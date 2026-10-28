/**
 * Integrated terminal sessions — one real shell per terminal tab.
 *
 * Design:
 *  - Shells run inside a real pseudoterminal (ConPTY on Windows 10 1809+,
 *    winpty before that, a Unix PTY elsewhere), so cmd, PowerShell, vim, less,
 *    progress bars and line editing behave exactly as in Windows Terminal. A
 *    plain stdin/stdout pipe is only a last-resort fallback when node-pty fails.
 *  - Every session is mirrored into a headless xterm. Re-attaching (the dialog
 *    reopened, popped out, a second window) serializes that mirror instead of
 *    replaying a raw byte buffer, so the screen, colors, cursor and alternate
 *    screen come back exactly, at any size, and the snapshot never exceeds the
 *    scrollback limit.
 *  - Output is coalesced (~5 ms) before crossing IPC; a flood like `dir /s`
 *    becomes a few hundred messages instead of tens of thousands.
 *  - Every chunk carries a sequence number from ONE process-wide counter. A
 *    client applies a snapshot taken at `seq` and then only chunks with a larger
 *    seq, so nothing is shown twice or lost while attaching, and stale output
 *    from a shell that was just restarted can never leak into its successor.
 *  - A session is replaced as a unit: the old one is marked disposed before its
 *    process is killed, so its late `exit` doesn't paint "[exited]" over the new
 *    shell or tell the renderer a fresh shell died.
 *
 * Session ids are `<chatId>` for a chat's first terminal and `<chatId>#<tab>`
 * for the rest; the chat id is what resolves the working directory.
 */
import * as pty from 'node-pty'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { BrowserWindow } from 'electron'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { CHANNELS } from '../../shared/ipc'
import type {
  ShellBackend,
  ShellProfile,
  ShellSessionInfo,
  ShellStartOptions,
  ShellState,
  ShellType
} from '../../shared/api'
import { sessionCwd } from './workspace'
import { isFloatingIconWindow, isVtuberWindow } from './overlay'

const IS_WIN = process.platform === 'win32'
const SCROLLBACK = 10_000
const FLUSH_MS = 5
/** Flush immediately once this much output is pending, to bound latency. */
const FLUSH_BYTES = 256 * 1024

interface ShellSession {
  sessionId: string
  chatId: string
  pty?: pty.IPty
  child?: ChildProcess
  shellType: ShellType
  backend: ShellBackend
  cwd: string
  title: string
  ordinal: number
  running: boolean
  exitCode: number | null
  /** Set before a deliberate kill so the dying process's events are ignored. */
  disposed: boolean
  /** The OS process is gone (set even after disposal, unlike `running`). */
  processGone: boolean
  mirror: HeadlessTerminal
  serializer: SerializeAddon
  cols: number
  rows: number
  /** Seq of the last chunk written to the mirror. */
  lastSeq: number
  pending: string
  flushTimer: NodeJS.Timeout | null
  /** Bypass output batching briefly after keyboard input. */
  interactiveUntil: number
  /** Pipe fallback only: the line being typed (there is no tty line discipline). */
  lineBuffer: string
  listeners: Array<{ dispose(): void }>
}

const sessions = new Map<string, ShellSession>()
let globalSeq = 0

function extractChatId(sessionId: string): string {
  const hashIdx = sessionId.indexOf('#')
  return hashIdx === -1 ? sessionId : sessionId.slice(0, hashIdx)
}

/** `10.0.22631` -> 22631. Drives the ConPTY/winpty choice and xterm reflow. */
function windowsBuild(): number | undefined {
  if (!IS_WIN) return undefined
  const build = Number(os.release().split('.')[2])
  return Number.isFinite(build) ? build : undefined
}

function windowsBackend(): ShellBackend {
  // node-pty's own threshold: ConPTY exists from 17134 but is unstable before 18309.
  return (windowsBuild() ?? 0) >= 18309 ? 'conpty' : 'winpty'
}

// ---------------------------------------------------------------------------
// Shell detection
// ---------------------------------------------------------------------------

function isFile(p: string | undefined): p is string {
  if (!p) return false
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function findOnPath(names: string[]): string | undefined {
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

function firstFile(candidates: Array<string | undefined>): string | undefined {
  return candidates.find(isFile)
}

function windowsHasWslDistro(): boolean {
  // wsl.exe ships with Windows even when no distro is installed, and then only
  // prints install instructions. Registered distros live under Lxss.
  try {
    const out = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'],
      { windowsHide: true, timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return /\\\{[0-9a-f-]+\}/i.test(out)
  } catch {
    return false
  }
}

function detectWindowsShells(): ShellProfile[] {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows'
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)']
  const localApp = process.env.LOCALAPPDATA
  const found: Array<Omit<ShellProfile, 'isDefault'>> = []

  const pwsh = firstFile([
    path.join(pf, 'PowerShell', '7', 'pwsh.exe'),
    path.join(pf, 'PowerShell', '7-preview', 'pwsh.exe'),
    findOnPath(['pwsh.exe'])
  ])
  if (pwsh) found.push({ type: 'pwsh', path: pwsh })

  const powershell = firstFile([
    path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    findOnPath(['powershell.exe'])
  ])
  if (powershell) found.push({ type: 'powershell', path: powershell })

  const cmd = firstFile([process.env.ComSpec, path.join(sysRoot, 'System32', 'cmd.exe')])
  found.push({ type: 'cmd', path: cmd ?? 'cmd.exe' })

  const gitOnPath = findOnPath(['git.exe'])
  const gitBash = firstFile([
    path.join(pf, 'Git', 'bin', 'bash.exe'),
    pf86 ? path.join(pf86, 'Git', 'bin', 'bash.exe') : undefined,
    localApp ? path.join(localApp, 'Programs', 'Git', 'bin', 'bash.exe') : undefined,
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    // <git>\cmd\git.exe -> <git>\bin\bash.exe
    gitOnPath ? path.join(path.dirname(path.dirname(gitOnPath)), 'bin', 'bash.exe') : undefined
  ])
  if (gitBash) found.push({ type: 'gitbash', path: gitBash })

  const wsl = path.join(sysRoot, 'System32', 'wsl.exe')
  if (isFile(wsl) && windowsHasWslDistro()) found.push({ type: 'wsl', path: wsl })

  // Same default as VS Code: PowerShell 7 when installed, else Windows PowerShell.
  const defaultType: ShellType = pwsh ? 'pwsh' : powershell ? 'powershell' : 'cmd'
  return found.map((s) => ({ ...s, isDefault: s.type === defaultType }))
}

function unixShellType(file: string): ShellType {
  const base = path.basename(file)
  if (base === 'zsh') return 'zsh'
  if (base === 'fish') return 'fish'
  return 'bash'
}

function detectUnixShells(): ShellProfile[] {
  const login = process.env.SHELL && isFile(process.env.SHELL) ? process.env.SHELL : undefined
  const candidates: Record<'bash' | 'zsh' | 'fish', string[]> = {
    bash: ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash'],
    zsh: ['/bin/zsh', '/usr/bin/zsh', '/opt/homebrew/bin/zsh', '/usr/local/bin/zsh'],
    fish: ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish']
  }
  const found = new Map<ShellType, string>()
  if (login) found.set(unixShellType(login), login)
  for (const type of ['zsh', 'bash', 'fish'] as const) {
    if (found.has(type)) continue
    const hit = firstFile(candidates[type])
    if (hit) found.set(type, hit)
  }
  if (found.size === 0) found.set('bash', '/bin/sh')
  const defaultType = login ? unixShellType(login) : (found.keys().next().value as ShellType)
  return Array.from(found, ([type, file]) => ({
    type,
    path: file,
    isDefault: type === defaultType
  }))
}

let profileCache: ShellProfile[] | null = null

export function listShellProfiles(): ShellProfile[] {
  if (!profileCache) {
    const detected = IS_WIN ? detectWindowsShells() : detectUnixShells()
    // Default first, so a client can just take [0].
    profileCache = detected.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  }
  return profileCache
}

function defaultShellType(): ShellType {
  return listShellProfiles()[0]?.type ?? (IS_WIN ? 'powershell' : 'bash')
}

function resolveShell(type?: ShellType): { file: string; args: string[]; type: ShellType } {
  const profiles = listShellProfiles()
  // An unknown/uninstalled type (e.g. pwsh uninstalled since the tab was made)
  // falls back to the default rather than failing to spawn.
  const profile = profiles.find((p) => p.type === type) ?? profiles[0]
  const resolved = profile?.type ?? defaultShellType()
  const file = profile?.path ?? (IS_WIN ? 'powershell.exe' : '/bin/sh')
  switch (resolved) {
    case 'powershell':
    case 'pwsh':
      return { file, args: ['-NoLogo'], type: resolved }
    case 'cmd':
      return { file, args: [], type: resolved }
    case 'gitbash':
      return { file, args: ['--login', '-i'], type: resolved }
    case 'wsl':
      // wsl.exe translates the Windows cwd to /mnt/<drive>/… on its own.
      return { file, args: [], type: resolved }
    default:
      return { file, args: ['-l'], type: resolved }
  }
}

function shellEnv(type: ShellType): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    // Electron's own switches must not leak into user programs:
    // ELECTRON_RUN_AS_NODE makes any Electron app launched from here start as
    // bare node, and the dev-server URL is meaningless to them.
    if (/^ELECTRON_/i.test(key)) continue
    env[key] = value
  }
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Roxy'
  // Windows console programs don't read TERM, and Windows Terminal doesn't set
  // it either; setting it can push tools like git onto Unix code paths. MSYS
  // (Git Bash) and Unix shells do need it.
  if (!IS_WIN || type === 'gitbash') env.TERM = 'xterm-256color'
  if (IS_WIN) env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8'
  if (!IS_WIN && !env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}

function resolveCwd(chatId: string): string {
  const candidate = sessionCwd(chatId)
  if (candidate && fs.existsSync(candidate)) return candidate
  return os.homedir()
}

// ---------------------------------------------------------------------------
// Broadcast + output pipeline
// ---------------------------------------------------------------------------

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !isFloatingIconWindow(win) && !isVtuberWindow(win)) {
      win.webContents.send(channel, payload)
    }
  }
}

function isCurrent(session: ShellSession): boolean {
  return !session.disposed && sessions.get(session.sessionId) === session
}

function flush(session: ShellSession): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
  if (!session.pending || !isCurrent(session)) {
    session.pending = ''
    return
  }
  const chunk = session.pending
  session.pending = ''
  const seq = ++globalSeq
  session.lastSeq = seq
  session.mirror.write(chunk)
  broadcast(CHANNELS.shellOutput, { sessionId: session.sessionId, chunk, seq })
}

function emitOutput(session: ShellSession, text: string): void {
  if (!text || !isCurrent(session)) return
  session.pending += text
  if (performance.now() < session.interactiveUntil || session.pending.length >= FLUSH_BYTES) {
    flush(session)
  } else if (!session.flushTimer) session.flushTimer = setTimeout(() => flush(session), FLUSH_MS)
}

function handleExit(session: ShellSession, code: number | null): void {
  session.processGone = true
  if (!isCurrent(session)) return
  flush(session)
  session.running = false
  session.exitCode = code
  broadcast(CHANNELS.shellExit, { sessionId: session.sessionId, code })
}

function createMirror(
  cols: number,
  rows: number,
  backend: ShellBackend
): { mirror: HeadlessTerminal; serializer: SerializeAddon } {
  const build = windowsBuild()
  const mirror = new HeadlessTerminal({
    cols,
    rows,
    scrollback: SCROLLBACK,
    allowProposedApi: true,
    // Same reflow heuristics as the visible terminal, so a snapshot taken after
    // a resize wraps the way the user saw it.
    ...((backend === 'conpty' || backend === 'winpty') && build
      ? { windowsPty: { backend, buildNumber: build } }
      : {})
  })
  const serializer = new SerializeAddon()
  mirror.loadAddon(serializer as unknown as Parameters<HeadlessTerminal['loadAddon']>[0])
  return { mirror, serializer }
}

function clampSize(cols?: number, rows?: number): { cols: number; rows: number } {
  return {
    cols: Math.min(1000, Math.max(10, Math.floor(cols ?? 0) || 80)),
    rows: Math.min(500, Math.max(2, Math.floor(rows ?? 0) || 24))
  }
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnSession(
  sessionId: string,
  options: ShellStartOptions,
  ordinal: number
): ShellSession {
  const chatId = extractChatId(sessionId)
  const cwd = resolveCwd(chatId)
  const { file, args, type } = resolveShell(options.shellType)
  const env = shellEnv(type)
  const { cols, rows } = clampSize(options.cols, options.rows)

  let ptyProc: pty.IPty | undefined
  try {
    ptyProc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env })
  } catch (err) {
    console.warn('[shell-session] node-pty spawn failed, falling back to pipes:', err)
  }

  const backend: ShellBackend = ptyProc ? (IS_WIN ? windowsBackend() : 'unix') : 'pipe'
  const { mirror, serializer } = createMirror(cols, rows, backend)

  const session: ShellSession = {
    sessionId,
    chatId,
    pty: ptyProc,
    shellType: type,
    backend,
    cwd,
    title: '',
    ordinal,
    running: true,
    exitCode: null,
    disposed: false,
    processGone: false,
    mirror,
    serializer,
    cols,
    rows,
    lastSeq: globalSeq,
    pending: '',
    flushTimer: null,
    interactiveUntil: 0,
    lineBuffer: '',
    listeners: []
  }

  session.listeners.push(
    mirror.onTitleChange((title) => {
      session.title = title
      if (isCurrent(session)) {
        broadcast(CHANNELS.shellTitle, { sessionId, title })
      }
    })
  )

  if (ptyProc) {
    session.listeners.push(
      ptyProc.onData((text) => emitOutput(session, text)),
      ptyProc.onExit(({ exitCode }) => handleExit(session, exitCode ?? 0))
    )
    return session
  }

  attachPipeFallback(session, file, args, env)
  return session
}

/**
 * Degraded mode for when no pseudoterminal is available. There's no tty, so
 * this supplies what a tty driver would: local echo, backspace, and turning
 * Enter into a full line. Full-screen programs and Tab completion can't work
 * here; ordinary commands do.
 */
function attachPipeFallback(
  session: ShellSession,
  file: string,
  args: string[],
  env: Record<string, string>
): void {
  let pipeArgs = args
  if (session.shellType === 'cmd') {
    // UTF-8 code page, so builtins don't emit OEM bytes we'd decode as mojibake.
    pipeArgs = ['/D', '/K', 'chcp 65001>nul']
  } else if (session.shellType === 'powershell' || session.shellType === 'pwsh') {
    pipeArgs = ['-NoLogo', '-NoExit', '-Command', '-']
  } else if (session.shellType !== 'wsl') {
    pipeArgs = ['-i']
  }

  const child = spawn(file, pipeArgs, {
    cwd: session.cwd,
    env: { ...env, TERM: 'dumb' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  session.child = child

  // A pipe gives bare \n; xterm needs \r\n to return the carriage.
  const toTerminal = (chunk: Buffer): void =>
    emitOutput(session, chunk.toString('utf8').replace(/\r?\n/g, '\r\n'))
  child.stdout?.on('data', toTerminal)
  child.stderr?.on('data', toTerminal)
  child.on('exit', (code) => handleExit(session, code))
  child.on('error', (err) => {
    emitOutput(session, `\r\n${err.message}\r\n`)
    handleExit(session, null)
  })
}

function pipeInput(session: ShellSession, data: string): boolean {
  const stdin = session.child?.stdin
  if (!stdin || stdin.destroyed) return false
  // Cursor keys, function keys, focus reports: meaningless without a tty.
  if (data.startsWith('\x1b')) return true
  const newline = IS_WIN ? '\r\n' : '\n'
  let echo = ''
  let prev = ''
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      if (!(ch === '\n' && prev === '\r')) {
        stdin.write(session.lineBuffer + newline)
        session.lineBuffer = ''
        echo += '\r\n'
      }
    } else if (ch === '\x7f' || ch === '\b') {
      if (session.lineBuffer) {
        session.lineBuffer = Array.from(session.lineBuffer).slice(0, -1).join('')
        echo += '\b \b'
      }
    } else if (ch === '\x03') {
      session.lineBuffer = ''
      echo += '^C\r\n'
      if (!IS_WIN) session.child?.kill('SIGINT')
    } else if (ch >= ' ' || ch === '\t') {
      session.lineBuffer += ch
      echo += ch
    }
    prev = ch
  }
  emitOutput(session, echo)
  return true
}

function killProcess(session: ShellSession): void {
  // Killing an exited ConPTY makes node-pty's console-list helper fail
  // ("AttachConsole failed") — and there is nothing left to kill anyway.
  if (session.processGone) return
  if (session.pty) {
    try {
      session.pty.kill()
    } catch {
      // already gone
    }
  }
  const pid = session.child?.pid
  if (session.child && pid && session.child.exitCode === null) {
    if (IS_WIN) {
      const taskkill = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'taskkill.exe'
      )
      try {
        spawn(taskkill, ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
      } catch {
        session.child.kill()
      }
    } else {
      session.child.kill('SIGKILL')
    }
  }
}

function disposeSession(session: ShellSession): void {
  session.disposed = true
  session.running = false
  if (session.flushTimer) clearTimeout(session.flushTimer)
  session.flushTimer = null
  session.pending = ''
  for (const l of session.listeners) {
    try {
      l.dispose()
    } catch {
      // ignore
    }
  }
  session.listeners = []
  killProcess(session)
  session.mirror.dispose()
}

function nextOrdinal(chatId: string): number {
  let max = 0
  for (const s of sessions.values()) {
    if (s.chatId === chatId) max = Math.max(max, s.ordinal)
  }
  return max + 1
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function snapshot(session: ShellSession): Promise<ShellState> {
  flush(session)
  const seq = session.lastSeq
  return new Promise((resolve) => {
    // Writes are parsed in order and a write's callback fires before the next
    // chunk is parsed, so this captures the mirror exactly as of `seq`.
    session.mirror.write('', () => {
      let serialized = ''
      try {
        serialized = session.disposed
          ? ''
          : session.serializer.serialize({ scrollback: SCROLLBACK })
      } catch (err) {
        console.warn('[shell-session] serialize failed:', err)
      }
      resolve({
        ...stateFields(session),
        snapshot: serialized,
        seq
      })
    })
  })
}

function stateFields(session: ShellSession): Omit<ShellState, 'snapshot' | 'seq'> {
  return {
    sessionId: session.sessionId,
    running: session.running,
    shellType: session.shellType,
    backend: session.backend,
    windowsBuild: windowsBuild(),
    cwd: session.cwd,
    title: session.title,
    ordinal: session.ordinal,
    exitCode: session.exitCode,
    cols: session.cols,
    rows: session.rows
  }
}

/**
 * Attach to a session, spawning a shell only if none is running. Never kills a
 * live shell — changing the type of a running one is `restartShell`.
 */
export function startShell(
  sessionId: string,
  options: ShellStartOptions = {}
): Promise<ShellState> {
  const existing = sessions.get(sessionId)
  if (existing?.running) return snapshot(existing)

  const ordinal = existing?.ordinal ?? options.ordinal ?? nextOrdinal(extractChatId(sessionId))
  const shellType = options.shellType ?? existing?.shellType
  if (existing) disposeSession(existing)
  const session = spawnSession(sessionId, { ...options, shellType }, ordinal)
  sessions.set(sessionId, session)
  return snapshot(session)
}

export function restartShell(
  sessionId: string,
  options: ShellStartOptions = {}
): Promise<ShellState> {
  const existing = sessions.get(sessionId)
  const ordinal = existing?.ordinal ?? options.ordinal ?? nextOrdinal(extractChatId(sessionId))
  const shellType = options.shellType ?? existing?.shellType
  const cols = options.cols ?? existing?.cols
  const rows = options.rows ?? existing?.rows
  if (existing) {
    sessions.delete(sessionId)
    disposeSession(existing)
  }
  const session = spawnSession(sessionId, { shellType, cols, rows }, ordinal)
  sessions.set(sessionId, session)
  return snapshot(session)
}

export function writeShell(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId)
  if (!session?.running) return false
  // Keep echo and line-editor redraws off the bulk-output batching timer.
  // Large pastes and Enter can trigger floods, so leave those batched.
  session.interactiveUntil = data.length <= 16 && !/[\r\n]/.test(data) ? performance.now() + 100 : 0
  if (session.pty) {
    try {
      session.pty.write(data)
      return true
    } catch {
      return false
    }
  }
  return pipeInput(session, data)
}

export function resizeShell(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  const size = clampSize(cols, rows)
  if (size.cols === session.cols && size.rows === session.rows) return true
  // Drain first: output produced at the old width must be parsed at that width.
  flush(session)
  session.cols = size.cols
  session.rows = size.rows
  session.mirror.resize(size.cols, size.rows)
  if (session.running && session.pty) {
    try {
      session.pty.resize(size.cols, size.rows)
    } catch {
      return false
    }
  }
  return true
}

export function killShell(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  sessions.delete(sessionId)
  disposeSession(session)
  return true
}

/** Kill every terminal a chat owns — its own and its `chatId#…` tabs. */
export function killShellsForChat(chatId: string): void {
  for (const session of Array.from(sessions.values())) {
    if (session.chatId === chatId) killShell(session.sessionId)
  }
}

export function clearShell(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  flush(session)
  // Erase scrollback only. The prompt stays put and the shell is undisturbed —
  // the same thing Windows Terminal's "Clear buffer" does.
  session.mirror.clear()
  return true
}

export function getShellState(sessionId: string): Promise<ShellState> {
  const session = sessions.get(sessionId)
  if (session) return snapshot(session)
  const type = defaultShellType()
  return Promise.resolve({
    sessionId,
    running: false,
    shellType: type,
    backend: IS_WIN ? windowsBackend() : 'unix',
    windowsBuild: windowsBuild(),
    cwd: resolveCwd(extractChatId(sessionId)),
    title: '',
    ordinal: 0,
    exitCode: null,
    cols: 80,
    rows: 24,
    snapshot: '',
    seq: globalSeq
  })
}

export function listShellSessions(chatId: string): ShellSessionInfo[] {
  return Array.from(sessions.values())
    .filter((s) => s.chatId === chatId)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => ({
      sessionId: s.sessionId,
      shellType: s.shellType,
      running: s.running,
      title: s.title,
      ordinal: s.ordinal,
      exitCode: s.exitCode
    }))
}

export function killAllShells(): void {
  for (const id of Array.from(sessions.keys())) {
    killShell(id)
  }
}
