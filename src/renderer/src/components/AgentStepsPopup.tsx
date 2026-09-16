import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronUp, ListChecks, Loader2, X } from 'lucide-react'
import { useRoxyStore } from '../lib/store'
import { extractAgentSteps } from '../lib/agent-steps'
import { cn } from '../lib/cn'

const DISMISSED_KEY_PREFIX = 'roxy.steps_dismissed.'

export function AgentStepsPopup(): JSX.Element | null {
  const { t } = useTranslation()
  const messages = useRoxyStore((s) => s.messages)
  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const activeChat = useRoxyStore((s) => s.chats.find((c) => c.id === s.activeChatId))
  const streaming = useRoxyStore((s) =>
    s.activeChatId ? (s.streamingChats[s.activeChatId] ?? null) : null
  )
  const isStopped = useRoxyStore((s) => (activeChatId ? Boolean(s.stopChats[activeChatId]) : false))

  const summary = useMemo(
    () => extractAgentSteps(activeChat, messages, streaming, { isStopped }),
    [activeChat, messages, streaming, isStopped]
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

  // Auto-expand on new plan changeKey, but respect user dismissal
  useEffect(() => {
    if (summary.changeKey && summary.changeKey !== lastChangeKey) {
      setLastChangeKey(summary.changeKey)
      const dismissed = isDismissedStored(activeChatId, summary.changeKey)
      if (dismissed) {
        setIsDismissed(true)
      } else {
        setIsDismissed(false)
        setIsExpanded(true)
      }
    }
  }, [summary.changeKey, lastChangeKey, activeChatId])

  // If user dismissed or no tasks, do not render anything
  if (isDismissed || summary.tasks.length === 0) return null

  const totalCount = summary.totalCount
  const completedCount = summary.completedCount
  const progress = summary.progress
  const isAllCompleted = totalCount > 0 && completedCount === totalCount
  const hasInProgress = summary.inProgressCount > 0
  const activeTask = summary.activeTask

  const handleDismiss = (): void => {
    setIsDismissed(true)
    if (activeChatId && summary.changeKey) {
      try {
        localStorage.setItem(`${DISMISSED_KEY_PREFIX}${activeChatId}`, summary.changeKey)
      } catch {}
    }
  }

  return (
    <div className="bg-bg px-4 pb-1.5">
      <div className="mx-auto max-w-3xl">
        <div
          role="region"
          aria-label={t('chat.agentSteps')}
          className="w-full rounded-xl border border-border/80 bg-surface/90 backdrop-blur-md shadow-raised overflow-hidden transition-all text-xs"
        >
          {/* Header summary bar */}
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
                  hasInProgress && Boolean(streaming) && !isStopped
                    ? 'bg-accent/15 text-accent'
                    : isAllCompleted
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-surface-2 text-text-muted'
                )}
              >
                {hasInProgress && Boolean(streaming) && !isStopped ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                ) : isAllCompleted ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[2.5]" />
                ) : (
                  <ListChecks className="h-3.5 w-3.5" />
                )}
              </div>

              <div className="flex min-w-0 items-center gap-2 flex-wrap">
                <span className="font-semibold text-text text-xs">{t('chat.agentSteps')}</span>

                <span className="rounded-full bg-surface-2 border border-border/60 px-2 py-0.5 text-[10px] font-mono tabular-nums text-text-muted">
                  {t('chat.stepsCompleted', {
                    done: completedCount,
                    total: totalCount
                  })}
                </span>

                {isStopped ? (
                  <span className="rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5 text-[10px] font-medium">
                    {t('chat.planStopped')}
                  </span>
                ) : isAllCompleted ? (
                  <span className="rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium">
                    {t('chat.allStepsCompleted')}
                  </span>
                ) : activeTask && !isExpanded ? (
                  <span className="truncate max-w-[260px] text-[11px] text-text-subtle">
                    {t('chat.currentStep', { title: activeTask.title })}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <span className="font-mono text-[10px] text-text-subtle mr-1 tabular-nums">
                {progress}%
              </span>

              <button
                type="button"
                onClick={() => setIsExpanded((v) => !v)}
                title={t('chat.toggleSteps')}
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
                title={t('chat.dismissSteps')}
                aria-label={t('chat.dismissSteps')}
                className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-subtle hover:bg-surface-2 hover:text-text transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 w-full bg-surface-2/70 overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-300 ease-out-quart',
                isAllCompleted ? 'bg-emerald-500' : 'bg-accent'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Expanded steps list */}
          {isExpanded && (
            <div className="max-h-52 overflow-y-auto divide-y divide-border/30 px-1 py-1">
              {summary.tasks.map((task, index) => {
                const isCompleted = task.status === 'completed'
                const isInProgress = task.status === 'in_progress'
                const isPending = task.status === 'pending'

                return (
                  <div
                    key={`${index}-${task.title}`}
                    className={cn(
                      'flex items-center justify-between gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                      isInProgress && 'bg-accent/10'
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]',
                          isCompleted && 'bg-emerald-500/20 text-emerald-400',
                          isInProgress &&
                            Boolean(streaming) &&
                            !isStopped &&
                            'bg-accent/20 text-accent',
                          (isPending || !streaming || isStopped) &&
                            !isCompleted &&
                            'ring-1 ring-inset ring-border text-text-subtle'
                        )}
                      >
                        {isCompleted ? (
                          <Check className="h-2.5 w-2.5 stroke-[3]" />
                        ) : isInProgress && Boolean(streaming) && !isStopped ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <span className="text-[9px] font-mono">{index + 1}</span>
                        )}
                      </span>

                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-xs',
                          isCompleted && 'text-text-subtle line-through',
                          isInProgress &&
                            Boolean(streaming) &&
                            !isStopped &&
                            'font-medium text-text',
                          isPending && 'text-text-muted'
                        )}
                      >
                        {task.title}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {isCompleted ? (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          {t('chat.stepStatusCompleted')}
                        </span>
                      ) : isInProgress && Boolean(streaming) && !isStopped ? (
                        <span className="flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                          {t('chat.stepStatusInProgress')}
                        </span>
                      ) : (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-subtle">
                          {t('chat.stepStatusPending')}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
