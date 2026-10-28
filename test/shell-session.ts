/**
 * Integrated-terminal smoke: drives real shells through shell-session.ts in
 * plain node (electron and the workspace resolver are stubbed). Covers the
 * behavior the renderer relies on — real PTY attach, snapshot + seq protocol,
 * restart isolation, per-chat listing/cleanup.
 *
 *   npm run smoke:shell
 *
 * On Windows, run from a console you may see node-pty print "AttachConsole
 * failed" when a shell is killed: its process-list helper cannot attach to the
 * ConPTY while this runner owns a console, and node-pty falls back to killing
 * the shell PID. Electron's main process has no console, so the app is
 * unaffected. The assertions are what count.
 */
import assert from 'node:assert/strict'
import Module from 'node:module'

type Sent = { channel: string; payload: Record<string, unknown> }
const sent: Sent[] = []

// --- stub electron: every broadcast lands in `sent` ------------------------
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: Record<string, unknown>) => sent.push({ channel, payload })
  }
}
const electronStub = { BrowserWindow: { getAllWindows: () => [fakeWindow] } }
type Loader = { _load: (request: unknown, ...rest: unknown[]) => unknown }
const loader = Module as unknown as Loader
const originalLoad = loader._load
loader._load = function (request, ...rest) {
  if (request === 'electron') return electronStub
  return originalLoad.call(this, request, ...rest)
}

// Required (not imported) so the electron stub is in place first.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const shell =
  require('../src/main/services/shell-session') as typeof import('../src/main/services/shell-session')

const IS_WIN = process.platform === 'win32'

function outputFor(sessionId: string, sinceSeq = 0): string {
  return sent
    .filter(
      (s) =>
        s.channel === 'shell:output' &&
        s.payload.sessionId === sessionId &&
        (s.payload.seq as number) > sinceSeq
    )
    .map((s) => s.payload.chunk as string)
    .join('')
}

async function waitFor(pred: () => boolean, what: string, ms = 15_000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function main(): Promise<void> {
  const profiles = shell.listShellProfiles()
  console.log(
    'profiles:',
    profiles.map((p) => `${p.type}${p.isDefault ? '*' : ''}=${p.path}`).join(' | ')
  )
  assert.ok(profiles.length > 0, 'at least one shell detected')
  assert.equal(profiles.filter((p) => p.isDefault).length, 1, 'exactly one default')
  assert.ok(profiles[0].isDefault, 'default is listed first')

  const chat = `smoke-${Date.now()}`
  const shellType = IS_WIN ? 'cmd' : profiles[0].type

  // 1. Start on a real PTY at the requested size.
  const started = await shell.startShell(chat, { shellType, cols: 120, rows: 30 })
  assert.equal(started.running, true)
  assert.equal(started.shellType, shellType)
  assert.notEqual(started.backend, 'pipe', 'runs on a real pseudoterminal')
  assert.equal(started.cols, 120)
  assert.equal(started.ordinal, 1)

  const marker = 'ROXY_SMOKE_' + Math.random().toString(36).slice(2, 8)
  shell.writeShell(chat, `echo ${marker}\r`)
  // The echoed command plus its output: the marker appears at least twice.
  await waitFor(() => outputFor(chat).split(marker).length - 1 >= 2, 'echo output')

  // 2. Attaching again never respawns and its snapshot contains the output.
  const attached = await shell.startShell(chat, { shellType: IS_WIN ? 'powershell' : shellType })
  assert.equal(attached.shellType, shellType, 'attach does not switch a live shell')
  assert.ok(attached.snapshot.includes(marker), 'snapshot holds earlier output')
  assert.ok(attached.seq > 0)

  // 3. Resize reaches the mirror; the next snapshot reports it.
  assert.equal(shell.resizeShell(chat, 90, 20), true)
  const resized = await shell.getShellState(chat)
  assert.equal(resized.cols, 90)
  assert.equal(resized.rows, 20)

  // 4. Restart: the old process's death must not surface as an exit event or
  //    as output for the new shell.
  const exitsBefore = sent.filter((s) => s.channel === 'shell:exit').length
  const restartType = IS_WIN
    ? (profiles.find((p) => p.type === 'powershell' || p.type === 'pwsh')?.type ?? 'cmd')
    : shellType
  const restarted = await shell.restartShell(chat, { shellType: restartType })
  assert.equal(restarted.shellType, restartType)
  assert.equal(restarted.ordinal, 1, 'ordinal survives a restart')
  assert.equal(restarted.cols, 90, 'size survives a restart')
  assert.ok(!restarted.snapshot.includes(marker), 'restart starts from a clean screen')
  const seqAfterRestart = restarted.seq
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(
    sent.filter((s) => s.channel === 'shell:exit').length,
    exitsBefore,
    'a deliberate restart emits no exit event'
  )
  const marker2 = marker + '_B'
  shell.writeShell(chat, `echo ${marker2}\r`)
  await waitFor(() => outputFor(chat, seqAfterRestart).includes(marker2), 'output after restart')
  assert.ok(!outputFor(chat, seqAfterRestart).includes(marker + '\r'), 'no stale output leaked')

  // 5. Tabs: list, ordinals, real exit, cleanup.
  const tab = `${chat}#tab2`
  const second = await shell.startShell(tab, { shellType })
  assert.equal(second.ordinal, 2, 'next ordinal for the chat')
  const listed = shell.listShellSessions(chat)
  assert.deepEqual(
    listed.map((s) => s.sessionId),
    [chat, tab]
  )

  shell.writeShell(tab, 'exit\r')
  await waitFor(
    () => sent.some((s) => s.channel === 'shell:exit' && s.payload.sessionId === tab),
    'exit event for a real exit'
  )
  const dead = await shell.getShellState(tab)
  assert.equal(dead.running, false)
  assert.equal(dead.exitCode, 0)
  assert.equal(shell.writeShell(tab, 'x'), false, 'writes to a dead shell are refused')

  // 6. Clear wipes scrollback but leaves the shell running.
  shell.clearShell(chat)
  const cleared = await shell.getShellState(chat)
  assert.ok(!cleared.snapshot.includes(marker2 + '\r\n' + marker2), 'scrollback cleared')
  assert.equal(cleared.running, true)

  // 7. Deleting the chat kills every one of its terminals.
  shell.killShellsForChat(chat)
  assert.deepEqual(shell.listShellSessions(chat), [])

  // 8. Electron's env must not leak into the child shell.
  process.env.ELECTRON_RUN_AS_NODE = '1'
  const envChat = `${chat}-env`
  await shell.startShell(envChat, { shellType })
  shell.writeShell(
    envChat,
    IS_WIN ? 'echo [%ELECTRON_RUN_AS_NODE%]\r' : 'echo "[$ELECTRON_RUN_AS_NODE]"\r'
  )
  // Unset prints `[]` (sh) or the literal `[%ELECTRON_RUN_AS_NODE%]` (cmd);
  // leaked prints `[1]`. Wait for the second bracket group (the output, not the
  // echoed command line), then make sure it isn't the leaked value.
  await waitFor(() => (outputFor(envChat).match(/\]/g) ?? []).length >= 2, 'env echo')
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(!outputFor(envChat).includes('[1]'), 'ELECTRON_RUN_AS_NODE does not leak')
  shell.killAllShells()
  delete process.env.ELECTRON_RUN_AS_NODE

  console.log('shell-session smoke: ok')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
