import {
  useCallback,
  useEffect,
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
  ExternalLink,
  Folder,
  Loader2,
  Play,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { Chat, MessagePart } from '@shared/types'
import { useRoxyStore } from '../lib/store'
import { api } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { renderAnsi } from '../lib/ansi'
import { cn } from '../lib/cn'
import { Button } from './ui'
import { TerminalOutput } from './TerminalOutput'

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

export interface UserCommandItem {
  id: string
  command: string
  output: string
  state: 'running' | 'done' | 'error'
  timestamp: number
}

/** In-memory store of user commands per session so dialog re-opens don't lose scrollback. */
const userCommandHistoryBySession = new Map<string, UserCommandItem[]>()

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

    items.push({
      id,
      tool: part.tool,
      title: part.title ?? part.tool,
      command,
      state: part.state,
      output: part.output ?? '',
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
  const runningAgentCommand = agentCommands.find((c) => c.state === 'running')

  const [activeTab, setActiveTab] = useState<'agent' | 'user'>(() => {
    if (initialTab) return initialTab
    return runningAgentCommand ? 'agent' : 'user'
  })

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  // Selected agent command to view
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const activeAgentCommand =
    (selectedAgentId ? agentCommands.find((c) => c.id === selectedAgentId) : null) ??
    runningAgentCommand ??
    agentCommands[0] ??
    null

  // User interactive terminal state
  const [userCommands, setUserCommands] = useState<UserCommandItem[]>(
    () => userCommandHistoryBySession.get(chat.id) ?? []
  )
  const [inputVal, setInputVal] = useState('')
  const [isUserRunning, setIsUserRunning] = useState(false)
  const [activeUserCallId, setActiveUserCallId] = useState<string | null>(null)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftInput, setDraftInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Agent interactive stdin state
  const [agentInputVal, setAgentInputVal] = useState('')
  const [isSendingAgentInput, setIsSendingAgentInput] = useState(false)

  const agentTerminalRef = useRef<HTMLDivElement>(null)
  const userTerminalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const agentInputRef = useRef<HTMLInputElement>(null)
  const userStickToBottom = useRef(true)
  const agentStickToBottom = useRef(true)

  const workspacePath = chat.worktreePath ?? chat.workspacePath ?? ''

  // Sync user commands to session map
  useEffect(() => {
    userCommandHistoryBySession.set(chat.id, userCommands)
  }, [chat.id, userCommands])

  // Auto-scroll agent terminal output
  useEffect(() => {
    if (agentStickToBottom.current && agentTerminalRef.current) {
      agentTerminalRef.current.scrollTop = agentTerminalRef.current.scrollHeight
    }
  }, [activeAgentCommand?.output])

  // Auto-scroll user terminal output
  useEffect(() => {
    if (userStickToBottom.current && userTerminalRef.current) {
      userTerminalRef.current.scrollTop = userTerminalRef.current.scrollHeight
    }
  }, [userCommands])

  // Focus input when switching to user tab
  useEffect(() => {
    if (activeTab === 'user') {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else if (activeTab === 'agent' && activeAgentCommand?.state === 'running') {
      setTimeout(() => agentInputRef.current?.focus(), 50)
    }
  }, [activeTab, activeAgentCommand?.state])

  const copyText = async (text: string, id: string): Promise<void> => {
    const ok = await writeClipboardText(text)
    if (ok) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    }
  }

  const runUserCommand = useCallback(async (): Promise<void> => {
    const cmd = inputVal.trim()
    if (!cmd || isUserRunning) return

    const callId = `user_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newEntry: UserCommandItem = {
      id: callId,
      command: cmd,
      output: '',
      state: 'running',
      timestamp: Date.now()
    }

    setUserCommands((prev) => [...prev, newEntry])
    setInputVal('')
    setDraftInput('')
    setHistoryIndex(-1)
    setIsUserRunning(true)
    setActiveUserCallId(callId)

    const unsub = api.tools?.onChunk?.((data) => {
      if (data.callId === callId) {
        setUserCommands((prev) =>
          prev.map((item) =>
            item.id === callId ? { ...item, output: item.output + data.chunk } : item
          )
        )
      }
    })

    try {
      const res = await api.tools.run(chat.id, 'bash', { command: cmd }, callId)
      setUserCommands((prev) =>
        prev.map((item) =>
          item.id === callId
            ? {
                ...item,
                state: res.ok ? 'done' : 'error',
                output: res.output || item.output || (res.ok ? '' : 'Failed')
              }
            : item
        )
      )
    } catch (err) {
      setUserCommands((prev) =>
        prev.map((item) =>
          item.id === callId
            ? {
                ...item,
                state: 'error',
                output: (item.output ? `${item.output}\n` : '') + String(err)
              }
            : item
        )
      )
    } finally {
      unsub?.()
      setIsUserRunning(false)
      setActiveUserCallId(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [chat.id, inputVal, isUserRunning])

  const stopUserCommand = async (): Promise<void> => {
    if (!activeUserCallId) return
    try {
      await api.tools.cancel(activeUserCallId)
    } catch {
      // ignore
    }
  }

  const sendUserInput = useCallback(async (): Promise<void> => {
    if (!activeUserCallId) return
    const text = inputVal
    setInputVal('')
    try {
      await api.tools.input(activeUserCallId, text, chat.id)
    } catch {
      // ignore
    } finally {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [activeUserCallId, inputVal, chat.id])

  const sendAgentInput = useCallback(async (): Promise<void> => {
    const callId = activeAgentCommand?.callId ?? runningAgentCommand?.callId ?? ''
    const text = agentInputVal
    setAgentInputVal('')
    setIsSendingAgentInput(true)
    try {
      await api.tools.input(callId, text, chat.id)
    } catch {
      // ignore
    } finally {
      setIsSendingAgentInput(false)
      setTimeout(() => agentInputRef.current?.focus(), 50)
    }
  }, [activeAgentCommand?.callId, runningAgentCommand?.callId, agentInputVal, chat.id])

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

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isUserRunning) {
        void sendUserInput()
      } else {
        void runUserCommand()
      }
      return
    }

    if (e.key === 'c' && e.ctrlKey && isUserRunning) {
      e.preventDefault()
      void stopUserCommand()
      return
    }

    // Up / Down arrow command history navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (userCommands.length === 0) return
      const nextIdx = historyIndex === -1 ? userCommands.length - 1 : Math.max(0, historyIndex - 1)
      if (historyIndex === -1) setDraftInput(inputVal)
      setHistoryIndex(nextIdx)
      setInputVal(userCommands[nextIdx]?.command ?? '')
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex === -1) return
      const nextIdx = historyIndex + 1
      if (nextIdx >= userCommands.length) {
        setHistoryIndex(-1)
        setInputVal(draftInput)
      } else {
        setHistoryIndex(nextIdx)
        setInputVal(userCommands[nextIdx]?.command ?? '')
      }
    }
  }

  const clearUserHistory = (): void => {
    setUserCommands([])
    userCommandHistoryBySession.delete(chat.id)
  }

  return (
    <div
      className={cn('flex h-full w-full min-w-0 flex-col overflow-hidden bg-surface', className)}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Terminal className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-text truncate">{t('commands.title')}</h2>
              {runningAgentCommand && (
                <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-success" />
                  {t('commands.agentRunning')}
                </span>
              )}
            </div>
            {workspacePath && (
              <div
                className="flex items-center gap-1 text-[11px] text-text-subtle hover:text-text cursor-pointer transition-colors"
                onClick={() => void copyText(workspacePath, 'workspace')}
                title={workspacePath}
              >
                <Folder className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[180px] sm:max-w-[280px] font-mono">
                  {workspacePath}
                </span>
                {copiedId === 'workspace' && <Check className="h-3 w-3 text-success shrink-0" />}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onPopOut && !isStandalone && (
            <button
              type="button"
              onClick={onPopOut}
              title={t('commands.popOut')}
              aria-label={t('commands.popOut')}
              className="press-scale flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-white/5 hover:text-text transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
              className="press-scale flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-white/5 hover:text-text transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-2/40 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('agent')}
            className={cn(
              'press-scale flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'agent'
                ? 'bg-elevated text-text shadow-sm'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
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
              'press-scale flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === 'user'
                ? 'bg-elevated text-text shadow-sm'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            )}
          >
            <span>{t('commands.commandLine')}</span>
            {isUserRunning && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
          </button>
        </div>

        {activeTab === 'user' && userCommands.length > 0 && (
          <button
            type="button"
            onClick={clearUserHistory}
            title={t('commands.clear')}
            className="flex items-center gap-1 text-[11px] text-text-subtle hover:text-danger transition-colors px-2 py-1"
          >
            <Trash2 className="h-3 w-3" />
            <span>{t('commands.clear')}</span>
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeTab === 'agent' ? (
          /* AGENT COMMANDS VIEW */
          agentCommands.length === 0 ? (
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
                      <div className="flex items-center gap-2 border-t border-border/80 bg-surface px-4 py-3 shrink-0">
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
                    )}
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-xs text-text-muted">
                    {t('commands.selectCommand')}
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          /* USER INTERACTIVE COMMAND LINE VIEW */
          <div className="flex flex-1 flex-col bg-[#0b0b0d]">
            {/* Output Scroll Area */}
            <div
              ref={userTerminalRef}
              onScrollCapture={(e) => {
                const el = e.target as HTMLElement
                userStickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
              }}
              className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-[#d4d4d4] space-y-4 select-text"
            >
              {userCommands.length === 0 ? (
                <div className="text-text-subtle select-none">
                  <p>{t('commands.terminalWelcome', { path: workspacePath || '.' })}</p>
                  <p className="mt-2 text-[11px] text-text-subtle/70">
                    Try: <code>git status</code>, <code>npm test</code>, <code>ls</code>,{' '}
                    <code>pwd</code>
                  </p>
                </div>
              ) : (
                userCommands.map((item) => (
                  <div key={item.id} className="space-y-1">
                    <div className="flex items-center gap-2 text-text font-medium min-w-0">
                      <span className="text-[#4ade80] shrink-0">$</span>
                      <span className="break-all whitespace-pre-wrap">{item.command}</span>
                      {item.state === 'running' && (
                        <Loader2 className="h-3 w-3 animate-spin text-accent ml-1 shrink-0" />
                      )}
                      {item.state === 'done' && (
                        <Check className="h-3 w-3 text-success/70 ml-1 shrink-0" />
                      )}
                      {item.state === 'error' && (
                        <AlertCircle className="h-3 w-3 text-danger/70 ml-1 shrink-0" />
                      )}
                    </div>

                    {item.output ? (
                      <div className="whitespace-pre-wrap break-all text-[#c4c4c4] pl-3 border-l border-border/40">
                        {renderAnsi(item.output.trimEnd())}
                      </div>
                    ) : item.state === 'running' ? (
                      <div className="text-text-subtle pl-3">{t('commands.running')}</div>
                    ) : (
                      <div className="text-text-subtle pl-3">(no output)</div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Input Prompt Box at the bottom */}
            <div className="flex items-center gap-2 border-t border-border/80 bg-surface px-4 py-3">
              <span className="font-mono text-sm font-bold text-[#4ade80]">$</span>
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={
                  isUserRunning
                    ? t('commands.userRunningInputPlaceholder')
                    : t('commands.inputPlaceholder')
                }
                className="flex-1 bg-transparent font-mono text-xs text-text placeholder:text-text-subtle focus:outline-none"
                autoFocus
              />

              {isUserRunning ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void sendUserInput()}
                    className="h-7 px-2.5 text-xs gap-1"
                    title={t('commands.sendInput')}
                  >
                    <span>{t('commands.send')}</span>
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void stopUserCommand()}
                    className="h-7 px-2 text-xs gap-1"
                    title={t('commands.stopCommand')}
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                    <span>{t('commands.stop')}</span>
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void runUserCommand()}
                  disabled={!inputVal.trim()}
                  className="h-7 px-3 text-xs gap-1"
                >
                  <Play className="h-3 w-3" />
                  <span>{t('commands.run')}</span>
                </Button>
              )}
            </div>
          </div>
        )}
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
