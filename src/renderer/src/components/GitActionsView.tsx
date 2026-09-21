import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Files,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Loader2,
  Ellipsis,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Tag,
  UploadCloud,
  X
} from 'lucide-react'
import type {
  GitChangedFile,
  GitCommitNode,
  GitFileDiffResult,
  GitRepositoryAction,
  GitStatusView
} from '@shared/api'
import { api } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { cn } from '../lib/cn'
import { Button, Input } from './ui'
import { FileDiffView } from './diff/FileDiffView'
import { MergeConflictSolver } from './MergeConflictSolver'
import { clearDraftForPath, clearDraftsForRoot } from './FileEditor'
import { useRoxyStore } from '../lib/store'
import { subscribeFileReviews } from '../lib/agent-file-changes'

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
  onOpenChanges?: (files: GitChangedFile[]) => void
  onOpenCommandOutput?: () => void
  isStandalone?: boolean
}

export function GitActionsView({
  root,
  sessionId,
  onOpenFile,
  onOpenChanges,
  onOpenCommandOutput,
  isStandalone: _isStandalone = false
}: GitActionsViewProps): JSX.Element {
  const { t } = useTranslation()
  const [gitStatus, setGitStatus] = useState<GitStatusView | null>(null)
  const [commits, setCommits] = useState<GitCommitNode[]>([])
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gitMenuOpen, setGitMenuOpen] = useState(false)
  const gitMenuRef = useRef<HTMLDivElement>(null)

  // Commit composer state
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [undoingCommit, setUndoingCommit] = useState(false)
  const [commitMenuOpen, setCommitMenuOpen] = useState(false)
  const commitMenuRef = useRef<HTMLDivElement>(null)

  // Remote operations state
  const [fetching, setFetching] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [repositoryAction, setRepositoryAction] = useState<string | null>(null)

  // Publishing / Initialize state
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishMode, setPublishMode] = useState<'new' | 'existing'>('new')
  const [repoName, setRepoName] = useState(() => {
    return root ? root.split(/[\\/]/).filter(Boolean).pop() || '' : ''
  })
  const [repoDescription, setRepoDescription] = useState('')
  const [isPrivateRepo, setIsPrivateRepo] = useState(true)
  const [personalToken, setPersonalToken] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [initializing, setInitializing] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (root) {
      setRepoName(root.split(/[\\/]/).filter(Boolean).pop() || '')
    }
  }, [root])

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

  // Merge conflict resolution and revert states
  const [resolvingConflictPath, setResolvingConflictPath] = useState<string | null>(null)
  const [isGitMerging, setIsGitMerging] = useState(false)
  const [isGitRebasing, setIsGitRebasing] = useState(false)
  const [abortingMerge, setAbortingMerge] = useState(false)
  const [revertingPath, setRevertingPath] = useState<string | null>(null)
  const [isRevertingAll, setIsRevertingAll] = useState(false)
  const [stagingPath, setStagingPath] = useState<string | null>(null)
  const [isStagingAll, setIsStagingAll] = useState(false)
  const [activeCategory, setActiveCategory] = useState<
    'commit' | 'changes' | 'pullPush' | 'branch' | 'remote' | 'stash' | 'tags' | null
  >(null)
  const [categoryAnchorRect, setCategoryAnchorRect] = useState<DOMRect | null>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const mainMenuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!commitMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!commitMenuRef.current?.contains(event.target as Node)) setCommitMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCommitMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [commitMenuOpen])

  useEffect(() => {
    if (!gitMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!gitMenuRef.current?.contains(target) && !portalRef.current?.contains(target)) {
        setGitMenuOpen(false)
        setActiveCategory(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setGitMenuOpen(false)
        setActiveCategory(null)
      }
    }
    const onResize = (): void => {
      setGitMenuOpen(false)
      setActiveCategory(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [gitMenuOpen])

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
      setIsGitMerging(false)
      return
    }

    try {
      setError(null)
      const [st, merging, rebasing] = await Promise.all([
        api.git.status(targetRoot),
        api.git.isMerging(targetRoot),
        api.git.isRebasing(targetRoot)
      ])
      setGitStatus(st)
      setIsGitMerging(merging)
      setIsGitRebasing(rebasing)
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

  const commitsCountRef = useRef(commits.length)
  useEffect(() => {
    commitsCountRef.current = commits.length
  }, [commits.length])

  const isRefreshingRef = useRef(false)
  const pendingRefreshRef = useRef(false)

  const refreshSilently = useCallback(async (): Promise<void> => {
    if (!root) return
    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true
      return
    }
    isRefreshingRef.current = true
    try {
      const [st, merging, rebasing] = await Promise.all([
        api.git.status(root),
        api.git.isMerging(root),
        api.git.isRebasing(root)
      ])
      setGitStatus(st)
      setIsGitMerging(merging)
      setIsGitRebasing(rebasing)
      if (st.isRepo) {
        const count = Math.max(60, commitsCountRef.current)
        const [graph, files] = await Promise.all([
          api.git.logGraph(root, count),
          api.git.changedFiles(root)
        ])
        setCommits(graph)
        setChangedFiles(files)
        setHasMoreCommits(graph.length >= count)
      } else {
        setCommits([])
        setChangedFiles([])
        setHasMoreCommits(false)
      }
    } catch {
      // Ignore background errors (e.g. index.lock during active git command)
    } finally {
      isRefreshingRef.current = false
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false
        void refreshSilently()
      }
    }
  }, [root])

  // 1. Auto-refresh when files change in workspace
  useEffect(() => {
    return api.files.onChanged((payload) => {
      if (!payload.sessionId || payload.sessionId === sessionId) {
        void refreshSilently()
      }
    })
  }, [sessionId, refreshSilently])

  // 2. Auto-refresh when window regains focus
  useEffect(() => {
    const onFocus = (): void => {
      void refreshSilently()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshSilently])

  // 3. Auto-refresh when agent file reviews change
  useEffect(() => {
    return subscribeFileReviews(() => {
      void refreshSilently()
    })
  }, [refreshSilently])

  // 4. Periodic background poll (every 2.5s) to catch external terminal git actions
  useEffect(() => {
    if (!root) return
    const timer = setInterval(() => {
      void refreshSilently()
    }, 2500)
    return () => clearInterval(timer)
  }, [root, refreshSilently])

  // 5. Auto-refresh when agent streaming finishes
  const streaming = useRoxyStore((s) =>
    sessionId ? (s.streamingChats[sessionId] ?? null) : null
  )
  const prevStreamingRef = useRef(streaming)
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      void refreshSilently()
    }
    prevStreamingRef.current = streaming
  }, [streaming, refreshSilently])

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
    if (!root) return
    setPublishing(true)
    setError(null)
    try {
      if (publishMode === 'new') {
        if (!repoName.trim()) {
          setError(t('git.repoNamePlaceholder'))
          setPublishing(false)
          return
        }
        const res = await api.git.createAndPublishGitHub(root, {
          name: repoName.trim(),
          description: repoDescription.trim() || undefined,
          isPrivate: isPrivateRepo,
          token: personalToken.trim() || undefined
        })
        if (res.ok) {
          setPublishOpen(false)
          await refreshAll(root)
        } else {
          setError(res.error || t('git.publishFailed'))
          if (
            res.error?.toLowerCase().includes('token') ||
            res.error?.toLowerCase().includes('auth')
          ) {
            setShowTokenInput(true)
          }
        }
      } else {
        if (!remoteUrl.trim()) {
          setError(t('git.remoteUrlPlaceholder'))
          setPublishing(false)
          return
        }
        const res = await api.git.publish(root, remoteUrl.trim())
        if (res.ok) {
          setPublishOpen(false)
          await refreshAll(root)
        } else {
          setError(res.error || t('git.publishFailed'))
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  const handleCommit = async (
    action: 'commit' | 'push' | 'sync' | 'amend' = 'commit'
  ): Promise<void> => {
    if (!root) return
    const msg = commitMessage.trim()
    if (!msg && !isGitMerging && action !== 'amend') return
    setCommitMenuOpen(false)
    setCommitting(true)
    setError(null)
    try {
      if (action !== 'amend' && !changedFiles.some((file) => file.staged)) {
        const stageRes = await api.git.stageAll(root)
        if (!stageRes.ok) {
          setError(stageRes.error || t('git.stageAllFailed'))
          return
        }
      }
      const res = await api.git.commit(root, msg, { amend: action === 'amend' })
      if (!res.ok) {
        setError(res.error || 'Commit failed')
        return
      }
      setCommitMessage('')
      await refreshAll(root)

      if (action === 'push') {
        const pushRes = await api.git.push(root)
        if (!pushRes.ok) setError(pushRes.error || 'Push failed')
        await refreshAll(root)
      } else if (action === 'sync') {
        const pullRes = await api.git.pull(root)
        await refreshAll(root)
        if (!pullRes.ok) {
          if (!pullRes.conflict) setError(pullRes.error || 'Pull failed during sync')
          return
        }
        const pushRes = await api.git.push(root)
        if (!pushRes.ok) setError(pushRes.error || 'Push failed during sync')
        await refreshAll(root)
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

  const handleUndoLastCommit = async (): Promise<void> => {
    if (!root || !window.confirm(t('git.undoLastCommitConfirm'))) return
    setCommitMenuOpen(false)
    setGitMenuOpen(false)
    setUndoingCommit(true)
    setError(null)
    try {
      const res = await api.git.undoLastCommit(root)
      if (!res.ok) setError(res.error || t('git.undoLastCommitFailed'))
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUndoingCommit(false)
    }
  }

  const handlePull = async (): Promise<void> => {
    if (!root) return
    setPulling(true)
    setError(null)
    try {
      const res = await api.git.pull(root)
      await refreshAll(root)
      if (!res.ok && !res.conflict) {
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

  const runRepoAction = async (action: GitRepositoryAction): Promise<void> => {
    if (!root) return
    setGitMenuOpen(false)
    setActiveCategory(null)
    setRepositoryAction(action.type)
    setError(null)
    try {
      const res = await api.git.repositoryAction(root, action)
      if (!res.ok) setError(res.error || 'Git operation failed')
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRepositoryAction(null)
    }
  }

  const handleCommitWithOptions = async (options: {
    amend?: boolean
    signoff?: boolean
    all?: boolean
    stagedOnly?: boolean
  }): Promise<void> => {
    if (!root) return
    setGitMenuOpen(false)
    setActiveCategory(null)
    const msg = commitMessage.trim()
    if (!msg && !isGitMerging && !options.amend) {
      setError(t('git.commitPlaceholder'))
      return
    }
    setCommitting(true)
    setError(null)
    try {
      if (!options.all && !options.stagedOnly && !changedFiles.some((f) => f.staged)) {
        const stageRes = await api.git.stageAll(root)
        if (!stageRes.ok) {
          setError(stageRes.error || t('git.stageAllFailed'))
          return
        }
      }
      const res = await api.git.commit(root, msg, {
        amend: options.amend,
        signoff: options.signoff,
        all: options.all
      })
      if (!res.ok) {
        setError(res.error || 'Commit failed')
        return
      }
      setCommitMessage('')
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommitting(false)
    }
  }

  const handleShowCommandOutput = async (): Promise<void> => {
    if (!root) return
    setGitMenuOpen(false)
    setActiveCategory(null)
    onOpenCommandOutput?.()
  }

  const handleCreateBranch = async (): Promise<void> => {
    if (!root) return
    setGitMenuOpen(false)
    setActiveCategory(null)
    const name = window.prompt(t('git.createBranchPrompt'))?.trim()
    if (!name) return
    setRepositoryAction('branch')
    setError(null)
    try {
      const res = await api.git.createBranch(root, name)
      if (!res.ok) setError(res.error || t('git.createBranchFailed'))
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRepositoryAction(null)
    }
  }

  const handleCreateTag = async (): Promise<void> => {
    if (!root) return
    setGitMenuOpen(false)
    setActiveCategory(null)
    const name = window.prompt(t('git.createTagPrompt'))?.trim()
    if (!name) return
    setRepositoryAction('tag')
    setError(null)
    try {
      const res = await api.git.createTag(root, name)
      if (!res.ok) setError(res.error || t('git.createTagFailed'))
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRepositoryAction(null)
    }
  }

  const handleStashPop = async (): Promise<void> => {
    if (!root) return
    setGitMenuOpen(false)
    setActiveCategory(null)
    setRepositoryAction('stash-pop')
    setError(null)
    try {
      const res = await api.git.stashPop(root)
      if (!res.ok) setError(res.error || t('git.stashPopFailed'))
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRepositoryAction(null)
    }
  }

  const handleSync = async (rebase = false): Promise<void> => {
    if (!root) return
    setSyncing(true)
    setError(null)
    try {
      const pullRes = rebase
        ? await api.git.repositoryAction(root, { type: 'pull', rebase: true })
        : await api.git.pull(root)
      await refreshAll(root)
      if (!pullRes.ok) {
        const hasConflict = 'conflict' in pullRes && Boolean(pullRes.conflict)
        if (!hasConflict) {
          setError(pullRes.error || 'Pull failed during sync')
        }
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

  const getCategoryItems = (
    cat: 'commit' | 'changes' | 'pullPush' | 'branch' | 'remote' | 'stash' | 'tags'
  ): {
    label?: string
    action?: () => void | Promise<void>
    disabled?: boolean
    danger?: boolean
    isDivider?: boolean
  }[] => {
    switch (cat) {
      case 'commit':
        return [
          { label: t('git.commit'), action: () => void handleCommitWithOptions({}) },
          { label: t('git.commitAmend'), action: () => void handleCommitWithOptions({ amend: true }) },
          { label: t('git.commitSignedOff'), action: () => void handleCommitWithOptions({ signoff: true }) },
          {
            label: t('git.commitStaged'),
            action: () => void handleCommitWithOptions({ stagedOnly: true }),
            disabled: !changedFiles.some((f) => f.staged)
          },
          {
            label: t('git.commitStagedAmend'),
            action: () => void handleCommitWithOptions({ stagedOnly: true, amend: true }),
            disabled: !changedFiles.some((f) => f.staged)
          },
          {
            label: t('git.commitStagedSignedOff'),
            action: () => void handleCommitWithOptions({ stagedOnly: true, signoff: true }),
            disabled: !changedFiles.some((f) => f.staged)
          },
          { label: t('git.commitAll'), action: () => void handleCommitWithOptions({ all: true }) },
          { label: t('git.commitAllAmend'), action: () => void handleCommitWithOptions({ all: true, amend: true }) },
          { label: t('git.commitAllSignedOff'), action: () => void handleCommitWithOptions({ all: true, signoff: true }) },
          { isDivider: true },
          {
            label: t('git.undoLastCommit'),
            action: () => void handleUndoLastCommit(),
            disabled: !canUndoLastCommit,
            danger: true
          }
        ]
      case 'changes':
        return [
          {
            label: t('git.openAllChanges'),
            action: () => {
              setGitMenuOpen(false)
              setActiveCategory(null)
              onOpenChanges?.(changedFiles)
            },
            disabled: changedFiles.length === 0 || !onOpenChanges
          },
          {
            label: t('git.stageAllChanges'),
            action: () => void handleStageAll(),
            disabled: changedFiles.length === 0 || changedFiles.every((f) => f.staged)
          },
          {
            label: t('git.unstageAllChanges'),
            action: () => void runRepoAction({ type: 'unstageAll' }),
            disabled: !changedFiles.some((f) => f.staged)
          },
          { isDivider: true },
          {
            label: t('git.discardAllChanges'),
            action: () => void handleRevertAll(),
            disabled: changedFiles.length === 0,
            danger: true
          }
        ]
      case 'pullPush':
        return [
          { label: t('git.pull'), action: () => void handlePull(), disabled: pulling },
          {
            label: t('git.pullRebase'),
            action: () => void runRepoAction({ type: 'pull', rebase: true }),
            disabled: pulling
          },
          {
            label: t('git.pullFrom'),
            action: () => {
              const input = window.prompt(t('git.pullFromPrompt'))?.trim()
              if (!input) return
              const [remote, branch] = input.split(/\s+/)
              void runRepoAction({ type: 'pull', remote, branch })
            },
            disabled: pulling
          },
          { isDivider: true },
          { label: t('git.push'), action: () => void handlePush(), disabled: pushing },
          {
            label: t('git.pushForce'),
            action: () => void runRepoAction({ type: 'push', force: true }),
            disabled: pushing
          },
          {
            label: t('git.pushTo'),
            action: () => {
              const input = window.prompt(t('git.pushToPrompt'))?.trim()
              if (!input) return
              const [remote, branch] = input.split(/\s+/)
              void runRepoAction({ type: 'push', remote, branch })
            },
            disabled: pushing
          },
          { isDivider: true },
          { label: t('git.sync'), action: () => void handleSync(), disabled: syncing },
          { label: t('git.syncRebase'), action: () => void handleSync(true), disabled: syncing }
        ]
      case 'branch':
        return [
          {
            label: t('git.checkoutTo'),
            action: () => {
              const branch = window.prompt(t('git.checkoutPrompt'))?.trim()
              if (branch) void runRepoAction({ type: 'checkout', branch })
            }
          },
          {
            label: t('git.checkoutToDetached'),
            action: () => {
              const branch = window.prompt(t('git.checkoutDetachedPrompt'))?.trim()
              if (branch) void runRepoAction({ type: 'checkout', branch, detached: true })
            }
          },
          { isDivider: true },
          { label: t('git.createBranch'), action: () => void handleCreateBranch() },
          {
            label: t('git.createBranchFrom'),
            action: () => {
              const name = window.prompt(t('git.createBranchFromPromptName'))?.trim()
              if (!name) return
              const startPoint = window.prompt(t('git.createBranchFromPromptStart'))?.trim()
              if (!startPoint) return
              void runRepoAction({ type: 'createBranchFrom', name, startPoint })
            }
          },
          {
            label: t('git.renameBranch'),
            action: () => {
              const newName = window.prompt(t('git.renameBranchPrompt'))?.trim()
              if (newName) void runRepoAction({ type: 'renameBranch', newName })
            }
          },
          {
            label: t('git.deleteBranch'),
            action: () => {
              const name = window.prompt(t('git.deleteBranchPrompt'))?.trim()
              if (!name) return
              if (!window.confirm(t('git.deleteBranchConfirm', { name }))) return
              void runRepoAction({ type: 'deleteBranch', name })
            }
          },
          { isDivider: true },
          {
            label: t('git.merge'),
            action: () => {
              const branch = window.prompt(t('git.mergePrompt'))?.trim()
              if (branch) void runRepoAction({ type: 'merge', branch })
            }
          },
          {
            label: t('git.rebaseBranch'),
            action: () => {
              const branch = window.prompt(t('git.rebaseBranchPrompt'))?.trim()
              if (branch) void runRepoAction({ type: 'rebase', branch })
            }
          },
          { isDivider: true },
          {
            label: t('git.abortRebase'),
            action: () => void runRepoAction({ type: 'abortRebase' }),
            disabled: !isGitRebasing
          }
        ]
      case 'remote':
        return [
          {
            label: t('git.addRemote'),
            action: () => {
              const name = window.prompt(t('git.addRemotePromptName'))?.trim()
              if (!name) return
              const url = window.prompt(t('git.addRemotePromptUrl'))?.trim()
              if (!url) return
              void runRepoAction({ type: 'addRemote', name, url })
            }
          },
          {
            label: t('git.removeRemote'),
            action: () => {
              const name = window.prompt(t('git.removeRemotePrompt'), 'origin')?.trim()
              if (!name) return
              if (!window.confirm(t('git.removeRemoteConfirm', { name }))) return
              void runRepoAction({ type: 'removeRemote', name })
            }
          },
          { isDivider: true },
          { label: t('git.fetch'), action: () => void handleFetch(), disabled: fetching },
          {
            label: t('git.fetchPrune'),
            action: () => void runRepoAction({ type: 'fetch', prune: true }),
            disabled: fetching
          },
          {
            label: t('git.fetchFromAllRemotes'),
            action: () => void runRepoAction({ type: 'fetch', all: true }),
            disabled: fetching
          }
        ]
      case 'stash':
        return [
          {
            label: t('git.stashPrompt'),
            action: () => {
              const message = window.prompt(t('git.stashPromptMessage'))?.trim()
              void runRepoAction({ type: 'stash', mode: 'tracked', message: message || undefined })
            },
            disabled: !hasWorkingChanges
          },
          {
            label: t('git.stashIncludeUntracked'),
            action: () => void runRepoAction({ type: 'stash', mode: 'untracked' }),
            disabled: !hasWorkingChanges
          },
          { isDivider: true },
          { label: t('git.applyLatestStash'), action: () => void runRepoAction({ type: 'stashApply' }) },
          {
            label: t('git.applyStash'),
            action: () => {
              const stash = window.prompt(t('git.applyStashPrompt'), 'stash@{0}')?.trim()
              if (stash) void runRepoAction({ type: 'stashApply', stash })
            }
          },
          { label: t('git.popStash'), action: () => void handleStashPop() },
          {
            label: t('git.popStashPrompt'),
            action: () => {
              const stash = window.prompt(t('git.popStashPrompt'), 'stash@{0}')?.trim()
              if (stash) void runRepoAction({ type: 'stashPop', stash })
            }
          },
          { isDivider: true },
          {
            label: t('git.dropStash'),
            action: () => {
              const stash = window.prompt(t('git.dropStashPrompt'), 'stash@{0}')?.trim()
              if (!stash) return
              if (!window.confirm(t('git.dropStashConfirm', { stash }))) return
              void runRepoAction({ type: 'stashDrop', stash })
            }
          },
          {
            label: t('git.dropAllStashes'),
            action: () => {
              if (!window.confirm(t('git.dropAllStashesConfirm'))) return
              void runRepoAction({ type: 'stashClear' })
            }
          }
        ]
      case 'tags':
        return [
          { label: t('git.createTag'), action: () => void handleCreateTag() },
          {
            label: t('git.deleteTag'),
            action: () => {
              const name = window.prompt(t('git.deleteTagPrompt'))?.trim()
              if (!name) return
              if (!window.confirm(t('git.deleteTagConfirm', { name }))) return
              void runRepoAction({ type: 'deleteTag', name })
            }
          },
          {
            label: t('git.deleteRemoteTag'),
            action: () => {
              const remote = window.prompt(t('git.deleteRemoteTagPromptRemote'), 'origin')?.trim()
              if (!remote) return
              const name = window.prompt(t('git.deleteRemoteTagPromptTag'))?.trim()
              if (!name) return
              if (!window.confirm(t('git.deleteRemoteTagConfirm', { remote, name }))) return
              void runRepoAction({ type: 'deleteRemoteTag', remote, name })
            }
          },
          { label: t('git.pushTags'), action: () => void runRepoAction({ type: 'pushTags' }) }
        ]
    }
  }

  const handleRevertFile = async (filePath: string): Promise<void> => {
    if (!root) return
    if (!window.confirm(t('git.revertFileConfirm', { path: filePath }))) return
    setRevertingPath(filePath)
    setError(null)
    try {
      const res = await api.git.revertFile(root, filePath)
      if (res.ok) {
        clearDraftForPath(filePath, root)
        await refreshAll(root)
      } else {
        setError(res.error || 'Failed to revert file')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRevertingPath(null)
    }
  }

  const handleStageFile = async (file: GitChangedFile): Promise<void> => {
    if (!root) return
    setStagingPath(file.path)
    setError(null)
    try {
      const res = file.staged
        ? await api.git.unstageFile(root, file.path)
        : await api.git.stageFile(root, file.path)
      if (!res.ok) setError(res.error || t(file.staged ? 'git.unstageFailed' : 'git.stageFailed'))
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStagingPath(null)
    }
  }

  const handleStageAll = async (): Promise<void> => {
    if (!root) return
    setIsStagingAll(true)
    setError(null)
    try {
      const res = await api.git.stageAll(root)
      if (!res.ok) setError(res.error || t('git.stageAllFailed'))
      await refreshAll(root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsStagingAll(false)
    }
  }

  const handleRevertAll = async (): Promise<void> => {
    if (!root) return
    if (!window.confirm(t('git.revertAllConfirm'))) return
    setIsRevertingAll(true)
    setError(null)
    try {
      const res = await api.git.revertAll(root)
      if (res.ok) {
        clearDraftsForRoot(root)
        await refreshAll(root)
      } else {
        setError(res.error || 'Failed to revert all changes')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsRevertingAll(false)
    }
  }

  const handleAbortMerge = async (): Promise<void> => {
    if (!root) return
    if (!window.confirm(t('git.abortMergeConfirm'))) return
    setAbortingMerge(true)
    setError(null)
    try {
      const res = await api.git.abortMerge(root)
      if (res.ok) {
        clearDraftsForRoot(root)
        await refreshAll(root)
      } else {
        setError(res.error || 'Failed to abort merge')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAbortingMerge(false)
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

  const renderPublishForm = (): JSX.Element => (
    <div className="w-full text-left rounded-xl border border-border bg-surface p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-1.5">
          <UploadCloud className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold uppercase tracking-wider text-text">
            {t('git.publishTitle')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPublishOpen(false)}
          className="text-xs text-text-subtle hover:text-text"
        >
          {t('common.cancel')}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Mode switch */}
      <div className="flex items-center rounded-lg bg-surface-2 p-0.5 border border-border text-xs">
        <button
          type="button"
          onClick={() => setPublishMode('new')}
          className={cn(
            'flex-1 py-1 px-2 rounded-md font-medium transition-colors text-center',
            publishMode === 'new'
              ? 'bg-surface text-text shadow-xs'
              : 'text-text-muted hover:text-text'
          )}
        >
          {t('git.publishModeNew')}
        </button>
        <button
          type="button"
          onClick={() => setPublishMode('existing')}
          className={cn(
            'flex-1 py-1 px-2 rounded-md font-medium transition-colors text-center',
            publishMode === 'existing'
              ? 'bg-surface text-text shadow-xs'
              : 'text-text-muted hover:text-text'
          )}
        >
          {t('git.publishModeExisting')}
        </button>
      </div>

      {publishMode === 'new' ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">
              {t('git.repoName')}
            </label>
            <Input
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder={t('git.repoNamePlaceholder')}
              className="w-full text-xs font-mono"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">
              {t('git.repoDescription')}
            </label>
            <Input
              value={repoDescription}
              onChange={(e) => setRepoDescription(e.target.value)}
              placeholder={t('git.repoDescriptionPlaceholder')}
              className="w-full text-xs"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-text pt-0.5">
            <input
              type="checkbox"
              checked={isPrivateRepo}
              onChange={(e) => setIsPrivateRepo(e.target.checked)}
              className="rounded border-border accent-accent h-3.5 w-3.5"
            />
            <span>{isPrivateRepo ? t('git.privateRepo') : t('git.publicRepo')}</span>
          </label>

          {showTokenInput ? (
            <div>
              <label className="block text-[11px] font-medium text-text-muted mb-1">
                {t('git.personalAccessToken')}
              </label>
              <Input
                type="password"
                value={personalToken}
                onChange={(e) => setPersonalToken(e.target.value)}
                placeholder={t('git.personalAccessTokenPlaceholder')}
                className="w-full text-xs font-mono"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTokenInput(true)}
              className="text-[10px] text-text-subtle hover:text-text underline block text-left"
            >
              {t('git.personalAccessToken')}
            </button>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-[11px] font-medium text-text-muted mb-1">
            {t('git.remoteUrl')}
          </label>
          <Input
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder={t('git.remoteUrlPlaceholder')}
            className="w-full text-xs font-mono"
            autoFocus
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => setPublishOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handlePublish()}
          disabled={publishing || (publishMode === 'new' ? !repoName.trim() : !remoteUrl.trim())}
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
  )

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
                onClick={() => {
                  setError(null)
                  setPublishOpen(true)
                }}
                disabled={initializing}
              >
                <UploadCloud className="h-4 w-4" />
                {t('git.publishRepo')}
              </Button>
            </div>
          ) : (
            renderPublishForm()
          )}
        </div>
      </div>
    )
  }

  const branchName = gitStatus?.branch || t('git.detached')
  const isDirty = changedFiles.length > 0 || Boolean(gitStatus?.dirty)
  const pendingSyncCount = (gitStatus?.ahead ?? 0) + (gitStatus?.behind ?? 0)
  const hasWorkingChanges = changedFiles.length > 0
  const canUndoLastCommit = commits.length > 0 && (!gitStatus?.hasUpstream || (gitStatus?.ahead ?? 0) > 0)
  const showCommitMenu = hasWorkingChanges || canUndoLastCommit

  const categories: {
    id: 'commit' | 'changes' | 'pullPush' | 'branch' | 'remote' | 'stash' | 'tags'
    label: string
    icon: typeof GitBranch
  }[] = [
    { id: 'commit', label: t('git.menuCommit'), icon: GitCommitHorizontal },
    { id: 'changes', label: t('git.menuChanges'), icon: Files },
    { id: 'pullPush', label: t('git.menuPullPush'), icon: RefreshCw },
    { id: 'branch', label: t('git.menuBranch'), icon: GitBranch },
    { id: 'remote', label: t('git.menuRemote'), icon: FolderGit2 },
    { id: 'stash', label: t('git.menuStash'), icon: Archive },
    { id: 'tags', label: t('git.menuTags'), icon: Tag }
  ]

  const isActionBusy = repositoryAction !== null || fetching || pulling || pushing || syncing

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

        <div ref={gitMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() =>
              setGitMenuOpen((open) => {
                if (open) setActiveCategory(null)
                return !open
              })
            }
            title={t('git.moreActions')}
            aria-label={t('git.moreActions')}
            aria-expanded={gitMenuOpen}
            disabled={isActionBusy}
            className="press-scale flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/5 hover:text-text"
          >
            {isActionBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ellipsis className="h-4 w-4" />
            )}
          </button>
          {gitMenuOpen &&
            createPortal(
              <div ref={portalRef} className="z-[9999] text-xs font-sans">
                <div
                  ref={mainMenuRef}
                  style={{
                    position: 'fixed',
                    top: (gitMenuRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                    right: Math.max(
                      8,
                      window.innerWidth - (gitMenuRef.current?.getBoundingClientRect().right ?? 0)
                    ),
                    zIndex: 9999
                  }}
                  className="animate-pop-in flex max-h-[75vh] w-52 origin-top-right flex-col overflow-y-auto sq-frame sq-xl sq-fill-elevated sq-ring edge edge-strong edge-panel rounded-xl border border-border bg-elevated p-1 shadow-float"
                >
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onMouseEnter={(e) => {
                        setActiveCategory(cat.id)
                        setCategoryAnchorRect(e.currentTarget.getBoundingClientRect())
                      }}
                      onClick={(e) => {
                        setActiveCategory((prev) => (prev === cat.id ? null : cat.id))
                        setCategoryAnchorRect(e.currentTarget.getBoundingClientRect())
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors',
                        activeCategory === cat.id
                          ? 'bg-accent/15 text-accent'
                          : 'text-text hover:bg-white/5'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <cat.icon className="h-3.5 w-3.5 opacity-70" />
                        <span>{cat.label}</span>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                    </button>
                  ))}
                  {!gitStatus?.hasUpstream && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        type="button"
                        onClick={() => {
                          setGitMenuOpen(false)
                          setActiveCategory(null)
                          setError(null)
                          setPublishOpen(true)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-text"
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                        {t('git.publishRepo')}
                      </button>
                    </>
                  )}
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setGitMenuOpen(false)
                      setActiveCategory(null)
                      handleManualRefresh()
                    }}
                    disabled={refreshing}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                    {t('ide.refresh')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShowCommandOutput()}
                    disabled={!onOpenCommandOutput}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                    {t('git.showGitOutput')}
                  </button>
                </div>

                {activeCategory && categoryAnchorRect && (
                  <div
                    ref={submenuRef}
                    style={{
                      position: 'fixed',
                      top: Math.min(
                        Math.max(8, categoryAnchorRect.top - 4),
                        Math.max(8, window.innerHeight - 340)
                      ),
                      left:
                        window.innerWidth - categoryAnchorRect.right >= 230
                          ? categoryAnchorRect.right + 4
                          : Math.max(8, categoryAnchorRect.left - 224),
                      zIndex: 10000
                    }}
                    className="animate-pop-in flex max-h-[75vh] w-56 flex-col overflow-y-auto sq-frame sq-xl sq-fill-elevated sq-ring edge edge-strong edge-panel rounded-xl border border-border bg-elevated p-1 shadow-float"
                  >
                    {getCategoryItems(activeCategory).map((item, idx) => {
                      if (item.isDivider) {
                        return (
                          <div key={`divider-${idx}`} className="my-1 border-t border-border" />
                        )
                      }
                      return (
                        <button
                          key={`${item.label}-${idx}`}
                          type="button"
                          onClick={() => {
                            setGitMenuOpen(false)
                            setActiveCategory(null)
                            item.action?.()
                          }}
                          disabled={item.disabled}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                            item.danger
                              ? 'text-danger hover:bg-danger/10 disabled:opacity-40'
                              : 'text-text hover:bg-white/5 disabled:opacity-40'
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>,
              document.body
            )}
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

      {/* Merge In Progress banner */}
      {(isGitMerging || changedFiles.some((f) => f.status === 'conflict')) && (
        <div className="flex items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold truncate">
              {changedFiles.some((f) => f.status === 'conflict')
                ? t('git.mergeInProgress')
                : t('git.allConflictsResolved')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!changedFiles.some((f) => f.status === 'conflict') && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleCommit()}
                disabled={committing}
                className="h-6 px-2 text-[10px]"
              >
                {committing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3 mr-1" />
                )}
                {t('git.completeMerge')}
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleAbortMerge()}
              disabled={abortingMerge}
              className="h-6 px-2 text-[10px]"
            >
              {abortingMerge ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3 mr-1" />
              )}
              {t('git.abortMerge')}
            </Button>
          </div>
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
              placeholder={isGitMerging ? t('git.completeMerge') : t('git.commitPlaceholder')}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text placeholder:text-text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div
            ref={commitMenuRef}
            className="relative flex h-8 w-full overflow-visible rounded-lg bg-accent text-white"
          >
            <Button
              variant="primary"
              size="sm"
              onClick={() => void (hasWorkingChanges ? handleCommit() : handleSync())}
              disabled={
                committing ||
                syncing ||
                (!hasWorkingChanges && pendingSyncCount === 0) ||
                (hasWorkingChanges && !commitMessage.trim() && !isGitMerging) ||
                changedFiles.some((f) => f.status === 'conflict')
              }
              className={cn(
                'min-w-0 flex-1 bg-accent text-white hover:bg-accent/90',
                showCommitMenu && 'rounded-r-none'
              )}
            >
              {committing || syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : !hasWorkingChanges ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <GitCommitHorizontal className="h-3.5 w-3.5" />
              )}
              {!hasWorkingChanges
                ? syncing
                  ? t('git.commitsToSync', { count: pendingSyncCount })
                  : `${t('git.syncChanges')} (${pendingSyncCount})`
                : committing
                ? t('git.committing')
                : isGitMerging
                  ? t('git.completeMerge')
                  : t('git.commit')}
            </Button>
            {showCommitMenu && (
              <button
                type="button"
                title={t('git.commitOptions')}
                aria-label={t('git.commitOptions')}
                aria-expanded={commitMenuOpen}
                onClick={() => setCommitMenuOpen((open) => !open)}
                disabled={
                  committing ||
                  undoingCommit ||
                  isGitMerging ||
                  changedFiles.some((f) => f.status === 'conflict')
                }
                className="press-scale flex w-9 items-center justify-center rounded-r-lg border-l border-white/20 bg-accent text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown className={cn('h-3.5 w-3.5 transition', commitMenuOpen && 'rotate-180')} />
              </button>
            )}
            {showCommitMenu && commitMenuOpen && (
              <div className="animate-pop-in absolute right-0 top-full z-50 mt-2 flex w-52 origin-top-right flex-col overflow-hidden sq-frame sq-xl sq-fill-elevated sq-ring edge edge-strong edge-panel rounded-xl border border-border bg-elevated p-1 shadow-float">
                {hasWorkingChanges &&
                  ([
                    ['push', t('git.commitAndPush')],
                    ['sync', t('git.commitAndSync')],
                    ['amend', t('git.commitAmend')]
                  ] as const).map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => void handleCommit(action)}
                      disabled={action !== 'amend' && !commitMessage.trim()}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-white/5 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                {hasWorkingChanges && canUndoLastCommit && <div className="my-1 border-t border-border" />}
                {canUndoLastCommit && (
                  <button
                    type="button"
                    onClick={() => void handleUndoLastCommit()}
                    disabled={undoingCommit}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-warning/10 hover:text-warning disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {undoingCommit ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {undoingCommit ? t('git.undoingLastCommit') : t('git.undoLastCommit')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setFilesExpanded(!filesExpanded)}
              title={
                changedFiles.length > 0
                  ? t('git.changes', { count: changedFiles.length })
                  : t('git.noChanges')
              }
              className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text transition-colors"
            >
              {filesExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {changedFiles.length > 0 ? (
                <>
                  <span>{t('git.changesLabel')}</span>
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/15 px-1 text-[10px] font-semibold leading-none text-accent">
                    {changedFiles.length}
                  </span>
                </>
              ) : (
                <span>{t('git.noChanges')}</span>
              )}
            </button>

            {changedFiles.length > 0 && (
              <>
                {onOpenChanges && (
                  <button
                    type="button"
                    onClick={() => onOpenChanges(changedFiles)}
                    title={t('git.openChanges')}
                    aria-label={t('git.openChanges')}
                    className="press-scale ml-auto flex h-6 w-6 items-center justify-center rounded text-text-subtle transition-colors hover:bg-white/5 hover:text-text"
                  >
                    <Files className="h-3.5 w-3.5" />
                  </button>
                )}
                {changedFiles.some((file) => !file.staged && file.status !== 'conflict') && (
                  <button
                    type="button"
                    onClick={() => void handleStageAll()}
                    disabled={isStagingAll}
                    title={isStagingAll ? t('git.stagingAll') : t('git.stageAll')}
                    aria-label={isStagingAll ? t('git.stagingAll') : t('git.stageAll')}
                    className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-subtle transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-50"
                  >
                    {isStagingAll ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRevertAll()}
                  disabled={isRevertingAll}
                  title={t('git.revertAll')}
                  aria-label={t('git.revertAll')}
                  className="press-scale ml-1 flex h-6 w-6 items-center justify-center rounded text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                >
                  <RotateCcw className={cn('h-3 w-3', isRevertingAll && 'animate-spin')} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Changed Files List */}
        {filesExpanded && changedFiles.length > 0 && (
          <div className="mt-2 flex-1 min-h-0 overflow-y-auto rounded-lg border border-border/70 bg-surface divide-y divide-border/40">
            {changedFiles.map((file) => {
              const isConflict = file.status === 'conflict'
              const statusColor = isConflict
                ? 'text-danger bg-danger/20 border-danger/40'
                : file.status === 'added'
                  ? 'text-success bg-success/15 border-success/30'
                  : file.status === 'deleted'
                    ? 'text-danger bg-danger/15 border-danger/30'
                    : file.status === 'untracked'
                      ? 'text-accent bg-accent/15 border-accent/30'
                      : 'text-warning bg-warning/15 border-warning/30'

              const statusLetter = isConflict
                ? 'C'
                : file.status === 'added'
                  ? 'A'
                  : file.status === 'deleted'
                    ? 'D'
                    : file.status === 'untracked'
                      ? 'U'
                      : 'M'

              return (
                <div
                  key={file.path}
                  onClick={() => {
                    if (isConflict) {
                      setResolvingConflictPath(file.path)
                    } else {
                      handleFileClick(file.path)
                    }
                  }}
                  className="group flex items-center justify-between gap-2 px-2.5 py-1 text-xs hover:bg-white/5 transition-colors cursor-pointer hover:text-text"
                  title={file.path}
                >
                  <span className="truncate font-mono text-[11px] text-text-muted group-hover:text-text">
                    {file.path}
                  </span>

                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isConflict ? (
                      <button
                        type="button"
                        onClick={() => setResolvingConflictPath(file.path)}
                        title={t('git.resolveConflict')}
                        className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/30 transition-colors"
                      >
                        {t('git.resolveConflict')}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleStageFile(file)}
                          disabled={stagingPath === file.path}
                          title={t(file.staged ? 'git.unstage' : 'git.stage')}
                          className={cn(
                            'flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-semibold opacity-0 transition-all group-hover:opacity-100 disabled:opacity-50',
                            stagingPath === file.path && 'opacity-100',
                            file.staged
                              ? 'bg-success/15 text-success hover:bg-success/25'
                              : 'text-text-muted hover:bg-accent/15 hover:text-accent'
                          )}
                        >
                          {stagingPath === file.path ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : file.staged ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevertFile(file.path)}
                          disabled={revertingPath === file.path}
                          title={t('git.revertFile')}
                          className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-danger/15 hover:text-danger disabled:opacity-50 transition-all"
                        >
                          <RotateCcw
                            className={cn('h-3 w-3', revertingPath === file.path && 'animate-spin')}
                          />
                        </button>
                      </>
                    )}

                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold border',
                        statusColor
                      )}
                      title={isConflict ? t('git.status.conflict') : file.status}
                    >
                      {statusLetter}
                    </span>
                  </div>
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

      {/* Standalone Publish Modal when already a repo but publishing to GitHub */}
      {publishOpen && gitStatus?.isRepo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            {renderPublishForm()}
          </div>
        </div>
      )}

      {/* Merge Conflict Solver Modal */}
      {resolvingConflictPath && root && (
        <MergeConflictSolver
          root={root}
          filePath={resolvingConflictPath}
          onClose={() => setResolvingConflictPath(null)}
          onResolved={async () => {
            setResolvingConflictPath(null)
            await refreshAll(root)
          }}
        />
      )}
    </div>
  )
}
