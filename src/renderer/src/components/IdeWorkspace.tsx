import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCheck,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Loader2,
  Pencil,
  Replace,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { GitFileDiffResult, WorkspaceFileEntry, WorkspaceFileSearchMatch } from '@shared/api'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { writeClipboardText } from '../lib/clipboard'
import { useRoxyStore } from '../lib/store'
import { subscribeFileReviews } from '../lib/agent-file-changes'
import {
  loadExpandedFolders,
  saveExpandedFolders,
  loadActiveFile,
  saveActiveFile,
  getAncestorPaths,
  migrateRenamedPath,
  pruneDeletedPath,
  normalizeRoot
} from '../lib/ide-state'
import { ContextMenuRow, ContextMenuSurface, CONTEXT_MENU_PAD, CONTEXT_ROW_H } from './ContextMenu'
import { CommandsPane } from './CommandsDialog'
import { FileEditor, clearDraftForPath } from './FileEditor'
import { GitActionsView } from './GitActionsView'
import { FileDiffView } from './diff/FileDiffView'

const control =
  'rounded p-1.5 text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

const MIN_PANEL_WIDTH = 180
const MAX_PANEL_WIDTH = 800
const DEFAULT_PANEL_WIDTH = 260
const PANEL_WIDTH_KEY = 'roxy:ide-panel-width'

interface ExplorerActions {
  sessionId: string
  refreshNonce: number
  selectedPath: string | undefined
  onSelect: (entry: WorkspaceFileEntry) => void
  creating: { parentPath: string; isDirectory: boolean } | null
  startCreate: (parentPath: string, isDirectory: boolean) => void
  cancelCreate: () => void
  renaming: string | null
  startRename: (entry: WorkspaceFileEntry) => void
  cancelRename: () => void
  deleteEntry: (entry: WorkspaceFileEntry) => Promise<void>
  openContextMenu: (e: React.MouseEvent, entry?: WorkspaceFileEntry, targetDir?: string) => void
  isExpanded: (path: string) => boolean
  toggleExpanded: (path: string) => void
  setExpanded: (path: string, expanded: boolean) => void
  renameEntry: (oldPath: string, newPath: string, isDirectory: boolean) => void
}

const ExplorerContext = createContext<ExplorerActions | null>(null)
function useExplorer(): ExplorerActions {
  const ctx = useContext(ExplorerContext)
  if (!ctx) throw new Error('useExplorer must be used within ExplorerContext')
  return ctx
}

function Directory({ path }: { path: string }): JSX.Element {
  const { t } = useTranslation()
  const {
    sessionId,
    refreshNonce,
    creating,
    cancelCreate,
    onSelect,
    openContextMenu,
    setExpanded
  } = useExplorer()
  const [entries, setEntries] = useState<WorkspaceFileEntry[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [createName, setCreateName] = useState('')
  const createInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let current = true
    if (!entries) setError(false)
    void api.files.list(sessionId, path).then(
      (result) => {
        if (current) {
          setEntries(result)
          setError(false)
        }
      },
      () => {
        if (current) setError(true)
      }
    )
    return () => {
      current = false
    }
  }, [sessionId, path, attempt, refreshNonce])

  const isCreatingHere = creating && creating.parentPath === path

  useEffect(() => {
    if (isCreatingHere) {
      setCreateName('')
      setTimeout(() => createInputRef.current?.focus(), 30)
    }
  }, [isCreatingHere])

  const handleCommitCreate = async (): Promise<void> => {
    const name = createName.trim()
    if (!name) {
      cancelCreate()
      return
    }
    const targetPath = path ? `${path}/${name}` : name
    try {
      const res = await api.files.create(sessionId, targetPath, creating?.isDirectory)
      if (!creating?.isDirectory) {
        onSelect({ path: res.path, name, directory: false })
      } else {
        setExpanded(res.path, true)
      }
    } catch {
      alert(creating?.isDirectory ? t('ide.folderCreateError') : t('ide.fileCreateError'))
    } finally {
      cancelCreate()
    }
  }

  if (error)
    return (
      <div className="p-3 text-xs text-text-muted" role="alert">
        <p>{t('ide.folderError')}</p>
        <button type="button" className={control} onClick={() => setAttempt((v) => v + 1)}>
          {t('ide.retry')}
        </button>
      </div>
    )
  if (!entries)
    return (
      <p role="status" className="p-3 text-xs text-text-muted">
        {t('ide.loading')}
      </p>
    )

  return (
    <ul
      className="space-y-0.5"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openContextMenu(e, undefined, path)
      }}
    >
      {isCreatingHere && (
        <li className="flex items-center gap-1.5 rounded px-2 py-1 bg-surface-2 border border-accent/40">
          <ChevronRight className="invisible h-3 w-3 shrink-0" />
          {creating?.isDirectory ? (
            <Folder className="h-4 w-4 shrink-0 text-accent/80" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-accent" />
          )}
          <input
            ref={createInputRef}
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCommitCreate()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelCreate()
              }
            }}
            onBlur={() => {
              if (!createName.trim()) {
                cancelCreate()
              } else {
                void handleCommitCreate()
              }
            }}
            placeholder={t('ide.namePlaceholder')}
            className="w-full min-w-0 bg-transparent text-xs text-text placeholder:text-text-subtle focus:outline-none"
            spellCheck={false}
          />
        </li>
      )}
      {entries.map((entry) => (
        <Entry key={entry.path} entry={entry} />
      ))}
      {!entries.length && !isCreatingHere && (
        <p className="p-2 text-xs text-text-subtle">{t('ide.emptyFolder')}</p>
      )}
    </ul>
  )
}

function Entry({ entry }: { entry: WorkspaceFileEntry }): JSX.Element {
  const { t } = useTranslation()
  const {
    sessionId,
    selectedPath,
    onSelect,
    creating,
    startCreate,
    renaming,
    startRename,
    cancelRename,
    deleteEntry,
    openContextMenu,
    isExpanded,
    toggleExpanded,
    setExpanded,
    renameEntry
  } = useExplorer()
  const expanded = entry.directory ? isExpanded(entry.path) : false
  const [renameName, setRenameName] = useState(entry.name)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const Icon = entry.directory ? (expanded ? FolderOpen : Folder) : FileText

  const isRenaming = renaming === entry.path

  useEffect(() => {
    if (isRenaming) {
      setRenameName(entry.name)
      setTimeout(() => {
        const input = renameInputRef.current
        if (!input) return
        input.focus()
        if (!entry.directory && entry.name.includes('.')) {
          const dot = entry.name.lastIndexOf('.')
          input.setSelectionRange(0, dot)
        } else {
          input.select()
        }
      }, 30)
    }
  }, [isRenaming, entry.name, entry.directory])

  useEffect(() => {
    if (creating && creating.parentPath === entry.path) {
      setExpanded(entry.path, true)
    }
  }, [creating, entry.path, setExpanded])

  const handleCommitRename = async (): Promise<void> => {
    const val = renameName.trim()
    if (!val || val === entry.name) {
      cancelRename()
      return
    }
    const parentPath = entry.path.includes('/')
      ? entry.path.slice(0, entry.path.lastIndexOf('/'))
      : ''
    const newPath = parentPath ? `${parentPath}/${val}` : val
    try {
      const res = await api.files.rename(sessionId, entry.path, newPath)
      renameEntry(entry.path, res.newPath, entry.directory)
      if (selectedPath === entry.path) {
        onSelect({ path: res.newPath, name: val, directory: entry.directory })
      }
    } catch {
      alert(t('ide.renameError'))
    } finally {
      cancelRename()
    }
  }

  if (isRenaming) {
    return (
      <li>
        <div className="flex items-center gap-1.5 rounded px-2 py-1 bg-surface-2 border border-accent/40">
          <ChevronRight
            aria-hidden
            className={`h-3 w-3 shrink-0 ${!entry.directory ? 'invisible' : expanded ? 'rotate-90' : ''}`}
          />
          <Icon
            aria-hidden
            className={`h-4 w-4 shrink-0 ${entry.directory ? 'text-accent/80' : ''}`}
          />
          <input
            ref={renameInputRef}
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCommitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
            onBlur={() => void handleCommitRename()}
            className="w-full min-w-0 bg-transparent text-xs text-text focus:outline-none"
            spellCheck={false}
          />
        </div>
        {entry.directory && expanded && (
          <div className="ml-3 border-l border-border pl-1">
            <Directory path={entry.path} />
          </div>
        )}
      </li>
    )
  }

  const isSelected = !entry.directory && selectedPath === entry.path

  return (
    <li
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openContextMenu(e, entry)
      }}
    >
      <div className="group relative flex w-full items-center">
        <button
          type="button"
          aria-expanded={entry.directory ? expanded : undefined}
          aria-current={isSelected ? 'true' : undefined}
          title={entry.path}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isSelected ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}
          onClick={() => (entry.directory ? toggleExpanded(entry.path) : onSelect(entry))}
        >
          <ChevronRight
            aria-hidden
            className={`h-3 w-3 shrink-0 transition-transform ${!entry.directory ? 'invisible' : expanded ? 'rotate-90' : ''}`}
          />
          <Icon
            aria-hidden
            className={`h-4 w-4 shrink-0 ${entry.directory ? 'text-accent/80' : ''}`}
          />
          <span className="truncate pr-16">{entry.name}</span>
        </button>

        {/* Hover action buttons */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 rounded bg-surface/95 px-1 py-0.5 shadow-xs border border-border/50">
          {entry.directory && (
            <>
              <button
                type="button"
                className="p-1 text-text-subtle hover:text-text rounded hover:bg-white/10 transition-colors"
                title={t('ide.newFile')}
                aria-label={t('ide.newFile')}
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(entry.path, true)
                  startCreate(entry.path, false)
                }}
              >
                <FilePlus className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="p-1 text-text-subtle hover:text-text rounded hover:bg-white/10 transition-colors"
                title={t('ide.newFolder')}
                aria-label={t('ide.newFolder')}
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(entry.path, true)
                  startCreate(entry.path, true)
                }}
              >
                <FolderPlus className="h-3 w-3" />
              </button>
            </>
          )}
          <button
            type="button"
            className="p-1 text-text-subtle hover:text-text rounded hover:bg-white/10 transition-colors"
            title={t('ide.rename')}
            aria-label={t('ide.rename')}
            onClick={(e) => {
              e.stopPropagation()
              startRename(entry)
            }}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="p-1 text-text-subtle hover:text-danger rounded hover:bg-white/10 transition-colors"
            title={t('ide.delete')}
            aria-label={t('ide.delete')}
            onClick={(e) => {
              e.stopPropagation()
              void deleteEntry(entry)
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {entry.directory && expanded && (
        <div className="ml-3 border-l border-border pl-1">
          <Directory path={entry.path} />
        </div>
      )}
    </li>
  )
}

interface FileContextMenuState {
  x: number
  y: number
  entry?: WorkspaceFileEntry
  targetDir?: string
}

function FileContextMenu({
  menu,
  onClose,
  onStartCreate,
  onStartRename,
  onDelete
}: {
  menu: FileContextMenuState
  onClose: () => void
  onStartCreate: (parentPath: string, isDirectory: boolean) => void
  onStartRename: (entry: WorkspaceFileEntry) => void
  onDelete: (entry: WorkspaceFileEntry) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { entry, targetDir } = menu

  const items: Array<{
    label: string
    icon: typeof FilePlus
    danger?: boolean
    onSelect: () => void
  }> = []

  if (entry) {
    if (entry.directory) {
      items.push({
        label: t('ide.newFile'),
        icon: FilePlus,
        onSelect: () => onStartCreate(entry.path, false)
      })
      items.push({
        label: t('ide.newFolder'),
        icon: FolderPlus,
        onSelect: () => onStartCreate(entry.path, true)
      })
    }
    items.push({
      label: t('ide.rename'),
      icon: Pencil,
      onSelect: () => onStartRename(entry)
    })
    items.push({
      label: t('ide.delete'),
      icon: Trash2,
      danger: true,
      onSelect: () => onDelete(entry)
    })
  } else {
    const parent = targetDir ?? ''
    items.push({
      label: t('ide.newFile'),
      icon: FilePlus,
      onSelect: () => onStartCreate(parent, false)
    })
    items.push({
      label: t('ide.newFolder'),
      icon: FolderPlus,
      onSelect: () => onStartCreate(parent, true)
    })
  }

  const height = items.length * CONTEXT_ROW_H + CONTEXT_MENU_PAD

  return (
    <ContextMenuSurface x={menu.x} y={menu.y} height={height} onClose={onClose}>
      {items.map((item) => (
        <ContextMenuRow
          key={item.label}
          label={item.label}
          icon={item.icon}
          danger={item.danger}
          onSelect={() => {
            onClose()
            item.onSelect()
          }}
        />
      ))}
    </ContextMenuSurface>
  )
}

function GitDiffViewer({
  root,
  path,
  commitSha,
  onClose,
  onOpenEditor
}: {
  root: string
  path: string
  commitSha?: string
  onClose: () => void
  onOpenEditor: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [diff, setDiff] = useState<GitFileDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [reverting, setReverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffNonce, setDiffNonce] = useState(0)

  // Auto-refresh working tree diff when files change or window focuses
  useEffect(() => {
    if (commitSha) return
    return api.files.onChanged(() => {
      setDiffNonce((n) => n + 1)
    })
  }, [commitSha])

  useEffect(() => {
    if (commitSha) return
    const onFocus = (): void => setDiffNonce((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [commitSha])

  useEffect(() => {
    let active = true
    if (diffNonce === 0) setLoading(true)
    setError(null)
    api.git
      .fileDiff(root, path, commitSha)
      .then((res) => {
        if (!active) return
        if (res.ok) {
          setDiff(res)
        } else {
          setError(res.error || t('git.diffError'))
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [root, path, commitSha, diffNonce, t])

  const handleRevert = async (): Promise<void> => {
    if (!window.confirm(t('git.revertFileConfirm', { path }))) return
    setReverting(true)
    setError(null)
    try {
      const res = await api.git.revertFile(root, path)
      if (res.ok) {
        clearDraftForPath(path, root)
        onClose()
      } else {
        setError(res.error || 'Failed to revert file')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReverting(false)
    }
  }

  return (
    <section
      aria-label={t('ide.diffTab')}
      className="flex min-h-0 min-w-[280px] flex-1 flex-col bg-bg"
    >
      {/* Top File & Revision Header Bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-accent shrink-0" />
          <span className="truncate font-mono text-xs font-semibold text-text" title={path}>
            {path}
          </span>
          <span className="rounded bg-surface-2 border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-subtle shrink-0">
            {commitSha ? commitSha.slice(0, 7) : t('git.workingTree')}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!commitSha && (
            <>
              <button
                type="button"
                onClick={() => void handleRevert()}
                disabled={reverting}
                title={t('git.revertFile')}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className={cn('h-3 w-3', reverting && 'animate-spin')} />
                <span>{t('git.revertFile')}</span>
              </button>
              <button
                type="button"
                onClick={onOpenEditor}
                title={t('git.viewEditor')}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-text-muted hover:bg-white/5 hover:text-text transition-colors"
              >
                <Pencil className="h-3 w-3" />
                <span>{t('git.viewEditor')}</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-white/5 hover:text-text transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Diff Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="flex flex-1 items-center justify-center p-6 text-text-muted gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-xs">{t('git.loadingFiles')}</span>
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center p-6 text-danger text-xs text-center">
            {error}
          </div>
        ) : diff?.isBinary ? (
          <div className="flex flex-1 items-center justify-center p-6 text-text-subtle text-xs text-center">
            {t('git.binaryDiff')}
          </div>
        ) : diff ? (
          <FileDiffView path={path} before={diff.before} after={diff.after} />
        ) : null}
      </div>
    </section>
  )
}

function Preview({
  sessionId,
  root,
  entry,
  initialLine,
  onClose
}: {
  sessionId: string
  root: string
  entry: WorkspaceFileEntry
  initialLine?: number
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      aria-label={t('ide.preview')}
      className="flex min-h-0 min-w-[280px] flex-1 flex-col bg-bg"
    >
      <FileEditor
        sessionId={sessionId}
        root={root}
        entry={entry}
        initialLine={initialLine}
        onClose={onClose}
      />
    </section>
  )
}

function WorkspaceContents({
  sessionId,
  root
}: {
  sessionId: string | null
  root: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const ideSelectedFile = useRoxyStore((s) => s.ideSelectedFile)
  const ideSelectedLine = useRoxyStore((s) => s.ideSelectedLine)
  const ideSelectedRoot = useRoxyStore((s) => s.ideSelectedRoot)
  const setIdeSelectedFile = useRoxyStore((s) => s.setIdeSelectedFile)
  const selectionMatchesRoot = Boolean(
    root && ideSelectedRoot && normalizeRoot(ideSelectedRoot) === normalizeRoot(root)
  )

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
    loadExpandedFolders(root)
  )

  const [selected, setSelected] = useState<WorkspaceFileEntry | null>(() => {
    if (ideSelectedFile && selectionMatchesRoot) return ideSelectedFile
    const saved = loadActiveFile(root)
    if (saved) {
      return {
        path: saved.path,
        name: saved.name,
        directory: false
      }
    }
    return null
  })
  const [selectedLine, setSelectedLine] = useState<number | undefined>(() => {
    if (ideSelectedFile && selectionMatchesRoot) return ideSelectedLine
    const saved = loadActiveFile(root)
    return saved?.line
  })
  const [diffTarget, setDiffTarget] = useState<{
    path: string
    commitSha?: string
  } | null>(null)
  const [copied, setCopied] = useState(0)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [creating, setCreating] = useState<{ parentPath: string; isDirectory: boolean } | null>(
    null
  )
  const [renaming, setRenaming] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)

  const ideTab = useRoxyStore((s) => s.ideTab)
  const setIdeTab = useRoxyStore((s) => s.setIdeTab)

  // Search & replace state
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [replaceStatus, setReplaceStatus] = useState<string | null>(null)
  const [searchNonce, setSearchNonce] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<WorkspaceFileSearchMatch[]>([])
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const commandsOpen = useRoxyStore((s) => s.commandsOpen)
  const setCommandsOpen = useRoxyStore((s) => s.setCommandsOpen)
  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const chats = useRoxyStore((s) => s.chats)
  const activeChat = chats.find((c) => c.id === activeChatId) ?? null
  const [terminalHeight, setTerminalHeight] = useState(260)
  const isDragging = useRef(false)

  const asideRef = useRef<HTMLElement | null>(null)
  const isPanelDragging = useRef(false)
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return Number.isFinite(v) && v >= MIN_PANEL_WIDTH && v <= MAX_PANEL_WIDTH
      ? v
      : DEFAULT_PANEL_WIDTH
  })

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
  }, [panelWidth])

  // Auto-refresh when files change in workspace
  useEffect(() => {
    return api.files.onChanged((payload) => {
      if (!payload.sessionId || payload.sessionId === sessionId) {
        setRefreshNonce((n) => n + 1)
      }
    })
  }, [sessionId])

  // Auto-refresh when window regains focus
  useEffect(() => {
    const onFocus = (): void => setRefreshNonce((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Auto-refresh when agent file reviews update
  useEffect(() => {
    return subscribeFileReviews(() => setRefreshNonce((n) => n + 1))
  }, [])

  // Periodic safety fallback poll
  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshNonce((n) => n + 1)
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  // Handle root change if component is kept mounted across project switch
  const prevRootRef = useRef(root)
  useEffect(() => {
    if (prevRootRef.current !== root) {
      prevRootRef.current = root
      setExpandedFolders(loadExpandedFolders(root))
      const saved = loadActiveFile(root)
      if (saved) {
        const entry = { path: saved.path, name: saved.name, directory: false }
        setSelected(entry)
        setSelectedLine(saved.line)
        setIdeSelectedFile(entry, saved.line, root)
      } else {
        setSelected(null)
        setSelectedLine(undefined)
        setIdeSelectedFile(null, undefined, root)
      }
    }
  }, [root, setIdeSelectedFile])

  // Save expanded folders whenever they change
  useEffect(() => {
    if (!root) return
    saveExpandedFolders(root, expandedFolders)
  }, [root, expandedFolders])

  // Save active file whenever selected or selectedLine changes
  useEffect(() => {
    if (!root) return
    if (selected) {
      saveActiveFile(root, {
        path: selected.path,
        name: selected.name,
        line: selectedLine
      })
    } else {
      saveActiveFile(root, null)
    }
  }, [root, selected, selectedLine])

  // On initial mount, replace stale cross-workspace selection with restored local state.
  useEffect(() => {
    setIdeSelectedFile(selected, selectedLine, root)
  }, [])

  const isExpanded = useCallback(
    (dirPath: string) => expandedFolders.has(dirPath),
    [expandedFolders]
  )

  const toggleExpanded = useCallback((dirPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }, [])

  const setExpanded = useCallback((dirPath: string, expand: boolean) => {
    setExpandedFolders((prev) => {
      if (prev.has(dirPath) === expand) return prev
      const next = new Set(prev)
      if (expand) {
        next.add(dirPath)
      } else {
        next.delete(dirPath)
      }
      return next
    })
  }, [])

  const expandAncestors = useCallback((filePath: string) => {
    const ancestors = getAncestorPaths(filePath)
    if (ancestors.length === 0) return
    setExpandedFolders((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const a of ancestors) {
        if (!next.has(a)) {
          next.add(a)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  const handleRenameEntry = useCallback(
    (oldPath: string, newPath: string, isDirectory: boolean) => {
      if (isDirectory) {
        setExpandedFolders((prev) => migrateRenamedPath(prev, oldPath, newPath))
        if (selected && selected.path.startsWith(`${oldPath}/`)) {
          const updatedPath = `${newPath}/${selected.path.slice(oldPath.length + 1)}`
          const updatedEntry: WorkspaceFileEntry = {
            ...selected,
            path: updatedPath
          }
          setSelected(updatedEntry)
          setIdeSelectedFile(updatedEntry, selectedLine, root)
        }
      } else {
        if (selected && selected.path === oldPath) {
          const newName = newPath.split('/').pop() || newPath
          const updatedEntry: WorkspaceFileEntry = {
            ...selected,
            path: newPath,
            name: newName
          }
          setSelected(updatedEntry)
          setIdeSelectedFile(updatedEntry, selectedLine, root)
        }
      }
    },
    [selected, selectedLine, setIdeSelectedFile, root]
  )

  useEffect(() => {
    if (ideSelectedFile && selectionMatchesRoot) {
      setSelected(ideSelectedFile)
      setSelectedLine(ideSelectedLine)
      expandAncestors(ideSelectedFile.path)
    }
  }, [ideSelectedFile, ideSelectedLine, selectionMatchesRoot, expandAncestors])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(0), 1200)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!replaceStatus) return
    const timer = setTimeout(() => setReplaceStatus(null), 3500)
    return () => clearTimeout(timer)
  }, [replaceStatus])

  const copyPath = async (text: string): Promise<void> => {
    const ok = await writeClipboardText(text)
    if (ok) setCopied((n) => n + 1)
  }

  // Live search debounced
  useEffect(() => {
    if (ideTab !== 'search' || !sessionId || !root || !searchQuery.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      void api.files
        .search(sessionId, searchQuery, { caseSensitive, wholeWord })
        .then((matches) => {
          if (cancelled) return
          setSearchResults(matches)
          setSearching(false)
        })
        .catch(() => {
          if (cancelled) return
          setSearchResults([])
          setSearching(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ideTab, sessionId, root, searchQuery, caseSensitive, wholeWord, searchNonce, refreshNonce])

  const executeReplace = async (paths?: string[]): Promise<void> => {
    if (!sessionId || !root || !searchQuery.trim() || replacing) return
    setReplacing(true)
    setReplaceStatus(null)
    try {
      const res = await api.files.replace(
        sessionId,
        searchQuery,
        replaceQuery,
        { caseSensitive, wholeWord },
        paths
      )
      setReplaceStatus(
        t('ide.replaceSuccess', {
          count: res.replacements,
          files: res.filesChanged
        })
      )
      setSearchNonce((n) => n + 1)
      setRefreshNonce((n) => n + 1)
      if (selected && (!paths || paths.includes(selected.path))) {
        setSelected({ ...selected })
      }
    } catch {
      // ignore
    } finally {
      setReplacing(false)
    }
  }

  const groupedResults = useMemo(() => {
    const map = new Map<string, WorkspaceFileSearchMatch[]>()
    for (const match of searchResults) {
      const list = map.get(match.path) ?? []
      list.push(match)
      map.set(match.path, list)
    }
    return map
  }, [searchResults])

  const openSearchResult = (match: WorkspaceFileSearchMatch): void => {
    const fileName = match.path.split('/').pop() || match.path
    const entry: WorkspaceFileEntry = {
      path: match.path,
      name: fileName,
      directory: false
    }
    setSelected(entry)
    setSelectedLine(match.line)
    setIdeSelectedFile(entry, match.line, root)
    setDiffTarget(null)
    expandAncestors(match.path)
  }

  const handleSelectFile = (entry: WorkspaceFileEntry): void => {
    setSelected(entry)
    setSelectedLine(undefined)
    setIdeSelectedFile(entry, undefined, root)
    setDiffTarget(null)
  }

  const handleDeleteEntry = async (entry: WorkspaceFileEntry): Promise<void> => {
    if (!sessionId) return
    if (!window.confirm(t('ide.deleteConfirm', { name: entry.name }))) return
    try {
      await api.files.delete(sessionId, entry.path)
      if (
        selected?.path === entry.path ||
        (entry.directory && selected?.path.startsWith(`${entry.path}/`))
      ) {
        setSelected(null)
        setSelectedLine(undefined)
        setIdeSelectedFile(null, undefined, root)
      }
      if (entry.directory) {
        setExpandedFolders((prev) => pruneDeletedPath(prev, entry.path))
      }
      setRefreshNonce((n) => n + 1)
    } catch {
      alert(t('ide.deleteError', { name: entry.name }))
    }
  }

  const explorerContextValue: ExplorerActions = {
    sessionId: sessionId ?? '',
    refreshNonce,
    selectedPath: selected?.path,
    onSelect: handleSelectFile,
    creating,
    startCreate: (parentPath, isDirectory) => setCreating({ parentPath, isDirectory }),
    cancelCreate: () => setCreating(null),
    renaming,
    startRename: (entry) => setRenaming(entry.path),
    cancelRename: () => setRenaming(null),
    deleteEntry: handleDeleteEntry,
    openContextMenu: (e, entry, targetDir) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        entry,
        targetDir
      })
    },
    isExpanded,
    toggleExpanded,
    setExpanded,
    renameEntry: handleRenameEntry
  }

  return (
    <>
      <aside
        ref={asideRef}
        aria-label={
          ideTab === 'files'
            ? t('ide.explorer')
            : ideTab === 'search'
              ? t('ide.searchTab')
              : t('ide.gitTab')
        }
        className="relative flex h-full shrink-0 border-r border-border bg-surface"
      >
        {/* Activity bar / tab switcher on the side */}
        <div
          role="tablist"
          aria-orientation="vertical"
          className="flex w-11 shrink-0 flex-col items-center border-r border-border bg-surface-2/40 py-2.5 gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={ideTab === 'files'}
            onClick={() => setIdeTab('files')}
            title={t('ide.filesTab')}
            aria-label={t('ide.filesTab')}
            className={cn(
              'press-scale relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              ideTab === 'files'
                ? 'bg-elevated text-accent shadow-xs'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            )}
          >
            {ideTab === 'files' && (
              <span className="absolute -left-1.5 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
            )}
            <Folder className="h-4 w-4" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ideTab === 'search'}
            onClick={() => {
              setIdeTab('search')
              setTimeout(() => searchInputRef.current?.focus(), 50)
            }}
            title={t('ide.searchTab')}
            aria-label={t('ide.searchTab')}
            className={cn(
              'press-scale relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              ideTab === 'search'
                ? 'bg-elevated text-accent shadow-xs'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            )}
          >
            {ideTab === 'search' && (
              <span className="absolute -left-1.5 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
            )}
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ideTab === 'git'}
            onClick={() => setIdeTab('git')}
            title={t('ide.gitTab')}
            aria-label={t('ide.gitTab')}
            className={cn(
              'press-scale relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              ideTab === 'git'
                ? 'bg-elevated text-accent shadow-xs'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            )}
          >
            {ideTab === 'git' && (
              <span className="absolute -left-1.5 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
            )}
            <GitBranch className="h-4 w-4" />
          </button>
        </div>

        {/* Panel content (Files, Search, or Git) */}
        <div
          style={{ width: panelWidth }}
          className="flex h-full flex-col overflow-hidden shrink-0"
        >
          {sessionId && root ? (
            ideTab === 'files' ? (
              <ExplorerContext.Provider value={explorerContextValue}>
                <div className="border-b border-border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div
                      className="truncate text-xs font-semibold uppercase tracking-wider text-text"
                      title={root}
                    >
                      {root.split(/[\\/]/).filter(Boolean).pop() || root}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className={control}
                        title={t('ide.newFile')}
                        aria-label={t('ide.newFile')}
                        onClick={() => setCreating({ parentPath: '', isDirectory: false })}
                      >
                        <FilePlus aria-hidden className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={control}
                        title={t('ide.newFolder')}
                        aria-label={t('ide.newFolder')}
                        onClick={() => setCreating({ parentPath: '', isDirectory: true })}
                      >
                        <FolderPlus aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyPath(root)}
                    title={root}
                    className="press-scale relative mt-0.5 flex w-full min-w-0 items-center text-left text-[11px] text-text-subtle hover:text-text-muted focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        'truncate font-mono transition-opacity duration-150',
                        copied && 'opacity-0'
                      )}
                    >
                      {root}
                    </span>
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-0 flex items-center text-[10px] font-medium text-accent transition-opacity duration-150',
                        copied ? 'opacity-100' : 'opacity-0'
                      )}
                    >
                      {t('chat.copied')}
                    </span>
                  </button>
                </div>
                <div
                  className="min-h-0 flex-1 overflow-auto p-1.5"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      targetDir: ''
                    })
                  }}
                >
                  <Directory path="" />
                </div>
              </ExplorerContext.Provider>
            ) : ideTab === 'search' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="border-b border-border p-2 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReplace((v) => !v)
                        if (!showReplace) {
                          setTimeout(() => replaceInputRef.current?.focus(), 50)
                        }
                      }}
                      title={t('ide.toggleReplace')}
                      aria-label={t('ide.toggleReplace')}
                      className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-text-subtle hover:text-text hover:bg-white/5 transition-colors"
                    >
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 transition-transform duration-150',
                          showReplace && 'rotate-90'
                        )}
                      />
                    </button>

                    <div className="flex flex-1 items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 min-w-0">
                      <Search className="h-3.5 w-3.5 text-text-subtle shrink-0" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('ide.searchPlaceholder')}
                        className="w-full bg-transparent text-xs text-text placeholder:text-text-subtle focus:outline-none"
                        spellCheck={false}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          title={t('ide.clearSearch')}
                          className="text-text-subtle hover:text-text"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {showReplace && (
                    <div className="flex items-center gap-1 pl-6">
                      <div className="flex flex-1 items-center gap-1.5 rounded border border-border bg-surface-2 px-2 py-1 min-w-0">
                        <Replace className="h-3.5 w-3.5 text-text-subtle shrink-0" />
                        <input
                          ref={replaceInputRef}
                          type="text"
                          value={replaceQuery}
                          onChange={(e) => setReplaceQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              void executeReplace()
                            }
                          }}
                          placeholder={t('ide.replacePlaceholder')}
                          className="w-full bg-transparent text-xs text-text placeholder:text-text-subtle focus:outline-none"
                          spellCheck={false}
                        />
                        {replaceQuery && (
                          <button
                            type="button"
                            onClick={() => setReplaceQuery('')}
                            title={t('ide.clearReplace')}
                            className="text-text-subtle hover:text-text"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void executeReplace()}
                        disabled={!searchQuery.trim() || searchResults.length === 0 || replacing}
                        title={t('ide.replaceAll')}
                        aria-label={t('ide.replaceAll')}
                        className="press-scale flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-surface-2 text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-30 transition-colors"
                      >
                        {replacing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        ) : (
                          <CheckCheck className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setCaseSensitive((v) => !v)}
                        title={t('ide.caseSensitive')}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-mono font-medium transition-colors',
                          caseSensitive
                            ? 'bg-accent/20 text-accent font-bold'
                            : 'text-text-subtle hover:bg-surface-2 hover:text-text'
                        )}
                      >
                        Aa
                      </button>
                      <button
                        type="button"
                        onClick={() => setWholeWord((v) => !v)}
                        title={t('ide.wholeWord')}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-mono font-medium transition-colors',
                          wholeWord
                            ? 'bg-accent/20 text-accent font-bold'
                            : 'text-text-subtle hover:bg-surface-2 hover:text-text'
                        )}
                      >
                        \b
                      </button>
                    </div>

                    <span
                      className="text-[11px] text-text-subtle truncate max-w-[145px]"
                      title={replaceStatus ?? undefined}
                    >
                      {replacing
                        ? t('ide.replacing')
                        : replaceStatus
                          ? replaceStatus
                          : searching
                            ? t('ide.searching')
                            : searchQuery.trim()
                              ? searchResults.length > 0
                                ? t('ide.searchMatches', {
                                    count: searchResults.length,
                                    files: groupedResults.size
                                  })
                                : t('ide.noMatches')
                              : ''}
                    </span>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-1.5 space-y-1">
                  {Array.from(groupedResults.entries()).map(([filePath, matches]) => {
                    const isCollapsed = collapsedFiles.has(filePath)
                    const fileName = filePath.split('/').pop() || filePath
                    const dirPath = filePath.includes('/')
                      ? filePath.slice(0, filePath.lastIndexOf('/'))
                      : ''

                    return (
                      <div key={filePath} className="rounded overflow-hidden">
                        <div className="group flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-surface-2 transition-colors">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedFiles((prev) => {
                                const next = new Set(prev)
                                if (next.has(filePath)) next.delete(filePath)
                                else next.add(filePath)
                                return next
                              })
                            }
                            className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-xs text-text"
                          >
                            <ChevronRight
                              className={cn(
                                'h-3 w-3 shrink-0 transition-transform text-text-subtle',
                                !isCollapsed && 'rotate-90'
                              )}
                            />
                            <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
                            <span className="truncate font-medium" title={filePath}>
                              {fileName}
                              {dirPath && (
                                <span className="ml-1 text-[10px] text-text-subtle font-normal">
                                  {dirPath}
                                </span>
                              )}
                            </span>
                          </button>

                          {showReplace && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                void executeReplace([filePath])
                              }}
                              disabled={replacing}
                              title={t('ide.replaceInFile')}
                              aria-label={t('ide.replaceInFile')}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-text-subtle hover:text-text hover:bg-white/10 transition-all"
                            >
                              <CheckCheck className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] tabular-nums text-text-subtle shrink-0">
                            {matches.length}
                          </span>
                        </div>

                        {!isCollapsed && (
                          <div className="ml-4 border-l border-border pl-1 space-y-0.5 mt-0.5">
                            {matches.map((m, idx) => (
                              <button
                                key={`${m.line}-${m.column}-${idx}`}
                                type="button"
                                onClick={() => openSearchResult(m)}
                                className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-[11px] font-mono hover:bg-surface-2 transition-colors group"
                              >
                                <span className="shrink-0 text-accent/80 font-medium">
                                  {m.line}
                                </span>
                                <span className="truncate text-text-muted group-hover:text-text">
                                  {m.lineText}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <GitActionsView
                root={root}
                sessionId={sessionId}
                onOpenFile={(filePath, commitSha) => {
                  const fileName = filePath.split('/').pop() || filePath
                  const entry: WorkspaceFileEntry = {
                    path: filePath,
                    name: fileName,
                    directory: false
                  }
                  setSelected(entry)
                  setSelectedLine(undefined)
                  setIdeSelectedFile(entry, undefined, root)
                  setDiffTarget({ path: filePath, commitSha })
                }}
              />
            )
          ) : (
            <p className="p-4 text-xs text-text-muted">{t('ide.noWorkspace')}</p>
          )}
        </div>

        {/* Horizontal drag handle to resize the sidebar panel width */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('ide.resizePanel')}
          aria-valuenow={panelWidth}
          onPointerDown={(e) => {
            isPanelDragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!isPanelDragging.current) return
            const aside = asideRef.current
            if (!aside) return
            const rect = aside.getBoundingClientRect()
            const newW = e.clientX - rect.left - 44
            setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newW)))
          }}
          onPointerUp={(e) => {
            isPanelDragging.current = false
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onDoubleClick={() => {
            setPanelWidth(DEFAULT_PANEL_WIDTH)
          }}
          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize touch-none z-20 hover:bg-accent/40 focus-visible:bg-accent transition-colors"
          title={t('ide.resizePanel')}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {sessionId && root ? (
            diffTarget ? (
              <GitDiffViewer
                key={`diff:${diffTarget.path}:${diffTarget.commitSha ?? 'wt'}`}
                root={root}
                path={diffTarget.path}
                commitSha={diffTarget.commitSha}
                onClose={() => {
                  setDiffTarget(null)
                  setSelected(null)
                  setSelectedLine(undefined)
                  setIdeSelectedFile(null, undefined, root)
                }}
                onOpenEditor={() => setDiffTarget(null)}
              />
            ) : selected ? (
              <Preview
                key={`${selected.path}:${selectedLine ?? 0}`}
                sessionId={sessionId}
                root={root}
                entry={selected}
                initialLine={selectedLine}
                onClose={() => {
                  setSelected(null)
                  setSelectedLine(undefined)
                  setIdeSelectedFile(null, undefined, root)
                }}
              />
            ) : (
              <section
                aria-label={t('ide.preview')}
                className="flex min-w-[280px] flex-1 flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-text-subtle"
              >
                <FileText aria-hidden className="h-8 w-8 opacity-40" />
                <p className="max-w-52 text-sm">{t('ide.selectFile')}</p>
              </section>
            )
          ) : (
            <p className="p-4 text-xs text-text-muted">{t('ide.noWorkspace')}</p>
          )}
        </div>

        {commandsOpen && activeChat && (
          <div
            style={{ height: terminalHeight }}
            className="relative flex min-h-[140px] max-h-[70vh] shrink-0 flex-col border-t border-border bg-bg"
          >
            <div
              role="separator"
              tabIndex={0}
              aria-label={t('commands.title')}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                isDragging.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!isDragging.current) return
                const container = e.currentTarget.parentElement?.parentElement
                if (!container) return
                const rect = container.getBoundingClientRect()
                const newHeight = rect.bottom - e.clientY
                setTerminalHeight(Math.max(120, Math.min(rect.height - 100, newHeight)))
              }}
              onPointerUp={(e) => {
                isDragging.current = false
                e.currentTarget.releasePointerCapture(e.pointerId)
              }}
              className="absolute -top-1 inset-x-0 h-2 cursor-row-resize touch-none z-20 hover:bg-accent/40 focus-visible:bg-accent transition-colors"
            />
            <CommandsPane
              chat={activeChat}
              onClose={() => setCommandsOpen(false)}
              onPopOut={() => void api.terminal.open(activeChat.id)}
              className="h-full border-0 rounded-none shadow-none"
            />
          </div>
        )}
      </div>

      {contextMenu && (
        <FileContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onStartCreate={(parentPath, isDirectory) => {
            setContextMenu(null)
            if (parentPath) setExpanded(parentPath, true)
            setCreating({ parentPath, isDirectory })
          }}
          onStartRename={(entry) => {
            setContextMenu(null)
            setRenaming(entry.path)
          }}
          onDelete={(entry) => {
            setContextMenu(null)
            void handleDeleteEntry(entry)
          }}
        />
      )}
    </>
  )
}

export function IdeWorkspace({
  sessionId,
  root
}: {
  sessionId: string | null
  root: string | null
}): JSX.Element {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <WorkspaceContents sessionId={sessionId} root={root} />
    </div>
  )
}
