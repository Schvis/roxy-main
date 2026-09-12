import { globalShortcut, BrowserWindow, app, Tray, Menu, screen } from 'electron'
import { AppSettings } from '../../shared/types'
import icon from '../../../resources/icon.png?asset'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as repo from '../db/repo'

let currentShortcut: string | null = null
let tray: Tray | null = null
let overlayWindow: BrowserWindow | null = null
let floatingIconWindow: BrowserWindow | null = null
let isOverlayOpen = false
let isMainWindowVisible = true
let isTakingScreenshot = false

export function setMainWindowVisibility(isVisible: boolean) {
  isMainWindowVisible = isVisible
  if (!repo.getSettings().overlayMode) return

  if (isVisible) {
    if (floatingIconWindow && !floatingIconWindow.isDestroyed()) {
      floatingIconWindow.hide()
    }
  } else {
    if (!isOverlayOpen) {
      getOrCreateFloatingIconWindow().showInactive()
    }
  }
}

function getOrCreateFloatingIconWindow(): BrowserWindow {
  if (floatingIconWindow && !floatingIconWindow.isDestroyed()) {
    return floatingIconWindow
  }

  const savedPos = repo.getSettings().overlayIconPosition

  floatingIconWindow = new BrowserWindow({
    width: 80,
    height: 80,
    x: savedPos?.x,
    y: savedPos?.y,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  floatingIconWindow.on('moved', () => {
    if (floatingIconWindow && !floatingIconWindow.isDestroyed()) {
      const bounds = floatingIconWindow.getBounds()
      repo.setOverlayIconPosition(bounds.x, bounds.y)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    floatingIconWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/floating-icon')
  } else {
    floatingIconWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: '/floating-icon'
    })
  }

  return floatingIconWindow
}

export function toggleOverlayState(forceOpen?: boolean) {
  isOverlayOpen = forceOpen ?? !isOverlayOpen
  const overlay = getOrCreateOverlayWindow()
  const iconWin = getOrCreateFloatingIconWindow()

  if (isOverlayOpen) {
    const iconBounds = iconWin.getBounds()
    const overlayBounds = overlay.getBounds()
    const display = screen.getDisplayNearestPoint({ x: iconBounds.x, y: iconBounds.y })

    let x = Math.round(iconBounds.x + iconBounds.width + 10)
    let y = Math.round(iconBounds.y)

    if (x + overlayBounds.width > display.workArea.x + display.workArea.width) {
      x = Math.round(iconBounds.x - overlayBounds.width - 10)
    }

    if (x < display.workArea.x) x = display.workArea.x
    if (x + overlayBounds.width > display.workArea.x + display.workArea.width) {
      x = display.workArea.x + display.workArea.width - overlayBounds.width
    }
    if (y + overlayBounds.height > display.workArea.y + display.workArea.height) {
      y = display.workArea.y + display.workArea.height - overlayBounds.height
    }
    if (y < display.workArea.y) y = display.workArea.y

    overlay.setPosition(x, y)

    overlay.show()
    overlay.focus()
  } else {
    overlay.hide()
    if (!isMainWindowVisible) {
      iconWin.showInactive()
    }
  }
}

let wasOverlayVisible = false
let wasIconVisible = false
let wasVtuberVisible = false

export function hideForScreenshot() {
  isTakingScreenshot = true
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    wasOverlayVisible = overlayWindow.isVisible()
    if (wasOverlayVisible) overlayWindow.hide()
  }
  if (floatingIconWindow && !floatingIconWindow.isDestroyed()) {
    wasIconVisible = floatingIconWindow.isVisible()
    if (wasIconVisible) floatingIconWindow.hide()
  }
  if (vtuberWindow && !vtuberWindow.isDestroyed()) {
    wasVtuberVisible = vtuberWindow.isVisible()
    if (wasVtuberVisible) vtuberWindow.hide()
  }
}

export function restoreAfterScreenshot() {
  if (overlayWindow && !overlayWindow.isDestroyed() && wasOverlayVisible) {
    overlayWindow.show()
  }
  if (floatingIconWindow && !floatingIconWindow.isDestroyed() && wasIconVisible) {
    floatingIconWindow.showInactive()
  }
  if (vtuberWindow && !vtuberWindow.isDestroyed() && wasVtuberVisible) {
    vtuberWindow.show()
  }
  // Reset flag after a short delay to ensure blur events have settled
  setTimeout(() => {
    isTakingScreenshot = false
  }, 100)
}

function getOrCreateOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }

  overlayWindow = new BrowserWindow({
    width: 450,
    height: 650,
    minWidth: 300,
    minHeight: 400,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  overlayWindow.on('blur', () => {
    if (isTakingScreenshot) return
    if (floatingIconWindow && floatingIconWindow.isFocused()) return
    if (isOverlayOpen) toggleOverlayState(false)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/overlay')
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
  }

  return overlayWindow
}

let vtuberWindow: BrowserWindow | null = null

export function getOrCreateVtuberWindow(): BrowserWindow {
  if (vtuberWindow && !vtuberWindow.isDestroyed()) {
    return vtuberWindow
  }

  const savedBounds = repo.getSettings().vtuberWindowBounds
  const primary = screen.getPrimaryDisplay()
  const defaultWidth = savedBounds?.width ?? 340
  const defaultHeight = savedBounds?.height ?? 440
  let defaultX =
    savedBounds?.x ?? Math.round(primary.workArea.x + primary.workArea.width - defaultWidth - 20)
  let defaultY =
    savedBounds?.y ?? Math.round(primary.workArea.y + primary.workArea.height - defaultHeight - 20)

  // Ensure window is reachable on an active display
  if (savedBounds?.x !== undefined && savedBounds?.y !== undefined) {
    const isVisible = screen.getAllDisplays().some((d) => {
      const wa = d.workArea
      return (
        defaultX + defaultWidth - 40 >= wa.x &&
        defaultX + 40 <= wa.x + wa.width &&
        defaultY + defaultHeight - 40 >= wa.y &&
        defaultY + 40 <= wa.y + wa.height
      )
    })
    if (!isVisible) {
      defaultX = Math.round(primary.workArea.x + primary.workArea.width - defaultWidth - 20)
      defaultY = Math.round(primary.workArea.y + primary.workArea.height - defaultHeight - 20)
      repo.setVtuberWindowBounds(defaultWidth, defaultHeight, defaultX, defaultY)
    }
  }

  vtuberWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 160,
    minHeight: 200,
    x: defaultX,
    y: defaultY,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: false
    }
  })

  vtuberWindow.on('resized', () => {
    if (vtuberWindow && !vtuberWindow.isDestroyed()) {
      const b = vtuberWindow.getBounds()
      repo.setVtuberWindowBounds(b.width, b.height, b.x, b.y)
    }
  })

  vtuberWindow.on('moved', () => {
    if (vtuberWindow && !vtuberWindow.isDestroyed()) {
      const b = vtuberWindow.getBounds()
      repo.setVtuberWindowBounds(b.width, b.height, b.x, b.y)
    }
  })

  vtuberWindow.once('ready-to-show', () => {
    if (vtuberWindow && !vtuberWindow.isDestroyed()) {
      vtuberWindow.show()
    }
  })

  vtuberWindow.on('closed', () => {
    vtuberWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    vtuberWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/vtuber')
  } else {
    vtuberWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/vtuber' })
  }

  return vtuberWindow
}

export function openVtuberWindow(): void {
  const win = getOrCreateVtuberWindow()
  if (!win.isVisible()) {
    win.show()
  }
}

export function closeVtuberWindow(): void {
  if (vtuberWindow && !vtuberWindow.isDestroyed()) {
    vtuberWindow.close()
    vtuberWindow = null
  }
}

export function resetVtuberPosition(): AppSettings {
  const primary = screen.getPrimaryDisplay()
  const defaultWidth = 340
  const defaultHeight = 440
  const defaultX = Math.round(primary.workArea.x + primary.workArea.width - defaultWidth - 20)
  const defaultY = Math.round(primary.workArea.y + primary.workArea.height - defaultHeight - 20)

  if (vtuberWindow && !vtuberWindow.isDestroyed()) {
    if (vtuberWindow.isMinimized()) {
      vtuberWindow.restore()
    }
    vtuberWindow.setBounds({
      width: defaultWidth,
      height: defaultHeight,
      x: defaultX,
      y: defaultY
    })
    if (!vtuberWindow.isVisible()) {
      vtuberWindow.show()
    }
    vtuberWindow.focus()
  } else if (repo.getSettings().vtuberEnabled) {
    openVtuberWindow()
  }

  return repo.setVtuberWindowBounds(defaultWidth, defaultHeight, defaultX, defaultY)
}

export function isVtuberWindow(win: BrowserWindow): boolean {
  return win === vtuberWindow
}

export function isOverlayWindow(win: BrowserWindow): boolean {
  return win === overlayWindow || win === floatingIconWindow || win === vtuberWindow
}

export function isFloatingIconWindow(win: BrowserWindow): boolean {
  return win === floatingIconWindow
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function isOverlayOpenState(): boolean {
  return isOverlayOpen
}

export function getIsMainWindowVisible(): boolean {
  return isMainWindowVisible
}

export function updateOverlayShortcut(settings: AppSettings): void {
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
    currentShortcut = null
  }
  if (settings.overlayMode && settings.overlayKeybind) {
    try {
      globalShortcut.register(settings.overlayKeybind, () => {
        toggleOverlayState()
      })
      currentShortcut = settings.overlayKeybind
    } catch (err) {
      console.error('Failed to register overlay shortcut:', err)
    }
  }

  if (settings.overlayMode) {
    if (!isOverlayOpen && !isMainWindowVisible) {
      getOrCreateFloatingIconWindow().showInactive()
    }

    if (!tray) {
      tray = new Tray(icon)
      tray.setToolTip('Roxy')

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Show Roxy',
          click: () => {
            const windows = BrowserWindow.getAllWindows().filter((w) => w !== overlayWindow)
            if (windows.length > 0) {
              windows[0].show()
              windows[0].focus()
            } else {
              app.emit('activate')
            }
          }
        },
        {
          label: 'Reset VTuber Position',
          click: () => {
            resetVtuberPosition()
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.quit()
          }
        }
      ])

      tray.setContextMenu(contextMenu)

      tray.on('click', () => {
        const windows = BrowserWindow.getAllWindows().filter((w) => w !== overlayWindow)
        if (windows.length > 0) {
          windows[0].show()
          windows[0].focus()
        } else {
          app.emit('activate')
        }
      })
    }
  } else {
    if (tray) {
      tray.destroy()
      tray = null
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy()
      overlayWindow = null
    }
    if (floatingIconWindow && !floatingIconWindow.isDestroyed()) {
      floatingIconWindow.destroy()
      floatingIconWindow = null
    }
    isOverlayOpen = false
  }
}
