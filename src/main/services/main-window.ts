import { app, BrowserWindow } from 'electron'
import { isOverlayWindow, toggleOverlayState } from './overlay'
import { isTerminalWindow } from './terminal-window'
import { setActiveChat } from './chat-events'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return null
}

export function isMainWindow(win: BrowserWindow): boolean {
  return win === mainWindow
}

export function focusMainWindow(sessionId?: string): void {
  let win = getMainWindow()
  if (!win) {
    win =
      BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && !isOverlayWindow(w) && !isTerminalWindow(w)
      ) ?? null
  }
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.setAlwaysOnTop(true)
    win.focus()
    win.setAlwaysOnTop(false)
    if (sessionId) {
      setActiveChat(sessionId)
    }
  } else {
    app.emit('activate')
  }
  toggleOverlayState(false)
}
