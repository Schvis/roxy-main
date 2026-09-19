import { diffArrays } from 'diff'
import type { Message, MessagePart, ToolDiff } from '@shared/types'
import { api } from './api'

export type FileReviewStatus = 'pending' | 'kept' | 'undone'

export interface AgentFileChange {
  path: string
  fileName: string
  initialBefore: string
  latestAfter: string
  addedLines: number
  removedLines: number
  changedLines: number
  isCreated: boolean
  isDeleted: boolean
  isModified: boolean
  isLatestTurn: boolean
  tools: string[]
  reviewStatus?: FileReviewStatus
}

export interface AgentFileChangesSummary {
  files: AgentFileChange[]
  latestTurnFiles: AgentFileChange[]
  pendingFiles: AgentFileChange[]
  totalFiles: number
  pendingCount: number
  createdCount: number
  deletedCount: number
  modifiedCount: number
  totalAdded: number
  totalRemoved: number
  totalChanged: number
  changeKey: string
}

function toLines(text: string): string[] {
  if (!text) return []
  return text.split(/\r?\n/)
}

const statsCache = new Map<
  string,
  { added: number; removed: number; isCreated: boolean; isDeleted: boolean; isModified: boolean }
>()

function getLineStats(
  path: string,
  before: string,
  after: string
): { added: number; removed: number; isCreated: boolean; isDeleted: boolean; isModified: boolean } {
  const cacheKey = `${path}:${before.length}:${after.length}:${before.slice(0, 40)}:${after.slice(0, 40)}`
  const cached = statsCache.get(cacheKey)
  if (cached) return cached

  const isCreated = !before && Boolean(after)
  const isDeleted = Boolean(before) && !after

  if (isCreated) {
    const lines = toLines(after)
    const res = {
      added: lines.length,
      removed: 0,
      isCreated: true,
      isDeleted: false,
      isModified: false
    }
    statsCache.set(cacheKey, res)
    return res
  }

  if (isDeleted) {
    const lines = toLines(before)
    const res = {
      added: 0,
      removed: lines.length,
      isCreated: false,
      isDeleted: true,
      isModified: false
    }
    statsCache.set(cacheKey, res)
    return res
  }

  if (before === after) {
    const res = {
      added: 0,
      removed: 0,
      isCreated: false,
      isDeleted: false,
      isModified: true
    }
    statsCache.set(cacheKey, res)
    return res
  }

  const bLines = toLines(before)
  const aLines = toLines(after)
  let added = 0
  let removed = 0

  try {
    const changes = diffArrays(bLines, aLines, { timeout: 40, maxEditLength: 4096 })
    if (changes) {
      for (const c of changes) {
        if (c.added) added += c.value.length
        if (c.removed) removed += c.value.length
      }
    } else {
      added = aLines.length
      removed = bLines.length
    }
  } catch {
    added = aLines.length
    removed = bLines.length
  }

  const res = {
    added,
    removed,
    isCreated: false,
    isDeleted: false,
    isModified: true
  }
  statsCache.set(cacheKey, res)
  return res
}

export function normalizeFilePath(p: string): string {
  if (!p) return ''
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

export function pathsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  const normA = normalizeFilePath(a).toLowerCase()
  const normB = normalizeFilePath(b).toLowerCase()
  if (normA === normB) return true
  if (normA.endsWith('/' + normB) || normB.endsWith('/' + normA)) return true
  return false
}

interface RawDiffEntry {
  path: string
  diff: ToolDiff
  tool: string
  isLatestTurn: boolean
}

function extractDiffsFromParts(
  parts: MessagePart[] | null | undefined,
  isLatestTurn: boolean
): RawDiffEntry[] {
  if (!parts) return []
  const result: RawDiffEntry[] = []

  for (const part of parts) {
    if (part.type === 'tool') {
      if (part.diff && part.diff.path) {
        result.push({
          path: normalizeFilePath(part.diff.path),
          diff: part.diff,
          tool: part.tool,
          isLatestTurn
        })
      }
      if (part.children) {
        result.push(...extractDiffsFromParts(part.children, isLatestTurn))
      }
    }
  }

  return result
}

const REVIEW_STORAGE_KEY = 'roxy.file_review_statuses'

interface PersistedReviewEntry {
  status: FileReviewStatus
  afterSignature?: string
}

function computeSignature(after?: string): string {
  if (after === undefined || after === null) return ''
  const normalized = after.replace(/\r\n/g, '\n')
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i)
    hash |= 0
  }
  return `${normalized.length}:${hash}`
}

function loadPersistedReviews(): Map<string, PersistedReviewEntry> {
  const map = new Map<string, PersistedReviewEntry>()
  if (typeof localStorage === 'undefined') return map
  try {
    const raw = localStorage.getItem(REVIEW_STORAGE_KEY)
    if (!raw) return map
    const parsed = JSON.parse(raw) as Record<string, PersistedReviewEntry | FileReviewStatus>
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'string') {
        map.set(key, { status: val as FileReviewStatus })
      } else if (val && typeof val.status === 'string') {
        map.set(key, val)
      }
    }
  } catch (err) {
    console.warn('Failed to load file review statuses from localStorage', err)
  }
  return map
}

function savePersistedReviews(map: Map<string, PersistedReviewEntry>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const entries = Array.from(map.entries())
    const trimmed = entries.length > 500 ? entries.slice(entries.length - 500) : entries
    const obj: Record<string, PersistedReviewEntry> = {}
    for (const [key, val] of trimmed) {
      obj[key] = val
    }
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(obj))
  } catch (err) {
    console.warn('Failed to save file review statuses to localStorage', err)
  }
}

const reviewStatusMap = loadPersistedReviews()
const reviewListeners = new Set<() => void>()

type DraftReverter = (sessionId: string, path: string, content?: string) => void
let draftReverter: DraftReverter | null = null

export function registerDraftReverter(fn: DraftReverter): () => void {
  draftReverter = fn
  return () => {
    if (draftReverter === fn) draftReverter = null
  }
}

export function revertEditorDraft(sessionId: string, path: string, content?: string): void {
  draftReverter?.(sessionId, path, content)
}

export function getPersistedReview(
  sessionId: string,
  path: string
): PersistedReviewEntry | undefined {
  for (const [key, entry] of reviewStatusMap.entries()) {
    const [sId, ...rest] = key.split(':')
    const storedPath = rest.join(':')
    if (sId === sessionId && pathsMatch(storedPath, path)) {
      return entry
    }
  }
  return undefined
}

export function getFileReviewStatus(
  sessionId: string,
  path: string,
  latestAfter?: string
): FileReviewStatus {
  const expectedSig = latestAfter !== undefined ? computeSignature(latestAfter) : undefined
  for (const [key, entry] of reviewStatusMap.entries()) {
    const [sId, ...rest] = key.split(':')
    const storedPath = rest.join(':')
    if (sId === sessionId && pathsMatch(storedPath, path)) {
      if (expectedSig && entry.afterSignature && entry.afterSignature !== expectedSig) {
        continue
      }
      return entry.status
    }
  }
  return 'pending'
}

export function setFileReviewStatus(
  sessionId: string,
  path: string,
  status: FileReviewStatus,
  latestAfter?: string
): void {
  for (const key of Array.from(reviewStatusMap.keys())) {
    const [sId, ...rest] = key.split(':')
    const storedPath = rest.join(':')
    if (sId === sessionId && pathsMatch(storedPath, path)) {
      reviewStatusMap.delete(key)
    }
  }
  const afterSignature = latestAfter !== undefined ? computeSignature(latestAfter) : undefined
  reviewStatusMap.set(`${sessionId}:${normalizeFilePath(path)}`, { status, afterSignature })
  savePersistedReviews(reviewStatusMap)
  reviewListeners.forEach((fn) => fn())
}

export function subscribeFileReviews(listener: () => void): () => void {
  reviewListeners.add(listener)
  return () => {
    reviewListeners.delete(listener)
  }
}

export async function undoFileChange(
  sessionId: string,
  change: AgentFileChange,
  onReverted?: () => void
): Promise<boolean> {
  try {
    if (change.isCreated) {
      await api.files.delete(sessionId, change.path)
      revertEditorDraft(sessionId, change.path)
    } else {
      const readResult = await api.files.read(sessionId, change.path)
      if (readResult && readResult.revision !== null) {
        await api.files.write(sessionId, change.path, change.initialBefore, readResult.revision)
      }
      revertEditorDraft(sessionId, change.path)
    }
    setFileReviewStatus(sessionId, change.path, 'undone', change.latestAfter)
    onReverted?.()
    return true
  } catch (err) {
    console.error('Failed to undo file change', err)
    return false
  }
}

export function keepFileChange(sessionId: string, path: string, latestAfter?: string): void {
  setFileReviewStatus(sessionId, path, 'kept', latestAfter)
  revertEditorDraft(sessionId, path)
}

export async function undoAllFileChanges(
  sessionId: string,
  changes: AgentFileChange[],
  onReverted?: () => void
): Promise<boolean> {
  let ok = true
  for (const c of changes) {
    if (c.reviewStatus === 'undone') continue
    const res = await undoFileChange(sessionId, c, onReverted)
    if (!res) ok = false
  }
  return ok
}

export function keepAllFileChanges(sessionId: string, changes: AgentFileChange[]): void {
  for (const c of changes) {
    keepFileChange(sessionId, c.path, c.latestAfter)
  }
}

export function extractAgentFileChanges(
  messages: Message[],
  streaming: MessagePart[] | null,
  sessionId?: string
): AgentFileChangesSummary {
  const rawDiffs: RawDiffEntry[] = []

  // Check which message index represents the latest assistant response with diffs
  let latestTurnIndex = -1
  if (streaming && streaming.length > 0) {
    latestTurnIndex = messages.length // Streaming is the latest
  } else {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.parts) {
        const hasDiff = msg.parts.some(
          (p) =>
            p.type === 'tool' &&
            (Boolean(p.diff) || p.children?.some((c) => c.type === 'tool' && Boolean(c.diff)))
        )
        if (hasDiff) {
          latestTurnIndex = i
          break
        }
      }
    }
  }

  // Collect from messages
  messages.forEach((msg, idx) => {
    if (msg.role !== 'assistant') return
    const isLatest = idx === latestTurnIndex
    rawDiffs.push(...extractDiffsFromParts(msg.parts, isLatest))
  })

  // Collect from streaming turn
  if (streaming) {
    rawDiffs.push(...extractDiffsFromParts(streaming, true))
  }

  if (rawDiffs.length === 0) {
    return {
      files: [],
      latestTurnFiles: [],
      pendingFiles: [],
      totalFiles: 0,
      pendingCount: 0,
      createdCount: 0,
      deletedCount: 0,
      modifiedCount: 0,
      totalAdded: 0,
      totalRemoved: 0,
      totalChanged: 0,
      changeKey: ''
    }
  }

  // Group diffs by normalized path maintaining chronological order
  const diffsByPath = new Map<
    string,
    {
      path: string
      fileName: string
      items: RawDiffEntry[]
    }
  >()

  for (const item of rawDiffs) {
    let matchedKey: string | undefined
    for (const key of diffsByPath.keys()) {
      if (pathsMatch(key, item.path)) {
        matchedKey = key
        break
      }
    }
    const targetKey = matchedKey ?? item.path
    const existing = diffsByPath.get(targetKey)
    if (!existing) {
      const fileName = item.path.split(/[/\\]/).pop() || item.path
      diffsByPath.set(targetKey, {
        path: item.path,
        fileName,
        items: [item]
      })
    } else {
      existing.items.push(item)
    }
  }

  const files: AgentFileChange[] = []
  let totalAdded = 0
  let totalRemoved = 0
  let createdCount = 0
  let deletedCount = 0
  let modifiedCount = 0

  for (const group of diffsByPath.values()) {
    const items = group.items
    const overallLatestAfter = items[items.length - 1].diff.after

    // Check if user has an existing review status for this file
    const review = sessionId ? getPersistedReview(sessionId, group.path) : undefined

    let initialBefore = items[0].diff.before
    let latestAfter = overallLatestAfter
    let reviewStatus: FileReviewStatus = 'pending'
    let isLatestTurn = items.some((it) => it.isLatestTurn)
    let tools = new Set(items.map((it) => it.tool))

    if (review && review.status === 'kept') {
      if (review.afterSignature) {
        if (computeSignature(overallLatestAfter) === review.afterSignature) {
          // The current latest state of this file has already been kept by the user
          reviewStatus = 'kept'
          initialBefore = items[0].diff.before
          latestAfter = overallLatestAfter
        } else {
          // Find the most recent boundary that matches the kept signature
          let foundBaseline: string | null = null
          let newStartIndex = -1

          for (let i = items.length - 1; i >= 0; i--) {
            if (i > 0 && computeSignature(items[i].diff.before) === review.afterSignature) {
              foundBaseline = items[i].diff.before
              newStartIndex = i
              break
            }
            if (computeSignature(items[i].diff.after) === review.afterSignature) {
              foundBaseline = items[i].diff.after
              newStartIndex = i + 1
              break
            }
          }

          if (foundBaseline !== null && newStartIndex >= 0 && newStartIndex < items.length) {
            initialBefore = foundBaseline
            latestAfter = overallLatestAfter
            reviewStatus = 'pending'
            const newItems = items.slice(newStartIndex)
            tools = new Set(newItems.map((it) => it.tool))
            isLatestTurn = newItems.some((it) => it.isLatestTurn)
          } else {
            reviewStatus = 'pending'
            initialBefore = items[0].diff.before
            latestAfter = overallLatestAfter
          }
        }
      } else {
        reviewStatus = 'kept'
      }
    } else if (review && review.status === 'undone') {
      if (review.afterSignature && computeSignature(overallLatestAfter) === review.afterSignature) {
        reviewStatus = 'undone'
      } else {
        reviewStatus = 'pending'
      }
    }

    const stats = getLineStats(group.path, initialBefore, latestAfter)
    const changedLines = stats.added + stats.removed

    if (initialBefore === latestAfter) continue

    // If previously kept and net change since kept is zero, retain kept status
    if (
      reviewStatus === 'pending' &&
      review?.status === 'kept' &&
      changedLines === 0 &&
      !stats.isCreated &&
      !stats.isDeleted
    ) {
      reviewStatus = 'kept'
    }

    if (reviewStatus === 'pending') {
      totalAdded += stats.added
      totalRemoved += stats.removed
      if (stats.isCreated) createdCount++
      else if (stats.isDeleted) deletedCount++
      else if (stats.isModified) modifiedCount++
    }

    files.push({
      path: group.path,
      fileName: group.fileName,
      initialBefore,
      latestAfter,
      addedLines: stats.added,
      removedLines: stats.removed,
      changedLines,
      isCreated: stats.isCreated,
      isDeleted: stats.isDeleted,
      isModified: stats.isModified,
      isLatestTurn,
      tools: Array.from(tools),
      reviewStatus
    })
  }

  const latestTurnFiles = files.filter((f) => f.isLatestTurn)
  const pendingFiles = files.filter((f) => f.reviewStatus === 'pending')
  const pendingCount = pendingFiles.length
  const changeKey = files
    .map(
      (f) => `${f.path}:${f.addedLines}:${f.removedLines}:${f.latestAfter.length}:${f.reviewStatus}`
    )
    .join('|')

  return {
    files,
    latestTurnFiles,
    pendingFiles,
    totalFiles: files.length,
    pendingCount,
    createdCount,
    deletedCount,
    modifiedCount,
    totalAdded,
    totalRemoved,
    totalChanged: totalAdded + totalRemoved,
    changeKey
  }
}
