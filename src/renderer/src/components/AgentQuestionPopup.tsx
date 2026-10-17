import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Edit3, HelpCircle, X } from 'lucide-react'
import { useRoxyStore } from '../lib/store'
import { extractAgentQuestionOptions } from '../lib/agent-input-options'
import { Button } from './ui'
import { cn } from '../lib/cn'
import { api } from '../lib/api'
import { parseQuestions } from '@shared/interaction-tools'

export function AgentQuestionPopup({
  wallpaper
}: { wallpaper?: boolean } = {}): JSX.Element | null {
  const { t } = useTranslation()
  const messages = useRoxyStore((s) => s.messages)
  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const streaming = useRoxyStore((s) =>
    s.activeChatId ? (s.streamingChats[s.activeChatId] ?? null) : null
  )
  const isStopped = useRoxyStore((s) => (activeChatId ? Boolean(s.stopChats[activeChatId]) : false))
  const submit = useRoxyStore((s) => s.submit)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const pendingQuestion = streaming?.findLast(
    (part) => part.type === 'tool' && part.tool === 'ask_user' && part.state === 'running'
  )
  const summary = useMemo(() => {
    if (pendingQuestion?.type === 'tool') {
      try {
        const questions = parseQuestions(pendingQuestion.input?.questions)
        return { hasQuestion: true, questions, changeKey: pendingQuestion.callId ?? '' }
      } catch {
        return null
      }
    }
    return extractAgentQuestionOptions(messages, Boolean(streaming))
  }, [messages, streaming, pendingQuestion])

  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [customInputVal, setCustomInputVal] = useState('')
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Reset pagination state whenever a new question set arrives
  useEffect(() => {
    if (summary?.changeKey && summary.changeKey !== activeKey) {
      setActiveKey(summary.changeKey)
      setCurrentIndex(0)
      setAnswers({})
      setCustomInputVal('')
      setIsCustomMode(false)
    }
  }, [summary?.changeKey, activeKey])

  if (isStopped || !summary || !summary.hasQuestion || summary.questions.length === 0) {
    return null
  }

  if (dismissedKey === summary.changeKey) {
    return null
  }

  const questions = summary.questions
  const total = questions.length
  const currentQuestion = questions[currentIndex] ?? questions[0]

  const submitAnswers = (finalAnswers: Record<number, string>): void => {
    if (pendingQuestion?.type === 'tool' && pendingQuestion.callId) {
      void api.tools.input(
        pendingQuestion.callId,
        JSON.stringify(questions.map((_, index) => finalAnswers[index] ?? ''))
      )
      return
    }
    if (total === 1) {
      void submit(finalAnswers[0] || '')
      return
    }

    const formatted = questions
      .map((q, idx) => {
        const ans = finalAnswers[idx] ?? ''
        const prefix = q.header ? `${q.header}: ` : `${q.question}: `
        return `${idx + 1}. ${prefix}${ans}`
      })
      .join('\n')

    void submit(formatted)
  }

  const handleAnswer = (answerValue: string): void => {
    const nextAnswers = { ...answers, [currentIndex]: answerValue }
    setAnswers(nextAnswers)
    setIsCustomMode(false)
    setCustomInputVal('')

    if (currentIndex < total - 1) {
      setCurrentIndex((prev) => prev + 1)
    } else {
      submitAnswers(nextAnswers)
    }
  }

  const handleDismiss = (): void => {
    if (pendingQuestion?.type === 'tool' && pendingQuestion.callId)
      void api.tools.cancel(pendingQuestion.callId)
    setDismissedKey(summary.changeKey)
  }

  return (
    <div className={cn('agent-question-gutter px-4 pb-1.5', !wallpaper && 'bg-bg')}>
      <div className="mx-auto max-w-3xl">
        <div className="agent-question-panel flex flex-col gap-2 rounded-lg border border-accent/30 bg-surface/90 backdrop-blur-md px-3 py-2.5 shadow-sm">
          {/* Header & Pagination */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {currentIndex > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCurrentIndex((prev) => prev - 1)
                    setIsCustomMode(false)
                  }}
                  title={t('chat.prevQuestion')}
                  className="press-scale flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-subtle hover:bg-white/5 hover:text-text transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <HelpCircle className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="truncate text-xs font-medium text-text">
                {currentQuestion.header || t('chat.agentNeedsInput')}
              </span>
              {total > 1 && (
                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.2 text-[10px] font-mono text-accent tabular-nums">
                    {t('chat.questionCount', { current: currentIndex + 1, total })}
                  </span>
                  <div className="flex items-center gap-1">
                    {questions.map((_, idx) => (
                      <span
                        key={idx}
                        className={cn(
                          'h-1.5 rounded-full transition-all duration-200',
                          idx === currentIndex
                            ? 'w-3 bg-accent'
                            : answers[idx]
                              ? 'w-1.5 bg-accent/40'
                              : 'w-1.5 bg-surface-2 border border-border'
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              title={t('common.close')}
              className="press-scale flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-subtle hover:bg-white/5 hover:text-text transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Question text */}
          <p className="text-xs text-text font-medium leading-relaxed select-text">
            {currentQuestion.question}
          </p>

          {/* Options / Custom input */}
          {isCustomMode ? (
            <div className="flex items-center gap-2 pt-1 w-full">
              <input
                type="text"
                value={customInputVal}
                onChange={(e) => setCustomInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customInputVal.trim()) {
                    e.preventDefault()
                    handleAnswer(customInputVal.trim())
                  }
                }}
                placeholder={t('chat.typeCustomAnswer')}
                className="flex-1 bg-surface-2 border border-border rounded px-3 py-1.5 text-xs text-text placeholder:text-text-subtle focus:outline-none focus:border-accent"
                autoFocus
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (customInputVal.trim()) {
                    handleAnswer(customInputVal.trim())
                  }
                }}
                disabled={!customInputVal.trim()}
                className="h-8 px-3 text-xs shrink-0"
              >
                {currentIndex === total - 1 ? t('chat.submitAnswers') : t('chat.nextQuestion')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsCustomMode(false)
                  setCustomInputVal('')
                }}
                className="h-8 px-2.5 text-xs text-text-subtle hover:text-text shrink-0"
              >
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1 w-full">
              {currentQuestion.options.map((opt) => (
                <Button
                  key={opt.id}
                  variant={answers[currentIndex] === opt.value ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => handleAnswer(opt.value)}
                  className={cn(
                    'w-full justify-start text-left h-auto min-h-8 py-2 px-3 text-xs gap-2 font-normal transition-colors',
                    answers[currentIndex] === opt.value
                      ? 'border-accent text-accent'
                      : 'hover:border-accent/60 hover:text-text'
                  )}
                  title={opt.description}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-[11px] text-text-subtle font-normal">
                      — {opt.description}
                    </span>
                  )}
                </Button>
              ))}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsCustomMode(true)
                  setCustomInputVal('')
                }}
                className="w-full justify-start text-left h-8 px-3 text-xs gap-2 text-text-subtle hover:text-text hover:bg-white/5 border border-dashed border-border/80 transition-colors"
              >
                <Edit3 className="h-3.5 w-3.5 shrink-0" />
                <span>{t('chat.customInput')}</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
