import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Terminal, AppWindow } from 'lucide-react'
import { useRoxyStore } from '../lib/store'
import { api } from '../lib/api'
import { CommandsPane } from './CommandsDialog'

export function StandaloneTerminal(): JSX.Element {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const sessionParam = searchParams.get('session')

  const chats = useRoxyStore((s) => s.chats)
  const activeChatId = useRoxyStore((s) => s.activeChatId)

  const [selectedChatId, setSelectedChatId] = useState<string | null>(sessionParam)

  // Keep selectedChatId updated if URL param arrives or changes
  useEffect(() => {
    if (sessionParam) {
      setSelectedChatId(sessionParam)
    }
  }, [sessionParam])

  const chat =
    chats.find((c) => c.id === selectedChatId) ??
    chats.find((c) => c.id === activeChatId) ??
    chats[0] ??
    null

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text select-none">
      {/* Draggable custom window title bar */}
      <div
        className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface px-3"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {/* Left side: traffic light offset on Mac, title + session picker */}
        <div className={`flex items-center gap-2.5 min-w-0 ${isMac ? 'pl-16' : ''}`}>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Terminal className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-semibold text-text truncate">{t('commands.title')}</span>

          {chats.length > 1 && (
            <select
              value={chat?.id ?? ''}
              onChange={(e) => setSelectedChatId(e.target.value)}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              className="ml-2 max-w-[200px] truncate rounded border border-border bg-surface-2 px-2 py-0.5 text-xs text-text font-medium outline-none hover:bg-elevated transition-colors cursor-pointer"
              title={t('commands.session')}
            >
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.repos?.[0]?.name || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Right side: button to bring main window to front (padded for Windows window controls) */}
        <div className={`flex items-center gap-1.5 ${!isMac ? 'pr-36' : ''}`}>
          <button
            type="button"
            onClick={() => void api.showMainWindow(chat?.id)}
            style={{ WebkitAppRegion: 'no-drag' } as any}
            title={t('commands.focusMain')}
            className="press-scale flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-white/5 hover:text-text transition-colors"
          >
            <AppWindow className="h-3.5 w-3.5" />
            <span className="hidden sm:inline text-[11px]">{t('commands.focusMain')}</span>
          </button>
        </div>
      </div>

      {/* Main commands & terminal view */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {chat ? (
          <CommandsPane chat={chat} isStandalone className="h-full w-full" />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-text-muted">
            <Terminal className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">{t('commands.emptyHistory')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
