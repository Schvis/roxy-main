/**
 * Keyboard shortcut utilities for recording, parsing, and matching key combinations.
 */

export interface ParsedKeybind {
  cmdCtrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

export function normalizeKeyName(key: string): string {
  if (key === ' ') return 'Space'
  if (key === '+') return 'Plus'
  if (key === 'ArrowUp') return 'Up'
  if (key === 'ArrowDown') return 'Down'
  if (key === 'ArrowLeft') return 'Left'
  if (key === 'ArrowRight') return 'Right'
  if (key === 'Escape') return 'Esc'
  if (key.length === 1) return key.toUpperCase()
  return key
}

export function parseKeybind(keybind: string): ParsedKeybind {
  const parts = keybind
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  let cmdCtrl = false
  let alt = false
  let shift = false
  let key = ''

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (
      lower === 'commandorcontrol' ||
      lower === 'ctrl' ||
      lower === 'control' ||
      lower === 'cmd' ||
      lower === 'command'
    ) {
      cmdCtrl = true
    } else if (lower === 'alt' || lower === 'option') {
      alt = true
    } else if (lower === 'shift') {
      shift = true
    } else {
      key = part
    }
  }

  return { cmdCtrl, alt, shift, key }
}

export function matchesKeybindDown(e: KeyboardEvent, keybind: string): boolean {
  if (e.repeat) return false
  if (!keybind) return false

  const parsed = parseKeybind(keybind)
  const isCmdCtrl = e.ctrlKey || e.metaKey
  if (isCmdCtrl !== parsed.cmdCtrl) return false
  if (e.altKey !== parsed.alt) return false
  if (e.shiftKey !== parsed.shift) return false

  const eventKey = normalizeKeyName(e.key)
  return eventKey.toUpperCase() === parsed.key.toUpperCase()
}

export function matchesKeybindRelease(e: KeyboardEvent, keybind: string): boolean {
  if (!keybind) return false

  const parsed = parseKeybind(keybind)
  const eventKey = normalizeKeyName(e.key)

  if (eventKey.toUpperCase() === parsed.key.toUpperCase()) {
    return true
  }

  // Also match when any required modifier of the combination is released
  if (parsed.cmdCtrl && (e.key === 'Control' || e.key === 'Meta')) {
    return true
  }
  if (parsed.alt && e.key === 'Alt') {
    return true
  }
  if (parsed.shift && e.key === 'Shift') {
    return true
  }

  return false
}

export function recordKeybindFromEvent(e: React.KeyboardEvent<HTMLInputElement>): {
  finished: boolean
  keybind: string
} {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    return { finished: false, keybind: parts.join('+') }
  }

  const keyName = normalizeKeyName(key)
  parts.push(keyName)
  return { finished: true, keybind: parts.join('+') }
}
