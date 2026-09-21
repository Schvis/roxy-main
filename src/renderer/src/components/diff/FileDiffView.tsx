import { useEffect, useMemo, useState, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns, Rows, Eye, EyeOff } from 'lucide-react'
import {
  createDiffState,
  diffRows,
  type DiffViewState,
  type InlineChange,
  type SyntaxToken
} from './model'
import { highlightSource } from './syntax'
import { cn } from '../../lib/cn'

export interface FileDiffViewProps {
  path: string
  before: string
  after: string
  mode?: 'unified' | 'split'
  onModeChange?: (mode: 'unified' | 'split') => void
  showAll?: boolean
  onShowAllChange?: (showAll: boolean) => void
  hideToolbar?: boolean
  embedded?: boolean
}

function renderInlineHighlighted(
  text: string,
  ranges: InlineChange[] | undefined,
  tokenList: SyntaxToken[] | undefined,
  highlightBg: string,
  textColor?: string
): JSX.Element {
  if (!text) return <>{'\u200b'}</>

  // When inline word diff ranges exist, split text and highlight changed segments
  if (ranges && ranges.length > 0) {
    const nodes: JSX.Element[] = []
    let cursor = 0

    ranges.forEach((range, idx) => {
      if (range.start > cursor) {
        nodes.push(
          <span key={`plain-${idx}`} className={textColor}>
            {text.slice(cursor, range.start)}
          </span>
        )
      }
      nodes.push(
        <span
          key={`hl-${idx}`}
          className={cn(highlightBg, 'font-medium underline underline-offset-2')}
        >
          {text.slice(range.start, range.end)}
        </span>
      )
      cursor = range.end
    })

    if (cursor < text.length) {
      nodes.push(
        <span key="tail" className={textColor}>
          {text.slice(cursor)}
        </span>
      )
    }

    return <>{nodes}</>
  }

  // Fall back to syntax tokens if present
  if (tokenList && tokenList.length > 0) {
    return (
      <>
        {tokenList.map((token, i) => (
          <span
            key={i}
            style={
              token.dark || token.light
                ? ({
                    '--syntax-dark': token.dark,
                    '--syntax-light': token.light
                  } as CSSProperties)
                : undefined
            }
            className={textColor}
          >
            {token.text}
          </span>
        ))}
      </>
    )
  }

  return <span className={textColor}>{text}</span>
}

export function FileDiffView({
  path,
  before,
  after,
  mode: propMode,
  onModeChange,
  showAll: propShowAll,
  onShowAllChange,
  hideToolbar = false,
  embedded = false
}: FileDiffViewProps): JSX.Element {
  const { t } = useTranslation()
  const [internalMode, setInternalMode] = useState<'unified' | 'split'>('unified')
  const [internalShowAll, setInternalShowAll] = useState(true)

  const mode = propMode ?? internalMode
  const setMode = (m: 'unified' | 'split'): void => {
    setInternalMode(m)
    onModeChange?.(m)
  }

  const showAll = propShowAll ?? internalShowAll
  const setShowAll = (val: boolean | ((prev: boolean) => boolean)): void => {
    const nextVal = typeof val === 'function' ? val(showAll) : val
    setInternalShowAll(nextVal)
    onShowAllChange?.(nextVal)
  }

  const [expandedSections, setExpandedSections] = useState<Set<number>>(() => new Set())
  const [beforeSyntax, setBeforeSyntax] = useState<SyntaxToken[][] | null>(null)
  const [afterSyntax, setAfterSyntax] = useState<SyntaxToken[][] | null>(null)

  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)

  // Asynchronously compute syntax highlighting for before/after files
  useEffect(() => {
    let active = true
    if (before && before.length < 200_000) {
      void highlightSource(path, before)
        .then((tokens) => {
          if (active) setBeforeSyntax(tokens)
        })
        .catch(() => {
          if (active) setBeforeSyntax(null)
        })
    } else {
      setBeforeSyntax(null)
    }

    if (after && after.length < 200_000) {
      void highlightSource(path, after)
        .then((tokens) => {
          if (active) setAfterSyntax(tokens)
        })
        .catch(() => {
          if (active) setAfterSyntax(null)
        })
    } else {
      setAfterSyntax(null)
    }

    return () => {
      active = false
    }
  }, [path, before, after])

  const diffState: DiffViewState = useMemo(() => {
    const state = createDiffState(path, before, after)
    state.mode = mode
    state.showAll = showAll
    state.expanded = expandedSections
    return state
  }, [path, before, after, mode, showAll, expandedSections])

  const rows = useMemo(() => diffRows(diffState, 3), [diffState])

  const toggleSection = (sectionIndex: number): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionIndex)) {
        next.delete(sectionIndex)
      } else {
        next.add(sectionIndex)
      }
      return next
    })
  }

  const syncSplitScroll = (source: 'left' | 'right'): void => {
    if (source === 'left' && leftPaneRef.current && rightPaneRef.current) {
      rightPaneRef.current.scrollTop = leftPaneRef.current.scrollTop
      rightPaneRef.current.scrollLeft = leftPaneRef.current.scrollLeft
    } else if (source === 'right' && leftPaneRef.current && rightPaneRef.current) {
      leftPaneRef.current.scrollTop = rightPaneRef.current.scrollTop
      leftPaneRef.current.scrollLeft = rightPaneRef.current.scrollLeft
    }
  }

  return (
    <div className={cn('flex flex-col bg-bg text-xs', embedded ? 'min-h-fit' : 'min-h-0 flex-1')}>
      {/* Diff Controls Bar */}
      {!hideToolbar && (
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface/80 px-3 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-muted">{t('ide.diffTab')}:</span>
            <span className="flex items-center gap-1 font-mono text-[10px] tabular-nums">
              {diffState.document.added > 0 && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400 font-semibold">
                  +{diffState.document.added}
                </span>
              )}
              {diffState.document.removed > 0 && (
                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-400 font-semibold">
                  -{diffState.document.removed}
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Show all / collapse context */}
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              title={showAll ? t('ide.collapseContext') : t('ide.expandAll')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-0.5 transition-colors',
                showAll
                  ? 'bg-accent/20 text-accent font-medium'
                  : 'text-text-subtle hover:bg-surface-2 hover:text-text'
              )}
            >
              {showAll ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span>{showAll ? t('ide.collapseContext') : t('ide.expandAll')}</span>
            </button>

            {/* Mode switch: Unified vs Split */}
            <div className="flex items-center rounded border border-border bg-surface-2 p-0.5 ml-2">
              <button
                type="button"
                onClick={() => setMode('unified')}
                title={t('ide.unifiedDiff')}
                className={cn(
                  'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
                  mode === 'unified'
                    ? 'bg-surface text-text shadow-xs font-medium'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <Rows className="h-3 w-3" />
                <span>{t('ide.unifiedDiff')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('split')}
                title={t('ide.splitDiff')}
                className={cn(
                  'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
                  mode === 'split'
                    ? 'bg-surface text-text shadow-xs font-medium'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <Columns className="h-3 w-3" />
                <span>{t('ide.splitDiff')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diff content view */}
      {mode === 'unified' ? (
        <div
          className={cn(
            'flex min-h-0 flex-1 font-mono text-[12px] leading-5',
            embedded ? 'overflow-visible' : 'overflow-auto'
          )}
        >
          <table className="w-full border-collapse" style={{ tabSize: 4 }}>
            <tbody>
              {rows.map((row, idx) => {
                if (row.kind === 'gap') {
                  return (
                    <tr
                      key={`gap-${idx}`}
                      style={{ height: '20px' }}
                      onClick={() => toggleSection(row.section)}
                      className="cursor-pointer border-y border-border/50 bg-surface-2/60 hover:bg-surface-2 text-text-subtle text-[11px] transition-colors"
                    >
                      <td
                        colSpan={4}
                        className="py-0 px-4 text-center font-sans text-[11px] h-5 leading-5 select-none"
                      >
                        {t('ide.expandGap', { count: row.count })}
                      </td>
                    </tr>
                  )
                }

                const isDeleted = row.before !== null && row.after === null
                const isAdded = row.before === null && row.after !== null
                const isContext = !row.changed

                const beforeLineNum = row.before !== null ? row.before + 1 : ''
                const afterLineNum = row.after !== null ? row.after + 1 : ''

                const text = isDeleted
                  ? diffState.document.beforeLines[row.before!].text
                  : diffState.document.afterLines[row.after!].text

                const inlineRanges = isDeleted
                  ? diffState.document.inlineBefore.get(row.before!)
                  : isAdded
                    ? diffState.document.inlineAfter.get(row.after!)
                    : undefined

                const tokens = isDeleted ? beforeSyntax?.[row.before!] : afterSyntax?.[row.after!]

                return (
                  <tr
                    key={`line-${idx}`}
                    style={{ height: '20px' }}
                    className={cn(
                      'h-5 leading-5 border-l-2 transition-colors',
                      isDeleted &&
                        'border-rose-500 bg-rose-500/15 hover:bg-rose-500/20 text-rose-100',
                      isAdded &&
                        'border-emerald-500 bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-100',
                      isContext && 'border-transparent text-text hover:bg-white/2'
                    )}
                  >
                    {/* Line numbers gutter */}
                    <td className="w-11 h-5 leading-5 select-none border-r border-border/40 px-2 py-0 text-right font-mono text-[11px] text-text-subtle/80 tabular-nums align-top">
                      {beforeLineNum}
                    </td>
                    <td className="w-11 h-5 leading-5 select-none border-r border-border/40 px-2 py-0 text-right font-mono text-[11px] text-text-subtle/80 tabular-nums align-top">
                      {afterLineNum}
                    </td>

                    {/* Change sign indicator */}
                    <td
                      className={cn(
                        'w-5 h-5 leading-5 select-none text-center font-mono text-[11px] font-bold align-top',
                        isDeleted && 'text-rose-400',
                        isAdded && 'text-emerald-400',
                        isContext && 'text-transparent'
                      )}
                    >
                      {isDeleted ? '-' : isAdded ? '+' : ' '}
                    </td>

                    {/* Code text with green or red highlights */}
                    <td className="diff-code-cell">
                      {renderInlineHighlighted(
                        text,
                        inlineRanges,
                        tokens,
                        isDeleted
                          ? 'bg-rose-500/35 text-white'
                          : isAdded
                            ? 'bg-emerald-500/35 text-white'
                            : 'bg-transparent',
                        isDeleted ? 'text-rose-200' : isAdded ? 'text-emerald-200' : undefined
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Split view (side-by-side) */
        <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
          {/* Left: Old code / deletions (Red) */}
          <div
            ref={leftPaneRef}
            onScroll={() => syncSplitScroll('left')}
            className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5"
          >
            <div className="sticky top-0 z-10 border-b border-border/60 bg-surface px-2 py-1 text-[10px] font-semibold text-rose-400">
              {t('ide.oldCode')}
            </div>
            <table className="w-full border-collapse" style={{ tabSize: 4 }}>
              <tbody>
                {rows.map((row, idx) => {
                  if (row.kind === 'gap') {
                    return (
                      <tr
                        key={`sgap-${idx}`}
                        style={{ height: '20px' }}
                        onClick={() => toggleSection(row.section)}
                        className="cursor-pointer border-y border-border/50 bg-surface-2/60 text-text-subtle text-[11px]"
                      >
                        <td
                          colSpan={2}
                          className="py-0 px-4 text-center font-sans text-[11px] h-5 leading-5 select-none"
                        >
                          {t('ide.expandGap', { count: row.count })}
                        </td>
                      </tr>
                    )
                  }

                  const hasBefore = row.before !== null
                  const isDeleted = row.changed && hasBefore
                  const text = hasBefore ? diffState.document.beforeLines[row.before!].text : ''
                  const inlineRanges = hasBefore
                    ? diffState.document.inlineBefore.get(row.before!)
                    : undefined
                  const tokens = hasBefore ? beforeSyntax?.[row.before!] : undefined

                  return (
                    <tr
                      key={`sline-left-${idx}`}
                      style={{ height: '20px' }}
                      className={cn(
                        'h-5 leading-5 border-l-2',
                        isDeleted
                          ? 'border-rose-500 bg-rose-500/15 text-rose-100'
                          : hasBefore
                            ? 'border-transparent text-text'
                            : 'border-transparent bg-surface-2/30 text-transparent select-none'
                      )}
                    >
                      <td className="w-11 h-5 leading-5 select-none border-r border-border/40 px-2 py-0 text-right font-mono text-[11px] text-text-subtle/80 tabular-nums align-top">
                        {hasBefore ? row.before! + 1 : ''}
                      </td>
                      <td className="diff-code-cell">
                        {hasBefore ? (
                          renderInlineHighlighted(
                            text,
                            inlineRanges,
                            tokens,
                            'bg-rose-500/35 text-white',
                            isDeleted ? 'text-rose-200' : undefined
                          )
                        ) : (
                          <span className="invisible">{'\u200b'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Right: New code / additions (Green) */}
          <div
            ref={rightPaneRef}
            onScroll={() => syncSplitScroll('right')}
            className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5"
          >
            <div className="sticky top-0 z-10 border-b border-border/60 bg-surface px-2 py-1 text-[10px] font-semibold text-emerald-400">
              {t('ide.newCode')}
            </div>
            <table className="w-full border-collapse" style={{ tabSize: 4 }}>
              <tbody>
                {rows.map((row, idx) => {
                  if (row.kind === 'gap') {
                    return (
                      <tr
                        key={`sgap-r-${idx}`}
                        style={{ height: '20px' }}
                        onClick={() => toggleSection(row.section)}
                        className="cursor-pointer border-y border-border/50 bg-surface-2/60 text-text-subtle text-[11px]"
                      >
                        <td
                          colSpan={2}
                          className="py-0 px-4 text-center font-sans text-[11px] h-5 leading-5 select-none"
                        >
                          {t('ide.expandGap', { count: row.count })}
                        </td>
                      </tr>
                    )
                  }

                  const hasAfter = row.after !== null
                  const isAdded = row.changed && hasAfter
                  const text = hasAfter ? diffState.document.afterLines[row.after!].text : ''
                  const inlineRanges = hasAfter
                    ? diffState.document.inlineAfter.get(row.after!)
                    : undefined
                  const tokens = hasAfter ? afterSyntax?.[row.after!] : undefined

                  return (
                    <tr
                      key={`sline-right-${idx}`}
                      style={{ height: '20px' }}
                      className={cn(
                        'h-5 leading-5 border-l-2',
                        isAdded
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100'
                          : hasAfter
                            ? 'border-transparent text-text'
                            : 'border-transparent bg-surface-2/30 text-transparent select-none'
                      )}
                    >
                      <td className="w-11 h-5 leading-5 select-none border-r border-border/40 px-2 py-0 text-right font-mono text-[11px] text-text-subtle/80 tabular-nums align-top">
                        {hasAfter ? row.after! + 1 : ''}
                      </td>
                      <td className="diff-code-cell">
                        {hasAfter ? (
                          renderInlineHighlighted(
                            text,
                            inlineRanges,
                            tokens,
                            'bg-emerald-500/35 text-white',
                            isAdded ? 'text-emerald-200' : undefined
                          )
                        ) : (
                          <span className="invisible">{'\u200b'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
