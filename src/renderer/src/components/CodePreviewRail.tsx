import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Braces,
  Boxes,
  ChevronDown,
  ChevronUp,
  GitCommit,
  Hash,
  ListTree,
  Map as MapIcon,
  Tag
} from 'lucide-react'
import type { EditorLineInfo, GroupedHunk } from './FileEditor'
import type { SyntaxToken } from './diff/model'
import { cn } from '../lib/cn'

export interface CodeStructureSymbol {
  id: string
  name: string
  kind: 'function' | 'class' | 'interface' | 'heading' | 'hunk'
  lineIdx: number
  indent: number
  hunk?: GroupedHunk
}

const FUNCTION_RE =
  /(?:(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*([a-zA-Z0-9_$]+)|(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|def\s+([a-zA-Z0-9_]+)|fn\s+([a-zA-Z0-9_]+)|func\s+(?:\([^)]+\)\s*)?([a-zA-Z0-9_]+))/

const CLASS_RE = /(?:export\s+)?(?:class|struct|enum)\s+([a-zA-Z0-9_$]+)/

const INTERFACE_RE = /(?:export\s+)?(?:interface|type)\s+([a-zA-Z0-9_$]+)/

const HEADING_RE = /^(#{1,6})\s+(.+)$/

const KEYWORD_REGEX =
  /\b(?:import|export|from|default|const|let|var|function|return|if|else|switch|case|break|for|while|do|try|catch|finally|throw|class|extends|implements|interface|type|enum|public|private|protected|readonly|static|async|await|new|this|typeof|instanceof|void|def|fn|func|mut|struct|impl|trait)\b/
const STRING_REGEX = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/
const COMMENT_REGEX = /^(?:\/\/.*|\/\*[\s\S]*?\*\/|#.*)/
const NUMBER_REGEX = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/

function getFallbackTokenColor(tokenText: string): string {
  if (COMMENT_REGEX.test(tokenText)) return '#6b7280' // Slate-500
  if (STRING_REGEX.test(tokenText)) return '#f59e0b' // Amber-500
  if (KEYWORD_REGEX.test(tokenText)) return '#818cf8' // Indigo-400
  if (NUMBER_REGEX.test(tokenText)) return '#38bdf8' // Sky-400
  return 'rgba(156, 163, 175, 0.65)' // Slate-400
}

export function extractCodeStructure(lines: string[], hunks: GroupedHunk[]): CodeStructureSymbol[] {
  const symbols: CodeStructureSymbol[] = []

  // Map hunks by starting line index
  const hunksByLine = new Map<number, GroupedHunk>()
  for (const h of hunks) {
    hunksByLine.set(h.startLineIdx, h)
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]
    const trimmed = rawLine.trim()
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      // Check if this line is start of a hunk even if blank/comment
      if (hunksByLine.has(idx)) {
        const hunk = hunksByLine.get(idx)!
        symbols.push({
          id: `hunk-${hunk.id}`,
          name: `Change (+${hunk.addedCount} -${hunk.deletedCount})`,
          kind: 'hunk',
          lineIdx: idx,
          indent: 0,
          hunk
        })
      }
      continue
    }

    const indent = rawLine.search(/\S/)

    // 1. Change hunk marker
    if (hunksByLine.has(idx)) {
      const hunk = hunksByLine.get(idx)!
      symbols.push({
        id: `hunk-${hunk.id}`,
        name: `Change (+${hunk.addedCount} -${hunk.deletedCount})`,
        kind: 'hunk',
        lineIdx: idx,
        indent: Math.max(0, indent),
        hunk
      })
    }

    // 2. Class / Struct
    const classMatch = trimmed.match(CLASS_RE)
    if (classMatch && classMatch[1]) {
      symbols.push({
        id: `class-${idx}-${classMatch[1]}`,
        name: classMatch[1],
        kind: 'class',
        lineIdx: idx,
        indent: Math.max(0, indent)
      })
      continue
    }

    // 3. Interface / Type
    const typeMatch = trimmed.match(INTERFACE_RE)
    if (typeMatch && typeMatch[1]) {
      symbols.push({
        id: `type-${idx}-${typeMatch[1]}`,
        name: typeMatch[1],
        kind: 'interface',
        lineIdx: idx,
        indent: Math.max(0, indent)
      })
      continue
    }

    // 4. Function / Method
    const funcMatch = trimmed.match(FUNCTION_RE)
    const funcName = funcMatch
      ? funcMatch[1] || funcMatch[2] || funcMatch[3] || funcMatch[4] || funcMatch[5]
      : null
    if (funcName) {
      symbols.push({
        id: `func-${idx}-${funcName}`,
        name: funcName,
        kind: 'function',
        lineIdx: idx,
        indent: Math.max(0, indent)
      })
      continue
    }

    // 5. Markdown heading
    const headMatch = rawLine.match(HEADING_RE)
    if (headMatch) {
      symbols.push({
        id: `heading-${idx}`,
        name: headMatch[2].trim(),
        kind: 'heading',
        lineIdx: idx,
        indent: (headMatch[1].length - 1) * 2
      })
      continue
    }
  }

  return symbols
}

export interface CodePreviewRailProps {
  lines: string[]
  lineInfos: EditorLineInfo[]
  hunks: GroupedHunk[]
  errorLines?: Set<number>
  syntaxTokens?: SyntaxToken[][] | null
  scrollContainerRef: React.RefObject<HTMLElement | null>
  onScrollToLine: (lineIdx: number) => void
  className?: string
}

export function CodePreviewRail({
  lines,
  lineInfos,
  hunks,
  errorLines,
  syntaxTokens,
  scrollContainerRef,
  onScrollToLine,
  className
}: CodePreviewRailProps): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'minimap' | 'outline'>('minimap')
  const [currentHunkIdx, setCurrentHunkIdx] = useState<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollbarTrackRef = useRef<HTMLDivElement>(null)

  // Spacing per preview line is constant (never squeezed or stretched)
  const PREVIEW_LINE_H = 3.5
  const totalLines = Math.max(1, lines.length)
  const totalContentHeight = Math.max(1, totalLines * PREVIEW_LINE_H)

  // Scroll state synchronized from scrollContainer
  const [scrollState, setScrollState] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1
  })

  // Tooltip hover state
  const [hoveredLine, setHoveredLine] = useState<{
    lineIdx: number
    y: number
    text: string
    kind: 'context' | 'added' | 'deleted'
    hasError: boolean
    hasDeletion?: boolean
  } | null>(null)

  // Synchronize scroll metrics from master editor element
  const updateScrollState = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setScrollState({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight || 1,
      clientHeight: el.clientHeight || 1
    })
  }, [scrollContainerRef])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    updateScrollState()
    const handleScroll = (): void => updateScrollState()
    el.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      el.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [scrollContainerRef, updateScrollState, lines.length])

  // Extract symbols for structure outline
  const symbols = useMemo(() => extractCodeStructure(lines, hunks), [lines, hunks])

  // Scroll metrics calculations
  const containerHeight = containerRef.current?.clientHeight || 400
  const maxEditorScroll = Math.max(1, scrollState.scrollHeight - scrollState.clientHeight)
  const maxMinimapScroll = Math.max(0, totalContentHeight - containerHeight)
  const minimapScrollTop =
    maxMinimapScroll > 0 ? (scrollState.scrollTop / maxEditorScroll) * maxMinimapScroll : 0

  // Viewport Slider coordinates in minimap space
  const firstVisibleLine = Math.max(0, (scrollState.scrollTop - 16) / 20)
  const visibleLineCount = Math.max(1, scrollState.clientHeight / 20)
  const sliderTop = firstVisibleLine * PREVIEW_LINE_H
  const sliderHeight = Math.max(16, visibleLineCount * PREVIEW_LINE_H)

  // Right-side Code Editor Scrollbar metrics
  const scrollbarThumbHeight = Math.max(
    20,
    Math.min(
      containerHeight,
      (scrollState.clientHeight / Math.max(1, scrollState.scrollHeight)) * containerHeight
    )
  )
  const availableScrollbarTrack = Math.max(1, containerHeight - scrollbarThumbHeight)
  const scrollbarThumbTop = Math.min(
    availableScrollbarTrack,
    Math.max(0, (scrollState.scrollTop / maxEditorScroll) * availableScrollbarTrack)
  )

  // Track active change hunk index based on current scroll position
  useEffect(() => {
    if (hunks.length === 0) return
    const currentLine = Math.floor(
      (scrollState.scrollTop / Math.max(1, scrollState.scrollHeight)) * lines.length
    )
    let closest = 0
    let minDiff = Infinity
    for (let i = 0; i < hunks.length; i++) {
      const diff = Math.abs(hunks[i].startLineIdx - currentLine)
      if (diff < minDiff) {
        minDiff = diff
        closest = i
      }
    }
    setCurrentHunkIdx(closest)
  }, [scrollState.scrollTop, scrollState.scrollHeight, hunks, lines.length])

  // Navigate to previous hunk
  const handlePrevChange = (): void => {
    if (hunks.length === 0) return
    const nextIdx = currentHunkIdx > 0 ? currentHunkIdx - 1 : hunks.length - 1
    setCurrentHunkIdx(nextIdx)
    onScrollToLine(hunks[nextIdx].startLineIdx)
  }

  // Navigate to next hunk
  const handleNextChange = (): void => {
    if (hunks.length === 0) return
    const nextIdx = currentHunkIdx < hunks.length - 1 ? currentHunkIdx + 1 : 0
    setCurrentHunkIdx(nextIdx)
    onScrollToLine(hunks[nextIdx].startLineIdx)
  }

  // Draw minimap on HTML5 canvas with consistent line spacing
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || mode !== 'minimap') return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    if (width === 0) return

    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(totalContentHeight * dpr)
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, totalContentHeight)

    const lineH = PREVIEW_LINE_H
    const maxCharsPerLine = 80
    const charWidth = (width - 8) / maxCharsPerLine

    // 1. Paint background highlight strips & git line indicators
    for (let i = 0; i < totalLines; i++) {
      const info = lineInfos[i]
      const y = i * lineH

      if (info?.kind === 'added') {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.18)'
        ctx.fillRect(0, y, width, lineH)
        // Solid green vertical indicator line on the left edge
        ctx.fillStyle = '#10b981'
        ctx.fillRect(0, y, 3, lineH)
      } else if (info?.kind === 'deleted') {
        ctx.fillStyle = 'rgba(244, 63, 94, 0.18)'
        ctx.fillRect(0, y, width, lineH)
        // Solid rose vertical indicator line on the left edge
        ctx.fillStyle = '#f43f5e'
        ctx.fillRect(0, y, 3, lineH)
      }

      // Red horizontal line indicator where lines were removed
      if (info?.gitDeletedCount) {
        ctx.fillStyle = '#f43f5e'
        ctx.fillRect(0, Math.max(0, y - 1), width, 2)
      }
      if (info?.gitDeletedTrailing) {
        ctx.fillStyle = '#f43f5e'
        ctx.fillRect(0, Math.max(0, (i + 1) * lineH - 2), width, 2)
      }
    }

    // 2. Paint miniature code lines with token-level syntax coloring
    const maxDrawWidth = width - 4
    for (let i = 0; i < totalLines; i++) {
      const line = lines[i] || ''
      if (!line.trim()) continue

      const info = lineInfos[i]
      const y = i * lineH
      const h = 2.2

      const indentCount = Math.max(0, line.search(/\S/))
      const contentLen = Math.min(line.trim().length, maxCharsPerLine - indentCount)
      if (contentLen <= 0) continue

      const startX = 4 + indentCount * charWidth * 0.8

      if (info?.kind === 'added') {
        ctx.fillStyle = '#34d399' // Emerald-400
        const w = Math.min(maxDrawWidth - startX, Math.max(3, contentLen * charWidth))
        ctx.fillRect(startX, y, w, h)
      } else if (info?.kind === 'deleted') {
        ctx.fillStyle = '#fb7185' // Rose-400
        const w = Math.min(maxDrawWidth - startX, Math.max(3, contentLen * charWidth))
        ctx.fillRect(startX, y, w, h)
      } else if (errorLines?.has(i + 1)) {
        ctx.fillStyle = '#ef4444' // Red-500
        const w = Math.min(maxDrawWidth - startX, Math.max(3, contentLen * charWidth))
        ctx.fillRect(startX, y, w, h)
      } else if (syntaxTokens?.[i] && syntaxTokens[i].length > 0) {
        let currX = startX
        for (const tok of syntaxTokens[i]) {
          if (!tok.text) continue
          const tokLen = tok.text.length
          const tokW = Math.max(1.5, tokLen * charWidth)
          if (currX + tokW > maxDrawWidth) break
          ctx.fillStyle = tok.dark || tok.light || '#9ca3af'
          ctx.fillRect(currX, y, tokW, h)
          currX += tokW
        }
      } else {
        const tokens = line
          .trim()
          .split(/([a-zA-Z0-9_$]+|[^\s\w])/g)
          .filter(Boolean)
        let currX = startX
        for (const tok of tokens) {
          const tokLen = tok.length
          const tokW = Math.max(1.5, tokLen * charWidth)
          if (currX + tokW > maxDrawWidth) break
          ctx.fillStyle = getFallbackTokenColor(tok)
          ctx.fillRect(currX, y, tokW, h)
          currX += tokW
        }
      }
    }
  }, [lines, lineInfos, errorLines, syntaxTokens, mode, totalContentHeight])

  // Mouse wheel over minimap scrolls the master editor
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop += e.deltaY
    }
  }

  // Jump to clicked line in minimap
  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickY = e.clientY - rect.top + minimapScrollTop
    const targetLine = Math.min(totalLines - 1, Math.max(0, Math.floor(clickY / PREVIEW_LINE_H)))
    onScrollToLine(targetLine)
  }

  // Dragging the minimap viewport slider
  const minimapDragStartY = useRef(0)
  const minimapDragStartScrollTop = useRef(0)
  const isMinimapDragging = useRef(false)

  const handleMinimapSliderPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    isMinimapDragging.current = true
    minimapDragStartY.current = e.clientY
    minimapDragStartScrollTop.current = scrollContainerRef.current?.scrollTop || 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleMinimapSliderPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isMinimapDragging.current || !scrollContainerRef.current) return
    const deltaY = e.clientY - minimapDragStartY.current
    const scrollDelta = (deltaY / PREVIEW_LINE_H) * 20
    scrollContainerRef.current.scrollTop = Math.max(
      0,
      Math.min(scrollState.scrollHeight, minimapDragStartScrollTop.current + scrollDelta)
    )
  }

  const handleMinimapSliderPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isMinimapDragging.current) {
      isMinimapDragging.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
    }
  }

  // Dragging the Right-side Code Editor Scrollbar
  const scrollbarDragStartY = useRef(0)
  const scrollbarDragStartScrollTop = useRef(0)
  const isScrollbarDragging = useRef(false)

  const handleScrollbarPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    isScrollbarDragging.current = true
    scrollbarDragStartY.current = e.clientY
    scrollbarDragStartScrollTop.current = scrollContainerRef.current?.scrollTop || 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleScrollbarPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!isScrollbarDragging.current || !scrollContainerRef.current) return
    const deltaY = e.clientY - scrollbarDragStartY.current
    const deltaScroll = (deltaY / availableScrollbarTrack) * maxEditorScroll
    scrollContainerRef.current.scrollTop = Math.max(
      0,
      Math.min(scrollState.scrollHeight, scrollbarDragStartScrollTop.current + deltaScroll)
    )
  }

  const handleScrollbarPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isScrollbarDragging.current) {
      isScrollbarDragging.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
    }
  }

  const handleScrollbarTrackClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (isScrollbarDragging.current || !scrollContainerRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickY = e.clientY - rect.top
    const ratio = Math.min(1, Math.max(0, clickY / rect.height))
    scrollContainerRef.current.scrollTop = ratio * maxEditorScroll
  }

  // Tooltip tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const hoverY = e.clientY - rect.top + minimapScrollTop
    const lineIdx = Math.min(totalLines - 1, Math.max(0, Math.floor(hoverY / PREVIEW_LINE_H)))
    const lineText = lines[lineIdx] ?? ''
    const info = lineInfos[lineIdx]

    setHoveredLine({
      lineIdx,
      y: e.clientY - rect.top,
      text: lineText.trim() || `(empty line ${lineIdx + 1})`,
      kind: info?.kind ?? 'context',
      hasError: Boolean(errorLines?.has(lineIdx + 1)),
      hasDeletion: Boolean(info?.gitDeletedCount || info?.gitDeletedTrailing)
    })
  }

  const handleMouseLeave = (): void => {
    setHoveredLine(null)
  }

  const symbolColor = (
    kind: CodeStructureSymbol['kind']
  ): { icon: JSX.Element; textClass: string } => {
    switch (kind) {
      case 'function':
        return {
          icon: <Braces className="h-3 w-3 text-purple-400 shrink-0" />,
          textClass: 'text-purple-300'
        }
      case 'class':
        return {
          icon: <Boxes className="h-3 w-3 text-amber-400 shrink-0" />,
          textClass: 'text-amber-300'
        }
      case 'interface':
        return {
          icon: <Tag className="h-3 w-3 text-sky-400 shrink-0" />,
          textClass: 'text-sky-300'
        }
      case 'heading':
        return {
          icon: <Hash className="h-3 w-3 text-indigo-400 shrink-0" />,
          textClass: 'text-indigo-300'
        }
      case 'hunk':
        return {
          icon: <GitCommit className="h-3 w-3 text-emerald-400 shrink-0" />,
          textClass: 'text-emerald-300'
        }
    }
  }

  return (
    <div
      className={cn(
        'flex w-36 shrink-0 flex-col border-l border-border bg-surface/40 select-none overflow-hidden text-xs',
        className
      )}
    >
      {/* Top Header Controls: Mode Selector (Icon-only) & Change Navigation */}
      <div className="flex flex-col border-b border-border bg-surface/70 px-1.5 py-1.5 gap-1.5 shrink-0">
        <div className="flex items-center justify-between gap-1">
          {/* View mode toggle tabs (icon-only, no text) */}
          <div className="flex items-center rounded-md bg-surface-2 p-0.5 border border-border/60">
            <button
              type="button"
              onClick={() => setMode('minimap')}
              title={t('ide.minimap')}
              aria-label={t('ide.minimap')}
              className={cn(
                'flex items-center justify-center h-6 w-6 rounded transition-colors',
                mode === 'minimap'
                  ? 'bg-elevated text-text shadow-sm'
                  : 'text-text-subtle hover:text-text'
              )}
            >
              <MapIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMode('outline')}
              title={t('ide.outline')}
              aria-label={t('ide.outline')}
              className={cn(
                'flex items-center justify-center h-6 w-6 rounded transition-colors',
                mode === 'outline'
                  ? 'bg-elevated text-text shadow-sm'
                  : 'text-text-subtle hover:text-text'
              )}
            >
              <ListTree className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Quick Hunk Navigation Buttons if changes exist */}
          {hunks.length > 0 && (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handlePrevChange}
                title={t('ide.previousChange')}
                aria-label={t('ide.previousChange')}
                className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextChange}
                title={t('ide.nextChange')}
                aria-label={t('ide.nextChange')}
                className="press-scale flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Change summary badge */}
        {hunks.length > 0 ? (
          <div className="flex items-center justify-between text-[10px] text-text-subtle font-mono px-0.5">
            <span className="flex items-center gap-1 font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t('ide.changeCount', { count: hunks.length })}
            </span>
            <span>
              {currentHunkIdx + 1}/{hunks.length}
            </span>
          </div>
        ) : (
          <div className="text-[10px] text-text-subtle px-0.5 truncate font-mono">
            {totalLines} lines
          </div>
        )}
      </div>

      {/* Main Body: Two Columns: [Left: Minimap/Outline] + [Right: Editor Scrollbar] */}
      <div className="flex flex-1 min-h-0 min-w-0 flex-row overflow-hidden">
        {/* Left Column: Minimap View */}
        {mode === 'minimap' && (
          <div
            ref={containerRef}
            onWheel={handleWheel}
            onClick={handleMinimapClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="relative min-h-0 flex-1 cursor-pointer overflow-hidden bg-[#09090b]/80"
          >
            {/* Scrollable canvas layer with constant line spacing */}
            <div
              style={{
                transform: `translateY(-${minimapScrollTop}px)`,
                height: `${totalContentHeight}px`,
                position: 'relative',
                willChange: 'transform'
              }}
            >
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: `${totalContentHeight}px` }}
                className="pointer-events-none block"
              />

              {/* Viewport Box overlay showing active editor view */}
              <div
                style={{
                  top: `${sliderTop}px`,
                  height: `${sliderHeight}px`
                }}
                onPointerDown={handleMinimapSliderPointerDown}
                onPointerMove={handleMinimapSliderPointerMove}
                onPointerUp={handleMinimapSliderPointerUp}
                className="absolute inset-x-0 z-10 cursor-grab active:cursor-grabbing border-y border-accent/40 bg-white/5 hover:bg-white/10 transition-colors shadow-sm"
              />
            </div>

            {/* Hover preview tooltip */}
            {hoveredLine && (
              <div
                style={{
                  top: `${Math.max(8, Math.min(containerHeight - 48, hoveredLine.y - 20))}px`
                }}
                className="pointer-events-none absolute right-full mr-2 z-30 w-52 rounded-md border border-border bg-surface/95 p-2 shadow-2xl backdrop-blur-md text-[11px]"
              >
                <div className="flex items-center justify-between border-b border-border/60 pb-1 mb-1 font-mono text-[10px] text-text-subtle">
                  <span>Line {hoveredLine.lineIdx + 1}</span>
                  {hoveredLine.kind === 'added' ? (
                    <span className="font-semibold text-emerald-400">+ Added</span>
                  ) : hoveredLine.hasDeletion || hoveredLine.kind === 'deleted' ? (
                    <span className="font-semibold text-rose-400">- Removed</span>
                  ) : hoveredLine.hasError ? (
                    <span className="font-semibold text-danger">! Error</span>
                  ) : null}
                </div>
                <div className="truncate font-mono text-[11px] text-text">{hoveredLine.text}</div>
              </div>
            )}
          </div>
        )}

        {/* Left Column: Structural Outline View */}
        {mode === 'outline' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-1 divide-y divide-border/20">
            {symbols.length > 0 ? (
              symbols.map((sym) => {
                const isHunk = sym.kind === 'hunk'
                const { icon, textClass } = symbolColor(sym.kind)
                return (
                  <button
                    key={sym.id}
                    type="button"
                    onClick={() => onScrollToLine(sym.lineIdx)}
                    style={{ paddingLeft: `${Math.min(20, 4 + sym.indent * 3)}px` }}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded py-1.5 pr-1.5 text-left text-[11px] transition-colors group',
                      isHunk ? 'bg-emerald-500/10 hover:bg-emerald-500/20' : 'hover:bg-white/5'
                    )}
                  >
                    {icon}
                    <span className={cn('truncate flex-1 font-mono text-[10px]', textClass)}>
                      {sym.name}
                    </span>
                    <span className="shrink-0 text-[9px] font-mono text-text-subtle group-hover:text-text">
                      :{sym.lineIdx + 1}
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="p-3 text-center text-[11px] text-text-subtle">
                {t('ide.noSymbolsFound')}
              </div>
            )}
          </div>
        )}

        {/* Right Column: Code Editor Scrollbar on the FAR RIGHT of the preview */}
        <div
          ref={scrollbarTrackRef}
          onClick={handleScrollbarTrackClick}
          onWheel={handleWheel}
          className="w-3.5 shrink-0 border-l border-border/40 bg-surface/20 hover:bg-surface/40 transition-colors relative cursor-pointer"
        >
          {/* Agent change tick marks in scrollbar track */}
          {hunks.map((hunk) => {
            const topPct = (hunk.startLineIdx / totalLines) * 100
            const heightPct = Math.max(
              1,
              ((hunk.endLineIdx - hunk.startLineIdx + 1) / totalLines) * 100
            )
            const isAddedOnly = hunk.deletedCount === 0
            return (
              <div
                key={hunk.id}
                style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                className={cn(
                  'absolute inset-x-0 pointer-events-none opacity-80',
                  isAddedOnly ? 'bg-emerald-500' : 'bg-rose-500'
                )}
              />
            )
          })}

          {/* Syntax error ticks */}
          {errorLines &&
            Array.from(errorLines).map((lineNum) => (
              <div
                key={lineNum}
                style={{ top: `${((lineNum - 1) / totalLines) * 100}%` }}
                className="absolute inset-x-0 h-1 bg-danger pointer-events-none z-10"
              />
            ))}

          {/* Interactive Scrollbar Thumb */}
          <div
            style={{
              top: `${scrollbarThumbTop}px`,
              height: `${scrollbarThumbHeight}px`
            }}
            onPointerDown={handleScrollbarPointerDown}
            onPointerMove={handleScrollbarPointerMove}
            onPointerUp={handleScrollbarPointerUp}
            className="absolute inset-x-0.5 rounded-full bg-border hover:bg-text-subtle/50 active:bg-accent/80 cursor-grab active:cursor-grabbing transition-colors z-20"
          />
        </div>
      </div>
    </div>
  )
}
