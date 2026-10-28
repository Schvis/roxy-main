import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import type { ShellState, ShellType } from '@shared/api'
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

// The search addon requires #RRGGBB (no alpha) for backgrounds.
const SEARCH_DECORATIONS = {
  matchBackground: '#5c4d12',
  matchOverviewRuler: '#facc15',
  activeMatchBackground: '#f97316',
  activeMatchColorOverviewRuler: '#f97316'
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/**
 * Chords the terminal pane owns (Windows Terminal's defaults): new tab, close
 * tab, cycle tabs. They are not sent to the shell and are left to bubble.
 */
export function isTerminalAppShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false
  const key = e.key.toLowerCase()
  if (e.key === 'Tab') return true
  return e.shiftKey && (key === 't' || key === 'w')
}

/**
 * xterm draws on a canvas, where a CSS `var()` in `fontFamily` is not resolved
 * and silently falls back to the browser default — so resolve it here.
 */
function terminalFontFamily(): string {
  const appMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return [appMono, "'Cascadia Mono'", 'Consolas', "'Courier New'", 'monospace']
    .filter(Boolean)
    .join(', ')
}

/** Quote a dropped path the way the target shell expects. */
function quotePath(file: string, shell: ShellType): string {
  switch (shell) {
    case 'cmd':
      return /[\s&()^,;=!'+[\]{}]/.test(file) ? `"${file}"` : file
    case 'powershell':
    case 'pwsh':
      return /[\s'`$&(){}@#;,]/.test(file) ? `'${file.replace(/'/g, "''")}'` : file
    case 'wsl':
    case 'gitbash': {
      // C:\a\b -> /mnt/c/a/b (WSL) or /c/a/b (MSYS)
      const drive = /^([a-zA-Z]):[\\/]/.exec(file)
      let posix = file.replace(/\\/g, '/')
      if (drive) {
        const prefix = shell === 'wsl' ? '/mnt/' : '/'
        posix = `${prefix}${drive[1].toLowerCase()}/${posix.slice(3)}`
      }
      return `'${posix.replace(/'/g, `'\\''`)}'`
    }
    default:
      return /[^\w@%+=:,./-]/.test(file) ? `'${file.replace(/'/g, `'\\''`)}'` : file
  }
}

export interface TerminalViewHandle {
  /** Clear scrollback; the prompt and the running program are untouched. */
  clear: () => void
  /** Kill and relaunch, optionally switching shell. */
  restart: (shellType?: ShellType) => Promise<void>
  /** Send Ctrl+C. */
  interrupt: () => void
  /** The buffer as plain text (what the user sees, no escape codes). */
  getText: () => string
  openSearch: () => void
  focus: () => void
}

export function TerminalView({
  sessionId,
  shellType,
  ordinal,
  active = true,
  className,
  onHandle,
  onState,
  onTitle,
  onExit
}: {
  sessionId: string
  /** Used only when this view has to spawn the shell; a live one is attached as-is. */
  shellType?: ShellType
  ordinal?: number
  active?: boolean
  className?: string
  onHandle?: (handle: TerminalViewHandle) => void
  /** The authoritative state from main after every (re)attach. */
  onState?: (state: ShellState) => void
  onTitle?: (title: string) => void
  onExit?: (code: number | null) => void
}): JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResult, setSearchResult] = useState<{ index: number; count: number } | null>(null)

  // Latest props/callbacks without re-running the (expensive) terminal effect.
  const latest = useRef({ shellType, ordinal, onState, onTitle, onExit, t })
  latest.current = { shellType, ordinal, onState, onTitle, onExit, t }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'bar',
      fontFamily: terminalFontFamily(),
      fontSize: 13,
      lineHeight: 1.2,
      theme: TERMINAL_THEME,
      scrollback: 10_000,
      allowProposedApi: true,
      // Alt+click positions the cursor in the prompt, as in Windows Terminal.
      altClickMovesCursor: true,
      macOptionIsMeta: true,
      minimumContrastRatio: 1,
      // PTY output already carries \r\n. Converting \n would corrupt TUIs that
      // move the cursor with a bare line feed.
      convertEol: false,
      rightClickSelectsWord: false,
      smoothScrollDuration: 0,
      // Bars/blocks/box-drawing drawn by the renderer, so they join up seamlessly.
      customGlyphs: true,
      rescaleOverlappingGlyphs: true
    })
    termRef.current = term

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode = new Unicode11Addon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(unicode)
    // Emoji and CJK are two cells wide, matching what ConPTY/PSReadLine assume.
    term.unicode.activeVersion = '11'
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        // Ctrl/Cmd+click to open, like every other terminal — a plain click is
        // just a click (and possibly the start of a selection).
        if (IS_MAC ? event.metaKey : event.ctrlKey) void api.system.openExternal(uri)
      })
    )
    searchRef.current = searchAddon
    const searchResults = searchAddon.onDidChangeResults((r) =>
      setSearchResult(r.resultCount > 0 ? { index: r.resultIndex, count: r.resultCount } : null)
    )

    term.open(container)

    // GPU renderer: far faster for floods of output. If the GPU context is
    // lost (driver reset, too many contexts) fall back to the DOM renderer.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // DOM renderer it is.
    }

    // The app's mono font is a webfont; glyph metrics measured before it loads
    // are wrong. Re-measure once it's available.
    void document.fonts?.ready.then(() => {
      if (disposed) return
      // Setting the same value is a no-op in xterm; toggle to force re-measure.
      const family = terminalFontFamily()
      term.options.fontFamily = `${family}, monospace`
      term.options.fontFamily = family
      fitRef.current?.()
    })

    // ---- sizing ----------------------------------------------------------
    let resizeTimer: number | undefined
    const fit = (): void => {
      if (disposed || container.clientWidth < 10 || container.clientHeight < 10) return
      try {
        fitAddon.fit()
      } catch {
        return
      }
      // Coalesce a drag-resize into one PTY resize; ConPTY reflows on each.
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        if (!disposed && term.cols > 0 && term.rows > 0) {
          void api.shell.resize(sessionId, term.cols, term.rows)
        }
      }, 40)
    }
    fitRef.current = fit
    let rafId = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(fit)
    })
    ro.observe(container)

    // ---- attach protocol -------------------------------------------------
    // Output is subscribed BEFORE the snapshot is requested, buffered while
    // the request is in flight, and replayed only past the snapshot's seq — so
    // nothing produced in between is lost or shown twice.
    let attaching = true
    let lastSeq = Number.POSITIVE_INFINITY
    let buffered: Array<{ chunk: string; seq: number }> = []
    let exited = false
    let restarting = false
    /** An exit that arrived mid-attach, applied once the snapshot lands. */
    let pendingExit: { code: number | null } | null = null

    const applyState = (state: ShellState): void => {
      if (disposed) return
      if (state.windowsBuild && (state.backend === 'conpty' || state.backend === 'winpty')) {
        term.options.windowsPty = { backend: state.backend, buildNumber: state.windowsBuild }
      }
      term.reset()
      // Restore at the size it was serialized at, then fit — reflow happens
      // in xterm exactly as it would have live.
      if (state.snapshot && state.cols > 0 && state.rows > 0) {
        term.resize(state.cols, state.rows)
        term.write(state.snapshot)
      }
      lastSeq = state.seq
      for (const b of buffered) if (b.seq > lastSeq) term.write(b.chunk)
      buffered = []
      attaching = false
      exited = !state.running && state.exitCode !== null
      if (exited) showExitNotice(state.exitCode)
      else if (pendingExit) {
        exited = true
        showExitNotice(pendingExit.code)
      }
      pendingExit = null
      latest.current.onState?.(state)
      term.write('', () => fit())
    }

    const showExitNotice = (code: number | null): void => {
      const text = latest.current.t('commands.terminalExitedCode', { code: code ?? '?' })
      term.write(`\r\n\x1b[0m\x1b[90m${text}\x1b[0m\r\n`)
    }

    const attach = (request: () => Promise<ShellState>): Promise<void> => {
      attaching = true
      buffered = []
      pendingExit = null
      return request().then(applyState, (err: unknown) => {
        attaching = false
        term.write(`\r\n\x1b[31m${String(err)}\x1b[0m\r\n`)
      })
    }

    const restart = async (type?: ShellType): Promise<void> => {
      if (restarting) return
      restarting = true
      try {
        await attach(() =>
          api.shell.restart(sessionId, {
            shellType: type ?? latest.current.shellType,
            cols: term.cols,
            rows: term.rows
          })
        )
      } finally {
        restarting = false
      }
      term.focus()
    }

    const unsubOutput = api.shell.onOutput((data) => {
      if (disposed || data.sessionId !== sessionId) return
      if (attaching) {
        buffered.push({ chunk: data.chunk, seq: data.seq })
      } else if (data.seq > lastSeq) {
        lastSeq = data.seq
        term.write(data.chunk)
      }
    })
    const unsubExit = api.shell.onExit((data) => {
      if (disposed || data.sessionId !== sessionId) return
      latest.current.onExit?.(data.code)
      if (attaching) {
        pendingExit = { code: data.code }
        return
      }
      exited = true
      // Output flushed before the exit event has already been delivered.
      showExitNotice(data.code)
    })
    const unsubTitle = api.shell.onTitle((data) => {
      if (!disposed && data.sessionId === sessionId) latest.current.onTitle?.(data.title)
    })

    // ---- input -----------------------------------------------------------
    const onData = term.onData((data) => {
      if (disposed) return
      if (exited) {
        // A dead terminal restarts on Enter, like VS Code's "press any key".
        if (data === '\r') void restart()
        return
      }
      void api.shell.write(sessionId, data)
    })
    // Binary input (mouse reports in some modes) — forward unchanged.
    const onBinary = term.onBinary((data) => {
      if (!disposed && !exited) void api.shell.write(sessionId, data)
    })

    const paste = (): void => {
      void navigator.clipboard.readText().then(
        (clip) => {
          if (clip && !disposed) term.paste(clip)
        },
        () => undefined
      )
    }

    const copySelection = (): boolean => {
      if (!term.hasSelection()) return false
      void writeClipboardText(term.getSelection())
      return true
    }

    term.attachCustomKeyEventHandler((event) => {
      if (isTerminalAppShortcut(event)) return false
      if (event.type !== 'keydown') return true
      const mod = IS_MAC ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      // Ctrl+C copies when there's a selection, otherwise it is SIGINT —
      // Windows Terminal's behavior.
      if (mod && !event.shiftKey && !event.altKey && key === 'c' && copySelection()) {
        term.clearSelection()
        event.preventDefault()
        return false
      }
      if (mod && event.shiftKey && key === 'c') {
        copySelection()
        event.preventDefault()
        return false
      }
      // Ctrl+V: let the browser fire a native paste event on xterm's textarea
      // (xterm turns it into a bracketed paste). Returning false stops xterm
      // from also sending ^V.
      if (mod && !event.shiftKey && !event.altKey && key === 'v') return false
      if (mod && event.shiftKey && key === 'v') {
        event.preventDefault()
        paste()
        return false
      }
      if (mod && event.shiftKey && key === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        return false
      }
      if (mod && !event.shiftKey && key === 'a' && IS_MAC) {
        term.selectAll()
        return false
      }
      return true
    })

    // Esc, Ctrl+A etc. belong to the shell (PSReadLine, vim, less), not to the
    // surrounding dialog's window-level shortcuts. The pane's own tab chords
    // are left to bubble.
    const stopKeys = (e: KeyboardEvent): void => {
      if (!isTerminalAppShortcut(e)) e.stopPropagation()
    }
    container.addEventListener('keydown', stopKeys)

    // Console-host right-click: copy the selection if there is one, else paste.
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      term.focus()
      if (copySelection()) term.clearSelection()
      else paste()
    }
    container.addEventListener('contextmenu', onContextMenu)

    // Drop files/folders to insert their quoted paths, like Windows Terminal.
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDrop = (e: DragEvent): void => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const shell = latest.current.shellType ?? 'bash'
      const paths = files
        .map((f) => api.shell.pathForFile(f))
        .filter(Boolean)
        .map((p) => quotePath(p, shell))
      if (paths.length && !exited) term.paste(paths.join(' '))
      term.focus()
    }
    container.addEventListener('dragover', onDragOver)
    container.addEventListener('drop', onDrop)

    // ---- initial attach --------------------------------------------------
    // Fit first so a newly spawned shell lays out its banner at the real width.
    fit()
    void attach(async () => {
      const existing = await api.shell.getState(sessionId)
      // An exited shell is shown as it ended (with its exit notice) instead of
      // being silently respawned on re-open.
      if (!existing.running && existing.exitCode !== null) return existing
      return api.shell.start(sessionId, {
        shellType: latest.current.shellType,
        ordinal: latest.current.ordinal,
        cols: term.cols,
        rows: term.rows
      })
    }).then(() => {
      if (!disposed && active) term.focus()
    })

    onHandle?.({
      clear: () => {
        term.clear()
        void api.shell.clear(sessionId)
      },
      restart,
      interrupt: () => {
        if (!exited) void api.shell.write(sessionId, '\x03')
        term.focus()
      },
      getText: () => {
        const buffer = term.buffer.active
        const lines: string[] = []
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i)
          if (!line) continue
          const text = line.translateToString(true)
          // Soft-wrapped rows are one logical line.
          if (line.isWrapped && lines.length) lines[lines.length - 1] += text
          else lines.push(text)
        }
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
        return lines.join('\n')
      },
      openSearch: () => setSearchOpen(true),
      focus: () => term.focus()
    })

    return () => {
      disposed = true
      window.clearTimeout(resizeTimer)
      cancelAnimationFrame(rafId)
      ro.disconnect()
      container.removeEventListener('keydown', stopKeys)
      container.removeEventListener('contextmenu', onContextMenu)
      container.removeEventListener('dragover', onDragOver)
      container.removeEventListener('drop', onDrop)
      onData.dispose()
      onBinary.dispose()
      searchResults.dispose()
      unsubOutput()
      unsubExit()
      unsubTitle()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // The terminal is rebuilt only for a different session; everything else is
    // read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Refit and focus when the tab becomes visible (a hidden tab measures 0×0).
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      fitRef.current?.()
      termRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(timer)
  }, [active])

  // ---- search ------------------------------------------------------------
  const runSearch = useCallback((term: string, backwards = false): void => {
    const search = searchRef.current
    if (!search) return
    if (!term) {
      search.clearDecorations()
      setSearchResult(null)
      return
    }
    const opts = { decorations: SEARCH_DECORATIONS, incremental: !backwards }
    if (backwards) search.findPrevious(term, opts)
    else search.findNext(term, opts)
  }, [])

  const closeSearch = useCallback((): void => {
    searchRef.current?.clearDecorations()
    termRef.current?.clearSelection()
    setSearchOpen(false)
    setSearchResult(null)
    termRef.current?.focus()
  }, [])

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [searchOpen])

  return (
    <div
      className={cn(
        'relative h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0b0b0d]',
        className
      )}
    >
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        className="h-full w-full overflow-hidden py-1.5 pl-2 pr-0.5 [&_.xterm]:h-full"
      />
      {searchOpen && (
        <div
          className="absolute right-4 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-elevated/95 px-1.5 py-1 shadow-lg backdrop-blur"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            value={searchTerm}
            placeholder={t('commands.searchPlaceholder')}
            aria-label={t('commands.searchPlaceholder')}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              runSearch(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(searchTerm, e.shiftKey)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
            className="h-6 w-44 rounded bg-surface-2 px-2 font-mono text-[11px] text-text outline-none placeholder:text-text-subtle"
          />
          <span className="min-w-[3.5rem] text-center text-[10px] tabular-nums text-text-subtle">
            {searchTerm
              ? searchResult
                ? t('commands.searchCount', {
                    current: searchResult.index + 1,
                    total: searchResult.count
                  })
                : t('commands.searchNoResults')
              : ''}
          </span>
          <button
            type="button"
            onClick={() => runSearch(searchTerm, true)}
            title={t('commands.searchPrevious')}
            aria-label={t('commands.searchPrevious')}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => runSearch(searchTerm)}
            title={t('commands.searchNext')}
            aria-label={t('commands.searchNext')}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            title={t('commands.searchClose')}
            aria-label={t('commands.searchClose')}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
