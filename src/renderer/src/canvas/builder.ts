/**
 * The layout builder — a small imperative API for emitting scene nodes.
 *
 * Layout code reads as a sequence of "put this here, advance the cursor", which
 * is what a block layout actually is. Keeping that in one object means every
 * block shares the same rules for hit regions, selection indices and clipping,
 * instead of each one hand-rolling geometry and getting the edge cases subtly
 * different.
 */

import type { Block, HitAction, HitRegion, Node, Rect, ScrollRegion, SelectableLine } from './scene'
import type { Font, TextRun, WrappedLine } from './text'
import { TextMetrics, wrapSpans, type InlineSpan } from './text'
import type { IconName } from './icons'
import type { CanvasTheme } from './theme'
import type { TFunction } from 'i18next'
import { linkUrl } from './links'

export class Builder {
  readonly metrics: TextMetrics
  readonly theme: CanvasTheme
  /**
   * The translator, threaded through rather than looked up.
   *
   * Layout runs in plain functions, not components, so `useTranslation` is not
   * available to it — and it must not be, because a hook here would tie the
   * whole layout tree to React's render phase. The transcript resolves `t` once
   * and hands it down (the pattern the rest of the app already uses for
   * module-scope helpers; see `Sidebar.tsx`).
   */
  readonly t: TFunction
  private readonly nodes: Node[] = []
  private readonly regions: HitRegion[] = []
  private readonly selectable: SelectableLine[] = []
  private readonly scrollRegions: ScrollRegion[] = []
  private clipRect: Rect | undefined
  /** Where nodes are appended — swapped while filling a clip's children. */
  private target: Node[] = this.nodes
  private lineCounter: { value: number }
  private animated = false

  constructor(
    metrics: TextMetrics,
    theme: CanvasTheme,
    lineCounter: { value: number },
    t: TFunction,
    readonly botUsernames: readonly string[] = []
  ) {
    this.metrics = metrics
    this.theme = theme
    this.lineCounter = lineCounter
    this.t = t
  }

  get palette(): CanvasTheme['palette'] {
    return this.theme.palette
  }

  push(node: Node): void {
    this.target.push(node)
  }

  /**
   * Reserve a place in the paint order and fill it later.
   *
   * A card's frame has to be painted BEFORE its contents but can only be
   * measured AFTER them — its height is the height of whatever went inside. So
   * layout emits a placeholder, lays the body out, then patches the placeholder
   * with the real rect. Appending the frame at the end and relying on the
   * painter to sort would be the alternative; this keeps paint order literal,
   * which is much easier to reason about when something draws in the wrong
   * place.
   */
  slot(): (node: Node) => void {
    const placeholder: Node = { kind: 'group', children: [] }
    this.target.push(placeholder)
    return (node: Node): void => {
      // Mutating in place keeps the array index stable, which is what makes the
      // reservation work at all.
      Object.assign(placeholder, { kind: 'group', children: [node] })
    }
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    fill?: string,
    border?: string
  ): void {
    this.push({ kind: 'rect', x, y, w, h, radius, fill, border })
  }

  hairline(x: number, y: number, w: number, color: string): void {
    this.push({ kind: 'hairline', x, y, w, color })
  }

  vrule(x: number, y: number, h: number, color: string, w = 1): void {
    this.push({ kind: 'vrule', x, y, h, w, color })
  }

  /**
   * A single unwrapped string. Returns its width so callers can lay out a row
   * left to right without re-measuring.
   */
  text(
    x: number,
    y: number,
    text: string,
    font: Font,
    color: string,
    opts: { align?: 'left' | 'right' | 'center'; maxWidth?: number } = {}
  ): number {
    let value = text
    let width = this.metrics.measure(text, font)
    if (opts.maxWidth !== undefined && width > opts.maxWidth) {
      const cut = this.metrics.ellipsize(text, font, opts.maxWidth)
      value = cut.text
      width = cut.width
    }
    this.push({
      kind: 'text',
      x,
      y,
      text: value,
      font,
      color,
      align: opts.align,
      maxWidth: opts.maxWidth
    })
    return width
  }

  icon(
    x: number,
    y: number,
    size: number,
    name: IconName,
    color: string,
    opts: { rotate?: number; opacity?: number } = {}
  ): void {
    this.push({ kind: 'icon', x, y, size, name, color, ...opts })
  }

  /** Filled icon — the cancel button's `fill-current` stop square. */
  iconFill(x: number, y: number, size: number, name: IconName, color: string): void {
    this.push({ kind: 'iconFill', x, y, size, name, color })
  }

  /**
   * Wrap styled spans into a column and emit them, registering each line as
   * selectable. Returns the height consumed.
   */
  paragraph(
    spans: InlineSpan[],
    x: number,
    y: number,
    maxWidth: number,
    opts: { lineGap?: number; selectable?: boolean } = {}
  ): number {
    const { lines, height } = wrapSpans(spans, maxWidth, this.metrics, opts.lineGap ?? 0)
    this.lines(x, y, lines, opts.selectable !== false)
    return height
  }

  /** Emit pre-wrapped lines (used when a caller wrapped them itself). */
  lines(x: number, y: number, lines: WrappedLine[], selectable = true): void {
    this.push({ kind: 'lines', x, y, lines })
    for (const line of lines) {
      for (const run of line.runs) {
        if (run.file) {
          this.region(
            x + run.x,
            y + line.y,
            run.width,
            line.height,
            { type: 'file', path: run.file.path, line: run.file.line },
            {
              hover: 'subtle',
              title: run.file.line ? `${run.file.path}:${run.file.line}` : run.file.path
            }
          )
        } else {
          const href = run.href && linkUrl(run.href)
          if (href)
            this.region(
              x + run.x,
              y + line.y,
              run.width,
              line.height,
              { type: 'link', href },
              { title: href }
            )
        }
      }
    }
    if (selectable) this.registerLines(lines, x, y)
  }

  /**
   * Make wrapped lines selectable.
   *
   * `breakAfter` is set on the LAST line only: a wrapped paragraph is one
   * logical line, so copying a selection that spans it must not insert the
   * breaks the wrapper happened to choose at this window width.
   */
  registerLines(lines: WrappedLine[], x: number, y: number): void {
    lines.forEach((line, i) => {
      this.selectable.push({
        index: this.lineCounter.value++,
        x,
        y: y + line.y,
        height: line.height,
        runs: line.runs,
        text: line.runs.map((r) => r.text).join(''),
        breakAfter: line.breakAfter || i === lines.length - 1,
        clip: this.clipRect
      })
    })
  }

  /**
   * Register one already-positioned row of runs as selectable — for code,
   * terminal output and diffs, where lines are laid out by the block itself and
   * every row is a real line break.
   */
  selectableRow(
    x: number,
    y: number,
    height: number,
    runs: TextRun[],
    text: string,
    options: { clip?: Rect; group?: string; breakAfter?: boolean } = {}
  ): void {
    this.selectable.push({
      index: this.lineCounter.value++,
      x,
      y,
      height,
      runs,
      text,
      breakAfter: options.breakAfter ?? true,
      clip: options.clip ?? this.clipRect,
      group: options.group
    })
  }

  region(
    x: number,
    y: number,
    w: number,
    h: number,
    action: HitAction,
    opts: { hover?: HitRegion['hover']; cursor?: HitRegion['cursor']; title?: string } = {}
  ): void {
    if (this.clipRect) {
      const bounds = intersect({ x, y, w, h }, this.clipRect)
      x = bounds.x
      y = bounds.y
      w = bounds.w
      h = bounds.h
    }
    if (w <= 0 || h <= 0) return
    this.regions.push({
      x,
      y,
      w,
      h,
      action,
      hover: opts.hover ?? 'none',
      cursor: opts.cursor ?? 'pointer',
      title: opts.title
    })
  }

  /**
   * A small icon button in a box's corner that copies `text`.
   *
   * Anchored by its RIGHT edge so callers place it against a box's inner edge
   * without measuring. It paints an opaque backdrop because it sits over
   * content (a code row, a terminal line); the painter's copy feedback then
   * swaps the icon for a check in the same rect.
   *
   * Pass `bottom` — the box's lower edge — and on a tall box the button follows
   * the viewport down as you scroll past the top, stopping at that edge, so it
   * can be reached without scrolling back up. Callers must emit it AFTER the
   * box's content so it paints on top of whatever it slides over.
   */
  copyButton(
    right: number,
    y: number,
    text: string,
    title: string,
    background: string,
    size = COPY_BUTTON_SIZE,
    bottom?: number
  ): void {
    const x = right - size
    const iconSize = Math.min(14, size - 8)
    let slide = bottom === undefined ? 0 : Math.max(0, bottom - STICKY_GAP - (y + size))
    // Never slide out of an enclosing clip: the paint would vanish under it and
    // the hit region (clipped at its laid-out position) would no longer match.
    if (this.clipRect)
      slide = Math.min(slide, Math.max(0, this.clipRect.y + this.clipRect.h - y - size))
    // A short box is on screen whole or not at all; a few pixels of travel would
    // read as jitter, not as a button that follows you.
    if (slide < STICKY_MIN_SLIDE) slide = 0

    const children: Node[] = []
    const previous = this.target
    this.target = children
    this.rect(x, y, size, size, 4, background, this.palette.border)
    this.icon(
      x + (size - iconSize) / 2,
      y + (size - iconSize) / 2,
      iconSize,
      'copy',
      this.palette.textSubtle
    )
    this.target = previous
    if (slide) this.push({ kind: 'sticky', y, slide, children })
    else for (const child of children) this.push(child)

    const count = this.regions.length
    this.region(x, y, size, size, { type: 'copy', text }, { hover: 'subtle', title })
    // `region` drops a rect that a clip hides entirely, so only tag one it kept.
    if (slide && this.regions.length > count) this.regions[count].slide = slide
  }

  /** Paint, hit regions, and selections share the intersection of all parent clips. */
  clipped(x: number, y: number, w: number, h: number, radius: number, fill: () => void): void {
    const children: Node[] = []
    const previous = this.target
    const previousClip = this.clipRect
    this.clipRect = previousClip ? intersect(previousClip, { x, y, w, h }) : { x, y, w, h }
    this.target = children
    fill()
    this.target = previous
    this.clipRect = previousClip
    this.push({ kind: 'clip', x, y, w, h, radius, children })
  }

  scrollRegion(region: ScrollRegion): void {
    this.scrollRegions.push(region)
  }

  /** Wrap a subtree in a pulsing-opacity group. */
  pulsing(fill: () => void): void {
    const children: Node[] = []
    const previous = this.target
    this.target = children
    fill()
    this.target = previous
    this.push({ kind: 'pulse', children })
    this.animated = true
  }

  /** Mark this block as needing continuous repaint (spinners, live text). */
  animate(): void {
    this.animated = true
  }

  finish(id: string, y: number, height: number): Block {
    return {
      id,
      y,
      height,
      nodes: this.nodes,
      regions: this.regions,
      selectable: this.selectable,
      scrollRegions: this.scrollRegions,
      animated: this.animated
    }
  }
}

/** Side of the corner copy button. */
export const COPY_BUTTON_SIZE = 22
/** Width wrapped text gives up so its first line never runs under the button. */
export const COPY_BUTTON_RESERVE = COPY_BUTTON_SIZE + 6
/** Space a sliding copy button keeps from the bottom edge of its box. */
const STICKY_GAP = 6
/** Below this much travel a copy button just stays put. */
const STICKY_MIN_SLIDE = 48

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y)
  }
}
