import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, GitMerge, Loader2, X, RotateCcw } from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { Button } from './ui'
import {
  parseConflictHunks,
  resolveConflictHunk,
  resolveAllConflictHunks,
  type ConflictHunk
} from '../lib/conflict-solver'
import { clearDraftForPath } from './FileEditor'

export interface MergeConflictSolverProps {
  root: string
  filePath: string
  onClose: () => void
  onResolved: () => void
}

export function MergeConflictSolver({
  root,
  filePath,
  onClose,
  onResolved
}: MergeConflictSolverProps): JSX.Element {
  const { t } = useTranslation()
  const [initialContent, setInitialContent] = useState<string>('')
  const [currentContent, setCurrentContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Load raw file content from disk
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api.git
      .fileDiff(root, filePath)
      .then((res) => {
        if (!active) return
        if (res.ok) {
          setInitialContent(res.after)
          setCurrentContent(res.after)
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
  }, [root, filePath, t])

  const hunks: ConflictHunk[] = useMemo(() => {
    return parseConflictHunks(currentContent)
  }, [currentContent])

  const handleResolveHunk = (
    hunkIndex: number,
    choice: 'current' | 'incoming' | 'both' | 'discard'
  ): void => {
    const updated = resolveConflictHunk(currentContent, hunkIndex, choice)
    setCurrentContent(updated)
  }

  const handleResolveAll = (choice: 'current' | 'incoming' | 'both'): void => {
    const updated = resolveAllConflictHunks(currentContent, choice)
    setCurrentContent(updated)
  }

  const handleReset = (): void => {
    setCurrentContent(initialContent)
  }

  const handleSaveAndStage = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const res = await api.git.resolveConflict(root, filePath, currentContent)
      if (res.ok) {
        clearDraftForPath(filePath, root)
        setSuccessMsg(t('git.allConflictsResolved'))
        setTimeout(() => {
          onResolved()
          onClose()
        }, 600)
      } else {
        setError(res.error || 'Failed to stage resolved conflict')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const allResolved = hunks.length === 0 && Boolean(currentContent)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex h-[88vh] w-[95vw] max-w-5xl flex-col rounded-xl border border-border bg-bg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <GitMerge className="h-4 w-4 text-warning shrink-0" />
            <span className="font-mono text-sm font-semibold text-text truncate">{filePath}</span>
            <span
              className={cn(
                'rounded px-2 py-0.5 font-mono text-[11px] font-bold border shrink-0',
                hunks.length > 0
                  ? 'border-warning/40 bg-warning/15 text-warning'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
              )}
            >
              {hunks.length > 0
                ? t('git.conflictsRemaining', { count: hunks.length })
                : t('git.allConflictsResolved')}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-text-subtle hover:text-text hover:bg-white/5 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Global Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/70 px-4 py-2 text-xs shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-text-muted">{t('git.resolveAll')}:</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleResolveAll('current')}
              disabled={hunks.length === 0}
              className="text-emerald-400 hover:text-emerald-300 border-emerald-500/30 text-[11px] h-7 px-2"
            >
              {t('git.acceptAllCurrent')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleResolveAll('incoming')}
              disabled={hunks.length === 0}
              className="text-blue-400 hover:text-blue-300 border-blue-500/30 text-[11px] h-7 px-2"
            >
              {t('git.acceptAllIncoming')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleResolveAll('both')}
              disabled={hunks.length === 0}
              className="text-purple-400 hover:text-purple-300 border-purple-500/30 text-[11px] h-7 px-2"
            >
              {t('git.acceptAllBoth')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-text-subtle hover:text-text text-[11px] h-7 px-2"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              <span>Reset</span>
            </Button>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSaveAndStage()}
            disabled={saving || !allResolved}
            className="text-[11px] h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1" />
            )}
            <span>{saving ? t('common.saving') : t('git.markResolved')}</span>
          </Button>
        </div>

        {/* Error / Success message */}
        {error && (
          <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-400 shrink-0">
            <Check className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Body: Conflict Hunks */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-bg">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-text-muted text-xs">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              <span>{t('git.loadingFiles')}</span>
            </div>
          ) : allResolved ? (
            <div className="flex flex-col items-center justify-center p-12 text-center bg-surface/60 rounded-xl border border-emerald-500/30 space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <Check className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-text">{t('git.allConflictsResolved')}</h3>
              <p className="text-xs text-text-muted max-w-sm">
                No conflict markers remain in this file. Click below to save your changes and stage
                the resolved file in Git.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSaveAndStage()}
                disabled={saving}
                className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                <span>{t('git.markResolved')}</span>
              </Button>
            </div>
          ) : (
            hunks.map((hunk, idx) => (
              <div
                key={hunk.id}
                className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm"
              >
                {/* Hunk Header with resolution buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-warning/20 font-mono text-[10px] font-bold text-warning border border-warning/40">
                      {idx + 1}
                    </span>
                    <span className="font-mono text-xs font-semibold text-text">
                      Conflict #{idx + 1}
                    </span>
                    <span className="text-[11px] text-text-subtle font-mono">
                      (Lines {hunk.startLine + 1}–{hunk.endLine + 1})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleResolveHunk(idx, 'current')}
                      title={t('git.acceptCurrent')}
                      className="rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 px-2 py-1 text-[11px] font-medium transition-colors"
                    >
                      {t('git.acceptCurrent')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveHunk(idx, 'incoming')}
                      title={t('git.acceptIncoming')}
                      className="rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 border border-blue-500/30 px-2 py-1 text-[11px] font-medium transition-colors"
                    >
                      {t('git.acceptIncoming')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveHunk(idx, 'both')}
                      title={t('git.acceptBoth')}
                      className="rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border border-purple-500/30 px-2 py-1 text-[11px] font-medium transition-colors"
                    >
                      {t('git.acceptBoth')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveHunk(idx, 'discard')}
                      title={t('git.discardConflict')}
                      className="rounded bg-surface hover:bg-white/10 text-text-subtle hover:text-text border border-border px-2 py-1 text-[11px] transition-colors"
                    >
                      {t('git.discardConflict')}
                    </button>
                  </div>
                </div>

                {/* Conflict Content Comparison */}
                <div className="divide-y divide-border/60">
                  {/* Current / Ours */}
                  <div className="bg-emerald-500/10 p-3">
                    <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-emerald-500/20 text-[11px] font-semibold text-emerald-400">
                      <span>
                        {'<<<<<<<'} {hunk.currentLabel}
                      </span>
                      <span className="text-[10px] font-normal uppercase tracking-wider opacity-80">
                        Current Changes (Ours)
                      </span>
                    </div>
                    <pre className="font-mono text-xs text-emerald-100 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                      {hunk.currentText || (
                        <span className="italic text-emerald-400/60 font-sans">(Empty)</span>
                      )}
                    </pre>
                  </div>

                  {/* Incoming / Theirs */}
                  <div className="bg-blue-500/10 p-3">
                    <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-blue-500/20 text-[11px] font-semibold text-blue-400">
                      <span>
                        {'>>>>>>>'} {hunk.incomingLabel}
                      </span>
                      <span className="text-[10px] font-normal uppercase tracking-wider opacity-80">
                        Incoming Changes (Theirs)
                      </span>
                    </div>
                    <pre className="font-mono text-xs text-blue-100 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                      {hunk.incomingText || (
                        <span className="italic text-blue-400/60 font-sans">(Empty)</span>
                      )}
                    </pre>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
