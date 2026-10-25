import type { WorkspaceSnapshot } from '@shared/workspace-inspector'
import { api } from './api'

export const WORKSPACE_OPEN_FILE = 'roxy:workspace-open-file'
export const WORKSPACE_OPEN_TOOL = 'roxy:workspace-open-tool'
export type WorkspaceTab = 'files' | 'search' | 'git' | 'changes'
export interface WorkspaceFileRequest {
  sessionId: string
  path: string
  line?: number
  comparison?: boolean
}

export function requestWorkspaceFile(request: WorkspaceFileRequest): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_OPEN_FILE, { detail: request }))
}

export async function resolveWorkspaceFile(
  sessionId: string,
  workspaceRoot: string,
  file: string,
  snapshot?: WorkspaceSnapshot
): Promise<{ rootId: string; path: string } | null> {
  const inspection = snapshot ?? (await api.workspace.inspect(sessionId))
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '')
  const insensitive = document.documentElement.dataset.platform === 'win32'
  const compare = (value: string): string => (insensitive ? value.toLowerCase() : value)
  const base = normalize(workspaceRoot)
  const path = normalize(file).replace(/^\.\//, '')
  if (!path || path.split('/').some((part) => part === '..')) return null
  const isAbsolute = path.startsWith('/') || /^[a-z]:\//i.test(path)
  const absolute = isAbsolute ? path : `${base}/${path}`
  // Root ids are opaque hashes from main; match on the directory each root covers,
  // preferring the deepest so a nested repo wins over its enclosing folder.
  const match = inspection.roots
    .map((root) => ({ id: root.id, directory: normalize(root.directory) }))
    .filter(({ directory }) => directory && compare(absolute).startsWith(compare(directory) + '/'))
    .sort((a, b) => b.directory.length - a.directory.length)[0]
  if (match) return { rootId: match.id, path: absolute.slice(match.directory.length + 1) }
  // Spelling differences (symlinks, short names) can defeat the prefix match; with a
  // single root, a relative path is unambiguous anyway.
  if (!isAbsolute && inspection.roots.length === 1) return { rootId: inspection.roots[0].id, path }
  return null
}
