export const EXPANDED_FOLDERS_STORAGE_PREFIX = 'roxy.ide.expandedFolders.v1'
export const ACTIVE_FILE_STORAGE_PREFIX = 'roxy.ide.activeFile.v1'

export interface StoredActiveFile {
  path: string
  name: string
  line?: number
}

export function normalizeRoot(root: string | null | undefined): string {
  return (root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

export function getAncestorPaths(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/')
  const ancestors: string[] = []
  let current = ''
  for (let i = 0; i < parts.length - 1; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i]
    ancestors.push(current)
  }
  return ancestors
}

export function loadExpandedFolders(root: string | null | undefined): Set<string> {
  if (typeof localStorage === 'undefined' || !root) return new Set()
  try {
    const key = `${EXPANDED_FOLDERS_STORAGE_PREFIX}:${normalizeRoot(root)}`
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((p): p is string => typeof p === 'string' && p.length > 0))
    }
  } catch {}
  return new Set()
}

export function saveExpandedFolders(
  root: string | null | undefined,
  folders: Set<string> | string[]
): void {
  if (typeof localStorage === 'undefined' || !root) return
  try {
    const key = `${EXPANDED_FOLDERS_STORAGE_PREFIX}:${normalizeRoot(root)}`
    const list = Array.isArray(folders) ? folders : Array.from(folders)
    if (list.length === 0) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(list))
    }
  } catch {}
}

export function loadActiveFile(root: string | null | undefined): StoredActiveFile | null {
  if (typeof localStorage === 'undefined' || !root) return null
  try {
    const key = `${ACTIVE_FILE_STORAGE_PREFIX}:${normalizeRoot(root)}`
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'path' in parsed &&
      typeof (parsed as StoredActiveFile).path === 'string'
    ) {
      const p = parsed as StoredActiveFile
      return {
        path: p.path,
        name: typeof p.name === 'string' && p.name ? p.name : p.path.split('/').pop() || p.path,
        line: typeof p.line === 'number' ? p.line : undefined
      }
    }
  } catch {}
  return null
}

export function saveActiveFile(
  root: string | null | undefined,
  file: StoredActiveFile | null
): void {
  if (typeof localStorage === 'undefined' || !root) return
  try {
    const key = `${ACTIVE_FILE_STORAGE_PREFIX}:${normalizeRoot(root)}`
    if (!file) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(
        key,
        JSON.stringify({
          path: file.path,
          name: file.name,
          line: file.line
        })
      )
    }
  } catch {}
}

export function migrateRenamedPath(
  folders: Set<string>,
  oldPath: string,
  newPath: string
): Set<string> {
  const next = new Set<string>()
  for (const p of folders) {
    if (p === oldPath) {
      next.add(newPath)
    } else if (p.startsWith(`${oldPath}/`)) {
      next.add(`${newPath}/${p.slice(oldPath.length + 1)}`)
    } else {
      next.add(p)
    }
  }
  return next
}

export function pruneDeletedPath(folders: Set<string>, deletedPath: string): Set<string> {
  const next = new Set<string>()
  for (const p of folders) {
    if (p === deletedPath || p.startsWith(`${deletedPath}/`)) {
      continue
    }
    next.add(p)
  }
  return next
}
