import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import type { GitChangedFile } from '@shared/api'
import { api } from '../lib/api'
import { GitActionsView, type GitActionsViewProps } from './GitActionsView'

interface GitRepositoriesViewProps extends Omit<
  GitActionsViewProps,
  'onOpenFile' | 'onOpenChanges' | 'onOpenCommandOutput'
> {
  onOpenFile?: (path: string, commitSha: string | undefined, repositoryRoot: string) => void
  onOpenChanges?: (files: GitChangedFile[], repositoryRoot: string) => void
  onOpenCommandOutput?: (repositoryRoot: string) => void
}

export function GitRepositoriesView({
  root,
  sessionId,
  onOpenFile,
  onOpenChanges,
  onOpenCommandOutput,
  isStandalone
}: GitRepositoriesViewProps): JSX.Element {
  const { t } = useTranslation()
  const [repositories, setRepositories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanNonce, setScanNonce] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const loadedRoot = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    let running = false
    if (loadedRoot.current !== root) setLoading(true)
    const discover = async (force = false): Promise<void> => {
      if (running) return
      running = true
      try {
        const roots = root ? await api.git.repositories(root, force) : []
        if (active) {
          loadedRoot.current = root
          setRepositories(roots)
          setError(null)
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      } finally {
        running = false
        if (active) setLoading(false)
      }
    }
    void discover(scanNonce > 0)
    const onFocus = (): void => {
      void discover(true)
    }
    const unsubscribe = api.files.onChanged((payload) => {
      if (!payload.sessionId || payload.sessionId === sessionId) void discover()
    })
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => {
      void discover()
    }, 30_000)
    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [root, sessionId, scanNonce])

  const controls = (repositoryRoot: string | null): JSX.Element => (
    <GitActionsView
      key={repositoryRoot}
      root={repositoryRoot}
      sessionId={sessionId}
      isStandalone={isStandalone}
      onOpenFile={
        onOpenFile && repositoryRoot
          ? (file, sha) => onOpenFile(file, sha, repositoryRoot)
          : undefined
      }
      onOpenChanges={
        onOpenChanges && repositoryRoot
          ? (files) => onOpenChanges(files, repositoryRoot)
          : undefined
      }
      onOpenCommandOutput={
        onOpenCommandOutput && repositoryRoot
          ? () => onOpenCommandOutput(repositoryRoot)
          : undefined
      }
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs text-text-muted">{t('git.repoName')}</span>
        <button
          type="button"
          title={t('ide.refresh')}
          aria-label={t('ide.refresh')}
          onClick={() => setScanNonce((n) => n + 1)}
          disabled={loading}
          className="rounded p-1 text-text-muted hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {error && (
        <p role="alert" className="p-3 text-xs text-danger">
          {error}
        </p>
      )}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : repositories.length === 0 ? (
        controls(root)
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {repositories.map((repositoryRoot) => {
            const name = repositoryRoot.split(/[\\/]/).filter(Boolean).pop() || repositoryRoot
            const isCollapsed = collapsed.has(repositoryRoot)
            return (
              <section
                key={repositoryRoot}
                className={
                  repositories.length === 1
                    ? 'flex min-h-0 flex-1 flex-col'
                    : 'shrink-0 border-b border-border'
                }
              >
                <button
                  type="button"
                  title={repositoryRoot}
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((previous) => {
                      const next = new Set(previous)
                      if (next.has(repositoryRoot)) next.delete(repositoryRoot)
                      else next.add(repositoryRoot)
                      return next
                    })
                  }
                  className="flex w-full shrink-0 items-center gap-2 bg-surface px-3 py-2 text-left text-xs"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">{name}</span>
                  <span className="min-w-0 flex-1 truncate text-text-subtle">{repositoryRoot}</span>
                </button>
                <div
                  hidden={isCollapsed}
                  className={
                    isCollapsed
                      ? 'hidden'
                      : repositories.length === 1
                        ? 'min-h-0 flex-1'
                        : 'h-[600px]'
                  }
                >
                  {controls(repositoryRoot)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
