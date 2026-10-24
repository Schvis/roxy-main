/**
 * Relay server base-link handling for Remote Workspace.
 *
 * Shared by the renderer (live validation as the user types) and the main
 * process (the authoritative check before anything is sent). Pure: no
 * Electron/DB/React deps, so the plain-Node smoke can exercise it.
 */

/** The relay used when the user doesn't provide one. */
export const DEFAULT_RELAY_BASE = 'https://roxy.schvis.com'

export type RelayBaseReason = 'invalid' | 'protocol' | 'insecure' | 'credentials' | 'query'

export type RelayBaseResult = { ok: true; base: string } | { ok: false; reason: RelayBaseReason }

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}

/**
 * Normalize a user-typed relay base link.
 *
 * - Empty input means "use the default".
 * - A bare host (`relay.example.com`) is treated as https; a bare loopback host
 *   (`localhost:3000`) as http.
 * - Plain `http` is accepted for loopback only: the host token, PIN and every
 *   shared transcript cross this connection, so it must be encrypted anywhere else.
 * - Credentials, query strings and fragments are rejected. A path prefix is kept
 *   (for a relay mounted behind a reverse proxy) with trailing slashes removed.
 */
export function normalizeRelayBase(input: string | null | undefined): RelayBaseResult {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: true, base: DEFAULT_RELAY_BASE }

  let text = raw
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      text = `${isLoopback(new URL(`https://${text}`).hostname) ? 'http' : 'https'}://${text}`
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'protocol' }
  if (!url.hostname) return { ok: false, reason: 'invalid' }
  if (url.username || url.password) return { ok: false, reason: 'credentials' }
  if (url.search || url.hash) return { ok: false, reason: 'query' }
  if (url.protocol === 'http:' && !isLoopback(url.hostname))
    return { ok: false, reason: 'insecure' }

  return { ok: true, base: `${url.origin}${url.pathname.replace(/\/+$/, '')}` }
}
