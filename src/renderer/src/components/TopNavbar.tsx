import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  GitBranch,
  Lightbulb,
  MonitorSmartphone,
  Palette,
  PanelLeft,
  Plug,
  Terminal
} from 'lucide-react'
import roxy from '../assets/roxy.png'
import { cn } from '../lib/cn'
import { api } from '../lib/api'
import { useRoxyStore } from '../lib/store'
import { useCustomizeCounts } from '../lib/useCustomizeCounts'
import { RemoteWorkspaceDialog } from './RemoteWorkspaceDialog'
import { WindowControls } from './WindowControls'

export function TopNavbar(): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const counts = useCustomizeCounts()
  const [remoteOpen, setRemoteOpen] = useState(false)
  const remotePhase = useRoxyStore((s) => s.remote.phase)
  const sidebarRailed = useRoxyStore((s) => s.sidebarRailed)
  const setSidebarRailed = useRoxyStore((s) => s.setSidebarRailed)
  const commandsOpen = useRoxyStore((s) => s.commandsOpen)
  const setCommandsOpen = useRoxyStore((s) => s.setCommandsOpen)
  const setIdeTab = useRoxyStore((s) => s.setIdeTab)
  const activeChat = useRoxyStore((s) => s.chats.find((c) => c.id === s.activeChatId))

  const handleOpenTerminal = (): void => {
    if (activeChat) {
      if (location.pathname !== '/' && location.pathname !== '/overlay') {
        navigate('/')
      }
      setCommandsOpen(!commandsOpen)
    } else {
      void api.terminal.open()
    }
  }

  // Green only when truly live; amber while spinning up or reconnecting.
  const remoteDot: 'green' | 'amber' | null =
    remotePhase === 'live'
      ? 'green'
      : remotePhase === 'starting' || remotePhase === 'offline'
        ? 'amber'
        : null

  return (
    <header className="titlebar flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-border bg-surface px-2">
      {/* Left branding & tools */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 px-1.5 py-0.5">
          <img
            src={roxy}
            alt="Roxy"
            className="h-5 w-5 sq sq-md rounded-md object-cover inset-ring-1 inset-ring-border"
          />
          <span className="text-xs font-semibold tracking-tight">Roxy</span>
        </div>

        <button
          type="button"
          onClick={() => setSidebarRailed(!sidebarRailed)}
          title={sidebarRailed ? t('sidebar.expand') : t('sidebar.collapse')}
          className={cn(
            'press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg transition-colors',
            sidebarRailed
              ? 'text-accent hover:bg-white/5'
              : 'text-text-muted hover:bg-white/5 hover:text-text'
          )}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="mx-1 h-3.5 w-px bg-border" />

        <button
          type="button"
          onClick={() => setRemoteOpen(true)}
          title={t('sidebar.remoteWorkspace')}
          className="relative press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg text-text-muted hover:bg-white/5 hover:text-text"
        >
          <MonitorSmartphone className="h-3.5 w-3.5" />
          {remoteDot && (
            <span
              className={cn(
                'absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-1.5 ring-surface',
                remoteDot === 'green' ? 'bg-success' : 'bg-warning'
              )}
            />
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate('/skills')}
          title={t('sidebar.skills')}
          className="relative press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg text-text-muted hover:bg-white/5 hover:text-text"
        >
          <Lightbulb className="h-3.5 w-3.5" />
          {counts.skills > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent px-0.5 text-[8px] font-bold text-accent-foreground">
              {counts.skills}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate('/mcp')}
          title={t('sidebar.mcpServers')}
          className="relative press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg text-text-muted hover:bg-white/5 hover:text-text"
        >
          <Plug className="h-3.5 w-3.5" />
          {counts.mcp > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent px-0.5 text-[8px] font-bold text-accent-foreground">
              {counts.mcp}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate('/themes')}
          title={t('sidebar.themes')}
          className="press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg text-text-muted hover:bg-white/5 hover:text-text"
        >
          <Palette className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (activeChat && (location.pathname === '/' || location.pathname === '/overlay')) {
              setIdeTab('git')
            } else {
              navigate('/git')
            }
          }}
          title={t('git.title')}
          className="press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg text-text-muted hover:bg-white/5 hover:text-text"
        >
          <GitBranch className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={handleOpenTerminal}
          title={t('commands.commandLine')}
          className={cn(
            'press-scale flex h-7 w-7 items-center justify-center sq sq-lg rounded-lg transition-colors',
            commandsOpen
              ? 'text-accent bg-white/5'
              : 'text-text-muted hover:bg-white/5 hover:text-text'
          )}
        >
          <Terminal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Draggable center space */}
      <div className="flex-1 h-full min-w-8" />

      {/* Window controls on right */}
      <WindowControls />

      {remoteOpen && <RemoteWorkspaceDialog onClose={() => setRemoteOpen(false)} />}
    </header>
  )
}
