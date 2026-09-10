import { globalShortcut, BrowserWindow } from 'electron'
import { AppSettings } from '../../shared/types'
import { CHANNELS } from '../../shared/ipc'
import * as repo from '../db/repo'
import {
  isOverlayWindow,
  toggleOverlayState,
  getOverlayWindow,
  isOverlayOpenState,
  getIsMainWindowVisible
} from './overlay'

let currentShortcut: string | null = null
let isPaused = false
let isRecording = false
let isHolding = false
let recordingStartTime = 0
let lastShortcutTime = 0
let releaseTimer: NodeJS.Timeout | null = null

function isValidGlobalAccelerator(shortcut: string): boolean {
  const parts = shortcut
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return false
  const hasModifier = parts.some((p) => {
    const l = p.toLowerCase()
    return (
      l === 'commandorcontrol' ||
      l === 'cmdorctrl' ||
      l === 'ctrl' ||
      l === 'control' ||
      l === 'alt' ||
      l === 'option' ||
      l === 'shift' ||
      l === 'super' ||
      l === 'command' ||
      l === 'cmd'
    )
  })
  const key = parts[parts.length - 1]
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/i.test(key)
  return hasModifier || isFunctionKey
}

function getTargetWindow(): BrowserWindow | null {
  if (isOverlayOpenState()) {
    const overlay = getOverlayWindow()
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
      return overlay
    }
  }

  const settings = repo.getSettings()
  if (settings.overlayMode && !getIsMainWindowVisible()) {
    toggleOverlayState(true)
    const overlay = getOverlayWindow()
    if (overlay && !overlay.isDestroyed()) {
      return overlay
    }
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !isOverlayWindow(win)) {
      if (win.isMinimized()) {
        win.restore()
      }
      return win
    }
  }

  return null
}

let activeRecordingWindow: BrowserWindow | null = null

function dispatchStartRecording(): void {
  const win = getTargetWindow()
  if (win && !win.isDestroyed()) {
    activeRecordingWindow = win
    win.webContents.send(CHANNELS.sttStartRecording)
  }
}

function dispatchStopRecording(): void {
  if (activeRecordingWindow && !activeRecordingWindow.isDestroyed()) {
    activeRecordingWindow.webContents.send(CHANNELS.sttStopRecording)
  }
  activeRecordingWindow = null
}

export function handleVoiceShortcutPress(): void {
  if (isPaused) return

  const now = Date.now()
  const elapsed = now - lastShortcutTime
  lastShortcutTime = now

  if (!isRecording) {
    isRecording = true
    isHolding = false
    recordingStartTime = now

    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }

    dispatchStartRecording()
    return
  }

  // Currently recording: detect auto-repeat from holding key vs intentional second tap
  const isRepeat = now - recordingStartTime < 650 || elapsed < 180
  if (isRepeat) {
    isHolding = true
    if (releaseTimer) {
      clearTimeout(releaseTimer)
    }
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (isHolding) {
        isHolding = false
        isRecording = false
        dispatchStopRecording()
      }
    }, 250)
    return
  }

  // Intentional second tap to stop
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  isHolding = false
  isRecording = false
  dispatchStopRecording()
}

export function updateVoiceShortcut(settings: AppSettings): void {
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut)
    } catch {
      // ignore
    }
    currentShortcut = null
  }

  if (isPaused) return

  const shortcut = settings.voiceKeybind?.trim()
  if (!shortcut || !isValidGlobalAccelerator(shortcut)) return

  try {
    const success = globalShortcut.register(shortcut, () => {
      handleVoiceShortcutPress()
    })
    if (success) {
      currentShortcut = shortcut
    } else {
      console.warn('[STT] Failed to register global voice shortcut:', shortcut)
    }
  } catch (err) {
    console.warn('[STT] Error registering global voice shortcut:', err)
  }
}

export function unregisterVoiceShortcut(): void {
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut)
    } catch {
      // ignore
    }
    currentShortcut = null
  }
}

export function setVoiceShortcutPaused(paused: boolean): void {
  isPaused = paused
  if (paused) {
    unregisterVoiceShortcut()
  } else {
    updateVoiceShortcut(repo.getSettings())
  }
}

export function setRecordingStateFromRenderer(recording: boolean): void {
  isRecording = recording
  if (!recording) {
    isHolding = false
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
  }
}
