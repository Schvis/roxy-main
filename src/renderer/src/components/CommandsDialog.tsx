import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  MoreHorizontal,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  Folder,
  GitBranch,
  Loader2,
  PanelRight,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { Chat, MessagePart } from '@shared/types'
import type { GitCommandLogEntry, ShellProfile, ShellType } from '@shared/api'
import { useRoxyStore } from '../lib/store'
import { api } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { cn } from '../lib/cn'
import { extractTerminalInputOptions } from '../lib/agent-input-options'
import { Button } from './ui'
import { TerminalOutput } from './TerminalOutput'
import { TerminalView, type TerminalViewHandle } from './TerminalView'

export interface AgentCommandItem {
  id: string
  tool: string
  title: string
  command: string
  state: 'running' | 'done' | 'error'
  output: string
  callId?: string
  cancellable?: boolean
  isLive: boolean
}

function extractAgentCommands(
  streaming: MessagePart[] | null,
  messages: Array<{ parts: MessagePart[] }>
): AgentCommandItem[] {
  const items: AgentCommandItem[] = []
  const seenCallIds = new Set<string>()

  const addPart = (part: MessagePart, isLive: boolean): void => {
    if (part.type !== 'tool') return
    const id = part.callId ?? `${part.tool}-${items.length}`
    if (part.callId && seenCallIds.has(part.callId)) return
    if (part.callId) seenCallIds.add(part.callId)

    const command =
      part.tool === 'bash'
        ? typeof part.input?.command === 'string'
          ? part.input.command
          : (part.title ?? '')
        : (part.title ?? part.tool)

    const initialOutput = part.tool === 'bash' && command ? `$ ${command}\n` : ''

    items.push({
      id,
      tool: part.tool,
      title: part.title ?? part.tool,
      command,
      state: part.state,
      output: part.output || initialOutput,
      callId: part.callId,
      cancellable: part.cancellable,
      isLive
    })

    if (part.children) {
      for (const child of part.children) {
        addPart(child, isLive)
      }
    }
  }

  // Live streaming parts come first
  if (streaming) {
    for (const part of streaming) {
      addPart(part, true)
    }
  }

  // Then scan past messages in reverse (newest to oldest)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.parts) {
      for (const part of msg.parts) {
        addPart(part, false)
      }
    }
  }

  return items
}

export interface TerminalTab {
  /** React key; stable for the tab's lifetime. */
  id: string
  sessionId: string
  /** Undefined = the machine's default shell (resolved by main). */
  shellType?: ShellType
  /** Display number, never reused while the tab exists. */
  ordinal: number
  /** Last window title the shell set; shown as a tooltip. */
  title: string
  running: boolean
}

function makeTerminalTab(sessionId: string, ordinal: number, shellType?: ShellType): TerminalTab {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    shellType,
    ordinal,
    title: '',
    running: true
  }
}

const SHELL_LABEL = {
  powershell: 'commands.shell.powershell',
  pwsh: 'commands.shell.pwsh',
  cmd: 'commands.shell.cmd',
  gitbash: 'commands.shell.gitbash',
  wsl: 'commands.shell.wsl',
  bash: 'commands.shell.bash',
  zsh: 'commands.shell.zsh',
  fish: 'commands.shell.fish'
} as const satisfies Record<ShellType, string>

function shellLabel(type: ShellType | undefined, t: TFunction): string {
  return type ? t(SHELL_LABEL[type]) : t('commands.shell.terminal')
}

export interface CommandsPaneProps {
  chat: Chat
  onClose?: () => void
  onPopOut?: () => void
  isStandalone?: boolean
  docked?: boolean
  active?: boolean
  initialTab?: 'agent' | 'user' | 'git'
  gitRoot?: string
  className?: string
}

export function CommandsPane({
  chat,
  onClose,
  onPopOut,
  isStandalone = false,
  docked = false,
  active = true,
  initialTab,
  gitRoot,
  className
}: CommandsPaneProps): JSX.Element {
  const { t } = useTranslation()
  const streaming = useRoxyStore((s) => (chat.id ? (s.streamingChats[chat.id] ?? null) : null))
  const messages = useRoxyStore((s) => s.messages)
  const cancelToolCall = useRoxyStore((s) => s.cancelToolCall)

  const agentCommands = extractAgentCommands(streaming, messages)
  const runningAgentCommand =
    agentCommands.find((c) => c.tool === 'bash' && c.state === 'running') ??
    agentCommands.find((c) => c.state === 'running')

  const [activeTab, setActiveTab] = useState<'agent' | 'user' | 'git'>(() => {
    if (initialTab) return initialTab
    return !docked && (runningAgentCommand || agentCommands.length > 0) ? 'agent' : 'user'
  })

  const prevInitialTabRef = useRef(initialTab)
  useEffect(() => {
    if (initialTab && initialTab !== prevInitialTabRef.current) {
      prevInitialTabRef.current = initialTab
      setActiveTab(initialTab)
    }
  }, [initialTab])

  // Selected agent command to view
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    () => runningAgentCommand?.id ?? null
  )

  // Select running command as soon as it begins (without forcing active tab switch)
  useEffect(() => {
    if (runningAgentCommand) {
      setSelectedAgentId(runningAgentCommand.id)
    }
  }, [runningAgentCommand?.id])

  const activeAgentCommand =
    (runningAgentCommand && (!selectedAgentId || selectedAgentId === runningAgentCommand.id)
      ? runningAgentCommand
      : null) ??
    (selectedAgentId ? agentCommands.find((c) => c.id === selectedAgentId) : null) ??
    runningAgentCommand ??
    agentCommands[0] ??
    null

  // ---- integrated terminals ----------------------------------------------
  // Tabs mirror the shell sessions main holds for this chat, so reopening the
  // dialog, popping it out, or switching chats and back restores them (instead
  // of orphaning the processes behind a fresh "Terminal 1").
  const [shellProfiles, setShellProfiles] = useState<ShellProfile[]>([])
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([])
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string>('')
  const [showTerminalSidebar, setShowTerminalSidebar] = useState(!docked)
  const [newTerminalMenuOpen, setNewTerminalMenuOpen] = useState(false)
  const terminalHandlesRef = useRef<Map<string, TerminalViewHandle>>(new Map())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void api.shell.profiles().then((p) => {
      if (alive) setShellProfiles(p)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setTerminalTabs([])
    setActiveTerminalTabId('')
    void api.shell.list(chat.id).then((sessions) => {
      if (!alive) return
      const tabs =
        sessions.length > 0
          ? sessions.map((s) => ({
              ...makeTerminalTab(s.sessionId, s.ordinal, s.shellType),
              title: s.title,
              running: s.running
            }))
          : [makeTerminalTab(chat.id, 1)]
      setTerminalTabs(tabs)
      setActiveTerminalTabId(tabs[0].id)
    })
    return () => {
      alive = false
    }
  }, [chat.id])

  const activeTerminalTab: TerminalTab | undefined =
    terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? terminalTabs[0]
  const activeHandle = (): TerminalViewHandle | undefined =>
    activeTerminalTab ? terminalHandlesRef.current.get(activeTerminalTab.id) : undefined
  const defaultShell = shellProfiles[0]?.type
  const tabTitle = (tab: TerminalTab): string =>
    t('commands.tabTitle', { shell: shellLabel(tab.shellType ?? defaultShell, t), n: tab.ordinal })

  const patchTab = useCallback((tabId: string, patch: Partial<TerminalTab>): void => {
    setTerminalTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)))
  }, [])

  const addTerminalTab = (shellType?: ShellType): void => {
    setNewTerminalMenuOpen(false)
    const ordinal = terminalTabs.reduce((max, tab) => Math.max(max, tab.ordinal), 0) + 1
    const suffix = Math.random().toString(36).slice(2, 8)
    const tab = makeTerminalTab(
      `${chat.id}#${suffix}`,
      ordinal,
      shellType ?? activeTerminalTab?.shellType
    )
    setTerminalTabs((prev) => [...prev, tab])
    setActiveTerminalTabId(tab.id)
  }

  const closeTerminalTab = (tabId: string): void => {
    const closing = terminalTabs.find((tab) => tab.id === tabId)
    if (!closing) return
    terminalHandlesRef.current.delete(tabId)
    void api.shell.kill(closing.sessionId)

    const rest = terminalTabs.filter((tab) => tab.id !== tabId)
    if (rest.length === 0) {
      // Never leave the pane empty: closing the last tab opens a fresh shell.
      const fresh = makeTerminalTab(chat.id, 1, closing.shellType)
      setTerminalTabs([fresh])
      setActiveTerminalTabId(fresh.id)
      return
    }
    setTerminalTabs(rest)
    if (activeTerminalTab?.id === tabId) {
      const idx = terminalTabs.findIndex((tab) => tab.id === tabId)
      setActiveTerminalTabId((rest[Math.max(0, idx - 1)] ?? rest[0]).id)
    }
  }

  const cycleTerminalTab = (delta: number): void => {
    if (terminalTabs.length < 2 || !activeTerminalTab) return
    const idx = terminalTabs.findIndex((tab) => tab.id === activeTerminalTab.id)
    const next = terminalTabs[(idx + delta + terminalTabs.length) % terminalTabs.length]
    setActiveTerminalTabId(next.id)
  }

  const switchActiveTabShellType = async (newType: ShellType): Promise<void> => {
    if (!activeTerminalTab) return
    patchTab(activeTerminalTab.id, { shellType: newType, title: '', running: true })
    await activeHandle()?.restart(newType)
  }

  const restartActiveTab = async (): Promise<void> => {
    if (!activeTerminalTab) return
    patchTab(activeTerminalTab.id, { title: '', running: true })
    await activeHandle()?.restart()
  }

  const clearActiveTab = (): void => {
    const handle = activeHandle()
    handle?.clear()
    handle?.focus()
  }

  const copyActiveTabOutput = (): void => {
    const text = activeHandle()?.getText()
    if (text) void copyText(text, 'output')
  }

  // Windows Terminal's tab chords. TerminalView lets exactly these bubble.
  const onTerminalKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!e.ctrlKey || e.altKey || e.metaKey) return
    const key = e.key.toLowerCase()
    if (e.shiftKey && key === 't') {
      e.preventDefault()
      addTerminalTab()
    } else if (e.shiftKey && key === 'w') {
      e.preventDefault()
      if (activeTerminalTab) closeTerminalTab(activeTerminalTab.id)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      cycleTerminalTab(e.shiftKey ? -1 : 1)
    }
  }

  // Agent interactive stdin state
  const [agentInputVal, setAgentInputVal] = useState('')
  const [isSendingAgentInput, setIsSendingAgentInput] = useState(false)

  const agentTerminalRef = useRef<HTMLDivElement>(null)
  const agentInputRef = useRef<HTMLInputElement>(null)
  const agentStickToBottom = useRef(true)

  const workspacePath = chat.worktreePath ?? chat.workspacePath ?? ''
  const gitWorkspacePath = gitRoot ?? workspacePath
  const [gitCommandLog, setGitCommandLog] = useState<GitCommandLogEntry[]>([])

  useEffect(() => {
    setGitCommandLog([])
    if (activeTab !== 'git' || !gitWorkspacePath) return
    let active = true
    const refresh = (): void => {
      void api.git.commandLog(gitWorkspacePath).then((entries) => {
        if (active) setGitCommandLog(entries)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [activeTab, gitWorkspacePath])

  // Auto-scroll agent terminal output
  useEffect(() => {
    if (agentStickToBottom.current && agentTerminalRef.current) {
      agentTerminalRef.current.scrollTop = agentTerminalRef.current.scrollHeight
    }
  }, [activeAgentCommand?.output])

  // Focus input when switching to user tab
  useEffect(() => {
    if (!active) return
    if (activeTab === 'user') {
      const handle = activeTerminalTab && terminalHandlesRef.current.get(activeTerminalTab.id)
      setTimeout(() => handle?.focus(), 50)
    } else if (activeTab === 'agent' && activeAgentCommand?.state === 'running') {
      setTimeout(() => agentInputRef.current?.focus(), 50)
    }
  }, [active, activeTab, activeAgentCommand?.state, activeTerminalTab?.id])

  const copyText = async (text: string, id: string): Promise<void> => {
    const ok = await writeClipboardText(text)
    if (ok) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    }
  }

  const sendAgentInput = useCallback(
    async (customVal?: string): Promise<void> => {
      const callId = activeAgentCommand?.callId ?? runningAgentCommand?.callId ?? ''
      const text = customVal !== undefined ? customVal : agentInputVal
      if (customVal === undefined) {
        setAgentInputVal('')
      }
      setIsSendingAgentInput(true)
      try {
        await api.tools.input(callId, text, chat.id)
      } catch {
        // ignore
      } finally {
        setIsSendingAgentInput(false)
        setTimeout(() => agentInputRef.current?.focus(), 50)
      }
    },
    [activeAgentCommand?.callId, runningAgentCommand?.callId, agentInputVal, chat.id]
  )

  const terminalOptions = useMemo(() => {
    if (!activeAgentCommand || activeAgentCommand.state !== 'running') return []
    return extractTerminalInputOptions(activeAgentCommand.output ?? '')
  }, [activeAgentCommand?.state, activeAgentCommand?.output])

  const handleAgentInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void sendAgentInput()
      return
    }

    if (e.key === 'c' && e.ctrlKey && activeAgentCommand?.callId) {
      e.preventDefault()
      void cancelToolCall(activeAgentCommand.callId)
    }
  }

  return (
    <div
      className={cn(
        '@container/terminal flex h-full w-full min-w-0 flex-col overflow-hidden bg-surface',
        className
      )}
    >
      {docked && (
        <>
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 select-none">
            <button
              type="button"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
              className="shrink-0 rounded p-1.5 text-text-subtle hover:bg-white/5 hover:text-text"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <div
              className="flex min-w-0 flex-1 items-center gap-1"
              role="tablist"
              aria-label={t('ide.terminalTab')}
            >
              {(['user', 'agent', 'git'] as const).map((mode) => {
                const Icon = mode === 'user' ? Terminal : mode === 'agent' ? Bot : GitBranch
                const label = t(
                  mode === 'user'
                    ? 'ide.terminalTab'
                    : mode === 'agent'
                      ? 'commands.agentCommands'
                      : 'git.commandOutput'
                )
                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === mode}
                    title={label}
                    aria-label={label}
                    onClick={() => setActiveTab(mode)}
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs',
                      activeTab === mode
                        ? 'bg-elevated text-text'
                        : 'text-text-subtle hover:bg-white/5 hover:text-text'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                )
              })}
              <span className="ml-2 truncate text-xs font-medium text-text-muted">
                {t(
                  activeTab === 'user'
                    ? 'ide.terminalTab'
                    : activeTab === 'agent'
                      ? 'commands.agentCommands'
                      : 'git.commandOutput'
                )}
              </span>
            </div>
            {onPopOut && (
              <button
                type="button"
                onClick={onPopOut}
                title={t('commands.popOut')}
                aria-label={t('commands.popOut')}
                className="rounded p-1.5 text-text-subtle hover:bg-white/5 hover:text-text"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {activeTab === 'user' && (
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 px-2">
              <select
                value={activeTerminalTab?.id ?? ''}
                onChange={(e) => setActiveTerminalTabId(e.target.value)}
                aria-label={t('commands.terminals')}
                className="h-7 min-w-0 flex-1 cursor-pointer truncate rounded bg-transparent px-1 text-xs text-text-muted outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {terminalTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tabTitle(tab)}
                  </option>
                ))}
              </select>
              <details className="relative shrink-0">
                <summary
                  title={t('commands.newTerminalWith')}
                  aria-label={t('commands.newTerminalWith')}
                  className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-text-subtle hover:bg-white/5 hover:text-text [&::-webkit-details-marker]:hidden"
                >
                  <Plus className="h-3.5 w-3.5" />
                </summary>
                <div className="absolute right-0 top-8 z-40 min-w-44 rounded-md border border-border bg-elevated p-1 shadow-lg">
                  {shellProfiles.map((profile) => (
                    <button
                      key={profile.type}
                      type="button"
                      onClick={(e) => {
                        addTerminalTab(profile.type)
                        e.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                      className="flex w-full rounded px-2 py-1.5 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text"
                    >
                      {shellLabel(profile.type, t)}
                    </button>
                  ))}
                </div>
              </details>
              <details className="relative shrink-0">
                <summary
                  title={t('commands.terminalActions')}
                  aria-label={t('commands.terminalActions')}
                  className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-text-subtle hover:bg-white/5 hover:text-text [&::-webkit-details-marker]:hidden"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </summary>
                <div className="absolute right-0 top-8 z-40 min-w-48 rounded-md border border-border bg-elevated p-1 shadow-lg">
                  {[
                    {
                      label: t('commands.search'),
                      icon: Search,
                      action: () => activeHandle()?.openSearch()
                    },
                    {
                      label: t('commands.interrupt'),
                      icon: Square,
                      action: () => activeHandle()?.interrupt()
                    },
                    {
                      label: t('commands.restart'),
                      icon: RotateCcw,
                      action: () => void restartActiveTab()
                    },
                    { label: t('commands.copyOutput'), icon: Copy, action: copyActiveTabOutput },
                    { label: t('commands.clear'), icon: Trash2, action: clearActiveTab },
                    {
                      label: t('commands.closeTerminal'),
                      icon: X,
                      action: () => {
                        if (activeTerminalTab) closeTerminalTab(activeTerminalTab.id)
                      }
                    }
                  ].map(({ label, icon: Icon, action }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.closest('details')?.removeAttribute('open')
                        action()
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          )}
        </>
      )}
      {/* Standalone window toolbar */}
      {!docked && (
        <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between border-b border-border bg-surface px-2.5 py-1 gap-2 select-none">
          {/* Left: Mode switcher + path */}
          <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto shrink-0">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Terminal className="h-3.5 w-3.5" />
            </div>

            <div className="flex items-center rounded-md bg-surface-2/60 p-0.5 border border-border/50">
              <button
                type="button"
                onClick={() => setActiveTab('agent')}
                className={cn(
                  'press-scale flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
                  activeTab === 'agent'
                    ? 'bg-elevated text-text shadow-xs font-semibold'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <span>{t('commands.agentCommands')}</span>
                {agentCommands.length > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.2 text-[10px] tabular-nums',
                      runningAgentCommand
                        ? 'bg-accent text-white font-semibold'
                        : 'bg-white/10 text-text-muted'
                    )}
                  >
                    {agentCommands.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('user')}
                className={cn(
                  'press-scale flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
                  activeTab === 'user'
                    ? 'bg-elevated text-text shadow-xs font-semibold'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <span>{t('commands.commandLine')}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('git')}
                className={cn(
                  'press-scale flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
                  activeTab === 'git'
                    ? 'bg-elevated text-text shadow-xs font-semibold'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <GitBranch className="h-3 w-3" />
                <span>{t('git.commandOutput')}</span>
                {gitCommandLog.some((entry) => entry.status === 'running') && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                )}
              </button>
            </div>

            {workspacePath && (
              <div
                className="hidden lg:flex items-center gap-1 text-[11px] text-text-subtle hover:text-text cursor-pointer transition-colors max-w-[140px] font-mono ml-1"
                onClick={() => void copyText(workspacePath, 'workspace')}
                title={workspacePath}
              >
                <Folder className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath}
                </span>
                {copiedId === 'workspace' && <Check className="h-3 w-3 text-success shrink-0" />}
              </div>
            )}
          </div>

          {/* Right side: terminal actions + window controls */}
          <div className="flex min-w-0 items-center gap-1.5 justify-end">
            {activeTab === 'user' ? (
              <>
                {/* Controls for active terminal tab */}
                <div className="flex items-center gap-1 shrink-0 pl-0.5">
                  {shellProfiles.length > 1 && activeTerminalTab && (
                    <select
                      value={activeTerminalTab.shellType ?? defaultShell ?? ''}
                      onChange={(e) => void switchActiveTabShellType(e.target.value as ShellType)}
                      className="h-7 rounded border border-border bg-surface-2 px-1.5 text-[11px] font-mono text-text outline-none hover:bg-elevated transition-colors cursor-pointer"
                      title={t('commands.shellPicker')}
                      aria-label={t('commands.shellPicker')}
                    >
                      {shellProfiles.map((profile) => (
                        <option key={profile.type} value={profile.type}>
                          {shellLabel(profile.type, t)}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => activeHandle()?.interrupt()}
                    title={t('commands.interrupt')}
                    className="flex h-7 items-center gap-1 text-[11px] text-text-subtle hover:text-warning transition-colors px-1.5 rounded hover:bg-white/5"
                  >
                    <Square className="h-2.5 w-2.5" />
                    <span className="hidden xl:inline text-[10px]">Ctrl+C</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => activeHandle()?.openSearch()}
                    title={t('commands.search')}
                    aria-label={t('commands.search')}
                    className="flex h-7 w-7 items-center justify-center text-text-subtle hover:text-text transition-colors rounded hover:bg-white/5"
                  >
                    <Search className="h-3 w-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void restartActiveTab()}
                    title={t('commands.restart')}
                    aria-label={t('commands.restart')}
                    className="flex h-7 w-7 items-center justify-center text-text-subtle hover:text-text transition-colors rounded hover:bg-white/5"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>

                  <button
                    type="button"
                    onClick={copyActiveTabOutput}
                    title={t('commands.copyOutput')}
                    aria-label={t('commands.copyOutput')}
                    className="flex h-7 w-7 items-center justify-center text-text-subtle hover:text-text transition-colors rounded hover:bg-white/5"
                  >
                    {copiedId === 'output' ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={clearActiveTab}
                    title={t('commands.clear')}
                    aria-label={t('commands.clear')}
                    className="flex h-7 w-7 items-center justify-center text-text-subtle hover:text-danger transition-colors rounded hover:bg-white/5"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {!showTerminalSidebar && activeTerminalTab && (
                  <span className="font-mono text-xs text-text-subtle truncate max-w-[120px] px-1">
                    {tabTitle(activeTerminalTab)}
                  </span>
                )}

                {/* Toggle Sidebar Button */}
                <button
                  type="button"
                  onClick={() => setShowTerminalSidebar((prev) => !prev)}
                  title={t('commands.toggleTerminalSidebar')}
                  aria-label={t('commands.toggleTerminalSidebar')}
                  className={cn(
                    'press-scale flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text transition-colors',
                    showTerminalSidebar && 'bg-accent/15 text-accent'
                  )}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </button>
              </>
            ) : activeTab === 'agent' ? (
              runningAgentCommand && (
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(runningAgentCommand.id)}
                  className="flex items-center gap-1.5 rounded-full bg-success/15 hover:bg-success/25 px-2 py-0.5 text-[10px] font-medium text-success shrink-0 transition-colors"
                  title={t('commands.agentRunning')}
                >
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-success" />
                  {t('commands.agentRunning')}
                </button>
              )
            ) : null}

            {(onPopOut || onClose) && <div className="h-4 w-px bg-border shrink-0 mx-0.5" />}

            {onPopOut && !isStandalone && (
              <button
                type="button"
                onClick={onPopOut}
                title={t('commands.popOut')}
                aria-label={t('commands.popOut')}
                className="press-scale flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title={t('common.close')}
                aria-label={t('common.close')}
                className="press-scale flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-white/5 hover:text-text transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeTab === 'agent' &&
          /* AGENT COMMANDS VIEW */
          (agentCommands.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-text-muted mb-3">
                <Terminal className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-text">{t('commands.noAgentCommands')}</h3>
              <p className="mt-1 max-w-sm text-xs text-text-muted">
                {t('commands.noAgentCommandsSub')}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => setActiveTab('user')}
              >
                <Play className="h-3.5 w-3.5" />
                {t('commands.commandLine')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 min-w-0 flex-col @min-[700px]/terminal:flex-row">
              {/* Side list of commands if multiple exist */}
              {agentCommands.length > 1 && (
                <div className="flex max-h-32 w-full shrink-0 flex-col border-b border-border bg-surface-2/20 @min-[700px]/terminal:max-h-none @min-[700px]/terminal:w-56 @min-[700px]/terminal:border-r">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-subtle border-b border-border">
                    {t('commands.recentCommands')}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
                    {agentCommands.map((item) => {
                      const isSelected = activeAgentCommand?.id === item.id
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSelectedAgentId(item.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                            isSelected
                              ? 'bg-elevated text-text shadow-sm font-medium'
                              : 'text-text-muted hover:bg-white/5 hover:text-text'
                          )}
                        >
                          <span className="shrink-0">
                            {item.state === 'running' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                            ) : item.state === 'done' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-text-muted" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[11px]">{item.command}</div>
                            <div className="text-[10px] text-text-subtle">{item.tool}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Main terminal output view */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0b0b0d]">
                {activeAgentCommand ? (
                  <>
                    {/* Active command header info */}
                    <div className="flex min-w-0 w-full shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-surface/50 px-3 py-2 sm:px-4 sm:py-2.5">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 overflow-hidden">
                        <span className="font-mono text-xs font-medium text-[#4ade80] shrink-0">
                          $
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs text-text select-all"
                          title={activeAgentCommand.command}
                        >
                          {activeAgentCommand.command}
                        </span>
                        <button
                          onClick={() => void copyText(activeAgentCommand.command, 'cmd')}
                          className="shrink-0 text-text-subtle hover:text-text p-1 transition-colors"
                          title={t('commands.copyCommand')}
                        >
                          {copiedId === 'cmd' ? (
                            <Check className="h-3 w-3 text-success shrink-0" />
                          ) : (
                            <Copy className="h-3 w-3 shrink-0" />
                          )}
                        </button>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        {activeAgentCommand.state === 'running' ? (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="flex shrink-0 items-center gap-1 text-xs text-accent font-medium whitespace-nowrap">
                              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                              <span>{t('commands.running')}</span>
                            </span>
                            {activeAgentCommand.callId && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (activeAgentCommand.callId) {
                                    void cancelToolCall(activeAgentCommand.callId)
                                  }
                                }}
                                className="flex shrink-0 items-center gap-1 rounded bg-danger/15 px-1.5 py-0.5 text-xs text-danger hover:bg-danger/25 transition-colors whitespace-nowrap"
                                title={t('commands.stopCommand')}
                              >
                                <Square className="h-2.5 w-2.5 fill-current shrink-0" />
                                <span className="hidden sm:inline">{t('commands.stop')}</span>
                              </button>
                            )}
                          </div>
                        ) : activeAgentCommand.state === 'done' ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-success whitespace-nowrap">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('commands.completed')}</span>
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('commands.error')}</span>
                          </span>
                        )}

                        <button
                          onClick={() => void copyText(activeAgentCommand.output, 'output')}
                          className="flex shrink-0 items-center gap-1 text-[11px] text-text-subtle hover:text-text px-1.5 py-1 rounded hover:bg-white/5 transition-colors whitespace-nowrap"
                          title={t('commands.copyOutput')}
                        >
                          {copiedId === 'output' ? (
                            <Check className="h-3 w-3 text-success shrink-0" />
                          ) : (
                            <Copy className="h-3 w-3 shrink-0" />
                          )}
                          <span className="hidden md:inline">{t('commands.copyOutput')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveTab('user')}
                          className="flex shrink-0 items-center gap-1 text-[11px] text-accent hover:underline px-1.5 py-1 rounded hover:bg-white/5 transition-colors font-medium whitespace-nowrap"
                          title={t('commands.openCommandLine')}
                        >
                          <Terminal className="h-3 w-3 shrink-0" />
                          <span className="hidden md:inline">{t('commands.commandLine')}</span>
                        </button>
                      </div>
                    </div>

                    {/* Terminal output body */}
                    <div
                      ref={agentTerminalRef}
                      onScrollCapture={(e) => {
                        const el = e.target as HTMLElement
                        agentStickToBottom.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight < 30
                      }}
                      className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-[#d4d4d4]"
                    >
                      <TerminalOutput
                        text={activeAgentCommand.output}
                        state={activeAgentCommand.state}
                        className="bg-transparent p-0 border-0 overflow-visible text-xs font-mono whitespace-pre-wrap break-all"
                      />
                    </div>

                    {/* Interactive Input Prompt for running command confirmation/input */}
                    {activeAgentCommand.state === 'running' && (
                      <div className="flex flex-col border-t border-border/80 bg-surface shrink-0">
                        {terminalOptions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5 pb-1">
                            <span className="text-[11px] font-medium text-text-subtle mr-1 select-none">
                              {t('commands.suggestedOptions')}:
                            </span>
                            {terminalOptions.map((opt) => (
                              <button
                                key={opt.id || opt.value}
                                type="button"
                                onClick={() => void sendAgentInput(opt.value)}
                                disabled={isSendingAgentInput}
                                className={cn(
                                  'press-scale flex items-center gap-1 rounded px-2.5 py-1 text-xs font-mono transition-colors',
                                  opt.isDefault
                                    ? 'bg-accent/20 border border-accent/40 text-accent font-medium hover:bg-accent/30'
                                    : 'bg-surface-2 border border-border hover:bg-elevated hover:text-text text-text-muted'
                                )}
                              >
                                <span>{opt.label}</span>
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => agentInputRef.current?.focus()}
                              className="press-scale flex items-center gap-1 rounded px-2.5 py-1 text-xs text-text-subtle hover:text-text bg-surface-2/60 hover:bg-surface-2 border border-border/60 transition-colors"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>{t('commands.customInput')}</span>
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2 px-4 py-2.5">
                          <span className="font-mono text-sm font-bold text-[#4ade80]">&gt;</span>
                          <input
                            ref={agentInputRef}
                            type="text"
                            value={agentInputVal}
                            onChange={(e) => setAgentInputVal(e.target.value)}
                            onKeyDown={handleAgentInputKeyDown}
                            placeholder={t('commands.agentInputPlaceholder')}
                            className="flex-1 bg-transparent font-mono text-xs text-text placeholder:text-text-subtle focus:outline-none"
                            autoFocus
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void sendAgentInput()}
                            disabled={isSendingAgentInput}
                            className="h-7 px-3 text-xs gap-1"
                          >
                            {isSendingAgentInput ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            <span>{t('commands.send')}</span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-text-muted">
                    {t('commands.selectCommand')}
                  </div>
                )}
              </div>
            </div>
          ))}

        {activeTab === 'git' && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0b0b0d]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/80 bg-surface/50 px-3">
              <div className="flex items-center gap-2 text-xs font-medium text-text">
                <GitBranch className="h-3.5 w-3.5 text-accent" />
                {t('git.commandOutput')}
              </div>
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    gitCommandLog
                      .slice()
                      .reverse()
                      .map(
                        (entry) =>
                          `$ ${entry.command}\n${entry.stdout}${entry.stderr}${entry.status === 'running' ? '' : `\n[${entry.status}]`}`
                      )
                      .join('\n\n'),
                    'git-output'
                  )
                }
                disabled={gitCommandLog.length === 0}
                title={t('commands.copyOutput')}
                className="flex h-7 w-7 items-center justify-center rounded text-text-subtle transition-colors hover:bg-white/5 hover:text-text disabled:opacity-40"
              >
                {copiedId === 'git-output' ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 font-mono text-xs">
              {gitCommandLog.length === 0 ? (
                <div className="flex h-full items-center justify-center font-sans text-xs text-text-muted">
                  {t('git.noCommandOutput')}
                </div>
              ) : (
                gitCommandLog.map((entry) => (
                  <section
                    key={entry.id}
                    className="overflow-hidden rounded-lg border border-border/80 bg-surface/40"
                  >
                    <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                      {entry.status === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                      ) : entry.status === 'succeeded' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
                      )}
                      <span className="min-w-0 flex-1 break-all text-[#d4d4d4]">
                        $ {entry.command}
                      </span>
                    </div>
                    {(entry.stdout || entry.stderr) && (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all p-3 leading-relaxed text-[#d4d4d4]">
                        {entry.stdout}
                        {entry.stderr && <span className="text-danger">{entry.stderr}</span>}
                      </pre>
                    )}
                  </section>
                ))
              )}
            </div>
          </div>
        )}

        {/* USER INTERACTIVE COMMAND LINE VIEW WITH MULTIPLE TABS */}
        <div
          className={cn(
            'flex flex-1 min-h-0 min-w-0 flex-row overflow-hidden bg-[#0b0b0d]',
            activeTab !== 'user' && 'hidden'
          )}
          onKeyDown={onTerminalKeyDown}
        >
          {/* Terminal panes container on left */}
          <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-[#0b0b0d]">
            {terminalTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'absolute inset-0',
                  activeTerminalTab?.id === tab.id ? 'block' : 'hidden'
                )}
              >
                <TerminalView
                  sessionId={tab.sessionId}
                  shellType={tab.shellType}
                  ordinal={tab.ordinal}
                  active={active && activeTab === 'user' && activeTerminalTab?.id === tab.id}
                  onHandle={(handle) => {
                    terminalHandlesRef.current.set(tab.id, handle)
                  }}
                  onState={(state) =>
                    patchTab(tab.id, {
                      // Main is authoritative: a session that outlived the
                      // pane may run a different shell than the tab assumed.
                      shellType: state.shellType,
                      ordinal: state.ordinal || tab.ordinal,
                      title: state.title,
                      running: state.running
                    })
                  }
                  onTitle={(title) => patchTab(tab.id, { title })}
                  onExit={() => patchTab(tab.id, { running: false })}
                />
              </div>
            ))}
          </div>

          {/* Right Sidebar: Terminal Tabs List */}
          {!docked && showTerminalSidebar && (
            <div className="flex w-44 sm:w-48 shrink-0 flex-col border-l border-border bg-surface-2/25 select-none">
              {/* Sidebar Header */}
              <div className="relative flex h-8 shrink-0 items-center justify-between border-b border-border/70 px-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                  {t('commands.terminals')}
                </span>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => addTerminalTab()}
                    title={t('commands.newTerminalShortcut')}
                    aria-label={t('commands.newTerminal')}
                    className="press-scale flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {shellProfiles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setNewTerminalMenuOpen((open) => !open)}
                      title={t('commands.newTerminalWith')}
                      aria-label={t('commands.newTerminalWith')}
                      aria-expanded={newTerminalMenuOpen}
                      className="press-scale flex h-5 w-4 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {newTerminalMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setNewTerminalMenuOpen(false)}
                    />
                    <div className="absolute right-1.5 top-7 z-30 min-w-[11rem] rounded-md border border-border bg-elevated p-1 shadow-lg">
                      {shellProfiles.map((profile) => (
                        <button
                          key={profile.type}
                          type="button"
                          onClick={() => addTerminalTab(profile.type)}
                          title={profile.path}
                          className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Terminal className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                            <span className="truncate">{shellLabel(profile.type, t)}</span>
                          </span>
                          {profile.isDefault && (
                            <span className="text-[10px] text-text-subtle">
                              {t('commands.shellDefault')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Tabs List */}
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
                {terminalTabs.map((tab) => {
                  const isActive = activeTerminalTab?.id === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTerminalTabId(tab.id)}
                      onAuxClick={(e) => {
                        // Middle-click closes, as in every tabbed terminal.
                        if (e.button === 1) {
                          e.preventDefault()
                          closeTerminalTab(tab.id)
                        }
                      }}
                      title={tab.title || undefined}
                      className={cn(
                        'group flex w-full items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs font-mono transition-colors',
                        isActive
                          ? 'bg-elevated text-text shadow-xs font-medium border border-border'
                          : 'text-text-muted hover:bg-white/5 hover:text-text'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Terminal
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            !tab.running
                              ? 'text-text-subtle/50'
                              : isActive
                                ? 'text-accent'
                                : 'text-text-subtle group-hover:text-text'
                          )}
                        />
                        <span className={cn('truncate', !tab.running && 'line-through opacity-60')}>
                          {tabTitle(tab)}
                        </span>
                      </div>
                      {terminalTabs.length > 1 && (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            closeTerminalTab(tab.id)
                          }}
                          title={t('commands.closeTerminalShortcut')}
                          aria-label={t('commands.closeTerminal')}
                          className="rounded p-0.5 text-text-subtle hover:text-danger hover:bg-white/10 opacity-60 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Quick Add footer button */}
              <div className="border-t border-border/70 p-1.5">
                <button
                  type="button"
                  onClick={() => addTerminalTab()}
                  className="press-scale flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-subtle hover:bg-white/5 hover:text-text transition-colors font-mono"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('commands.newTerminal')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function CommandsDialog({
  chat,
  onClose,
  onPopOut,
  initialTab
}: {
  chat: Chat
  onClose: () => void
  onPopOut?: () => void
  initialTab?: 'agent' | 'user' | 'git'
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="animate-scrim-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="animate-modal-in flex h-[660px] max-h-[90vh] w-full max-w-4xl min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CommandsPane
          chat={chat}
          onClose={onClose}
          onPopOut={onPopOut}
          isStandalone={false}
          initialTab={initialTab}
        />
      </div>
    </div>
  )
}
