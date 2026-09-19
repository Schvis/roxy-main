import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronRight,
  CornerLeftUp,
  FileCode,
  Folder,
  FolderPlus,
  Loader2,
  Search,
  X
} from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { getFileIconDescriptor } from '../lib/file-icon'
import { createContextAttachment } from '@shared/context'
import type { ChatContextAttachment } from '@shared/types'
import type { WorkspaceFileEntry, WorkspaceFileSearchMatch } from '@shared/api'
import { Button } from './ui'

interface SelectedItem {
  type: 'file' | 'folder'
  path: string
  name: string
  line?: number
}

export function ContextFilePickerModal({
  sessionId,
  workspaceRoot,
  onClose,
  onAttach
}: {
  sessionId: string
  workspaceRoot: string | null
  onClose: () => void
  onAttach: (attachments: ChatContextAttachment[]) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([])
  const [searchResults, setSearchResults] = useState<WorkspaceFileSearchMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(() => new Map())
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Load directory entries when currentPath changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.files
      .list(sessionId, currentPath)
      .then((items) => {
        if (!cancelled) {
          setEntries(items)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, currentPath])

  // Search across workspace when search query is 2+ chars
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api.files
        .search(sessionId, q, { maxResults: 100 })
        .then((res) => {
          if (!cancelled) {
            setSearchResults(res)
          }
        })
        .catch(() => {
          if (!cancelled) setSearchResults([])
        })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId, searchQuery])

  // Filtered directory entries for local filter
  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)
    )
  }, [entries, searchQuery])

  // Breadcrumbs for currentPath
  const pathSegments = useMemo(() => {
    if (!currentPath) return []
    return currentPath.split('/').filter(Boolean)
  }, [currentPath])

  const navigateToSegment = (index: number): void => {
    if (index < 0) {
      setCurrentPath('')
    } else {
      setCurrentPath(pathSegments.slice(0, index + 1).join('/'))
    }
  }

  const handleGoUp = (): void => {
    if (!currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    setCurrentPath(parts.join('/'))
  }

  const toggleSelect = (
    type: 'file' | 'folder',
    path: string,
    name: string,
    line?: number
  ): void => {
    const key = line ? `${type}:${path}:${line}` : `${type}:${path}`
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.set(key, { type, path, name, line })
      }
      return next
    })
  }

  const isSelected = (type: 'file' | 'folder', path: string, line?: number): boolean => {
    return selectedItems.has(line ? `${type}:${path}:${line}` : `${type}:${path}`)
  }

  const handleAttachCurrentFolder = (): void => {
    if (!currentPath) return
    const name = currentPath.split('/').pop() || currentPath
    toggleSelect('folder', currentPath, name)
  }

  const handleCommitSelection = (): void => {
    if (selectedItems.size === 0) return
    const attachments: ChatContextAttachment[] = []
    for (const item of selectedItems.values()) {
      attachments.push(createContextAttachment(item.type, item.path, workspaceRoot, item.line))
    }
    onAttach(attachments)
    onClose()
  }

  const handleDirectAttach = (type: 'file' | 'folder', path: string, line?: number): void => {
    onAttach([createContextAttachment(type, path, workspaceRoot, line)])
    onClose()
  }

  const isSearching = searchQuery.trim().length >= 2 && searchResults.length > 0
  const currentDirName = pathSegments.at(-1) || ''

  return (
    <div
      className="animate-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="animate-modal-in flex h-[580px] max-h-[90vh] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <FolderPlus className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-text">
              {t('chat.attachContextModalTitle')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="press-scale flex h-7 w-7 items-center justify-center rounded-lg text-text-subtle hover:bg-white/5 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="border-b border-border/80 bg-surface-2/40 px-4 py-2.5">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-text-subtle" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('chat.searchFilesPlaceholder')}
              className="w-full rounded-lg border border-border bg-surface py-1.5 pl-9 pr-8 text-xs text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-text-subtle hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Breadcrumbs (when not searching across files) */}
        {!isSearching && (
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface-2/20 px-4 py-1.5 text-xs text-text-muted">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto py-0.5">
              <button
                type="button"
                onClick={() => navigateToSegment(-1)}
                className={cn(
                  'press-scale flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-text',
                  !currentPath && 'font-semibold text-text'
                )}
              >
                <Folder className="h-3 w-3 text-accent" />
                <span>{t('chat.root')}</span>
              </button>
              {pathSegments.map((segment, index) => {
                const isLast = index === pathSegments.length - 1
                return (
                  <div key={segment + index} className="flex items-center gap-1 shrink-0">
                    <ChevronRight className="h-3 w-3 text-text-subtle/60" />
                    <button
                      type="button"
                      onClick={() => navigateToSegment(index)}
                      className={cn(
                        'press-scale rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-text',
                        isLast && 'font-semibold text-text'
                      )}
                    >
                      {segment}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 pl-2">
              {currentPath && (
                <>
                  <button
                    type="button"
                    onClick={handleGoUp}
                    title={t('chat.goUp')}
                    className="press-scale flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-[11px] hover:bg-white/10 hover:text-text"
                  >
                    <CornerLeftUp className="h-3 w-3" />
                    <span>{t('chat.goUp')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAttachCurrentFolder}
                    className={cn(
                      'press-scale flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors',
                      isSelected('folder', currentPath)
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                        : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20'
                    )}
                  >
                    {isSelected('folder', currentPath) ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span>{t('chat.contextAttached')}</span>
                      </>
                    ) : (
                      <>
                        <FolderPlus className="h-3 w-3" />
                        <span>{t('chat.attachThisFolder', { name: currentDirName })}</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-danger">
              <span>{error}</span>
            </div>
          ) : isSearching ? (
            /* Workspace search results */
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1 text-[11px] font-medium text-text-subtle">
                Search results ({searchResults.length}):
              </div>
              {searchResults.map((match, idx) => {
                const fileName = match.path.split('/').pop() || match.path
                const checked = isSelected('file', match.path, match.line)
                return (
                  <div
                    key={`${match.path}:${match.line}:${idx}`}
                    onDoubleClick={() => handleDirectAttach('file', match.path, match.line)}
                    onClick={() => toggleSelect('file', match.path, fileName, match.line)}
                    className={cn(
                      'press-scale flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer select-none',
                      checked
                        ? 'bg-accent/15 text-text border border-accent/30'
                        : 'hover:bg-white/5 text-text-muted hover:text-text'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          checked
                            ? 'border-accent bg-accent text-white'
                            : 'border-border bg-surface'
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </div>
                      <FileCode className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-medium text-text">{fileName}</span>
                        <span className="truncate font-mono text-[10px] text-text-subtle">
                          {match.path}:{match.line}
                        </span>
                      </div>
                    </div>
                    {match.lineText && (
                      <span className="truncate font-mono text-[10px] text-text-subtle max-w-[200px]">
                        {match.lineText.trim()}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-text-muted">
              {searchQuery ? t('chat.noMatchingFiles') : t('chat.emptyFolder')}
            </div>
          ) : (
            /* Directory entries list */
            <div className="flex flex-col gap-0.5">
              {filteredEntries.map((entry) => {
                const type = entry.directory ? 'folder' : 'file'
                const checked = isSelected(type, entry.path)
                return (
                  <div
                    key={entry.path}
                    onDoubleClick={() => {
                      if (entry.directory) {
                        setCurrentPath(entry.path)
                      } else {
                        handleDirectAttach('file', entry.path)
                      }
                    }}
                    className={cn(
                      'press-scale flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors select-none',
                      checked
                        ? 'bg-accent/15 text-text border border-accent/30'
                        : 'hover:bg-white/5 text-text-muted hover:text-text'
                    )}
                  >
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer"
                      onClick={() => {
                        if (entry.directory) {
                          setCurrentPath(entry.path)
                        } else {
                          toggleSelect('file', entry.path, entry.name)
                        }
                      }}
                    >
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSelect(type, entry.path, entry.name)
                        }}
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          checked
                            ? 'border-accent bg-accent text-white'
                            : 'border-border bg-surface'
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </div>

                      {entry.directory ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
                      ) : (
                        (() => {
                          const { Icon: FileIcon, color } = getFileIconDescriptor(entry.name)
                          return <FileIcon className={cn('h-3.5 w-3.5 shrink-0', color)} />
                        })()
                      )}

                      <span
                        className="truncate font-mono text-xs"
                        title={
                          workspaceRoot
                            ? `${workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/${entry.path.replace(/^\/+/, '')}`
                            : entry.path
                        }
                      >
                        {entry.name}
                      </span>
                    </div>

                    {entry.directory && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleSelect('folder', entry.path, entry.name)}
                          className={cn(
                            'press-scale flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium border transition-colors',
                            checked
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                              : 'border-border/60 bg-surface-2 text-text-muted hover:text-text hover:bg-surface'
                          )}
                        >
                          {checked ? (
                            <>
                              <Check className="h-2.5 w-2.5" />
                              <span>{t('chat.contextAttached')}</span>
                            </>
                          ) : (
                            <>
                              <FolderPlus className="h-2.5 w-2.5" />
                              <span>{t('common.add')}</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCurrentPath(entry.path)}
                          title="Open folder"
                          className="press-scale flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 text-text-subtle hover:text-text"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-border bg-surface px-4">
          <div className="flex items-center gap-2">
            {selectedItems.size > 0 ? (
              <>
                <span className="text-xs font-medium text-text">
                  {t('chat.attachSelected', { count: selectedItems.size })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedItems(new Map())}
                  className="text-xs text-text-subtle hover:text-text underline"
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="text-xs text-text-subtle">
                Select items or double-click to attach
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selectedItems.size === 0}
              onClick={handleCommitSelection}
            >
              {t('chat.attachSelected', { count: Math.max(1, selectedItems.size) })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
