import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  Folder,
  Loader2,
  PanelRight,
  Play,
  Plus,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { Chat, MessagePart } from '@shared/types'
import type { ShellType } from '@shared/api'
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
  id: string
  sessionId: string
  shellType: ShellType
  title: string
}

export interface CommandsPaneProps {
  chat: Chat
  onClose?: () => void
  onPopOut?: () => void
  isStandalone?: boolean
  initialTab?: 'agent' | 'user'
  className?: string
}

export function CommandsPane({
  chat,
  onClose,
  onPopOut,
  isStandalone = false,
  initialTab,
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

  const [activeTab, setActiveTab] = useState<'agent' | 'user'>(() => {
    if (initialTab) return initialTab
    return runningAgentCommand || agentCommands.length > 0 ? 'agent' : 'user'
  })

  const prevInitialTabRef = useRef(initialTab)
  useEffect(() => {
    if (initialTab && initialTab !== prevInitialTabRef.current) {
      prevInitialTabRef.current = initialTab
      if (initialTab === 'agent' || activeTab !== 'agent') {
        setActiveTab(initialTab)
      }
    }
  }, [initialTab, activeTab])

  // Selected agent command to view
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    () => runningAgentCommand?.id ?? null
  )

  // Auto-switch to agent tab and select running command as soon as it begins
  useEffect(() => {
    if (runningAgentCommand) {
      setActiveTab('agent')
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

  // Persistent shell state
  const isWin =
    typeof navigator !== 'undefined' && /Win/.test(navigator.userAgent || navigator.platform)
  const defaultShellType: ShellType = isWin ? 'powershell' : 'bash'

  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>(() => [
    {
      id: 'default',
      sessionId: chat.id,
      shellType: defaultShellType,
      title: isWin ? 'PowerShell 1' : 'Terminal 1'
    }
  ])
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string>('default')
  const [showTerminalSidebar, setShowTerminalSidebar] = useState(true)
  const terminalHandlesRef = useRef<Map<string, TerminalViewHandle>>(new Map())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Reset/sync terminal tabs if chat.id changes
  useEffect(() => {
    setTerminalTabs([
      {
        id: 'default',
        sessionId: chat.id,
        shellType: defaultShellType,
        title: isWin ? 'PowerShell 1' : 'Terminal 1'
      }
    ])
    setActiveTerminalTabId('default')
  }, [chat.id])

  const activeTerminalTab = terminalTabs.find((t) => t.id === activeTerminalTabId) ??
    terminalTabs[0] ?? {
      id: 'default',
      sessionId: chat.id,
      shellType: defaultShellType,
      title: 'Terminal 1'
    }

  const addTerminalTab = (preferredType?: ShellType): void => {
    const type = preferredType ?? activeTerminalTab.shellType ?? defaultShellType
    const nextNum = terminalTabs.length + 1
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const typeLabel = type === 'cmd' ? 'CMD' : type === 'powershell' ? 'PowerShell' : 'Terminal'
    const newTab: TerminalTab = {
      id: newId,
      sessionId: `${chat.id}#${newId}`,
      shellType: type,
      title: `${typeLabel} ${nextNum}`
    }
    setTerminalTabs((prev) => [...prev, newTab])
    setActiveTerminalTabId(newId)
  }

  const closeTerminalTab = (tabId: string): void => {
    const tabToClose = terminalTabs.find((t) => t.id === tabId)
    if (!tabToClose) return

    terminalHandlesRef.current.delete(tabId)
    void api.shell.kill(tabToClose.sessionId)

    if (terminalTabs.length <= 1) {
      const newTab: TerminalTab = {
        id: 'default',
        sessionId: chat.id,
        shellType: defaultShellType,
        title: isWin ? 'PowerShell 1' : 'Terminal 1'
      }
      setTerminalTabs([newTab])
      setActiveTerminalTabId('default')
      return
    }

    const nextTabs = terminalTabs.filter((t) => t.id !== tabId)
    setTerminalTabs(nextTabs)
    if (activeTerminalTabId === tabId) {
      const closedIdx = terminalTabs.findIndex((t) => t.id === tabId)
      const nextActive = nextTabs[Math.max(0, closedIdx - 1)] ?? nextTabs[0]
      if (nextActive) {
        setActiveTerminalTabId(nextActive.id)
      }
    }
  }

  const switchActiveTabShellType = async (newType: ShellType): Promise<void> => {
    const handle = terminalHandlesRef.current.get(activeTerminalTab.id)
    handle?.reset()
    setTerminalTabs((prev) =>
      prev.map((t) => {
        if (t.id === activeTerminalTab.id) {
          const typeLabel =
            newType === 'cmd' ? 'CMD' : newType === 'powershell' ? 'PowerShell' : 'Terminal'
          const num = t.title.split(' ').pop() || '1'
          return { ...t, shellType: newType, title: `${typeLabel} ${num}` }
        }
        return t
      })
    )
    await api.shell.restart(activeTerminalTab.sessionId, newType)
    setTimeout(() => handle?.focus(), 50)
  }

  const restartActiveTab = async (): Promise<void> => {
    const handle = terminalHandlesRef.current.get(activeTerminalTab.id)
    handle?.reset()
    await api.shell.restart(activeTerminalTab.sessionId, activeTerminalTab.shellType)
    setTimeout(() => handle?.focus(), 50)
  }

  const clearActiveTab = async (): Promise<void> => {
    const handle = terminalHandlesRef.current.get(activeTerminalTab.id)
    handle?.clear()
    await api.shell.clear(activeTerminalTab.sessionId)
    setTimeout(() => handle?.focus(), 50)
  }

  const copyActiveTabOutput = async (): Promise<void> => {
    const state = await api.shell.getState(activeTerminalTab.sessionId)
    if (state.output) {
      void copyText(state.output, 'output')
    }
  }

  // Agent interactive stdin state
  const [agentInputVal, setAgentInputVal] = useState('')
  const [isSendingAgentInput, setIsSendingAgentInput] = useState(false)

  const agentTerminalRef = useRef<HTMLDivElement>(null)
  const agentInputRef = useRef<HTMLInputElement>(null)
  const agentStickToBottom = useRef(true)

  const workspacePath = chat.worktreePath ?? chat.workspacePath ?? ''

  // Auto-scroll agent terminal output
  useEffect(() => {
    if (agentStickToBottom.current && agentTerminalRef.current) {
      agentTerminalRef.current.scrollTop = agentTerminalRef.current.scrollHeight
    }
  }, [activeAgentCommand?.output])

  // Focus input when switching to user tab
  useEffect(() => {
    if (activeTab === 'user') {
      const handle = terminalHandlesRef.current.get(activeTerminalTab.id)
      setTimeout(() => handle?.focus(), 50)
    } else if (activeTab === 'agent' && activeAgentCommand?.state === 'running') {
      setTimeout(() => agentInputRef.current?.focus(), 50)
    }
  }, [activeTab, activeAgentCommand?.state, activeTerminalTab.id])

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
      className={cn('flex h-full w-full min-w-0 flex-col overflow-hidden bg-surface', className)}
    >
      {/* Unified Compact Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface px-2.5 gap-2 select-none">
        {/* Left: Mode switcher + path */}
        <div className="flex min-w-0 items-center gap-1.5 shrink-0">
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
                {isWin && (
                  <select
                    value={activeTerminalTab.shellType}
                    onChange={(e) => void switchActiveTabShellType(e.target.value as ShellType)}
                    className="h-7 rounded border border-border bg-surface-2 px-1.5 text-[11px] font-mono text-text outline-none hover:bg-elevated transition-colors cursor-pointer"
                    title="Shell"
                  >
                    <option value="powershell">{t('commands.powershell')}</option>
                    <option value="cmd">{t('commands.cmd')}</option>
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => void api.shell.write(activeTerminalTab.sessionId, '\x03')}
                  title={t('commands.interrupt')}
                  className="flex h-7 items-center gap-1 text-[11px] text-text-subtle hover:text-warning transition-colors px-1.5 rounded hover:bg-white/5"
                >
                  <Square className="h-2.5 w-2.5" />
                  <span className="hidden xl:inline text-[10px]">Ctrl+C</span>
                </button>

                <button
                  type="button"
                  onClick={() => void restartActiveTab()}
                  title={t('commands.restart')}
                  className="flex h-7 w-7 items-center justify-center text-text-subtle hover:text-text transition-colors rounded hover:bg-white/5"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>

                <button
                  type="button"
                  onClick={() => void copyActiveTabOutput()}
                  title={t('commands.copyOutput')}
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
                  onClick={() => void clearActiveTab()}
                  title={t('commands.clear')}
                  className="flex h-7 w-7 items-center justify-center text-text-subtle hover:text-danger transition-colors rounded hover:bg-white/5"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {!showTerminalSidebar && (
                <span className="font-mono text-xs text-text-subtle truncate max-w-[120px] px-1">
                  {activeTerminalTab.title}
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
          ) : (
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
          )}

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
            <div className="flex flex-1 min-h-0 min-w-0 flex-col sm:flex-row">
              {/* Side list of commands if multiple exist */}
              {agentCommands.length > 1 && (
                <div className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-2/20">
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
              <div className="flex flex-1 min-w-0 flex-col bg-[#0b0b0d]">
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
                      className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-[#d4d4d4]"
                    >
                      <TerminalOutput
                        text={activeAgentCommand.output}
                        state={activeAgentCommand.state}
                        className="h-full bg-transparent p-0 border-0 overflow-visible text-xs font-mono whitespace-pre-wrap break-all"
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

        {/* USER INTERACTIVE COMMAND LINE VIEW WITH MULTIPLE TABS */}
        <div
          className={cn(
            'flex flex-1 min-h-0 min-w-0 flex-row overflow-hidden bg-[#0b0b0d]',
            activeTab !== 'user' && 'hidden'
          )}
        >
          {/* Terminal panes container on left */}
          <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-[#0b0b0d]">
            {terminalTabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'absolute inset-0',
                  activeTerminalTabId === tab.id ? 'block' : 'hidden'
                )}
              >
                <TerminalView
                  sessionId={tab.sessionId}
                  active={activeTab === 'user' && activeTerminalTabId === tab.id}
                  onHandle={(handle) => {
                    terminalHandlesRef.current.set(tab.id, handle)
                  }}
                />
              </div>
            ))}
          </div>

          {/* Right Sidebar: Terminal Tabs List */}
          {showTerminalSidebar && (
            <div className="flex w-44 sm:w-48 shrink-0 flex-col border-l border-border bg-surface-2/25 select-none">
              {/* Sidebar Header */}
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 px-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                  {t('commands.terminals')}
                </span>
                <button
                  type="button"
                  onClick={() => addTerminalTab()}
                  title={t('commands.newTerminal')}
                  aria-label={t('commands.newTerminal')}
                  className="press-scale flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Tabs List */}
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
                {terminalTabs.map((tab) => {
                  const isActive = activeTerminalTabId === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTerminalTabId(tab.id)}
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
                            isActive ? 'text-accent' : 'text-text-subtle group-hover:text-text'
                          )}
                        />
                        <span className="truncate">{tab.title}</span>
                      </div>
                      {terminalTabs.length > 1 && (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            closeTerminalTab(tab.id)
                          }}
                          title={t('commands.closeTerminal')}
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
  initialTab?: 'agent' | 'user'
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
