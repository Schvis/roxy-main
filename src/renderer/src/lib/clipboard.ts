import { api } from './api'

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (api?.clipboard?.writeText) {
      await api.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to web clipboard
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }

  return false
}

export async function writeClipboardImage(dataUrl: string): Promise<boolean> {
  try {
    if (!api?.clipboard?.writeImage) return false
    await api.clipboard.writeImage(dataUrl)
    return true
  } catch {
    return false
  }
}
