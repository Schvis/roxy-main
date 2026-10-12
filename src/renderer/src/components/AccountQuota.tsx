import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import type { ConnectedProvider } from '@shared/types'
import type { ConnectionQuota } from '@shared/quota'
import { CODEX_PROVIDER_ID } from '@shared/cliproxy'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { BucketRow } from './QuotaMeter'

export function AccountQuota({ provider }: { provider: ConnectedProvider }): JSX.Element | null {
  const { t } = useTranslation()
  const [quota, setQuota] = useState<ConnectionQuota | null>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  const enabled =
    provider.seedId === CODEX_PROVIDER_ID && provider.enabled && provider.hasCredential
  const load = useCallback(
    async (force = false): Promise<void> => {
      const current = ++request.current
      setLoading(true)
      let result: ConnectionQuota
      try {
        result = await api.cliproxy.quota(provider.id, force)
      } catch (e) {
        result = {
          connectionId: provider.id,
          upstream: 'codex',
          buckets: [],
          fetchedAt: Date.now(),
          error: e instanceof Error ? e.message : String(e)
        }
      }
      if (request.current !== current) return
      setQuota(result)
      setLoading(false)
    },
    [provider.id]
  )

  useEffect(() => {
    setQuota(null)
    if (!enabled) return
    void load()
    const timer = setInterval(() => void load(), 5 * 60_000)
    return () => {
      clearInterval(timer)
      request.current++
    }
  }, [enabled, provider.proxyAuthFile, load])

  if (!enabled) return null

  return (
    <section
      aria-label={t('quota.title', { account: 'ChatGPT' })}
      className="border-t border-border px-4 py-3"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-text">
          {t('quota.title', { account: 'ChatGPT' })}
        </h3>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          title={t('quota.refresh')}
          aria-label={t('quota.refresh')}
          className="press-scale flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
        >
          <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>
      {!quota ? (
        <p role="status" className="text-xs text-text-subtle">
          {t('quota.loading')}
        </p>
      ) : quota.buckets.length ? (
        quota.buckets.map((bucket) => (
          <BucketRow key={bucket.id} bucket={bucket} now={Date.now()} />
        ))
      ) : (
        <div role="status" className="text-xs text-text-subtle">
          <p>{t('quota.unavailable')}</p>
          {quota.error && <p className="mt-1">{quota.error}</p>}
        </div>
      )}
    </section>
  )
}
