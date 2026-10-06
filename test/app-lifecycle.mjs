import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync('src/main/index.ts', 'utf8')
const start = source.indexOf('function createWindow(): BrowserWindow {')
const end = source.indexOf('\n/**', start)
assert.ok(start >= 0 && end > start, 'Main window factory exists')
const { code } = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' })

function harness(platform = 'win32', overlayMode = false) {
  let quitting = false
  let quits = 0
  let flushes = 0
  let hidden = false
  let destroyed = false
  let allowUnload = true
  const windows = []
  class FakeWindow extends EventEmitter {
    constructor() {
      super()
      this.webContents = new EventEmitter()
      this.webContents.setWindowOpenHandler = () => {}
      windows.push(this)
    }
    isDestroyed() {
      return destroyed
    }
    isMinimized() {
      return false
    }
    isMaximized() {
      return false
    }
    isFullScreen() {
      return false
    }
    getBounds() {
      return { width: 1100, height: 720 }
    }
    hide() {
      hidden = true
    }
    loadFile() {}
    close() {
      let prevented = false
      this.emit('close', {
        preventDefault: () => {
          prevented = true
        }
      })
      if (prevented || !allowUnload) return
      destroyed = true
      windows.splice(windows.indexOf(this), 1)
      this.emit('closed')
    }
  }
  const context = {
    process: { platform },
    BrowserWindow: FakeWindow,
    repo: {
      getIdeWindowSize: () => null,
      getSettings: () => ({ overlayMode }),
      setIdeWindowSize: () => {}
    },
    app: {
      quit: () => {
        quits++
      }
    },
    initialBackgroundColor: () => '#000000',
    icon: '',
    join: (...parts) => parts.join('\\'),
    __dirname: '.',
    setMainWindow: () => {},
    flushAllActiveTurns: () => {
      flushes++
    },
    is: { dev: false },
    setTimeout,
    clearTimeout
  }
  Object.defineProperty(context, 'isQuitting', { get: () => quitting })
  runInNewContext(code, context)
  const win = context.createWindow()
  // Hidden auxiliary windows prevent Electron's window-all-closed event.
  const auxiliary = new FakeWindow()
  return {
    win,
    auxiliary,
    windows,
    get quits() {
      return quits
    },
    get flushes() {
      return flushes
    },
    get hidden() {
      return hidden
    },
    get destroyed() {
      return destroyed
    },
    setQuitting: () => {
      quitting = true
    },
    cancelUnload: () => {
      allowUnload = false
    }
  }
}

for (const platform of ['win32', 'linux']) {
  const app = harness(platform)
  app.win.close()
  assert.equal(app.quits, 1, `${platform}: closing main window quits with auxiliary window alive`)
  assert.deepEqual(app.windows, [app.auxiliary])
  assert.equal(app.flushes, 1)

  const background = harness(platform, true)
  background.win.close()
  assert.equal(background.hidden, true)
  assert.equal(background.destroyed, false)
  assert.equal(background.quits, 0, `${platform}: background mode keeps app running`)
  assert.equal(background.flushes, 0)

  const cancelled = harness(platform)
  cancelled.cancelUnload()
  cancelled.win.close()
  assert.equal(cancelled.destroyed, false)
  assert.equal(cancelled.quits, 0, `${platform}: cancelled close does not quit`)

  const explicitQuit = harness(platform, true)
  explicitQuit.setQuitting()
  explicitQuit.win.close()
  assert.equal(explicitQuit.hidden, false)
  assert.equal(explicitQuit.destroyed, true)
  assert.equal(explicitQuit.quits, 0, `${platform}: explicit quit is not reentered`)
}

const mac = harness('darwin')
mac.win.close()
assert.equal(mac.destroyed, true)
assert.equal(mac.quits, 0, 'macOS preserves close-without-quit behavior')
console.log('APP LIFECYCLE OK')
