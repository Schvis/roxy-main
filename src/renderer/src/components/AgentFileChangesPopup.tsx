import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileCode,
  FileEdit,
  FileMinus,
  FilePlus,
  Loader2,
  RotateCcw,
  ArrowUpRight,
  X
} from 'lucide-react'
import { useRoxyStore } from '../lib/store'
import {
  extractAgentFileChanges,
  keepFileChange,
  undoFileChange,
  keepAllFileChanges,
  undoAllFileChanges,
  subscribeFileReviews,
  type AgentFileChange
} from '../lib/agent-file-changes'
import { cn } from '../lib/cn'

const DISMISSED_KEY_PREFIX = 'roxy.file_changes_dismissed.'

export function AgentFileChangesPopup(): JSX.Element | null {
  const { t } = useTranslation()
  const messages = useRoxyStore((s) => s.messages)
  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const chats = useRoxyStore((s) => s.chats)
  const streaming = useRoxyStore((s) =>
    s.activeChatId ? (s.streamingChats[s.activeChatId] ?? null) : null
  )
  const setIdeSelectedFile = useRoxyStore((s) => s.setIdeSelectedFile)
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const parentChat = activeChat?.parentId
    ? chats.find((chat) => chat.id === activeChat.parentId)
    : undefined
  const workspaceRoot =
    activeChat?.worktreePath ??
    activeChat?.workspacePath ??
    parentChat?.worktreePath ??
    parentChat?.workspacePath ??
    null

  const [reviewNonce, setReviewNonce] = useState(0)
  useEffect(() => subscribeFileReviews(() => setReviewNonce((n) => n + 1)), [])

  const summary = useMemo(
    () => extractAgentFileChanges(messages, streaming, activeChatId ?? undefined),
    [messages, streaming, activeChatId, reviewNonce]
  )

  const isDismissedStored = (chatId: string | null, changeKey: string): boolean => {
    if (typeof localStorage === 'undefined' || !chatId || !changeKey) return false
    try {
      return localStorage.getItem(`${DISMISSED_KEY_PREFIX}${chatId}`) === changeKey
    } catch {
      return false
    }
  }

  const [isDismissed, setIsDismissed] = useState(() =>
    isDismissedStored(activeChatId, summary.changeKey)
  )
  const [isExpanded, setIsExpanded] = useState(true)
  const [lastChangeKey, setLastChangeKey] = useState(summary.changeKey)
  const [activeTab, setActiveTab] = useState<'all' | 'latest'>('all')
  const [revertingPath, setRevertingPath] = useState<string | null>(null)
  const [isRevertingAll, setIsRevertingAll] = useState(false)

  // Auto-expand and un-dismiss whenever fresh file changes land from the agent
  useEffect(() => {
    if (summary.changeKey && summary.changeKey !== lastChangeKey) {
      setLastChangeKey(summary.changeKey)
      setActiveTab('all')
      const dismissed = isDismissedStored(activeChatId, summary.changeKey)
      if (!dismissed || Boolean(streaming)) {
        setIsDismissed(false)
        setIsExpanded(true)
      } else {
        setIsDismissed(true)
      }
    }
  }, [summary.changeKey, lastChangeKey, streaming, activeChatId])

  // Filter to files that are still pending review
  const pendingFiles = summary.files.filter((f) => f.reviewStatus === 'pending')
  const latestPendingFiles = summary.latestTurnFiles.filter((f) => f.reviewStatus === 'pending')
  const hasLatest = latestPendingFiles.length > 0
  const displayedFiles = activeTab === 'latest' && hasLatest ? latestPendingFiles : pendingFiles

  // If no pending files remain, reset and clean up popup
  if (displayedFiles.length === 0) return null

  const pendingAdded = displayedFiles.reduce((acc, f) => acc + f.addedLines, 0)
  const pendingRemoved = displayedFiles.reduce((acc, f) => acc + f.removedLines, 0)
  const createdCount = displayedFiles.filter((f) => f.isCreated).length
  const deletedCount = displayedFiles.filter((f) => f.isDeleted).length

  const handleOpenFile = (change: AgentFileChange): void => {
    setIdeSelectedFile({
      path: change.path,
      name: change.fileName,
      directory: false
    }, undefined, workspaceRoot)
  }

  const handleKeepFile = (file: AgentFileChange): void => {
    if (!activeChatId) return
    keepFileChange(activeChatId, file.path, file.latestAfter)
  }

  const handleUndoFile = async (file: AgentFileChange): Promise<void> => {
    if (!activeChatId) return
    setRevertingPath(file.path)
    try {
      await undoFileChange(activeChatId, file)
    } finally {
      setRevertingPath(null)
    }
  }

  const handleKeepAll = (): void => {
    if (!activeChatId) return
    keepAllFileChanges(activeChatId, displayedFiles)
  }

  const handleRevertAll = async (): Promise<void> => {
    if (!activeChatId || isRevertingAll) return
    setIsRevertingAll(true)
    try {
      await undoAllFileChanges(activeChatId, displayedFiles)
    } finally {
      setIsRevertingAll(false)
    }
  }

  const handleDismiss = (): void => {
    setIsDismissed(true)
    if (activeChatId && summary.changeKey) {
      try {
        localStorage.setItem(`${DISMISSED_KEY_PREFIX}${activeChatId}`, summary.changeKey)
      } catch {}
    }
  }

  // When dismissed, provide a minimal pill so the user can re-open it
  if (isDismissed) {
    return (
      <div className="shrink-0 border-b border-border/70 bg-surface/50 px-4 py-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setIsDismissed(false)
              if (activeChatId) {
                try {
                  localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${activeChatId}`)
                } catch {}
              }
            }}
            title={t('chat.toggleFileChanges')}
            className="flex items-center gap-2 rounded px-2 py-0.5 text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
          >
            <FileCode className="h-3.5 w-3.5 text-accent" />
            <span className="font-medium text-[11px]">
              {t('chat.fileChanges', { count: displayedFiles.length })}
            </span>
            <span className="flex items-center gap-1 font-mono text-[10px]">
              {pendingAdded > 0 && <span className="text-emerald-400">+{pendingAdded}</span>}
              {pendingRemoved > 0 && <span className="text-rose-400">-{pendingRemoved}</span>}
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label={t('chat.fileChanges', { count: displayedFiles.length })}
      className="shrink-0 border-b border-border bg-surface/90 backdrop-blur-sm px-4 py-2 text-xs shadow-sm transition-all"
    >
      <div className="flex flex-col gap-2">
        {/* Header summary bar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
              <FileCode className="h-3.5 w-3.5" />
            </div>

            <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-text text-xs">
                {t('chat.fileChanges', { count: displayedFiles.length })}
              </span>

              <div className="flex items-center gap-1 font-mono text-[11px] tabular-nums">
                {pendingAdded > 0 && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-emerald-400 font-medium">
                    +{pendingAdded}
                  </span>
                )}
                {pendingRemoved > 0 && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.2 text-rose-400 font-medium">
                    -{pendingRemoved}
                  </span>
                )}
              </div>

              {createdCount > 0 && (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.2 text-[10px] font-medium text-emerald-400">
                  {t('chat.filesCreated', { count: createdCount })}
                </span>
              )}
              {deletedCount > 0 && (
                <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.2 text-[10px] font-medium text-rose-400">
                  {t('chat.filesDeleted', { count: deletedCount })}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Filter tabs if multiple turns exist */}
            {latestPendingFiles.length > 0 && latestPendingFiles.length !== pendingFiles.length && (
              <div className="flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  className={cn(
                    'rounded px-1.5 py-0.5 font-medium transition-colors',
                    activeTab === 'all'
                      ? 'bg-surface text-text shadow-sm'
                      : 'text-text-muted hover:text-text'
                  )}
                >
                  {t('chat.allSessionChanges')} ({pendingFiles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('latest')}
                  className={cn(
                    'rounded px-1.5 py-0.5 font-medium transition-colors',
                    activeTab === 'latest'
                      ? 'bg-surface text-text shadow-sm'
                      : 'text-text-muted hover:text-text'
                  )}
                >
                  {t('chat.latestTurnChanges')} ({latestPendingFiles.length})
                </button>
              </div>
            )}

            {displayedFiles.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isRevertingAll || Boolean(revertingPath)}
                  onClick={handleKeepAll}
                  title={t('chat.keepAllChanges')}
                  className="press-scale flex h-6 items-center gap-1 rounded bg-emerald-500/15 px-2 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                >
                  <Check className="h-3 w-3" />
                  <span>{t('chat.keepAll')}</span>
                </button>
                <button
                  type="button"
                  disabled={isRevertingAll || Boolean(revertingPath)}
                  onClick={() => void handleRevertAll()}
                  title={t('chat.revertAllChanges')}
                  className="press-scale flex h-6 items-center gap-1 rounded bg-rose-500/15 px-2 text-[11px] font-medium text-rose-400 hover:bg-rose-500/25 transition-colors disabled:opacity-50"
                >
                  {isRevertingAll ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  <span>{t('chat.revertAll')}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              title={t('chat.toggleFileChanges')}
              aria-expanded={isExpanded}
              className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-surface-2 hover:text-text transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              title={t('chat.dismissFileChanges')}
              aria-label={t('chat.dismissFileChanges')}
              className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-surface-2 hover:text-text transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Popup List of Files */}
        {isExpanded && (
          <div className="mt-1 overflow-hidden rounded-lg border border-border/70 bg-surface/70">
            <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
              {displayedFiles.map((file) => {
                const StatusIcon = file.isCreated ? FilePlus : file.isDeleted ? FileMinus : FileEdit
                const isItemReverting = revertingPath === file.path

                return (
                  <div
                    key={file.path}
                    onClick={() => handleOpenFile(file)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleOpenFile(file)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={t('chat.viewChanges')}
                    className="group flex items-center justify-between gap-3 px-3 py-1.5 text-xs transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent cursor-pointer"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <StatusIcon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          file.isCreated && 'text-emerald-400',
                          file.isDeleted && 'text-rose-400',
                          file.isModified && 'text-accent'
                        )}
                      />

                      <span className="shrink-0 font-medium text-text group-hover:text-accent transition-colors">
                        {file.fileName}
                      </span>

                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle">
                        {file.path}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* Status Pill */}
                      {file.isCreated ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          {t('chat.fileCreated')}
                        </span>
                      ) : file.isDeleted ? (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                          {t('chat.fileDeleted')}
                        </span>
                      ) : (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                          {t('chat.fileModified')}
                        </span>
                      )}

                      {/* Line change counts */}
                      <div className="flex items-center gap-1 font-mono text-[11px] tabular-nums">
                        {file.addedLines > 0 && (
                          <span className="text-emerald-400 font-medium">+{file.addedLines}</span>
                        )}
                        {file.removedLines > 0 && (
                          <span className="text-rose-400 font-medium">-{file.removedLines}</span>
                        )}
                      </div>

                      {/* Keep and Undo options per file */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={isRevertingAll || isItemReverting}
                          onClick={() => handleKeepFile(file)}
                          title={t('chat.keep')}
                          className="press-scale flex h-5 w-5 items-center justify-center rounded text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isRevertingAll || isItemReverting}
                          onClick={() => void handleUndoFile(file)}
                          title={t('chat.undo')}
                          className="press-scale flex h-5 w-5 items-center justify-center rounded text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                        >
                          {isItemReverting ? (
                            <Loader2 className="h-3 w-3 animate-spin text-rose-400" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                        </button>
                      </div>

                      <ArrowUpRight className="h-3 w-3 text-text-subtle group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                  </div>
                )
              })}
            </div>

            {displayedFiles.length > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-surface-2/40 px-3 py-1.5 text-xs">
                <span className="text-[11px] text-text-subtle">
                  {t('chat.fileChanges', { count: displayedFiles.length })}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isRevertingAll || Boolean(revertingPath)}
                    onClick={handleKeepAll}
                    title={t('chat.keepAllChanges')}
                    className="press-scale flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    <span>{t('chat.keepAll')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isRevertingAll || Boolean(revertingPath)}
                    onClick={() => void handleRevertAll()}
                    title={t('chat.revertAllChanges')}
                    className="press-scale flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/25 transition-colors disabled:opacity-50"
                  >
                    {isRevertingAll ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    <span>{t('chat.revertAll')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
