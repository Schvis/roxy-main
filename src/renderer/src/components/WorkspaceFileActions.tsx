import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'

export function WorkspaceFileActions({
  sessionId,
  onChanged
}: {
  sessionId: string
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [destination, setDestination] = useState('')
  const run = async (action: 'file' | 'folder' | 'rename' | 'delete'): Promise<void> => {
    if (!path.trim() || busy) return
    const { editorDocuments } = await import('../lib/workspace-editor')
    if (
      [...editorDocuments.values()].some(
        (entry) => entry.sessionId === sessionId && (entry.dirty || entry.saving)
      )
    ) {
      setFailed(true)
      return
    }
    if (action === 'rename' && (!destination.trim() || destination === path)) return
    if (action === 'delete' && !window.confirm(t('ide.deleteConfirm', { name: path }))) return
    setBusy(true)
    setFailed(false)
    try {
      const success =
        action === 'delete'
          ? await api.files.delete(sessionId, path)
          : action === 'rename'
            ? await api.files.rename(sessionId, path, destination!)
            : (await api.files.create(sessionId, path, action === 'folder')).success
      if (!success) throw new Error('File operation failed')
      setPath('')
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 border-b border-border p-2 text-xs">
      <input
        aria-label={t('workspaceMigration.path')}
        placeholder={t('workspaceMigration.path')}
        value={path}
        onChange={(event) => setPath(event.target.value)}
        className="rounded border border-border bg-surface px-2 py-1 text-text"
      />
      <div className="flex flex-wrap gap-3">
        <input
          aria-label={t('workspaceMigration.destination')}
          placeholder={t('workspaceMigration.destination')}
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-text"
        />
        {(
          [
            ['file', 'ide.newFile'],
            ['folder', 'ide.newFolder'],
            ['rename', 'ide.rename'],
            ['delete', 'ide.delete']
          ] as const
        ).map(([action, label]) => (
          <button
            key={action}
            type="button"
            disabled={busy || !path.trim()}
            onClick={() => void run(action)}
            className="text-text-muted hover:text-text disabled:opacity-40"
          >
            {t(label)}
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="text-danger">
          {t('inspector.unavailable')}
        </p>
      )}
    </div>
  )
}
