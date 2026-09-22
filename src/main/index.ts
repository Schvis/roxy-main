import { app, shell, BrowserWindow, session, protocol, net, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import macDockIcon from '../../resources/icon-mac.png?asset'
import { registerIpc } from './ipc'
import { getDb } from './db/database'
import { startLoopScheduler } from './services/loops'
import { listModels } from './services/models'
import { backfillUsageFromHistory } from './services/usage'
import { listConnectedProviders } from './db/repo'
import { setAppIcon, closeAll as closeAllBrowsers } from './services/browser'
import {
  BROWSER_PARTITION,
  credentialsFor as browserProxyCredentials
} from './services/browser-proxy'
import { cleanupToolOutputs } from './services/tool-output-store'
import { cancelAllBackgroundJobs } from './services/background-tasks'
import { shutdownAllLsp } from './services/lsp'
import { shutdownAllMcp } from './services/mcp'
import { shutdownRemote } from './services/remote'
import { shutdownCliProxy } from './services/cliproxy'
import { initAutoUpdater } from './services/updater'
import { initTracking, shutdownTracking } from './services/track'
import { killAllBackground, setPromptText, setAgentPromptText } from './harness'
import { killAllShells } from './services/shell-session'
import { PROMPT_TEXT, AGENT_PROMPT_TEXT } from '../shared/prompt-text'
import { applyWindowChrome, chromePlatform, initialBackgroundColor } from './services/window-chrome'
import { resolveThemeById } from './services/themes'
import * as repo from './db/repo'
import { setMainWindow, focusMainWindow } from './services/main-window'
import {
  updateOverlayShortcut,
  isOverlayWindow,
  setMainWindowVisibility,
  openVtuberWindow
} from './services/overlay'
import { updateVoiceShortcut, unregisterVoiceShortcut } from './services/voice-shortcut'
import { startLocalTtsServer, stopLocalTtsServer } from './services/tts'
import { initDiscordRpc, shutdownDiscordRpc } from './services/discord-rpc'
import { flushAllActiveTurns } from './services/turn-recovery'
import { initPortableMode } from './services/portable-mode'

let isQuitting = false

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const savedIdeSize = repo.getIdeWindowSize()
  const mainWindow = new BrowserWindow({
    width: savedIdeSize?.width ?? 1100,
    height: savedIdeSize?.height ?? 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: initialBackgroundColor(),
    title: 'Roxy',
    // Window controls are rendered in the top navbar (or traffic lights on mac).
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 17 } } : {}),
    ...(isMac ? {} : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  setMainWindow(mainWindow)
  let saveWindowSizeTimer: NodeJS.Timeout | null = null
  const saveWindowSize = (): void => {
    if (mainWindow.isDestroyed()) return
    // `getNormalBounds()` returns the pre-Snap restore size on Windows. Use the
    // visible bounds for ordinary/snapped windows, but keep restore bounds for
    // minimized, maximized, and fullscreen states where current bounds are not
    // a useful startup size.
    const { width, height } =
      mainWindow.isMinimized() || mainWindow.isMaximized() || mainWindow.isFullScreen()
        ? mainWindow.getNormalBounds()
        : mainWindow.getBounds()
    repo.setIdeWindowSize(width, height)
  }
  mainWindow.on('resize', () => {
    if (saveWindowSizeTimer) clearTimeout(saveWindowSizeTimer)
    saveWindowSizeTimer = setTimeout(() => {
      saveWindowSizeTimer = null
      saveWindowSize()
    }, 200)
  })

  mainWindow.on('ready-to-show', () => {
    // Repaint the native window controls from the active theme before the
    // window is first shown. The constructor can only reach built-in themes
    // synchronously; this covers a user theme, whose file has to be read.
    void resolveThemeById(repo.getSettings().activeThemeId, chromePlatform())
      .then((theme) => applyWindowChrome(mainWindow, theme))
      .catch(() => undefined)
    mainWindow.show()
    const s = repo.getSettings()
    if (s.vtuberEnabled) {
      openVtuberWindow()
    }
  })

  mainWindow.on('close', (event) => {
    if (saveWindowSizeTimer) {
      clearTimeout(saveWindowSizeTimer)
      saveWindowSizeTimer = null
    }
    saveWindowSize()
    if (repo.getSettings().overlayMode && !isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    } else {
      flushAllActiveTurns('interrupted')
    }
  })

  mainWindow.webContents.on('render-process-gone', () => {
    flushAllActiveTurns('interrupted')
  })

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Close Without Saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes. Are you sure you want to close?'
    })
    if (choice === 0) {
      event.preventDefault()
    }
  })

  mainWindow.on('show', () => {
    setMainWindowVisibility(true)
  })

  mainWindow.on('hide', () => {
    setMainWindowVisibility(false)
  })

  // Open external links in the user's browser instead of a new Electron window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the Vite dev server in development, or the built HTML in production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * Warm the models.dev catalog for each connected provider (so `modelCost` can
 * price rows), then run the one-time history backfill. Fully best-effort — any
 * failure just leaves backfilled rows unpriced, which real turns fill in later.
 */
async function warmCatalogThenBackfill(): Promise<void> {
  try {
    const providers = listConnectedProviders()
    // Pull each provider's catalog once; listModels caches it process-wide, which
    // is exactly what modelCost() reads from.
    await Promise.allSettled(providers.map((p) => listModels(p.id)))
  } catch {
    // ignore — backfill still runs, just possibly unpriced
  }
  backfillUsageFromHistory()
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'roxy-local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true
    }
  }
])

initPortableMode()

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.whenReady().then(() => {
    protocol.handle('roxy-local', async (request) => {
      try {
        const url = new URL(request.url)
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Missing path', { status: 400 })
        return await net.fetch(pathToFileURL(filePath).toString())
      } catch (err) {
        return new Response(String(err), { status: 404 })
      }
    })

    electronApp.setAppUserModelId('com.roxy.app')
    // Give the agent's browser window the Roxy icon too (no asset import in the
    // browser service so the smoke's esbuild bundle stays happy).
    setAppIcon(icon)
    // Inject the tuned per-model + per-agent prompt text into the harness (imported
    // via `?raw` here in the Vite-built entry, so the esbuild smoke bundle never
    // sees it).
    setPromptText(PROMPT_TEXT)
    setAgentPromptText(AGENT_PROMPT_TEXT)

    if (process.platform === 'darwin') {
      // Use the padded variant so the dock icon matches Apple's size convention
      // (the full-bleed resources/icon.png would render oversized next to native apps).
      app.dock?.setIcon(macDockIcon)
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    app.on('login', (event, webContents, _details, authInfo, callback) => {
      if (!authInfo.isProxy || webContents.session !== session.fromPartition(BROWSER_PARTITION))
        return
      event.preventDefault()
      void browserProxyCredentials(authInfo).then((credentials) => {
        if (credentials) callback(credentials.username, credentials.password)
        else callback()
      })
    })

    // Grant media (microphone) and clipboard permissions
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (
        permission === 'media' ||
        permission === 'clipboard-read' ||
        permission === 'clipboard-sanitized-write'
      ) {
        callback(true)
        return
      }
      callback(false)
    })
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return (
        permission === 'media' ||
        permission === 'clipboard-read' ||
        permission === 'clipboard-sanitized-write'
      )
    })

    // Open the database (runs migrations) and wire up IPC before the first window.
    getDb()
    registerIpc()
    // Anonymous usage tracking (opt-out in Settings). Deliberately after the DB
    // and IPC are up so nothing here can delay the first window, and it owns its
    // own storage - a failure in it can't touch either.
    initTracking()
    startLoopScheduler()
    // Sweep tool-output spill files older than the retention window (best-effort).
    void cleanupToolOutputs()
    // One-time: seed the usage/cost table from existing message history so the
    // dashboard isn't empty after upgrading. Warm the models.dev catalog first so
    // backfilled rows can be priced (else they'd all cost $0). Best-effort + async.
    void warmCatalogThenBackfill()

    updateOverlayShortcut(repo.getSettings())
    updateVoiceShortcut(repo.getSettings())

    const initialSettings = repo.getSettings()
    if (
      initialSettings.ttsEnabled &&
      initialSettings.ttsAutoStart &&
      initialSettings.ttsProvider !== 'fish'
    ) {
      void startLocalTtsServer()
    }

    const mainWindow = createWindow()
    initAutoUpdater(mainWindow)
    initDiscordRpc()

    app.on('activate', () => {
      const windows = BrowserWindow.getAllWindows().filter((w) => !isOverlayWindow(w))
      if (windows.length === 0) {
        createWindow()
      } else {
        const win = windows[0]
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
        win.focus()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !repo.getSettings().overlayMode) {
    app.quit()
  }
})

// Kill any agent-started background processes (dev servers/watchers) on quit,
// cancel any in-flight background subagent tasks (Phase 11), and shut down any
// warm language servers (Phase 12).
// Last chance to send the queued events: 'before-quit' fires before windows
// start tearing down, which gives the final flush a real (if not guaranteed)
// window to reach the network. Losing it costs one app_close, nothing more.
app.on('before-quit', () => {
  isQuitting = true
  flushAllActiveTurns('interrupted')
  shutdownTracking()
})

app.on('will-quit', () => {
  flushAllActiveTurns('interrupted')
  unregisterVoiceShortcut()
  killAllBackground()
  killAllShells()
  cancelAllBackgroundJobs()
  closeAllBrowsers()
  shutdownAllLsp()
  void shutdownAllMcp()
  shutdownRemote()
  // The Codex sidecar holds the user's subscription tokens - never leave it
  // running (and listening on loopback) after the app that owns it is gone.
  shutdownCliProxy()
  void stopLocalTtsServer()
  shutdownDiscordRpc()
})
