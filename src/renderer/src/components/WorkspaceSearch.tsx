import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFileSearchMatch } from '@shared/api'
import { api } from '../lib/api'

export function WorkspaceSearch({
  sessionId,
  onSelect
}: {
  sessionId: string
  onSelect: (path: string, line: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matches, setMatches] = useState<WorkspaceFileSearchMatch[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)
  const [resultKey, setResultKey] = useState('')
  const searchKey = JSON.stringify([sessionId, query, caseSensitive, wholeWord])
  const resultsCurrent = resultKey === searchKey
  useEffect(() => {
    let current = true
    setMatches([])
    setError(false)
    setBusy(false)
    if (!query) return
    const timer = setTimeout(() => {
      setBusy(true)
      void api.files
        .search(sessionId, query, { caseSensitive, wholeWord })
        .then(
          (result) => {
            if (current) {
              setMatches(result)
              setResultKey(searchKey)
            }
          },
          () => {
            if (current) setError(true)
          }
        )
        .finally(() => {
          if (current) setBusy(false)
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [sessionId, query, caseSensitive, wholeWord, version, searchKey])
  const replace = async (): Promise<void> => {
    const { editorDocuments } = await import('../lib/workspace-editor')
    if (busy || !resultsCurrent || !matches.length) return
    if (
      [...editorDocuments.values()].some(
        (entry) => entry.sessionId === sessionId && (entry.dirty || entry.saving)
      )
    ) {
      setError(true)
      return
    }
    if (
      !matches.length ||
      !window.confirm(t('workspaceMigration.replaceConfirm', { count: matches.length }))
    )
      return
    setBusy(true)
    try {
      await api.files.replace(sessionId, query, replacement, { caseSensitive, wholeWord }, [
        ...new Set(matches.map((match) => match.path))
      ])
      setVersion((value) => value + 1)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 p-2 text-xs">
      <input
        aria-label={t('ide.searchPlaceholder')}
        placeholder={t('ide.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="rounded border border-border bg-surface px-2 py-1 text-text"
      />
      <input
        aria-label={t('ide.replacePlaceholder')}
        placeholder={t('ide.replacePlaceholder')}
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
        className="rounded border border-border bg-surface px-2 py-1 text-text"
      />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['ide.caseSensitive', caseSensitive, setCaseSensitive],
            ['ide.wholeWord', wholeWord, setWholeWord]
          ] as const
        ).map(([key, value, setValue]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value}
            onClick={() => setValue(!value)}
            className={value ? 'text-accent' : 'text-text-muted'}
          >
            {t(key)}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || !resultsCurrent || !matches.length}
          onClick={() => void replace()}
          className="text-text disabled:opacity-40"
        >
          {t('ide.replaceAll')}
        </button>
      </div>
      {busy && <p role="status">{t('inspector.loading')}</p>}
      {error && (
        <p role="alert" className="text-danger">
          {t('inspector.unavailable')}
        </p>
      )}
      {matches.map((match, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSelect(match.path, match.line)}
          className="rounded px-2 py-1 text-left hover:bg-white/5"
        >
          <span className="block truncate text-text">
            {match.path}:{match.line}
          </span>
          <span className="block truncate font-mono text-text-muted">{match.lineText}</span>
        </button>
      ))}
    </div>
  )
}
