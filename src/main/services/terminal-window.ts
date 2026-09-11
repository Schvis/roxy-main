import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import * as repo from '../db/repo'
import { resolveThemeById } from './themes'
import {
  OVERLAY_HEIGHT,
  applyWindowChrome,
  chromePlatform,
  initialBackgroundColor,
  initialOverlay
} from './window-chrome'

let terminalWindow: BrowserWindow | null = null

function loadTerminalRoute(win: BrowserWindow, sessionId?: string): void {
  const hash = sessionId ? `/terminal?session=${encodeURIComponent(sessionId)}` : '/terminal'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#' + hash)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

export function getOrCreateTerminalWindow(sessionId?: string): BrowserWindow {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    if (sessionId) {
      loadTerminalRoute(terminalWindow, sessionId)
    }
    return terminalWindow
  }

  const isMac = process.platform === 'darwin'
  terminalWindow = new BrowserWindow({
    width: 820,
    height: 580,
    minWidth: 460,
    minHeight: 340,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: initialBackgroundColor(),
    title: 'Roxy — Commands & Terminal',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 13 } }
      : { titleBarOverlay: initialOverlay(OVERLAY_HEIGHT.terminal) }),
    ...(isMac ? {} : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  terminalWindow.once('ready-to-show', () => {
    if (terminalWindow && !terminalWindow.isDestroyed()) {
      void resolveThemeById(repo.getSettings().activeThemeId, chromePlatform())
        .then((theme) => {
          if (terminalWindow && !terminalWindow.isDestroyed()) {
            applyWindowChrome(terminalWindow, theme)
          }
        })
        .catch(() => undefined)
      terminalWindow.show()
    }
  })

  terminalWindow.on('closed', () => {
    terminalWindow = null
  })

  loadTerminalRoute(terminalWindow, sessionId)
  return terminalWindow
}

export function openTerminalWindow(sessionId?: string): void {
  const win = getOrCreateTerminalWindow(sessionId)
  if (!win.isVisible()) {
    win.show()
  }
  win.focus()
}

export function closeTerminalWindow(): void {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    terminalWindow.close()
    terminalWindow = null
  }
}

export function isTerminalWindow(win: BrowserWindow): boolean {
  return win === terminalWindow
}
