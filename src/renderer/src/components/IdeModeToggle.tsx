import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, SquareCode } from 'lucide-react'
import { cn } from '../lib/cn'
import { useRoxyStore } from '../lib/store'

export function IdeModeToggle(): JSX.Element {
  const { t } = useTranslation()
  const settings = useRoxyStore((s) => s.settings)
  const setIdeMode = useRoxyStore((s) => s.setIdeMode)
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const enabled = settings?.ideMode ?? false

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t('ide.settingsTitle')}
        aria-busy={saving}
        disabled={!settings || saving}
        title={t(error ? 'ide.saveError' : saving ? 'ide.saving' : 'ide.settingsTitle')}
        onClick={async () => {
          if (!settings || pending.current) return
          pending.current = true
          setSaving(true)
          setError(false)
          try {
            await setIdeMode(!enabled)
          } catch {
            setError(true)
          } finally {
            pending.current = false
            setSaving(false)
          }
        }}
        className={cn(
          'press-scale relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50',
          error
            ? 'text-danger'
            : enabled
              ? 'bg-elevated text-accent shadow-xs'
              : 'text-text-muted hover:bg-white/5 hover:text-text'
        )}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareCode className="h-4 w-4" />}
      </button>
      {error && (
        <span role="alert" className="sr-only">
          {t('ide.saveError')}
        </span>
      )}
    </>
  )
}
