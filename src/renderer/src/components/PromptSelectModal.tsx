import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Sparkles, Terminal, X } from 'lucide-react'
import { PROMPT_FAMILIES } from '@shared/prompt'
import { useRoxyStore } from '../lib/store'
import { Button } from './ui'

export function PromptSelectModal({
  modelName,
  currentPromptId,
  onClose,
  onSelect
}: {
  modelName: string
  currentPromptId?: string | null
  onClose: () => void
  onSelect: (promptId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const customPrompts = useRoxyStore((s) => s.customPrompts)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text">{t('inference.promptModalTitle')}</h2>
            <p className="mt-1 text-xs text-text-muted">
              {t('inference.promptModalSubtitle', { model: modelName })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted hover:bg-white/5 hover:text-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t('inference.builtinPrompts')}
            </div>
            <div className="space-y-1.5">
              {PROMPT_FAMILIES.map((family) => {
                const selected = currentPromptId === family.id
                return (
                  <button
                    key={family.id}
                    type="button"
                    onClick={() => onSelect(family.id)}
                    className="group flex w-full items-start justify-between rounded-lg border border-border bg-surface-2 p-3 text-left transition hover:border-accent hover:bg-accent/10"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-accent/80 shrink-0" />
                        <span className="text-xs font-medium text-text group-hover:text-accent">
                          {family.name}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-muted">{family.description}</p>
                    </div>
                    {selected && <Check className="h-4 w-4 text-accent shrink-0 mt-0.5" />}
                  </button>
                )
              })}
            </div>
          </div>

          {customPrompts.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {t('inference.customPrompts')}
              </div>
              <div className="space-y-1.5">
                {customPrompts.map((p) => {
                  const selected = currentPromptId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className="group flex w-full items-start justify-between rounded-lg border border-border bg-surface-2 p-3 text-left transition hover:border-accent hover:bg-accent/10"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="h-3.5 w-3.5 text-text-muted shrink-0" />
                          <span className="text-xs font-medium text-text group-hover:text-accent">
                            {p.name}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-text-muted">{p.content}</p>
                      </div>
                      {selected && <Check className="h-4 w-4 text-accent shrink-0 mt-0.5" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3 bg-surface-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('inference.promptModalClose')}
          </Button>
        </div>
      </div>
    </div>
  )
}
