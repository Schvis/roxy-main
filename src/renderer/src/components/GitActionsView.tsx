import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Loader2,
  RefreshCw,
  UploadCloud,
  X
} from 'lucide-react'
import type { GitChangedFile, GitCommitNode, GitFileDiffResult, GitStatusView } from '@shared/api'
import { api } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { cn } from '../lib/cn'
import { Button, Input } from './ui'
import { FileDiffView } from './diff/FileDiffView'

const LANE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316' // orange
]

const ROW_H = 38
const LANE_W = 14
const LANE_OFFSET = 12

const DEFAULT_GRAPH_HEIGHT = 280
const MIN_GRAPH_HEIGHT = 90
const GRAPH_HEIGHT_KEY = 'roxy:git-graph-height'

function getLaneX(lane: number): number {
  return lane * LANE_W + LANE_OFFSET
}

interface GraphRowItem {
  commit: GitCommitNode
  commitLane: number
  color: string
  hasIncoming: boolean
  passingLanes: number[]
  convergingLanes: number[]
  outgoingConnections: { targetLane: number; isDirect: boolean }[]
}

export interface GitActionsViewProps {
  root: string | null
  sessionId?: string | null
  onOpenFile?: (path: string, commitSha?: string) => void
  isStandalone?: boolean
}

export function GitActionsView({
  root,
  sessionId: _sessionId,
  onOpenFile,
  isStandalone: _isStandalone = false
}: GitActionsViewProps): JSX.Element {
  const { t } = useTranslation()
  const [gitStatus, setGitStatus] = useState<GitStatusView | null>(null)
  const [commits, setCommits] = useState<GitCommitNode[]>([])
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Commit composer state
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)

  // Remote operations state
  const [fetching, setFetching] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Publishing / Initialize state
  const [publishOpen, setPublishOpen] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [publishMessage, setPublishMessage] = useState('Initial commit')
  const [initializing, setInitializing] = useState(false)
  const [publishing, setPublishing] = useState(false)

  // Changed files collapse
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [copiedSha, setCopiedSha] = useState<string | null>(null)

  // Infinite scroll state for commit graph
  const [hasMoreCommits, setHasMoreCommits] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Selected commit & its modified files
  const [selectedCommit, setSelectedCommit] = useState<GitCommitNode | null>(null)
  const [selectedCommitFiles, setSelectedCommitFiles] = useState<GitChangedFile[]>([])
  const [loadingCommitFiles, setLoadingCommitFiles] = useState(false)

  // Internal diff modal state (used when onOpenFile is not provided, e.g. standalone view)
  const [internalDiff, setInternalDiff] = useState<{ path: string; commitSha?: string } | null>(
    null
  )
  const [internalDiffData, setInternalDiffData] = useState<GitFileDiffResult | null>(null)
  const [loadingInternalDiff, setLoadingInternalDiff] = useState(false)

  const handleFileClick = (filePath: string, commitSha?: string): void => {
    if (onOpenFile) {
      onOpenFile(filePath, commitSha)
    } else {
      setInternalDiff({ path: filePath, commitSha })
    }
  }

  useEffect(() => {
    if (!internalDiff || !root) {
      setInternalDiffData(null)
      return
    }
    let active = true
    setLoadingInternalDiff(true)
    api.git
      .fileDiff(root, internalDiff.path, internalDiff.commitSha)
      .then((res) => {
        if (active) setInternalDiffData(res)
      })
      .catch((e) => {
        if (active) {
          setInternalDiffData({
            path: internalDiff.path,
            before: '',
            after: '',
            ok: false,
            error: e instanceof Error ? e.message : String(e)
          })
        }
      })
      .finally(() => {
        if (active) setLoadingInternalDiff(false)
      })

    return () => {
      active = false
    }
  }, [internalDiff, root])

  // Vertical resize state for commit graph
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isGraphDragging = useRef(false)
  const [graphHeight, setGraphHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem(GRAPH_HEIGHT_KEY))
    return Number.isFinite(v) && v >= MIN_GRAPH_HEIGHT ? v : DEFAULT_GRAPH_HEIGHT
  })

  useEffect(() => {
    localStorage.setItem(GRAPH_HEIGHT_KEY, String(graphHeight))
  }, [graphHeight])

  const refreshAll = async (targetRoot = root): Promise<void> => {
    if (!targetRoot) {
      setGitStatus(null)
      setCommits([])
      setChangedFiles([])
      setLoading(false)
      setHasMoreCommits(false)
      return
    }

    try {
      setError(null)
      const st = await api.git.status(targetRoot)
      setGitStatus(st)
      if (st.isRepo) {
        const [graph, files] = await Promise.all([
          api.git.logGraph(targetRoot, 60),
          api.git.changedFiles(targetRoot)
        ])
        setCommits(graph)
        setChangedFiles(files)
        setHasMoreCommits(graph.length >= 60)
      } else {
        setCommits([])
        setChangedFiles([])
        setHasMoreCommits(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refreshAll(root)
  }, [root])

  const handleManualRefresh = (): void => {
    setRefreshing(true)
    void refreshAll(root)
  }

  const handleInitRepo = async (): Promise<void> => {
    if (!root) return
    setInitializing(true)
    setError(null)
    try {
      const res = await api.git.init(root)
      if (res.ok) {
        await refreshAll(root)
      } else {
        setError(res.error || 'Failed to initialize repository')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInitializing(false)
    }
  }

  const handlePublish = async (): Promise<void> => {
    if (!root || !remoteUrl.trim()) return
    setPublishing(true)
    setError(null)
    try {
      const res = await api.git.publish(root, remoteUrl.trim())
      if (res.ok) {
        setPublishOpen(false)
        await refreshAll(root)
      } else {
        setError(res.error || 'Failed to publish workspace')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  const handleCommit = async (): Promise<void> => {
    if (!root || !commitMessage.trim()) return
    setCommitting(true)
    setError(null)
    try {
      const res = await api.git.commit(root, commitMessage.trim())
      if (res.ok) {
        setCommitMessage('')
        await refreshAll(root)
      } else {
        setError(res.error || 'Commit failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommitting(false)
    }
  }

  const handleFetch = async (): Promise<void> => {
    if (!root) return
    setFetching(true)
    setError(null)
    try {
      const res = await api.git.fetch(root)
      if (res.ok) {
        await refreshAll(root)
      } else {
        setError(res.error || 'Fetch failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetching(false)
    }
  }

  const handlePull = async (): Promise<void> => {
    if (!root) return
    setPulling(true)
    setError(null)
    try {
      const res = await api.git.pull(root)
      if (res.ok) {
        await refreshAll(root)
      } else {
        setError(res.error || 'Pull failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPulling(false)
    }
  }

  const handlePush = async (): Promise<void> => {
    if (!root) return
    setPushing(true)
    setError(null)
    try {
      const res = await api.git.push(root)
      if (res.ok) {
        await refreshAll(root)
      } else {
        setError(res.error || 'Push failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPushing(false)
    }
  }

  const handleSync = async (): Promise<void> => {
    if (!root) return
    setSyncing(true)
    setError(null)
    try {
      const pullRes = await api.git.pull(root)
      if (!pullRes.ok) {
        setError(pullRes.error || 'Pull failed during sync')
        setSyncing(false)
        return
      }
      const pushRes = await api.git.push(root)
      if (!pushRes.ok) {
        setError(pushRes.error || 'Push failed during sync')
      }
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  const handleCopySha = async (sha: string): Promise<void> => {
    await writeClipboardText(sha)
    setCopiedSha(sha)
    setTimeout(() => setCopiedSha(null), 1500)
  }

  const loadMoreCommits = async (): Promise<void> => {
    if (!root || loadingMore || !hasMoreCommits) return
    setLoadingMore(true)
    try {
      const nextLimit = commits.length + 60
      const graph = await api.git.logGraph(root, nextLimit)
      if (graph.length <= commits.length) {
        setHasMoreCommits(false)
      } else {
        setCommits(graph)
        if (graph.length < nextLimit) {
          setHasMoreCommits(false)
        }
      }
    } catch {
      // Ignore error
    } finally {
      setLoadingMore(false)
    }
  }

  const handleGraphScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollHeight - scrollTop - clientHeight < 100 && !loadingMore && hasMoreCommits) {
      void loadMoreCommits()
    }
  }

  const handleSelectCommit = async (commit: GitCommitNode): Promise<void> => {
    if (selectedCommit?.sha === commit.sha) {
      setSelectedCommit(null)
      setSelectedCommitFiles([])
      return
    }
    setSelectedCommit(commit)
    if (!root) return
    setLoadingCommitFiles(true)
    try {
      const files = await api.git.commitFiles(root, commit.sha)
      setSelectedCommitFiles(files)
    } catch {
      setSelectedCommitFiles([])
    } finally {
      setLoadingCommitFiles(false)
    }
  }

  // Precompute continuous commit graph lanes
  const { graphRows } = useMemo(() => {
    if (!commits || commits.length === 0) return { graphRows: [], maxLane: 0 }

    const activeLanes: (string | null)[] = []
    let peakLane = 0

    const rows: GraphRowItem[] = commits.map((commit) => {
      const initialLanes = [...activeLanes]

      // 1. Locate or allocate lane for this commit
      let commitLane = activeLanes.indexOf(commit.sha)
      const hasIncoming = commitLane !== -1

      if (commitLane === -1) {
        commitLane = activeLanes.indexOf(null)
        if (commitLane === -1) {
          commitLane = activeLanes.length
          activeLanes.push(commit.sha)
        } else {
          activeLanes[commitLane] = commit.sha
        }
      }

      // Check if other lanes also point to this commit (converging branches from above)
      const convergingLanes: number[] = []
      for (let l = 0; l < initialLanes.length; l++) {
        if (l !== commitLane && initialLanes[l] === commit.sha) {
          convergingLanes.push(l)
          activeLanes[l] = null
        }
      }

      // 2. Set outgoing targets for parents
      const outgoingConnections: { targetLane: number; isDirect: boolean }[] = []
      if (commit.parents.length > 0) {
        // Direct first parent continues on commitLane
        const p0 = commit.parents[0]
        activeLanes[commitLane] = p0
        outgoingConnections.push({ targetLane: commitLane, isDirect: true })

        // Additional parents (merges)
        for (let p = 1; p < commit.parents.length; p++) {
          const pSha = commit.parents[p]
          let pLane = activeLanes.indexOf(pSha)
          if (pLane === -1) {
            pLane = activeLanes.indexOf(null)
            if (pLane === -1) {
              pLane = activeLanes.length
              activeLanes.push(pSha)
            } else {
              activeLanes[pLane] = pSha
            }
          }
          outgoingConnections.push({ targetLane: pLane, isDirect: false })
        }
      } else {
        // Root commit closes lane
        activeLanes[commitLane] = null
      }

      const finalLanes = [...activeLanes]

      // 3. Passing lanes (active before and still active after)
      const passingLanes: number[] = []
      const maxCheck = Math.max(initialLanes.length, finalLanes.length)
      for (let l = 0; l < maxCheck; l++) {
        if (l !== commitLane && !convergingLanes.includes(l)) {
          if (initialLanes[l] && finalLanes[l]) {
            passingLanes.push(l)
          }
        }
      }

      const rowMaxLane = Math.max(
        commitLane,
        ...passingLanes,
        ...convergingLanes,
        ...outgoingConnections.map((c) => c.targetLane)
      )
      if (rowMaxLane > peakLane) peakLane = rowMaxLane

      // Clean trailing nulls
      while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
        activeLanes.pop()
      }

      return {
        commit,
        commitLane,
        color: LANE_COLORS[commitLane % LANE_COLORS.length],
        hasIncoming,
        passingLanes,
        convergingLanes,
        outgoingConnections
      }
    })

    return { graphRows: rows, maxLane: peakLane }
  }, [commits])

  if (!root) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-text-muted">
        <FolderGit2 className="h-10 w-10 stroke-1 opacity-40 mb-3" />
        <p className="text-sm font-medium text-text">{t('ide.noWorkspace')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    )
  }

  // Not initialized
  if (gitStatus && !gitStatus.isRepo) {
    return (
      <div className="flex h-full w-full flex-col overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center text-center py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 border border-border mb-4 text-accent">
            <FolderGit2 className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-text mb-1">{t('git.notInitialized')}</h2>
          <p className="text-xs text-text-muted mb-6 leading-relaxed">{t('git.initDescription')}</p>

          {error && (
            <div className="mb-4 flex w-full items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-left text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!publishOpen ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="primary"
                onClick={() => void handleInitRepo()}
                disabled={initializing}
              >
                {initializing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitBranch className="h-4 w-4" />
                )}
                {initializing ? t('git.initializing') : t('git.initRepo')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPublishOpen(true)}
                disabled={initializing}
              >
                <UploadCloud className="h-4 w-4" />
                {t('git.publishRepo')}
              </Button>
            </div>
          ) : (
            <div className="w-full text-left rounded-xl border border-border bg-surface p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-text">
                  {t('git.publishTitle')}
                </span>
                <button
                  type="button"
                  onClick={() => setPublishOpen(false)}
                  className="text-xs text-text-subtle hover:text-text"
                >
                  {t('common.cancel')}
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t('git.remoteUrl')}
                </label>
                <Input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder={t('git.remoteUrlPlaceholder')}
                  className="w-full text-xs"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t('git.initialCommitMessage')}
                </label>
                <Input
                  value={publishMessage}
                  onChange={(e) => setPublishMessage(e.target.value)}
                  className="w-full text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setPublishOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handlePublish()}
                  disabled={publishing || !remoteUrl.trim()}
                >
                  {publishing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="h-3.5 w-3.5" />
                  )}
                  {publishing ? t('git.publishing') : t('git.publish')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const branchName = gitStatus?.branch || t('git.detached')
  const isDirty = changedFiles.length > 0 || Boolean(gitStatus?.dirty)

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col min-h-0 min-w-0 overflow-hidden bg-bg"
    >
      {/* Top Action & Status Bar */}
      <header className="flex shrink-0 items-center justify-between gap-1.5 border-b border-border bg-surface px-2.5 py-1.5 min-h-[38px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text border border-border min-w-0"
            title={branchName}
          >
            <GitBranch className="h-3 w-3 text-accent shrink-0" />
            <span className="truncate max-w-[95px] font-mono text-[11px]">{branchName}</span>
            {isDirty && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-warning shrink-0"
                title={t('ide.dirty')}
              />
            )}
          </div>

          {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
              {gitStatus.ahead > 0 && (
                <span
                  className="flex items-center text-accent"
                  title={t('git.ahead', { count: gitStatus.ahead })}
                >
                  <ArrowUp className="h-2.5 w-2.5 mr-0.5" />
                  {gitStatus.ahead}
                </span>
              )}
              {gitStatus.behind > 0 && (
                <span
                  className="flex items-center text-warning"
                  title={t('git.behind', { count: gitStatus.behind })}
                >
                  <ArrowDown className="h-2.5 w-2.5 mr-0.5" />
                  {gitStatus.behind}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleFetch}
            disabled={fetching || refreshing}
            title={t('git.fetch')}
            aria-label={t('git.fetch')}
            className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('h-3 w-3', fetching && 'animate-spin')} />
          </button>

          <button
            type="button"
            onClick={handlePull}
            disabled={pulling || refreshing}
            title={t('git.pull')}
            aria-label={t('git.pull')}
            className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-50 transition-colors"
          >
            <ArrowDown className={cn('h-3 w-3', pulling && 'animate-spin')} />
          </button>

          <button
            type="button"
            onClick={handlePush}
            disabled={pushing || refreshing}
            title={t('git.push')}
            aria-label={t('git.push')}
            className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-50 transition-colors"
          >
            <ArrowUp className={cn('h-3 w-3', pushing && 'animate-spin')} />
          </button>

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || refreshing}
            title={t('git.sync')}
            aria-label={t('git.sync')}
            className="press-scale flex h-6 items-center gap-1 rounded bg-accent/15 px-1.5 text-[11px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('h-2.5 w-2.5', syncing && 'animate-spin')} />
            <span className="hidden sm:inline">{t('git.sync')}</span>
          </button>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title={t('ide.refresh')}
            aria-label={t('ide.refresh')}
            className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* Error alert */}
      {error && (
        <div className="flex items-start justify-between gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <div className="flex items-start gap-1.5 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-bold opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Commit & Changes Section (Top Split) */}
      <section className="flex flex-1 min-h-0 flex-col border-b border-border bg-surface/50 p-2.5 overflow-hidden">
        <div className="shrink-0 space-y-2">
          <div className="relative">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleCommit()
                }
              }}
              placeholder={t('git.commitPlaceholder')}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setFilesExpanded(!filesExpanded)}
              className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text transition-colors"
            >
              {filesExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>
                {changedFiles.length > 0
                  ? t('git.changes', { count: changedFiles.length })
                  : t('git.noChanges')}
              </span>
            </button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCommit()}
              disabled={committing || changedFiles.length === 0 || !commitMessage.trim()}
            >
              {committing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitCommitHorizontal className="h-3.5 w-3.5" />
              )}
              {committing ? t('git.committing') : t('git.commit')}
            </Button>
          </div>
        </div>

        {/* Changed Files List */}
        {filesExpanded && changedFiles.length > 0 && (
          <div className="mt-2 flex-1 min-h-0 overflow-y-auto rounded-lg border border-border/70 bg-surface divide-y divide-border/40">
            {changedFiles.map((file) => {
              const statusColor =
                file.status === 'added'
                  ? 'text-success bg-success/15 border-success/30'
                  : file.status === 'deleted'
                    ? 'text-danger bg-danger/15 border-danger/30'
                    : file.status === 'untracked'
                      ? 'text-accent bg-accent/15 border-accent/30'
                      : 'text-warning bg-warning/15 border-warning/30'

              const statusLetter =
                file.status === 'added'
                  ? 'A'
                  : file.status === 'deleted'
                    ? 'D'
                    : file.status === 'untracked'
                      ? 'U'
                      : 'M'

              return (
                <div
                  key={file.path}
                  onClick={() => handleFileClick(file.path)}
                  className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs hover:bg-white/5 transition-colors cursor-pointer hover:text-text"
                  title={file.path}
                >
                  <span className="truncate font-mono text-[11px] text-text-muted">
                    {file.path}
                  </span>
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold border',
                      statusColor
                    )}
                  >
                    {statusLetter}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Draggable Vertical Splitter to resize graph height */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('git.resizeGraph')}
        aria-valuenow={graphHeight}
        onPointerDown={(e) => {
          isGraphDragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!isGraphDragging.current) return
          const container = containerRef.current
          if (!container) return
          const rect = container.getBoundingClientRect()
          const newH = rect.bottom - e.clientY
          const maxH = Math.max(MIN_GRAPH_HEIGHT, rect.height - 110)
          setGraphHeight(Math.max(MIN_GRAPH_HEIGHT, Math.min(maxH, newH)))
        }}
        onPointerUp={(e) => {
          isGraphDragging.current = false
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onDoubleClick={() => {
          setGraphHeight(DEFAULT_GRAPH_HEIGHT)
        }}
        className="relative h-2 -my-1 cursor-row-resize touch-none z-10 flex items-center justify-center group hover:bg-accent/40 focus-visible:bg-accent transition-colors shrink-0"
        title={t('git.resizeGraph')}
      >
        <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-accent transition-colors" />
      </div>

      {/* Visual Commit Graph Section (Below) */}
      <section
        style={{ height: graphHeight }}
        className="shrink-0 flex min-h-0 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 px-2.5 py-1.5 bg-surface">
          <div className="flex items-center gap-1.5">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-accent" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text">
              {t('git.graphTitle')}
            </span>
          </div>
          <span className="text-[10px] font-mono text-text-subtle">{commits.length}</span>
        </div>

        {commits.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-text-muted">
            {t('git.noCommits')}
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
            {/* Left: Commit Graph List with infinite scroll */}
            <div
              onScroll={handleGraphScroll}
              className="flex-1 overflow-y-auto overflow-x-auto min-h-0 min-w-0"
            >
              <div className="min-w-full">
                {graphRows.map((row) => {
                  const isCopied = copiedSha === row.commit.sha
                  const isSelected = selectedCommit?.sha === row.commit.sha
                  const laneX = getLaneX(row.commitLane)
                  const dotY = ROW_H / 2
                  const rowMaxLane = Math.max(
                    row.commitLane,
                    ...row.passingLanes,
                    ...row.convergingLanes,
                    ...row.outgoingConnections.map((c) => c.targetLane)
                  )
                  const rowSvgWidth = Math.max(26, (rowMaxLane + 1) * LANE_W + LANE_OFFSET + 4)

                  return (
                    <div
                      key={row.commit.sha}
                      onClick={() => void handleSelectCommit(row.commit)}
                      className={cn(
                        'group relative flex h-[38px] items-stretch border-b border-border/30 hover:bg-white/5 transition-colors cursor-pointer select-none',
                        isSelected && 'bg-accent/10 border-l-2 border-l-accent'
                      )}
                    >
                      {/* SVG Continuous Graph */}
                      <div className="relative shrink-0 select-none" style={{ width: rowSvgWidth }}>
                        <svg className="absolute inset-0 h-full w-full pointer-events-none">
                          {/* 1. Passing lanes: unbroken vertical line top to bottom */}
                          {row.passingLanes.map((lane) => {
                            const x = getLaneX(lane)
                            return (
                              <line
                                key={`pass-${lane}`}
                                x1={x}
                                y1={0}
                                x2={x}
                                y2={ROW_H}
                                stroke={LANE_COLORS[lane % LANE_COLORS.length]}
                                strokeWidth="2"
                                strokeOpacity="0.75"
                              />
                            )
                          })}

                          {/* 2. Converging branches from above */}
                          {row.convergingLanes.map((cLane) => {
                            const fromX = getLaneX(cLane)
                            return (
                              <path
                                key={`conv-${cLane}`}
                                d={`M ${fromX} 0 C ${fromX} ${dotY * 0.7}, ${laneX} ${dotY * 0.3}, ${laneX} ${dotY}`}
                                fill="none"
                                stroke={LANE_COLORS[cLane % LANE_COLORS.length]}
                                strokeWidth="2"
                                strokeOpacity="0.8"
                              />
                            )
                          })}

                          {/* 3. Incoming trunk line from previous commit on this lane */}
                          {row.hasIncoming && (
                            <line
                              x1={laneX}
                              y1={0}
                              x2={laneX}
                              y2={dotY}
                              stroke={row.color}
                              strokeWidth="2"
                            />
                          )}

                          {/* 4. Outgoing connections to parents */}
                          {row.outgoingConnections.map((conn) => {
                            const targetX = getLaneX(conn.targetLane)
                            if (conn.isDirect) {
                              return (
                                <line
                                  key={`out-dir-${conn.targetLane}`}
                                  x1={laneX}
                                  y1={dotY}
                                  x2={laneX}
                                  y2={ROW_H}
                                  stroke={row.color}
                                  strokeWidth="2"
                                />
                              )
                            }
                            const targetColor = LANE_COLORS[conn.targetLane % LANE_COLORS.length]
                            return (
                              <path
                                key={`out-merge-${conn.targetLane}`}
                                d={`M ${laneX} ${dotY} C ${laneX} ${dotY + (ROW_H - dotY) * 0.7}, ${targetX} ${dotY + (ROW_H - dotY) * 0.3}, ${targetX} ${ROW_H}`}
                                fill="none"
                                stroke={targetColor}
                                strokeWidth="2"
                                strokeOpacity="0.85"
                              />
                            )
                          })}

                          {/* 5. Commit Node Dot */}
                          {row.commit.isMerge ? (
                            <>
                              <circle
                                cx={laneX}
                                cy={dotY}
                                r={4.5}
                                fill="#18181b"
                                stroke={row.color}
                                strokeWidth="2"
                              />
                              <circle cx={laneX} cy={dotY} r={1.5} fill={row.color} />
                            </>
                          ) : (
                            <circle
                              cx={laneX}
                              cy={dotY}
                              r={3}
                              fill={row.color}
                              stroke="#18181b"
                              strokeWidth="1.5"
                            />
                          )}
                        </svg>
                      </div>

                      {/* Commit info: 2 lines compact */}
                      <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5 pr-2 pl-1">
                        {/* Top line: refs, merge badge, message */}
                        <div className="flex items-center gap-1 min-w-0">
                          {row.commit.isMerge && (
                            <span className="flex items-center rounded bg-purple-500/20 px-1 py-0.2 text-[8px] font-bold text-purple-400 border border-purple-500/30 shrink-0">
                              <GitMerge className="h-2 w-2 mr-0.5" />
                              {t('git.merge')}
                            </span>
                          )}

                          {row.commit.refs.map((ref) => {
                            const isHead = ref.includes('HEAD')
                            const isOrigin = ref.startsWith('origin/')
                            const isTag = ref.startsWith('tag:')
                            return (
                              <span
                                key={ref}
                                className={cn(
                                  'rounded px-1 py-0.1 text-[9px] font-mono font-medium truncate max-w-[80px] border shrink-0',
                                  isHead
                                    ? 'bg-accent/15 text-accent border-accent/30'
                                    : isOrigin
                                      ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                                      : isTag
                                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                        : 'bg-surface-2 text-text border-border'
                                )}
                                title={ref}
                              >
                                {ref.replace(/^tag:\s*/, '')}
                              </span>
                            )
                          })}

                          <span
                            className={cn(
                              'truncate text-[11px] font-medium leading-tight',
                              isSelected ? 'text-accent font-semibold' : 'text-text'
                            )}
                            title={row.commit.message}
                          >
                            {row.commit.message}
                          </span>
                        </div>

                        {/* Bottom line: author/time and SHA */}
                        <div className="flex items-center justify-between gap-1 text-[9px] text-text-subtle font-mono mt-0.5">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="truncate max-w-[90px]">{row.commit.author}</span>
                            <span>{row.commit.date}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleCopySha(row.commit.sha)
                            }}
                            title={isCopied ? t('git.copied') : t('git.copySha')}
                            className="flex items-center gap-0.5 rounded bg-surface-2 px-1 py-0.2 text-[9px] text-text-subtle hover:text-text hover:bg-white/10 transition-colors shrink-0"
                          >
                            {isCopied ? (
                              <Check className="h-2 w-2 text-success" />
                            ) : (
                              row.commit.shortSha
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {loadingMore && (
                <div className="flex items-center justify-center p-2 text-xs text-text-muted gap-1.5 border-t border-border/20">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  <span className="text-[11px]">{t('git.loadingMore')}</span>
                </div>
              )}
            </div>

            {/* Right: Selected Commit Details & Modified Files (on the side of the graph) */}
            {selectedCommit && (
              <div className="w-[230px] sm:w-[270px] shrink-0 border-l border-border bg-surface/90 flex flex-col min-h-0 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 bg-surface shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <GitCommitHorizontal className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span className="font-mono text-xs font-semibold text-text truncate">
                      {selectedCommit.shortSha}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => void handleCopySha(selectedCommit.sha)}
                      title={copiedSha === selectedCommit.sha ? t('git.copied') : t('git.copySha')}
                      className="p-1 rounded text-text-subtle hover:text-text hover:bg-white/5 transition-colors"
                    >
                      {copiedSha === selectedCommit.sha ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <span className="text-[10px] font-mono">{t('git.copySha')}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCommit(null)
                        setSelectedCommitFiles([])
                      }}
                      title={t('git.closeDetails')}
                      className="p-1 rounded text-text-subtle hover:text-text hover:bg-white/5 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Commit info & full message */}
                <div className="p-2.5 border-b border-border/60 space-y-1.5 shrink-0 bg-surface/40">
                  <p className="text-xs text-text font-medium whitespace-pre-wrap break-words leading-relaxed max-h-24 overflow-y-auto">
                    {selectedCommit.message}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-text-subtle font-mono pt-0.5">
                    <span className="truncate max-w-[110px]">{selectedCommit.author}</span>
                    <span>{selectedCommit.date}</span>
                  </div>
                </div>

                {/* Modified files list */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="flex items-center justify-between px-2.5 py-1 bg-surface-2/60 border-b border-border/50 text-[10px] font-medium text-text-muted shrink-0">
                    <span>{t('git.commitFiles', { count: selectedCommitFiles.length })}</span>
                  </div>

                  {loadingCommitFiles ? (
                    <div className="flex flex-1 items-center justify-center p-4 text-xs text-text-muted gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      <span>{t('git.loadingFiles')}</span>
                    </div>
                  ) : selectedCommitFiles.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-text-subtle">
                      {t('git.noCommitFiles')}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto divide-y divide-border/30">
                      {selectedCommitFiles.map((file) => {
                        const statusColor =
                          file.status === 'added'
                            ? 'text-success bg-success/15 border-success/30'
                            : file.status === 'deleted'
                              ? 'text-danger bg-danger/15 border-danger/30'
                              : file.status === 'renamed'
                                ? 'text-purple-400 bg-purple-500/15 border-purple-500/30'
                                : 'text-warning bg-warning/15 border-warning/30'

                        const statusLetter =
                          file.status === 'added'
                            ? 'A'
                            : file.status === 'deleted'
                              ? 'D'
                              : file.status === 'renamed'
                                ? 'R'
                                : 'M'

                        return (
                          <div
                            key={file.path}
                            onClick={() => handleFileClick(file.path, selectedCommit.sha)}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-white/5 transition-colors cursor-pointer hover:text-text"
                            title={file.path}
                          >
                            <span className="truncate font-mono text-[11px] text-text-muted hover:text-text">
                              {file.path}
                            </span>
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold border',
                                statusColor
                              )}
                            >
                              {statusLetter}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Standalone Diff Modal */}
      {internalDiff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex h-[85vh] w-[92vw] max-w-5xl flex-col rounded-xl border border-border bg-bg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="h-4 w-4 text-accent shrink-0" />
                <span className="font-mono text-sm font-semibold text-text truncate">
                  {internalDiff.path}
                </span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-muted border border-border shrink-0">
                  {internalDiff.commitSha
                    ? internalDiff.commitSha.slice(0, 7)
                    : t('git.workingTree')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInternalDiff(null)}
                className="p-1 rounded text-text-subtle hover:text-text hover:bg-white/5 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Diff Body */}
            <div className="flex-1 min-h-0 overflow-hidden bg-bg">
              {loadingInternalDiff ? (
                <div className="flex h-full items-center justify-center gap-2 text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  <span className="text-xs">{t('git.loadingFiles')}</span>
                </div>
              ) : internalDiffData?.isBinary ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-subtle">
                  {t('git.binaryDiff')}
                </div>
              ) : internalDiffData?.error ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-danger">
                  {internalDiffData.error}
                </div>
              ) : (
                <FileDiffView
                  path={internalDiff.path}
                  before={internalDiffData?.before ?? ''}
                  after={internalDiffData?.after ?? ''}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
