import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import os from 'node:os'
import path from 'node:path'

const mainSource = readFileSync('src/main/index.ts', 'utf8')
const identityBlock = mainSource.match(
  /if \(process\.platform === 'win32'\) \{\s*\/\/[^\n]*\n\s*app\.setAppUserModelId[^\n]*\n\s*\}/
)?.[0]
assert.ok(identityBlock, 'Windows sender identity is configured directly')
for (const [platform, packaged, expected] of [
  ['win32', false, 'Roxy'],
  ['win32', true, 'com.roxy.app'],
  ['darwin', false, null]
]) {
  let identity = null
  runInNewContext(identityBlock, {
    process: { platform },
    app: {
      isPackaged: packaged,
      setAppUserModelId: (id) => {
        identity = id
      }
    }
  })
  assert.equal(identity, expected)
}
assert.match(readFileSync('electron-builder.yml', 'utf8'), /^productName: Roxy$/m)

const handlers = new Map()
const requests = []
const shown = []
let enabled = true
let focused = false
let supported = true
let selected = null
let overlayFocused = false
let auxiliaryFocused = false
const overlay = { isDestroyed: () => false, isFocused: () => overlayFocused }
const auxiliary = { isDestroyed: () => false, isFocused: () => auxiliaryFocused }
const win = {
  isDestroyed: () => false,
  isFocused: () => focused,
  webContents: {
    send: (channel, payload) => {
      if (channel === 'agent-notification:requested') requests.push(payload)
    }
  }
}
class FakeNotification {
  constructor(options) {
    this.options = options
    this.listeners = new Map()
    shown.push(this)
  }
  static isSupported() {
    return supported
  }
  on(event, callback) {
    this.listeners.set(event, callback)
  }
  show() {
    this.displayed = true
  }
}
globalThis.notificationHarness = {
  electron: {
    BrowserWindow: { getAllWindows: () => [win, overlay, auxiliary] },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    Notification: FakeNotification
  },
  repo: {
    getSettings: () => ({ toastNotificationsEnabled: enabled }),
    getChat: (id) => (id === 'missing' ? null : { title: 'Test session' })
  },
  window: {
    getMainWindow: () => win,
    focusMainWindow: (id) => {
      selected = id
    }
  },
  overlay: {
    isOverlayWindow: (candidate) => candidate === overlay || candidate === auxiliary,
    isFloatingIconWindow: (candidate) => candidate === auxiliary,
    isVtuberWindow: () => false
  }
}
const root = mkdtempSync(path.join(os.tmpdir(), 'roxy-notifications-'))
try {
  const result = await build({
    entryPoints: ['src/main/services/agent-notifications.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'notification-dependencies',
        setup(builder) {
          builder.onResolve(
            { filter: /^(electron|\.\.\/db\/repo|\.\/main-window|\.\/overlay)$/ },
            ({ path: name }) => ({ path: name, namespace: 'mock' })
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => {
            const key =
              name === 'electron'
                ? 'electron'
                : name.includes('repo')
                  ? 'repo'
                  : name.includes('main-window')
                    ? 'window'
                    : 'overlay'
            return {
              contents: `module.exports = globalThis.notificationHarness.${key}`,
              loader: 'js'
            }
          })
        }
      }
    ]
  })
  const file = path.join(root, 'service.cjs')
  writeFileSync(file, result.outputFiles[0].text)
  const service = createRequire(import.meta.url)(file)
  service.initAgentNotifications()
  const show = handlers.get('agent-notification:show')
  const reply = (request) =>
    show({ sender: win.webContents }, request.id, 'Localized title', 'Localized body')

  focused = true
  service.requestAgentNotification('chat', 'done')
  assert.equal(requests.length, 0)
  focused = false
  overlayFocused = true
  service.requestAgentNotification('chat', 'done')
  assert.equal(requests.length, 0)
  overlayFocused = false
  auxiliaryFocused = true
  service.requestAgentNotification('chat', 'done')
  assert.equal(requests.length, 1)
  reply(requests.pop())
  shown.length = 0
  auxiliaryFocused = false
  enabled = false
  service.requestAgentNotification('chat', 'done')
  assert.equal(requests.length, 0)
  enabled = true
  supported = false
  service.requestAgentNotification('chat', 'done')
  assert.equal(requests.length, 0)
  supported = true
  service.requestAgentNotification('missing', 'done')
  assert.equal(requests.length, 0)

  service.requestAgentNotification('chat', 'input')
  const input = requests.pop()
  assert.equal(input.kind, 'input')
  show({ sender: {} }, input.id, 'Wrong window', 'Ignore')
  assert.equal(shown.length, 0)
  reply(input)
  assert.equal(shown.length, 1)
  assert.deepEqual(shown[0].options, { title: 'Localized title', body: 'Localized body' })
  assert.equal(shown[0].displayed, true)
  reply(input)
  assert.equal(shown.length, 1)
  shown[0].listeners.get('click')()
  assert.equal(selected, 'chat')

  service.requestAgentNotification('chat', 'done')
  focused = true
  reply(requests.pop())
  assert.equal(shown.length, 1)
  focused = false
  service.requestAgentNotification('chat', 'done')
  enabled = false
  reply(requests.pop())
  assert.equal(shown.length, 1)
  enabled = true

  const stopped = service.watchAgentNotifications('chat')
  stopped.finish(false, true)
  assert.equal(requests.length, 0)
  const foreground = service.watchAgentNotifications('chat', false)
  foreground.finish(true, false)
  assert.equal(requests.length, 0)
  const done = service.watchAgentNotifications('chat')
  done.finish(true, false)
  done.finish(true, false)
  assert.equal(requests.length, 1)
  reply(requests.pop())
  const command = service.watchAgentNotifications('chat')
  command.apply({ type: 'tool-start', callId: 'cmd', tool: 'bash' })
  command.apply({ type: 'tool-delta', callId: 'cmd', chunk: 'Continue? [Y/n] ' })
  await new Promise((resolve) => setTimeout(resolve, 850))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].kind, 'action')
  reply(requests.pop())
  command.finish(false, true)
  console.log('Agent notification service: passed')
} finally {
  delete globalThis.notificationHarness
  rmSync(root, { recursive: true, force: true })
}
