import * as pty from 'node-pty'
import { spawn, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { BrowserWindow } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { ShellState, ShellType } from '../../shared/api'
import { sessionCwd } from './workspace'
import { isFloatingIconWindow, isVtuberWindow } from './overlay'

interface ShellSession {
  sessionId: string
  pty?: pty.IPty
  child?: ChildProcess
  shellType: ShellType
  cwd: string
  buffer: string
  running: boolean
  startedAt: number
}

const sessions = new Map<string, ShellSession>()
const MAX_BUFFER = 250_000

function extractChatId(sessionId: string): string {
  const hashIdx = sessionId.indexOf('#')
  return hashIdx === -1 ? sessionId : sessionId.slice(0, hashIdx)
}

function resolveShell(type?: ShellType): { cmd: string; args: string[]; resolvedType: ShellType } {
  const isWin = process.platform === 'win32'
  if (isWin) {
    if (type === 'cmd') {
      return {
        cmd: process.env.COMSPEC || 'cmd.exe',
        args: [],
        resolvedType: 'cmd'
      }
    }
    return {
      cmd: 'powershell.exe',
      args: ['-NoLogo'],
      resolvedType: 'powershell'
    }
  }

  const shell = process.env.SHELL || '/bin/bash'
  return {
    cmd: shell,
    args: ['-l'],
    resolvedType: 'bash'
  }
}

function broadcastChunk(sessionId: string, chunk: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !isFloatingIconWindow(win) && !isVtuberWindow(win)) {
      win.webContents.send(CHANNELS.shellOutput, { sessionId, chunk })
    }
  }
}

function broadcastExit(sessionId: string, code: number | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !isFloatingIconWindow(win) && !isVtuberWindow(win)) {
      win.webContents.send(CHANNELS.shellExit, { sessionId, code })
    }
  }
}

export function startShell(
  sessionId: string,
  preferredType?: ShellType,
  initialCols = 80,
  initialRows = 24
): ShellState {
  const existing = sessions.get(sessionId)
  if (existing && existing.running) {
    if (preferredType && preferredType !== existing.shellType) {
      killShell(sessionId)
    } else {
      return {
        running: existing.running,
        shellType: existing.shellType,
        cwd: existing.cwd,
        output: existing.buffer
      }
    }
  }

  const candidateCwd = sessionCwd(extractChatId(sessionId))
  let cwd = candidateCwd && fs.existsSync(candidateCwd) ? candidateCwd : process.cwd()
  if (!fs.existsSync(cwd)) {
    cwd = os.homedir()
  }

  const { cmd, args, resolvedType } = resolveShell(preferredType)
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...(process.platform === 'win32' ? { PYTHONIOENCODING: 'utf-8' } : {})
  }

  let ptyProc: pty.IPty | undefined
  try {
    ptyProc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: initialCols,
      rows: initialRows,
      cwd,
      env,
      useConpty: true
    })
  } catch (err) {
    console.warn('[shell-session] node-pty spawn failed, trying fallback:', err)
  }

  if (ptyProc) {
    const session: ShellSession = {
      sessionId,
      pty: ptyProc,
      shellType: resolvedType,
      cwd,
      buffer: existing?.buffer ?? '',
      running: true,
      startedAt: Date.now()
    }
    sessions.set(sessionId, session)

    ptyProc.onData((text: string) => {
      session.buffer = (session.buffer + text).slice(-MAX_BUFFER)
      broadcastChunk(sessionId, text)
    })

    ptyProc.onExit(({ exitCode }) => {
      session.running = false
      const exitMsg = `\r\n[Process exited with code ${exitCode ?? 0}]\r\n`
      session.buffer = (session.buffer + exitMsg).slice(-MAX_BUFFER)
      broadcastChunk(sessionId, exitMsg)
      broadcastExit(sessionId, exitCode ?? 0)
    })

    return {
      running: true,
      shellType: resolvedType,
      cwd,
      output: session.buffer
    }
  }

  const child = spawn(cmd, args.length === 0 && resolvedType === 'cmd' ? ['/K'] : args, {
    cwd,
    env: { ...env, TERM: 'dumb' },
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const session: ShellSession = {
    sessionId,
    child,
    shellType: resolvedType,
    cwd,
    buffer: existing?.buffer ?? '',
    running: true,
    startedAt: Date.now()
  }
  sessions.set(sessionId, session)

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    session.buffer = (session.buffer + text).slice(-MAX_BUFFER)
    broadcastChunk(sessionId, text)
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    session.buffer = (session.buffer + text).slice(-MAX_BUFFER)
    broadcastChunk(sessionId, text)
  })

  child.on('exit', (code, signal) => {
    session.running = false
    const exitMsg = `\r\n[Process exited with code ${code ?? (signal ? `signal ${signal}` : 0)}]\r\n`
    session.buffer = (session.buffer + exitMsg).slice(-MAX_BUFFER)
    broadcastChunk(sessionId, exitMsg)
    broadcastExit(sessionId, code)
  })

  child.on('error', (err) => {
    session.running = false
    const errMsg = `\r\n[Shell error: ${err.message}]\r\n`
    session.buffer = (session.buffer + errMsg).slice(-MAX_BUFFER)
    broadcastChunk(sessionId, errMsg)
    broadcastExit(sessionId, null)
  })

  return {
    running: true,
    shellType: resolvedType,
    cwd,
    output: session.buffer
  }
}

export function writeShell(sessionId: string, data: string): boolean {
  let session = sessions.get(sessionId)
  if (!session || !session.running) {
    startShell(sessionId, session?.shellType)
    session = sessions.get(sessionId)
  }
  if (!session || !session.running) {
    return false
  }

  if (session.pty) {
    try {
      session.pty.write(data)
      return true
    } catch {
      return false
    }
  }

  if (session.child && session.child.stdin && !session.child.stdin.destroyed) {
    if (data === '\x03') {
      if (process.platform === 'win32') {
        session.child.stdin.write('\x03\r\n')
      } else {
        session.child.kill('SIGINT')
      }
      return true
    }

    const line = data.endsWith('\n')
      ? data
      : process.platform === 'win32'
        ? `${data}\r\n`
        : `${data}\n`

    try {
      session.child.stdin.write(line)
      return true
    } catch {
      return false
    }
  }

  return false
}

export function resizeShell(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId)
  if (!session || !session.running || !session.pty) return false
  try {
    const validCols = Math.max(10, Math.floor(cols) || 80)
    const validRows = Math.max(2, Math.floor(rows) || 24)
    session.pty.resize(validCols, validRows)
    return true
  } catch {
    return false
  }
}

export function killShell(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  session.running = false

  if (session.pty) {
    try {
      session.pty.kill()
    } catch {
      // ignore
    }
  }

  if (session.child && session.child.pid) {
    if (process.platform === 'win32') {
      const taskkill = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'taskkill.exe'
      )
      try {
        spawn(taskkill, ['/pid', String(session.child.pid), '/t', '/f'], { windowsHide: true })
      } catch {
        try {
          session.child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    } else {
      try {
        session.child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }

  sessions.delete(sessionId)
  return true
}

export function restartShell(sessionId: string, shellType?: ShellType): ShellState {
  killShell(sessionId)
  return startShell(sessionId, shellType)
}

export function clearShell(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (session) {
    session.buffer = ''
    if (session.pty) {
      try {
        session.pty.clear()
      } catch {
        // ignore
      }
    }
  }
  return true
}

export function getShellState(sessionId: string): ShellState {
  const session = sessions.get(sessionId)
  if (session) {
    return {
      running: session.running,
      shellType: session.shellType,
      cwd: session.cwd,
      output: session.buffer
    }
  }

  const candidateCwd = sessionCwd(extractChatId(sessionId))
  let cwd = candidateCwd && fs.existsSync(candidateCwd) ? candidateCwd : process.cwd()
  if (!fs.existsSync(cwd)) {
    cwd = os.homedir()
  }

  return {
    running: false,
    shellType: process.platform === 'win32' ? 'powershell' : 'bash',
    cwd,
    output: ''
  }
}

export function killAllShells(): void {
  for (const id of Array.from(sessions.keys())) {
    killShell(id)
  }
}
