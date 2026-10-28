import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Chat } from '@shared/types'
import { cn } from '../lib/cn'
import { CommandsPane } from './CommandsDialog'

const WIDTH_KEY = 'roxy.terminalDock.width'
const MIN_WIDTH = 360
const MAX_WIDTH = 1100
/** Chat keeps at least this much room once the window is wide enough to share. */
const CHAT_RESERVE = 420

function defaultWidth(): number {
  return Math.round(Math.min(640, Math.max(MIN_WIDTH, window.innerWidth * 0.38)))
}

/**
 * The terminal, docked to the right of the chat like Explorer / Search /
 * Source Control — not a modal over it.
 *
 * It stays mounted while hidden for the current chat, so closing and reopening
 * the dock does not require re-attaching xterm. Switching chats replaces the
 * view; the shells themselves keep running in main.
 */
export function TerminalDock({
  chat,
  open,
  initialTab,
  onClose,
  onPopOut
}: {
  chat: Chat
  open: boolean
  initialTab?: 'agent' | 'user' | 'git'
  onClose: () => void
  onPopOut: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const panel = useRef<HTMLElement>(null)
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY))
      if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) return saved
    } catch {
      /* Resizing also works without persistence. */
    }
    return defaultWidth()
  })
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH)
  const minWidth = Math.min(MIN_WIDTH, availableWidth)
  const maxWidth = Math.min(MAX_WIDTH, availableWidth)
  const width = Math.max(minWidth, Math.min(maxWidth, preferredWidth))

  const drag = useRef<{ x: number; width: number; cursor: string; userSelect: string } | null>(null)
  const stopResize = (): void => {
    if (!drag.current) return
    document.body.style.cursor = drag.current.cursor
    document.body.style.userSelect = drag.current.userSelect
    drag.current = null
  }
  const resize = (value: number): void => {
    const next = Math.round(Math.max(minWidth, Math.min(maxWidth, value)))
    setPreferredWidth(next)
    try {
      localStorage.setItem(WIDTH_KEY, String(next))
    } catch {
      /* Keep the in-memory preference. */
    }
  }

  useLayoutEffect(() => {
    const host = panel.current?.parentElement
    if (!host) return
    const measure = (): void => {
      const available = host.clientWidth
      // Same rule as the workspace inspector: share the row once the chat can
      // keep a comfortable column, otherwise overlay it.
      setAvailableWidth(Math.max(1, available - (available >= 960 ? CHAT_RESERVE : 0)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    window.addEventListener('blur', stopResize)
    return () => {
      window.removeEventListener('blur', stopResize)
      stopResize()
    }
  }, [])

  return (
    <aside
      ref={panel}
      id="terminal-dock"
      aria-label={t('ide.terminalTab')}
      aria-hidden={!open || undefined}
      style={{ width }}
      className={cn(
        'terminal-dock absolute inset-y-0 right-0 z-30 flex max-w-full shrink-0 flex-col border-l border-border bg-surface shadow-[-12px_0_32px_#00000018] outline-none',
        !open && 'hidden'
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('commands.resizeDock')}
        aria-controls="terminal-dock"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        title={t('commands.resizeDock')}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            x: event.clientX,
            width,
            cursor: document.body.style.cursor,
            userSelect: document.body.style.userSelect
          }
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width + drag.current.x - event.clientX)
        }}
        onPointerUp={(event) => {
          stopResize()
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={stopResize}
        onLostPointerCapture={stopResize}
        onDoubleClick={() => resize(defaultWidth())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            resize(width + (event.key === 'ArrowLeft' ? 20 : -20))
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            resize(event.key === 'Home' ? minWidth : maxWidth)
          }
        }}
        className="workspace-resize-handle absolute inset-y-0 left-0 z-40 w-1 touch-none cursor-col-resize hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
      />
      <CommandsPane
        chat={chat}
        docked
        active={open}
        initialTab={initialTab}
        onClose={onClose}
        onPopOut={onPopOut}
        className="@container/terminal min-h-0 flex-1"
      />
    </aside>
  )
}
