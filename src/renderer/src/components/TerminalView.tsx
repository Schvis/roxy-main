import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../lib/api'
import { writeClipboardText } from '../lib/clipboard'
import { cn } from '../lib/cn'

const TERMINAL_THEME = {
  background: '#0b0b0d',
  foreground: '#d4d4d4',
  cursor: '#4ade80',
  cursorAccent: '#0b0b0d',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#1e1e1e',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#38bdf8',
  white: '#f3f4f6',
  brightBlack: '#6b7280',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff'
}

export interface TerminalViewHandle {
  clear: () => void
  reset: () => void
  focus: () => void
}

export function TerminalView({
  sessionId,
  active = true,
  className,
  onHandle
}: {
  sessionId: string
  active?: boolean
  className?: string
  onHandle?: (handle: TerminalViewHandle) => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'var(--font-mono, Consolas, "Courier New", monospace)',
      fontSize: 13,
      lineHeight: 1.25,
      theme: TERMINAL_THEME,
      allowTransparency: true,
      convertEol: true,
      scrollback: 10000,
      rightClickSelectsWord: false
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon

    const safeFit = (): void => {
      const el = containerRef.current
      if (!el || el.clientWidth < 10 || el.clientHeight < 10) return
      try {
        fitAddon.fit()
        if (term.cols > 0 && term.rows > 0) {
          void api.shell.resize(sessionId, term.cols, term.rows)
        }
      } catch {
        // ignore
      }
    }

    // Custom key shortcuts (copy selection on Ctrl+C; Ctrl+Shift+V terminal paste)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown') {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'c'
        ) {
          if (term.hasSelection()) {
            const sel = term.getSelection()
            void writeClipboardText(sel)
            return false
          }
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
          event.preventDefault()
          void navigator.clipboard.readText().then((clip) => {
            if (clip && !disposed) {
              term.paste(clip)
            }
          })
          return false
        }
      }
      // Standard Ctrl+V / Cmd+V is passed through to browser DOM paste event on xterm textarea (prevents duplicate pastes)
      return true
    })

    // Normal command line right-click behavior: copy if selection, paste if no selection
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      term.focus()

      if (term.hasSelection()) {
        const sel = term.getSelection()
        if (sel) {
          void writeClipboardText(sel)
          term.clearSelection()
          return
        }
      }

      void navigator.clipboard.readText().then((clip) => {
        if (clip && !disposed) {
          term.paste(clip)
        }
      })
    }

    const container = containerRef.current
    container.addEventListener('contextmenu', onContextMenu)

    // User typing sends raw data straight to the PTY
    const onDataDisp = term.onData((data) => {
      if (!disposed) {
        void api.shell.write(sessionId, data)
      }
    })

    // Realtime stdout/stderr from PTY
    const unsubOutput = api.shell.onOutput((data) => {
      if (!disposed && data.sessionId === sessionId) {
        term.write(data.chunk)
      }
    })

    // Load initial buffer or start fresh shell
    void api.shell.getState(sessionId).then((state) => {
      if (disposed) return
      if (state.output) {
        term.write(state.output)
      } else if (!state.running) {
        void api.shell.start(sessionId).then((started) => {
          if (!disposed && started.output) {
            term.write(started.output)
          }
        })
      }
      setTimeout(safeFit, 30)
      term.focus()
    })

    const ro = new ResizeObserver(() => {
      if (!disposed) safeFit()
    })
    ro.observe(containerRef.current)

    if (onHandle) {
      onHandle({
        clear: () => {
          term.clear()
          void api.shell.clear(sessionId)
        },
        reset: () => {
          term.reset()
        },
        focus: () => {
          term.focus()
        }
      })
    }

    return () => {
      disposed = true
      container.removeEventListener('contextmenu', onContextMenu)
      ro.disconnect()
      onDataDisp.dispose()
      unsubOutput()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId])

  // Refit and focus when tab becomes active
  useEffect(() => {
    if (active && termRef.current && fitAddonRef.current) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit()
          const term = termRef.current
          if (term && term.cols > 0 && term.rows > 0) {
            void api.shell.resize(sessionId, term.cols, term.rows)
            term.focus()
          }
        } catch {
          // ignore
        }
      }, 50)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [active, sessionId])

  return (
    <div
      ref={containerRef}
      onClick={() => termRef.current?.focus()}
      className={cn(
        'h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0b0b0d] p-2 select-text [&_.xterm]:h-full',
        className
      )}
    />
  )
}
