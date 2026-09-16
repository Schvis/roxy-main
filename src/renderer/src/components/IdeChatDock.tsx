import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { useRoxyStore } from '../lib/store'

let state = { pending: false, error: false }
const listeners = new Set<() => void>()
const publish = (next: typeof state): void => {
  state = next
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function IdeChatDock({ compact = false }: { compact?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const settings = useRoxyStore((s) => s.settings)
  const status = useSyncExternalStore(subscribe, () => state)

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
    if (state.pending) return
    const dock = event.target.value as 'left' | 'right' | 'bottom'
    publish({ pending: true, error: false })
    try {
      const result = await api.settings.setIdeChatDock(dock)
      useRoxyStore.setState((current) => ({
        settings: current.settings
          ? { ...current.settings, ideChatDock: result.ideChatDock }
          : result
      }))
      publish({ pending: false, error: false })
    } catch {
      publish({ pending: false, error: true })
    }
  }

  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <span className="text-text-subtle">{t('ide.chatDock')}</span>
          <select
            className="h-7 rounded-lg border border-border bg-surface-2 px-2 text-xs text-text outline-none transition-colors hover:bg-elevated focus:border-accent"
            value={settings?.ideChatDock ?? 'right'}
            disabled={!settings || status.pending}
            aria-label={t('ide.chatDock')}
            onChange={(e) => void handleChange(e)}
          >
            <option value="right">{t('ide.dockRight')}</option>
            <option value="left">{t('ide.dockLeft')}</option>
            <option value="bottom">{t('ide.dockBottom')}</option>
          </select>
        </label>
        {status.pending && (
          <span role="status" className="text-[10px] text-text-subtle">
            {t('ide.saving')}
          </span>
        )}
        {status.error && (
          <span role="alert" className="text-[10px] text-danger">
            {t('ide.dockError')}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 text-xs text-text-muted">
      <label className="flex items-center gap-2">
        {t('ide.chatDock')}
        <select
          className="rounded border border-border bg-surface p-1 text-text"
          value={settings?.ideChatDock ?? 'right'}
          disabled={!settings || status.pending}
          onChange={(e) => void handleChange(e)}
        >
          <option value="left">{t('ide.dockLeft')}</option>
          <option value="right">{t('ide.dockRight')}</option>
          <option value="bottom">{t('ide.dockBottom')}</option>
        </select>
      </label>
      {status.pending && <span role="status">{t('ide.saving')}</span>}
      {status.error && (
        <span role="alert" className="text-danger">
          {t('ide.dockError')}
        </span>
      )}
    </div>
  )
}
