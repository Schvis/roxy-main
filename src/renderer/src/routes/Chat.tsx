import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { ChatView } from '../components/ChatView'
import { IdeWorkspace } from '../components/IdeWorkspace'
import { TopNavbar } from '../components/TopNavbar'
import { useRoxyStore } from '../lib/store'

const IDE_CHAT_SIZES_KEY = 'roxy.ide.chatSizes.v1'
const IDE_CHAT_COLLAPSED_KEY = 'roxy.ide.chatCollapsed.v1'
const DEFAULT_IDE_CHAT_SIZES = { left: 42, right: 42, bottom: 42 }
const MIN_CHAT_WIDTH_PX = 380
const MIN_CHAT_HEIGHT_PX = 300
const MIN_IDE_WORKSPACE_WIDTH_PX = 380
const MIN_IDE_WORKSPACE_HEIGHT_PX = 220

function clampChatSize(value: number): number {
  return Math.max(20, Math.min(75, value))
}

function loadChatSizes(): typeof DEFAULT_IDE_CHAT_SIZES {
  try {
    const parsed = JSON.parse(localStorage.getItem(IDE_CHAT_SIZES_KEY) ?? '{}') as Record<
      string,
      unknown
    >
    return {
      left: typeof parsed.left === 'number' ? clampChatSize(parsed.left) : 42,
      right: typeof parsed.right === 'number' ? clampChatSize(parsed.right) : 42,
      bottom: typeof parsed.bottom === 'number' ? clampChatSize(parsed.bottom) : 42
    }
  } catch {
    return DEFAULT_IDE_CHAT_SIZES
  }
}

function Chat(): JSX.Element {
  const { t } = useTranslation()
  const dock = useRoxyStore((s) => s.settings?.ideChatDock ?? 'right')
  const [sizes, setSizes] = useState(loadChatSizes)
  const [chatCollapsed, setChatCollapsed] = useState(
    () => localStorage.getItem(IDE_CHAT_COLLAPSED_KEY) === 'true'
  )
  useEffect(() => {
    try {
      localStorage.setItem(IDE_CHAT_SIZES_KEY, JSON.stringify(sizes))
    } catch {}
  }, [sizes])
  useEffect(() => {
    localStorage.setItem(IDE_CHAT_COLLAPSED_KEY, String(chatCollapsed))
  }, [chatCollapsed])
  const pane = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const bottom = dock === 'bottom'
  const size = sizes[dock]
  const resize = (value: number, rect?: DOMRect): void => {
    let clamped = clampChatSize(value)
    if (rect) {
      if (bottom) {
        const minPct = (MIN_CHAT_HEIGHT_PX / Math.max(rect.height, 1)) * 100
        const maxPct = 100 - (MIN_IDE_WORKSPACE_HEIGHT_PX / Math.max(rect.height, 1)) * 100
        if (maxPct >= minPct) {
          clamped = Math.max(minPct, Math.min(maxPct, clamped))
        }
      } else {
        const minPct = (MIN_CHAT_WIDTH_PX / Math.max(rect.width, 1)) * 100
        const maxPct = 100 - (MIN_IDE_WORKSPACE_WIDTH_PX / Math.max(rect.width, 1)) * 100
        if (maxPct >= minPct) {
          clamped = Math.max(minPct, Math.min(maxPct, clamped))
        }
      }
    }
    setSizes((current) => ({ ...current, [dock]: Math.round(clamped * 10) / 10 }))
  }
  const ideMode = useRoxyStore((s) => s.settings?.ideMode ?? false)
  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const chats = useRoxyStore((s) => s.chats)
  const activeChat = chats.find((chat) => chat.id === activeChatId)
  const parentChat = chats.find((chat) => chat.id === activeChat?.parentId)
  const root =
    activeChat?.worktreePath ??
    activeChat?.workspacePath ??
    parentChat?.worktreePath ??
    parentChat?.workspacePath ??
    null
  return (
    <div className="flex h-full w-full flex-col min-w-0 overflow-hidden">
      <TopNavbar />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <Sidebar />
        <div
          ref={pane}
          className={`relative flex min-h-0 min-w-0 flex-1 overflow-auto ${ideMode && bottom ? 'flex-col' : ''}`}
        >
          {ideMode && chatCollapsed && (
            <button
              type="button"
              onClick={() => setChatCollapsed(false)}
              title={t('ide.expandChat')}
              aria-label={t('ide.expandChat')}
              aria-expanded={false}
              className={`absolute z-30 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-muted shadow-sm transition-colors hover:bg-elevated hover:text-text ${
                bottom ? 'bottom-2 right-2' : dock === 'left' ? 'left-2 top-2' : 'right-2 top-2'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          )}
          {ideMode ? (
            <div
              className={`flex min-h-0 min-w-0 flex-1 ${bottom ? 'w-full min-h-[220px]' : 'min-w-[380px]'}`}
              style={{ order: dock === 'left' ? 2 : 0 }}
            >
              <IdeWorkspace
                key={JSON.stringify([activeChatId, root])}
                sessionId={activeChatId}
                root={root}
              />
            </div>
          ) : null}
          {ideMode && !chatCollapsed ? (
            <div
              role="separator"
              tabIndex={0}
              aria-label={t('ide.resizeChat')}
              aria-orientation={bottom ? 'horizontal' : 'vertical'}
              aria-valuemin={20}
              aria-valuemax={75}
              aria-valuenow={Math.round(size)}
              className={`relative z-10 shrink-0 touch-none bg-border hover:bg-accent focus-visible:bg-accent focus-visible:outline-none after:absolute after:inset-0 ${bottom ? 'h-px cursor-row-resize after:-top-1 after:-bottom-1' : 'w-px cursor-col-resize after:-left-1 after:-right-1'}`}
              style={{ order: 1 }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                dragging.current = event.pointerId
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                if (dragging.current !== event.pointerId || !pane.current) return
                const rect = pane.current.getBoundingClientRect()
                const raw = bottom
                  ? ((rect.bottom - event.clientY) / rect.height) * 100
                  : dock === 'left'
                    ? ((event.clientX - rect.left) / rect.width) * 100
                    : ((rect.right - event.clientX) / rect.width) * 100
                resize(raw, rect)
              }}
              onPointerUp={(event) => {
                dragging.current = null
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onLostPointerCapture={() => {
                dragging.current = null
              }}
              onKeyDown={(event) => {
                const delta = bottom
                  ? { ArrowUp: 2, ArrowDown: -2 }
                  : dock === 'left'
                    ? { ArrowLeft: -2, ArrowRight: 2 }
                    : { ArrowLeft: 2, ArrowRight: -2 }
                const step = delta[event.key as keyof typeof delta]
                if (step !== undefined || event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  const rect = pane.current?.getBoundingClientRect()
                  resize(
                    event.key === 'Home' ? 20 : event.key === 'End' ? 75 : size + (step ?? 0),
                    rect
                  )
                }
              }}
            />
          ) : null}
          {/* Fixed sibling slot and wrapper preserve transcript/composer state on toggles. */}
          <div
            className={`relative flex min-h-0 min-w-0 shrink-0 ${
              ideMode
                ? chatCollapsed
                  ? bottom
                    ? 'h-0 w-full overflow-hidden'
                    : 'h-full w-0 overflow-hidden'
                  : bottom
                    ? 'w-full min-h-[300px]'
                    : 'min-w-[380px] min-h-[300px]'
                : 'h-full flex-1 min-w-[380px] min-h-[300px]'
            }`}
            style={
              ideMode
                ? {
                    order: dock === 'left' ? 0 : 2,
                    flex: `0 0 ${chatCollapsed ? '0px' : `${size}%`}`
                  }
                : undefined
            }
          >
            <div
              className={
                chatCollapsed
                  ? 'invisible h-full w-full overflow-hidden'
                  : 'flex h-full min-h-0 w-full min-w-0'
              }
            >
              <ChatView onCollapse={() => setChatCollapsed(true)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* App keeps this route mounted behind secondary screens. Without memo, every
   location change would still walk the expensive transcript even though the
   component instance survived; Chat has no props, so only its own store
   subscriptions should make it render. */
export default memo(Chat)
