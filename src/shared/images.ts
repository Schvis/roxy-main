/**
 * Image URL resolution for chat images (remote URLs, data URLs, and local workspace files).
 */

/**
 * Resolve an image source (URL, data URL, file://, or local/relative file path)
 * to a URL that the renderer's `<img>` or `new Image()` can load.
 *
 * Local files are mapped to `roxy-local://image?path=<encodedPath>` which Electron
 * safely handles via `protocol.handle`.
 */
export function resolveImageSrc(src: string, workspacePath?: string | null): string {
  if (!src) return src
  const trimmed = src
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^['"]|['"]$/g, '')
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('roxy-local:')
  ) {
    return trimmed
  }

  if (trimmed.startsWith('file://')) {
    let filePath = trimmed.slice(7)
    if (/^\/[a-zA-Z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    try {
      filePath = decodeURIComponent(filePath)
    } catch {
      // Keep undecoded if malformed percent-encoding
    }
    return `roxy-local://image?path=${encodeURIComponent(filePath)}`
  }

  const isWindowsAbsolute = /^[a-zA-Z]:[/\\]/.test(trimmed) || trimmed.startsWith('\\\\')
  const isPosixAbsolute = trimmed.startsWith('/')

  if (isWindowsAbsolute || isPosixAbsolute) {
    return `roxy-local://image?path=${encodeURIComponent(trimmed)}`
  }

  if (workspacePath) {
    const cleanRel = trimmed.replace(/^\.[/\\]/, '')
    const separator = workspacePath.includes('\\') ? '\\' : '/'
    const base =
      workspacePath.endsWith('/') || workspacePath.endsWith('\\')
        ? workspacePath.slice(0, -1)
        : workspacePath
    const combined = `${base}${separator}${cleanRel}`
    return `roxy-local://image?path=${encodeURIComponent(combined)}`
  }

  return trimmed
}
