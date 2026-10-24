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
  let path = normalize(file).replace(/^\.\//, '')
  if (compare(path).startsWith(compare(base) + '/')) path = path.slice(base.length + 1)
  if (
    path.startsWith('/') ||
    /^[a-z]:\//i.test(path) ||
    path.split('/').some((part) => part === '..')
  )
    return null
  const workspace = inspection.roots.find((root) => root.id === 'workspace')
  if (workspace) return { rootId: workspace.id, path }
  const repositories = await api.git.repositories(workspaceRoot)
  const absolute = `${base}/${path}`
  const candidates = repositories
    .map((repository, index) => ({ root: normalize(repository), index }))
    .filter(({ root }) => compare(absolute).startsWith(compare(root) + '/'))
    .sort((a, b) => b.root.length - a.root.length)
  const match = candidates[0]
  if (!match || !inspection.roots.some((root) => root.id === String(match.index))) return null
  return { rootId: String(match.index), path: absolute.slice(match.root.length + 1) }
}
