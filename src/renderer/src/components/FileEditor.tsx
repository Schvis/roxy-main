import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code,
  Eye,
  Image as ImageIcon,
  Map as MapIcon,
  Replace,
  RotateCcw,
  Search,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { diffArrays } from 'diff'
import type { WorkspaceFileDiagnostic, WorkspaceFileEntry, WorkspaceFileRead } from '@shared/api'
import { resolveImageSrc } from '@shared/images'
import { api } from '../lib/api'
import { useRoxyStore } from '../lib/store'
import {
  extractAgentFileChanges,
  keepFileChange,
  subscribeFileReviews,
  registerDraftReverter,
  pathsMatch
} from '../lib/agent-file-changes'
import { useFileDiagnostics } from '../lib/useFileDiagnostics'
import type { SyntaxToken } from './diff/model'
import { cn } from '../lib/cn'
import { getFileIconDescriptor } from '../lib/file-icon'
import { CodePreviewRail } from './CodePreviewRail'
import { AudioPreview } from './AudioPreview'
import './FileEditor.css'

export interface AlignedEditorLine {
  kind: 'context' | 'added' | 'deleted'
  text: string
  deletedText?: string
  hunkId?: string
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|apng|tiff?)$/i
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|m4a|aac|opus|wma|weba)$/i

export function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.test(path)
}

export function isAudioFile(path: string): boolean {
  return AUDIO_EXTENSIONS.test(path)
}

export interface GroupedHunk {
  id: string
  startLineIdx: number
  endLineIdx: number
  deletedCount: number
  addedCount: number
}

export function computeAlignedEditorLines(before: string, after: string): AlignedEditorLine[] {
  const bLines = before ? before.split(/\r?\n/) : []
  const aLines = after ? after.split(/\r?\n/) : []

  if (bLines.length === 0 && aLines.length === 0) return []

  if (bLines.length === 0) {
    return aLines.map((line) => ({
      kind: 'added',
      text: line,
      hunkId: 'hunk-0'
    }))
  }
  if (aLines.length === 0) {
    return bLines.map((line) => ({
      kind: 'deleted',
      text: '',
      deletedText: line,
      hunkId: 'hunk-0'
    }))
  }

  let changes
  try {
    changes = diffArrays(bLines, aLines, { timeout: 100, maxEditLength: 8192 })
  } catch {
    return aLines.map((line) => ({
      kind: 'context',
      text: line
    }))
  }

  const result: AlignedEditorLine[] = []
  let hunkCounter = 0

  for (let i = 0; i < changes.length; i++) {
    const part = changes[i]
    if (!part.added && !part.removed) {
      for (const line of part.value) {
        result.push({
          kind: 'context',
          text: line
        })
      }
    } else if (part.removed) {
      const nextPart = i + 1 < changes.length && changes[i + 1].added ? changes[i + 1] : null
      const removedLines = part.value
      const addedLines = nextPart ? nextPart.value : []
      if (nextPart) i++

      const hunkId = `hunk-${hunkCounter++}`
      // Show all deleted lines as blank lines carrying the old text
      for (const remLine of removedLines) {
        result.push({
          kind: 'deleted',
          text: '',
          deletedText: remLine,
          hunkId
        })
      }
      // Show all added lines
      for (const addLine of addedLines) {
        result.push({
          kind: 'added',
          text: addLine,
          hunkId
        })
      }
    } else if (part.added) {
      const hunkId = `hunk-${hunkCounter++}`
      for (const line of part.value) {
        result.push({
          kind: 'added',
          text: line,
          hunkId
        })
      }
    }
  }

  return result
}

export interface EditorLineInfo {
  kind: 'context' | 'added' | 'deleted'
  deletedText?: string
  hunkId?: string
  gitDeletedCount?: number
  gitDeletedTrailing?: boolean
}

export function computeEditorLineInfos(
  before: string,
  currentText: string,
  isPendingChange: boolean
): EditorLineInfo[] {
  const curLines = currentText ? currentText.split('\n') : []
  if (curLines.length === 0) return []
  if (!isPendingChange || !before) {
    return curLines.map(() => ({ kind: 'context' }))
  }

  const bLines = before.split(/\r?\n/)
  let changes
  try {
    changes = diffArrays(bLines, curLines, { timeout: 100, maxEditLength: 8192 })
  } catch {
    return curLines.map(() => ({ kind: 'context' }))
  }

  const lineInfos: EditorLineInfo[] = []
  let hunkCounter = 0
  for (let i = 0; i < changes.length; i++) {
    const part = changes[i]
    if (!part.added && !part.removed) {
      for (let j = 0; j < part.value.length; j++) {
        lineInfos.push({ kind: 'context' })
      }
    } else if (part.removed) {
      const nextPart = i + 1 < changes.length && changes[i + 1].added ? changes[i + 1] : null
      const removedLines = part.value
      const addedLines = nextPart ? nextPart.value : []
      if (nextPart) i++

      const hunkId = `hunk-${hunkCounter++}`
      let remIdx = 0
      for (const addLine of addedLines) {
        if (addLine === '' && remIdx < removedLines.length) {
          lineInfos.push({
            kind: 'deleted',
            deletedText: removedLines[remIdx],
            hunkId
          })
          remIdx++
        } else {
          lineInfos.push({ kind: 'added', hunkId })
        }
      }
    } else if (part.added) {
      const hunkId = `hunk-${hunkCounter++}`
      for (let j = 0; j < part.value.length; j++) {
        lineInfos.push({ kind: 'added', hunkId })
      }
    }
  }

  while (lineInfos.length < curLines.length) {
    lineInfos.push({ kind: 'context' })
  }
  return lineInfos.slice(0, curLines.length)
}

function useFileSyntaxTokens(path: string, text: string): SyntaxToken[][] | null {
  const [result, setResult] = useState<{
    path: string
    text: string
    tokens: SyntaxToken[][] | null
  } | null>(null)
  useEffect(() => {
    if (text.length > 200_000 || text.split('\n').length > 5000) {
      setResult(null)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      void import('./diff/syntax')
        .then(({ highlightSource }) => highlightSource(path, text))
        .then((lines) => {
          if (current) setResult({ path, text, tokens: lines })
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [path, text])
  return result?.path === path ? result.tokens : null
}

function fitSyntaxTokensToLine(
  tokens: SyntaxToken[] | undefined,
  text: string
): SyntaxToken[] | null {
  if (!tokens?.length) return null
  const fitted: SyntaxToken[] = []
  let offset = 0

  for (const token of tokens) {
    if (offset >= text.length) break
    const tokenText = text.slice(offset, offset + token.text.length)
    if (tokenText) fitted.push({ ...token, text: tokenText })
    offset += token.text.length
  }

  if (offset < text.length) {
    const color = fitted.at(-1) ?? tokens.at(-1)
    fitted.push({ ...color, text: text.slice(offset) })
  }

  return fitted
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

type Draft = {
  text: string
  saved: string
  revision: string
  bom: string
  crlf: boolean
  pending: boolean
  error: 'writeError' | 'conflict' | null
  userEdited?: boolean
}
// Survives file/route/session switches and workspace refreshes. Never persist source to settings.
const drafts = new Map<string, Draft>()
const listeners = new Set<() => void>()
let version = 0
const notify = (): void => {
  version++
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function revertDraft(sessionId?: string, path?: string, _content?: string): void {
  for (const [key] of drafts.entries()) {
    try {
      const [sId, , p] = JSON.parse(key)
      if ((!sessionId || sId === sessionId) && (!path || pathsMatch(p, path))) {
        drafts.delete(key)
      }
    } catch {
      // ignore
    }
  }
  notify()
}

export function clearDraftForPath(filePath: string, root?: string): void {
  for (const [key] of drafts.entries()) {
    try {
      const [, r, p] = JSON.parse(key)
      if (pathsMatch(p, filePath) && (!root || pathsMatch(r, root))) {
        drafts.delete(key)
      }
    } catch {
      // ignore
    }
  }
  notify()
}

export function clearDraftsForRoot(root?: string): void {
  for (const [key] of drafts.entries()) {
    try {
      const [, r] = JSON.parse(key)
      if (!root || pathsMatch(r, root)) {
        drafts.delete(key)
      }
    } catch {
      // ignore
    }
  }
  notify()
}

export function clearDraftsForSession(sessionId?: string): void {
  for (const [key] of drafts.entries()) {
    try {
      const [sId] = JSON.parse(key)
      if (!sessionId || sId === sessionId) {
        drafts.delete(key)
      }
    } catch {
      // ignore
    }
  }
  notify()
}

registerDraftReverter(revertDraft)

window.addEventListener('beforeunload', (event) => {
  if (
    [...drafts.values()].some(
      (draft) => draft.pending || (Boolean(draft.userEdited) && draft.text !== draft.saved)
    )
  ) {
    event.preventDefault()
    event.returnValue = ''
  }
})

export function FileEditor({
  sessionId,
  root,
  entry,
  initialLine,
  onClose
}: {
  sessionId: string
  root: string
  entry: WorkspaceFileEntry
  initialLine?: number
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  useSyncExternalStore(subscribe, () => version)
  const path = entry.path
  const key = JSON.stringify([sessionId, root, path])
  const draft = drafts.get(key)
  const gutter = useRef<HTMLPreElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const overlay = useRef<HTMLPreElement>(null)
  const lineHighlightLayer = useRef<HTMLDivElement>(null)
  const readOnlyCode = useRef<HTMLPreElement>(null)
  const [showCodePreview, setShowCodePreview] = useState(true)
  const [file, setFile] = useState<WorkspaceFileRead | null>(null)
  const [readError, setReadError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [revertingThisFile, setRevertingThisFile] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [showFind, setShowFind] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const isImage = isImageFile(path)
  const isAudio = isAudioFile(path)
  const isSvg = /\.svg$/i.test(path)
  const [viewMode, setViewMode] = useState<'image' | 'code'>(isImage ? 'image' : 'code')
  const [zoom, setZoom] = useState(1)
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setViewMode(isImageFile(path) ? 'image' : 'code')
    setZoom(1)
    setImageDimensions(null)
    setImageError(false)
  }, [path])

  const imageSrc = useMemo(() => {
    if (!isImage) return null
    return resolveImageSrc(path, root)
  }, [isImage, path, root])

  const audioSrc = useMemo(() => {
    if (!isAudio) return null
    return resolveImageSrc(path, root)
  }, [isAudio, path, root])

  const activeImageSrc = useMemo(() => {
    if (isSvg && draft?.text) {
      return `data:image/svg+xml;utf8,${encodeURIComponent(draft.text)}`
    }
    return imageSrc
  }, [isSvg, draft?.text, imageSrc])

  const handleZoomIn = (): void => {
    setZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))
  }

  const handleZoomOut = (): void => {
    setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))
  }

  const handleResetZoom = (): void => {
    setZoom(1)
  }

  const handleWheel = (e: React.WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (e.deltaY < 0) {
        handleZoomIn()
      } else {
        handleZoomOut()
      }
    }
  }

  useEffect(() => {
    if (!showErrors) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowErrors(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowErrors(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showErrors])

  const text = draft?.text ?? (file?.binary ? '' : (file?.content.replace(/\r\n?/g, '\n') ?? ''))
  const lines = useMemo(() => text.split('\n'), [text])
  const diagnostics = useFileDiagnostics(sessionId, path, text, !!draft && !loading)
  const errorLines = useMemo(
    () => new Set(diagnostics.issues.map((issue) => issue.line)),
    [diagnostics.issues]
  )
  const focusIssue = (issue: WorkspaceFileDiagnostic): void => {
    const input = textarea.current
    if (!input) return
    input.focus()
    input.setSelectionRange(issue.start, issue.start + issue.length)
    input.scrollTop = Math.max(0, (issue.line - 1) * 20 - input.clientHeight / 2 + 16)
    // Match textarea font/tab metrics, including long lines and tabs.
    const measure = document.createElement('span')
    measure.className = 'file-editor-code'
    measure.style.cssText = 'position:absolute;visibility:hidden;padding:0;width:max-content'
    measure.textContent = text.slice(
      text.lastIndexOf('\n', Math.max(0, issue.start - 1)) + 1,
      issue.start
    )
    input.parentElement?.appendChild(measure)
    input.scrollLeft = Math.max(
      0,
      measure.getBoundingClientRect().width - input.clientWidth / 2 + 16
    )
    measure.remove()
    syncScroll()
  }

  const messages = useRoxyStore((s) => s.messages)
  const streaming = useRoxyStore((s) =>
    s.activeChatId === sessionId ? (s.streamingChats[sessionId] ?? null) : null
  )

  const [reviewNonce, setReviewNonce] = useState(0)

  const agentChange = useMemo(() => {
    const summary = extractAgentFileChanges(messages, streaming, sessionId)
    return summary.files.find((f) => pathsMatch(f.path, path)) ?? null
  }, [messages, streaming, sessionId, path, reviewNonce])

  const reviewStatus = agentChange ? agentChange.reviewStatus : 'none'

  const [activeAligned, setActiveAligned] = useState<AlignedEditorLine[] | null>(null)
  const hunkActionsLayer = useRef<HTMLDivElement>(null)

  // When agent changes arrive for this file with deletions, ensure blank lines are in draft.text
  const lastChangeKeyRef = useRef<string>('')
  useEffect(() => {
    if (agentChange && reviewStatus === 'pending' && draft) {
      const key = `${path}:${agentChange.path}:${agentChange.addedLines}:${agentChange.removedLines}:${agentChange.latestAfter.length}`
      const isRawAfter =
        draft.text === agentChange.latestAfter &&
        draft.text !== activeAligned?.map((l) => l.text).join('\n')
      if (lastChangeKeyRef.current !== key || isRawAfter || !activeAligned) {
        lastChangeKeyRef.current = key
        const initial = computeAlignedEditorLines(
          agentChange.initialBefore,
          agentChange.latestAfter
        )
        setActiveAligned(initial)
        const initialText = initial.map((l) => l.text).join('\n')
        if (draft.text !== initialText) {
          draft.text = initialText
          notify()
        }
      }
    } else if (!agentChange || reviewStatus !== 'pending') {
      setActiveAligned(null)
      lastChangeKeyRef.current = ''
      if (draft && !draft.userEdited && draft.text !== draft.saved) {
        draft.text = draft.saved
        notify()
      }
    }
  }, [agentChange, reviewStatus, draft, path])

  // Whether current workspace root is a git repository
  const [isGitFolder, setIsGitFolder] = useState<boolean>(false)
  // Fetch committed HEAD content from git for working-tree diff visual decorations
  const [gitHeadText, setGitHeadText] = useState<string | null>(null)

  const refreshGitHead = useCallback(() => {
    if (!root || !path) {
      setIsGitFolder(false)
      setGitHeadText(null)
      return
    }
    api.git
      .status(root)
      .then((st) => {
        if (!st.isRepo) {
          setIsGitFolder(false)
          setGitHeadText(null)
          return
        }
        setIsGitFolder(true)
        return api.git.fileDiff(root, path).then((res) => {
          if (res.ok && !res.isBinary) {
            setGitHeadText(res.before ? res.before.replace(/\r\n?/g, '\n') : '')
          } else {
            setGitHeadText(null)
          }
        })
      })
      .catch(() => {
        setIsGitFolder(false)
        setGitHeadText(null)
      })
  }, [root, path])

  useEffect(() => {
    refreshGitHead()
  }, [refreshGitHead, reloadNonce])

  useEffect(() => {
    return subscribeFileReviews(() => {
      setReviewNonce((n) => n + 1)
      refreshGitHead()
    })
  }, [refreshGitHead])

  const isModifiedVsGit = Boolean(isGitFolder && gitHeadText !== null && gitHeadText !== text)
  const hasUnsavedDraft = Boolean(draft && draft.text !== draft.saved)

  const handleRevertThisFile = async (): Promise<void> => {
    if (!window.confirm(t('git.revertFileConfirm', { path: entry.path }))) return
    setRevertingThisFile(true)
    try {
      const res = await api.git.revertFile(root, entry.path)
      if (res.ok) {
        clearDraftForPath(entry.path, root)
        setReloadNonce((n) => n + 1)
        refreshGitHead()
      }
    } catch {
      // ignore
    } finally {
      setRevertingThisFile(false)
    }
  }

  // Git diff is visual metadata. Keep typing responsive by updating it only after input settles.
  const diffText = useDebouncedValue(text, 250)
  const gitDiffInfo = useMemo(() => {
    if (!isGitFolder || activeAligned || gitHeadText === null) {
      return { addedLines: new Set<number>(), deletedMarkers: new Map<number, number>() }
    }
    if (gitHeadText === diffText) {
      return { addedLines: new Set<number>(), deletedMarkers: new Map<number, number>() }
    }

    const bLines = gitHeadText ? gitHeadText.split('\n') : []
    const cLines = diffText.split('\n')
    if (bLines.length > 5000 || cLines.length > 5000) {
      return { addedLines: new Set<number>(), deletedMarkers: new Map<number, number>() }
    }
    let changes
    try {
      changes = diffArrays(bLines, cLines, { timeout: 50, maxEditLength: 10000 })
    } catch {
      return { addedLines: new Set<number>(), deletedMarkers: new Map<number, number>() }
    }

    if (!changes) {
      return { addedLines: new Set<number>(), deletedMarkers: new Map<number, number>() }
    }

    const addedLines = new Set<number>()
    const deletedMarkers = new Map<number, number>()
    let curIdx = 0

    for (let i = 0; i < changes.length; i++) {
      const part = changes[i]
      if (!part.added && !part.removed) {
        curIdx += part.value.length
      } else if (part.removed) {
        const removedCount = part.value.length
        const nextPart = i + 1 < changes.length && changes[i + 1].added ? changes[i + 1] : null
        if (nextPart) {
          i++
          const addedCount = nextPart.value.length
          for (let j = 0; j < addedCount; j++) {
            addedLines.add(curIdx + j)
          }
          deletedMarkers.set(curIdx, removedCount)
          curIdx += addedCount
        } else {
          deletedMarkers.set(curIdx, removedCount)
        }
      } else if (part.added) {
        for (let j = 0; j < part.value.length; j++) {
          addedLines.add(curIdx + j)
        }
        curIdx += part.value.length
      }
    }

    return { addedLines, deletedMarkers }
  }, [activeAligned, gitHeadText, diffText, isGitFolder])

  const hunks = useMemo<GroupedHunk[]>(() => {
    if (!activeAligned) return []
    const result: GroupedHunk[] = []
    let curHunk: GroupedHunk | null = null

    for (let idx = 0; idx < activeAligned.length; idx++) {
      const line = activeAligned[idx]
      if (line.hunkId) {
        if (!curHunk || curHunk.id !== line.hunkId) {
          if (curHunk) result.push(curHunk)
          curHunk = {
            id: line.hunkId,
            startLineIdx: idx,
            endLineIdx: idx,
            deletedCount: line.kind === 'deleted' ? 1 : 0,
            addedCount: line.kind === 'added' ? 1 : 0
          }
        } else {
          curHunk.endLineIdx = idx
          if (line.kind === 'deleted') curHunk.deletedCount++
          if (line.kind === 'added') curHunk.addedCount++
        }
      } else if (curHunk) {
        result.push(curHunk)
        curHunk = null
      }
    }
    if (curHunk) result.push(curHunk)
    return result
  }, [activeAligned])

  const lineInfos: EditorLineInfo[] = useMemo(() => {
    if (activeAligned) {
      if (activeAligned.length === lines.length) {
        return activeAligned.map((item, idx) => {
          if (item.kind === 'deleted' && lines[idx] === '') {
            return {
              kind: 'deleted' as const,
              deletedText: item.deletedText,
              hunkId: item.hunkId
            }
          }
          if (item.kind === 'added') {
            return { kind: 'added' as const, hunkId: item.hunkId }
          }
          return { kind: 'context' as const }
        })
      }
      return computeEditorLineInfos(agentChange?.initialBefore ?? '', text, true)
    }

    const total = lines.length
    return lines.map((_, idx) => {
      const isAdded = gitDiffInfo.addedLines.has(idx)
      const deletedCount = gitDiffInfo.deletedMarkers.get(idx)
      const isTrailing = idx === total - 1 && gitDiffInfo.deletedMarkers.has(total)
      return {
        kind: isAdded ? ('added' as const) : ('context' as const),
        gitDeletedCount: deletedCount,
        gitDeletedTrailing: isTrailing
      }
    })
  }, [activeAligned, lines, agentChange, text, gitDiffInfo])

  const previewLines = useDebouncedValue(lines, 200)
  const previewLineInfos = useDebouncedValue(lineInfos, 200)
  const previewErrorLines = useDebouncedValue(errorLines, 200)

  const handleKeepHunk = (hunkId: string): void => {
    if (!activeAligned || !draft) return
    const nextAligned: AlignedEditorLine[] = []
    for (const line of activeAligned) {
      if (line.hunkId === hunkId) {
        if (line.kind === 'deleted') {
          continue
        }
        if (line.kind === 'added') {
          nextAligned.push({
            kind: 'context',
            text: line.text
          })
        }
      } else {
        nextAligned.push(line)
      }
    }
    setActiveAligned(nextAligned)
    const newText = nextAligned.map((l) => l.text).join('\n')
    draft.text = newText
    draft.userEdited = true
    notify()
    void save()

    const hasRemaining = nextAligned.some((l) => Boolean(l.hunkId))
    if (!hasRemaining && agentChange) {
      keepFileChange(sessionId, agentChange.path, newText)
      setActiveAligned(null)
      refreshGitHead()
    }
  }

  const handleRevertHunk = (hunkId: string): void => {
    if (!activeAligned || !draft) return
    const nextAligned: AlignedEditorLine[] = []
    for (const line of activeAligned) {
      if (line.hunkId === hunkId) {
        if (line.kind === 'deleted') {
          nextAligned.push({
            kind: 'context',
            text: line.deletedText ?? ''
          })
        }
      } else {
        nextAligned.push(line)
      }
    }
    setActiveAligned(nextAligned)
    const newText = nextAligned.map((l) => l.text).join('\n')
    draft.text = newText
    draft.userEdited = true
    notify()
    void save()

    const hasRemaining = nextAligned.some((l) => Boolean(l.hunkId))
    if (!hasRemaining && agentChange) {
      keepFileChange(sessionId, agentChange.path, newText)
      setActiveAligned(null)
      refreshGitHead()
    }
  }

  const syntaxTokens = useFileSyntaxTokens(path, text)

  const findMatches = useMemo(() => {
    if (!findQuery || !showFind) return []
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped
    let regex: RegExp
    try {
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
    } catch {
      return []
    }
    const matches: Array<{ start: number; end: number; line: number }> = []
    const lines = text.split('\n')
    let charOffset = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(line)) !== null) {
        matches.push({
          start: charOffset + m.index,
          end: charOffset + m.index + m[0].length,
          line: i + 1
        })
        if (m[0].length === 0) break
      }
      charOffset += line.length + 1
    }
    return matches
  }, [findQuery, caseSensitive, wholeWord, text, showFind])

  const jumpToMatch = (index: number): void => {
    if (!findMatches.length) return
    const clamped = (index + findMatches.length) % findMatches.length
    setCurrentMatchIndex(clamped)
    const match = findMatches[clamped]
    const input = textarea.current
    if (!input || !match) return
    input.focus()
    input.setSelectionRange(match.start, match.end)
    input.scrollTop = Math.max(0, (match.line - 1) * 20 - input.clientHeight / 2 + 16)
    syncScroll()
  }

  const nextMatch = (): void => jumpToMatch(currentMatchIndex + 1)
  const prevMatch = (): void => jumpToMatch(currentMatchIndex - 1)

  const openFind = (withReplace = false): void => {
    setShowFind(true)
    if (withReplace) {
      setShowReplace(true)
    }
    const input = textarea.current
    if (input) {
      const start = input.selectionStart
      const end = input.selectionEnd
      if (end > start && end - start < 100) {
        const selected = input.value.slice(start, end)
        if (!selected.includes('\n')) {
          setFindQuery(selected)
        }
      }
    }
    setTimeout(() => {
      if (withReplace && replaceInputRef.current) {
        replaceInputRef.current.focus()
        replaceInputRef.current.select()
      } else {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      }
    }, 20)
  }

  const replaceCurrent = (): void => {
    if (!draft || !findMatches.length) return
    const match = findMatches[currentMatchIndex]
    if (!match) return
    const before = draft.text.slice(0, match.start)
    const after = draft.text.slice(match.end)
    const newText = before + replaceQuery + after
    draft.text = newText
    draft.userEdited = true
    notify()
    void save()
    setTimeout(() => {
      jumpToMatch(currentMatchIndex)
    }, 10)
  }

  const replaceAll = (): void => {
    if (!draft || !findMatches.length || !findQuery) return
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped
    let regex: RegExp
    try {
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
    } catch {
      return
    }
    const newText = draft.text.replace(regex, () => replaceQuery)
    if (newText !== draft.text) {
      draft.text = newText
      draft.userEdited = true
      notify()
      void save()
    }
  }

  useEffect(() => {
    if (!initialLine || !textarea.current || !text) return
    const lines = text.split('\n')
    let offset = 0
    for (let i = 0; i < Math.min(initialLine - 1, lines.length); i++) {
      offset += lines[i].length + 1
    }
    const lineLen = lines[initialLine - 1]?.length ?? 0
    const input = textarea.current
    input.focus()
    input.setSelectionRange(offset, offset + lineLen)
    input.scrollTop = Math.max(0, (initialLine - 1) * 20 - input.clientHeight / 2 + 16)
    syncScroll()
  }, [initialLine, text])
  const syncScroll = (): void => {
    const input = textarea.current
    if (!input) return
    if (gutter.current) gutter.current.scrollTop = input.scrollTop
    if (overlay.current) {
      overlay.current.style.width = `${input.clientWidth}px`
      overlay.current.style.height = `${input.clientHeight}px`
      overlay.current.scrollTop = input.scrollTop
      overlay.current.scrollLeft = input.scrollLeft
    }
    if (lineHighlightLayer.current) {
      lineHighlightLayer.current.scrollTop = input.scrollTop
      lineHighlightLayer.current.scrollLeft = input.scrollLeft
    }
    if (hunkActionsLayer.current) {
      hunkActionsLayer.current.scrollTop = input.scrollTop
    }
  }

  const scrollToLine = (lineIdx: number): void => {
    const el = textarea.current || readOnlyCode.current
    if (!el) return
    el.scrollTop = Math.max(0, 16 + lineIdx * 20 - el.clientHeight / 2 + 10)
    syncScroll()
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncScroll)
    return () => window.cancelAnimationFrame(frame)
  }, [lines.length, syntaxTokens])
  useLayoutEffect(() => {
    if (!textarea.current) return
    const observer = new ResizeObserver(syncScroll)
    observer.observe(textarea.current)
    syncScroll()
    return () => observer.disconnect()
  }, [!!draft])

  // Auto-reload when workspace file changes on disk (git revert, git pull, agent edit, external tool)
  useEffect(() => {
    return api.files.onChanged((payload) => {
      if (payload.root && !pathsMatch(payload.root, root)) return
      const curDraft = drafts.get(key)
      if (!curDraft || curDraft.text === curDraft.saved) {
        drafts.delete(key)
        notify()
        setReloadNonce((n) => n + 1)
      }
    })
  }, [root, key])

  useEffect(() => {
    if (drafts.has(key) && attempt === 0 && reloadNonce === 0) return
    let current = true
    setLoading(true)
    setReadError(false)
    void api.files.read(sessionId, path).then(
      (result) => {
        if (!current) return
        setFile(result)
        if (!result.binary && !result.truncated && result.revision !== null) {
          const bom = result.content.startsWith('\uFEFF') ? '\uFEFF' : ''
          const content = result.content.slice(bom.length)
          const fileText = content.replace(/\r\n?/g, '\n')
          let text = fileText
          if (agentChange && reviewStatus === 'pending') {
            const initialAligned = computeAlignedEditorLines(
              agentChange.initialBefore,
              agentChange.latestAfter
            )
            text = initialAligned.map((l) => l.text).join('\n')
            setActiveAligned(initialAligned)
          } else {
            setActiveAligned(null)
          }
          drafts.set(key, {
            text,
            saved: fileText,
            revision: result.revision,
            bom,
            crlf: content.includes('\r\n'),
            pending: false,
            error: null,
            userEdited: false
          })
        } else drafts.delete(key)
        notify()
        setLoading(false)
      },
      () => {
        if (current) {
          setReadError(true)
          setLoading(false)
        }
      }
    )
    return () => {
      current = false
    }
  }, [key, sessionId, path, attempt, reloadNonce])

  const save = async (): Promise<void> => {
    if (!draft || draft.pending || loading || draft.text === draft.saved) return
    const textToSave =
      reviewStatus === 'pending'
        ? draft.text
            .split('\n')
            .filter((line, idx) => !(lineInfos[idx]?.kind === 'deleted' && line === ''))
            .join('\n')
        : draft.text
    const revision = draft.revision
    const content = draft.bom + (draft.crlf ? textToSave.replace(/\n/g, '\r\n') : textToSave)
    draft.pending = true
    draft.error = null
    notify()
    try {
      const result = await api.files.write(sessionId, path, content, revision)
      if (result.status === 'saved') {
        draft.saved = draft.text
        draft.userEdited = false
        draft.revision = result.revision
        refreshGitHead()
      } else draft.error = 'conflict'
    } catch {
      draft.error = 'writeError'
    } finally {
      draft.pending = false
      notify()
    }
  }

  // When review status becomes kept or undone (externally from popup or internally), auto-refresh file from disk and git diff
  const prevReviewStatusRef = useRef(reviewStatus)
  useEffect(() => {
    const prev = prevReviewStatusRef.current
    prevReviewStatusRef.current = reviewStatus
    if (prev === 'pending' && (reviewStatus === 'kept' || reviewStatus === 'undone')) {
      setActiveAligned(null)
      if (agentChange && draft) {
        draft.userEdited = false
      }
      clearDraftForPath(path, root)
      setReloadNonce((n) => n + 1)
      refreshGitHead()
    }
  }, [reviewStatus, agentChange, draft, path, root, refreshGitHead])

  const reload = (): void => {
    if (draft?.pending || loading) return
    if (draft && draft.text !== draft.saved && !window.confirm(t('ide.discardConfirm'))) return
    setAttempt((value) => value + 1)
  }
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-bg"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          event.stopPropagation()
          openFind(false)
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
          event.preventDefault()
          event.stopPropagation()
          openFind(true)
        }
      }}
    >
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {isImage && viewMode === 'image' ? (
          <ImageIcon aria-hidden className="h-4 w-4 shrink-0 text-accent" />
        ) : (
          (() => {
            const { Icon: FileIcon, color: fileColor } = getFileIconDescriptor(entry.name)
            return <FileIcon aria-hidden className={cn('h-4 w-4 shrink-0', fileColor)} />
          })()
        )}
        <span
          className="max-w-[40%] shrink-0 truncate text-xs font-medium text-text"
          title={entry.name}
        >
          {entry.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-subtle" title={entry.path}>
          {entry.path}
        </span>

        {/* View Mode Toggle for SVGs */}
        {isSvg && (
          <div className="flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('image')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors',
                viewMode === 'image'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              )}
              title={t('ide.viewImage')}
            >
              <Eye className="h-3 w-3" />
              <span>{t('ide.imagePreview')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('code')}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors',
                viewMode === 'code'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              )}
              title={t('ide.viewCode')}
            >
              <Code className="h-3 w-3" />
              <span>{t('ide.codeTab')}</span>
            </button>
          </div>
        )}

        {isAudio ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-subtle font-mono uppercase">
              {t('ide.audioPreview')}
            </span>
          </div>
        ) : isImage && viewMode === 'image' ? (
          <div className="flex items-center gap-1.5 shrink-0">
            {imageDimensions && (
              <span className="font-mono text-[11px] text-text-subtle tabular-nums mr-1">
                {imageDimensions.w} × {imageDimensions.h} px
              </span>
            )}
            <div className="flex items-center gap-0.5 rounded border border-border bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.25}
                className="rounded p-1 text-text-subtle hover:bg-surface hover:text-text disabled:opacity-40 transition-colors"
                title={t('ide.zoomOut')}
                aria-label={t('ide.zoomOut')}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="font-mono text-[11px] px-1.5 py-0.5 rounded hover:bg-surface text-text-subtle hover:text-text tabular-nums transition-colors"
                title={t('ide.resetZoom')}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 5}
                className="rounded p-1 text-text-subtle hover:bg-surface hover:text-text disabled:opacity-40 transition-colors"
                title={t('ide.zoomIn')}
                aria-label={t('ide.zoomIn')}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
            {!isSvg && (
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-subtle">
                {t('ide.imagePreview')}
              </span>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="rounded p-1.5 text-text-subtle hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title={`${t('ide.findInFile')} (Ctrl+F)`}
              aria-label={t('ide.findInFile')}
              onClick={() => openFind()}
            >
              <Search aria-hidden className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={cn(
                'rounded p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                showCodePreview
                  ? 'bg-surface-2 text-accent font-medium'
                  : 'text-text-subtle hover:bg-surface-2 hover:text-text'
              )}
              title={t('ide.toggleCodePreview')}
              aria-label={t('ide.toggleCodePreview')}
              onClick={() => setShowCodePreview((v) => !v)}
            >
              <MapIcon aria-hidden className="h-3.5 w-3.5" />
            </button>
            {draft ? (
              <div ref={dropdownRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowErrors((open) => !open)}
                  title={
                    diagnostics.issues.length > 0
                      ? t('ide.syntaxErrors', { count: diagnostics.issues.length })
                      : t('ide.syntaxClean')
                  }
                  aria-label={t('ide.toggleErrors')}
                  aria-expanded={showErrors}
                  className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    diagnostics.issues.length > 0
                      ? 'bg-danger/10 text-danger hover:bg-danger/20 font-medium'
                      : 'text-text-subtle hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  {diagnostics.issues.length > 0 ? (
                    <>
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{diagnostics.issues.length}</span>
                    </>
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" />
                  )}
                </button>
                {showErrors && (
                  <div
                    role="dialog"
                    aria-label={t('ide.syntaxTitle')}
                    className="absolute right-0 top-full mt-1.5 z-30 w-80 max-h-72 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-2xl text-xs"
                  >
                    <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-text-muted">
                      <span role="status" className="font-medium">
                        {diagnostics.status === 'ready'
                          ? diagnostics.issues.length
                            ? t('ide.syntaxErrors', { count: diagnostics.issues.length })
                            : t('ide.syntaxClean')
                          : t(`ide.syntax_${diagnostics.status}`)}
                      </span>
                      <button
                        type="button"
                        className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        title={t('ide.closeErrors')}
                        aria-label={t('ide.closeErrors')}
                        onClick={() => setShowErrors(false)}
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {diagnostics.issues.length > 0 ? (
                      <ul className="divide-y divide-border/50 py-0.5">
                        {diagnostics.issues.map((issue, index) => (
                          <li key={index}>
                            <button
                              type="button"
                              className="block w-full rounded p-2 text-left text-danger hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              onClick={() => {
                                focusIssue(issue)
                                setShowErrors(false)
                              }}
                            >
                              {t('ide.syntaxLocation', {
                                line: issue.line,
                                column: issue.column,
                                code: issue.code,
                                message: issue.message
                              })}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="p-3 text-text-muted">{t('ide.syntaxClean')}</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-subtle">
                {t('ide.readOnly')}
              </span>
            )}

            {(isModifiedVsGit || hasUnsavedDraft) && (
              <button
                type="button"
                onClick={() => void handleRevertThisFile()}
                disabled={revertingThisFile}
                title={t('git.revertFile')}
                aria-label={t('git.revertFile')}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/15 disabled:opacity-50 transition-colors shrink-0 font-medium"
              >
                <RotateCcw className={cn('h-3.5 w-3.5', revertingThisFile && 'animate-spin')} />
                <span className="hidden sm:inline">{t('git.revertFile')}</span>
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="rounded p-1.5 text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={t('ide.closePreview')}
          aria-label={t('ide.closePreview')}
          onClick={onClose}
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </header>
      {showFind && (
        <div
          role="search"
          aria-label={t('ide.findInFile')}
          className="absolute right-4 top-14 z-30 flex flex-col gap-1.5 rounded-md border border-border bg-surface/95 p-1.5 shadow-2xl backdrop-blur-md text-xs"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowReplace((v) => !v)
                if (!showReplace) {
                  setTimeout(() => replaceInputRef.current?.focus(), 50)
                }
              }}
              title={t('ide.toggleReplace')}
              aria-label={t('ide.toggleReplace')}
              className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-text-subtle hover:text-text hover:bg-white/5 transition-colors"
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform duration-150',
                  showReplace && 'rotate-90'
                )}
              />
            </button>

            <div className="flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5">
              <Search className="h-3.5 w-3.5 text-text-subtle shrink-0" />
              <input
                ref={findInputRef}
                type="text"
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value)
                  setCurrentMatchIndex(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.shiftKey) prevMatch()
                    else nextMatch()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setShowFind(false)
                    textarea.current?.focus()
                  }
                }}
                placeholder={t('ide.findPlaceholder')}
                className="w-36 bg-transparent text-xs text-text placeholder:text-text-subtle focus:outline-none"
              />
              {findQuery && (
                <button
                  type="button"
                  onClick={() => setFindQuery('')}
                  className="text-text-subtle hover:text-text"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <span className="min-w-[4rem] text-center text-[11px] tabular-nums text-text-subtle">
              {findQuery
                ? findMatches.length > 0
                  ? t('ide.findMatches', {
                      current: currentMatchIndex + 1,
                      total: findMatches.length
                    })
                  : t('ide.findNoMatches')
                : ''}
            </span>

            <div className="flex items-center gap-0.5 border-l border-border pl-1">
              <button
                type="button"
                onClick={() => setCaseSensitive((v) => !v)}
                title={t('ide.caseSensitive')}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium transition-colors ${
                  caseSensitive
                    ? 'bg-accent/20 text-accent font-bold'
                    : 'text-text-subtle hover:bg-surface-2 hover:text-text'
                }`}
              >
                Aa
              </button>
              <button
                type="button"
                onClick={() => setWholeWord((v) => !v)}
                title={t('ide.wholeWord')}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium transition-colors ${
                  wholeWord
                    ? 'bg-accent/20 text-accent font-bold'
                    : 'text-text-subtle hover:bg-surface-2 hover:text-text'
                }`}
              >
                \b
              </button>
            </div>

            <div className="flex items-center gap-0.5 border-l border-border pl-1">
              <button
                type="button"
                onClick={prevMatch}
                disabled={!findMatches.length}
                title={t('ide.findPrevious')}
                className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={nextMatch}
                disabled={!findMatches.length}
                title={t('ide.findNext')}
                className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowFind(false)
                  textarea.current?.focus()
                }}
                title={t('ide.closeFind')}
                className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {showReplace && (
            <div className="flex items-center gap-1.5 pl-5">
              <div className="flex items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5">
                <Replace className="h-3.5 w-3.5 text-text-subtle shrink-0" />
                <input
                  ref={replaceInputRef}
                  type="text"
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (e.ctrlKey || e.metaKey) {
                        replaceAll()
                      } else {
                        replaceCurrent()
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setShowFind(false)
                      textarea.current?.focus()
                    }
                  }}
                  placeholder={t('ide.replacePlaceholder')}
                  className="w-36 bg-transparent text-xs text-text placeholder:text-text-subtle focus:outline-none"
                />
                {replaceQuery && (
                  <button
                    type="button"
                    onClick={() => setReplaceQuery('')}
                    title={t('ide.clearReplace')}
                    className="text-text-subtle hover:text-text"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 border-l border-border pl-1">
                <button
                  type="button"
                  onClick={replaceCurrent}
                  disabled={!draft || !findMatches.length}
                  title={t('ide.replace')}
                  aria-label={t('ide.replace')}
                  className="press-scale flex h-6 items-center justify-center rounded px-2 text-[11px] font-medium border border-border bg-surface-2 text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-40 transition-colors"
                >
                  <Replace className="h-3 w-3 mr-1" />
                  {t('ide.replace')}
                </button>
                <button
                  type="button"
                  onClick={replaceAll}
                  disabled={!draft || !findMatches.length}
                  title={t('ide.replaceAll')}
                  aria-label={t('ide.replaceAll')}
                  className="press-scale flex h-6 items-center justify-center rounded px-2 text-[11px] font-medium border border-border bg-surface-2 text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-40 transition-colors"
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  {t('ide.replaceAll')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {draft && (
        <span role="status" className="sr-only">
          {t(draft.pending ? 'ide.saving' : draft.text !== draft.saved ? 'ide.dirty' : 'ide.saved')}
        </span>
      )}
      {readError && (
        <p role="alert" className="p-3 text-xs text-danger">
          {t('ide.readError')}
        </p>
      )}
      {draft?.error && (
        <p role="alert" className="p-3 text-xs text-danger">
          {t(`ide.${draft.error}`)}
        </p>
      )}
      {(readError || draft?.error) && (
        <button
          type="button"
          className="self-start rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
          disabled={draft?.pending || loading}
          onClick={reload}
        >
          {t('ide.reload')}
        </button>
      )}
      {loading && !isImage && !isAudio && (
        <p role="status" className="p-3 text-xs">
          {t('ide.loading')}
        </p>
      )}
      {isImage && viewMode === 'image' && activeImageSrc ? (
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-8 image-preview-checkerboard select-none"
          onWheel={handleWheel}
        >
          {imageError ? (
            <div className="flex flex-col items-center gap-2 text-danger">
              <AlertCircle className="h-8 w-8" />
              <span className="text-xs">{t('ide.imageLoadError')}</span>
              <button
                type="button"
                onClick={() => {
                  setImageError(false)
                  setAttempt((a) => a + 1)
                }}
                className="rounded border border-border px-2.5 py-1 text-xs text-text hover:bg-surface-2 transition-colors"
              >
                {t('ide.reload')}
              </button>
            </div>
          ) : (
            <div
              className="inline-flex items-center justify-center transition-all duration-75 ease-out"
              style={{
                minWidth: imageDimensions ? `${imageDimensions.w * zoom}px` : undefined,
                minHeight: imageDimensions ? `${imageDimensions.h * zoom}px` : undefined
              }}
            >
              <img
                src={activeImageSrc}
                alt={entry.name}
                style={{
                  width: imageDimensions ? `${imageDimensions.w * zoom}px` : undefined,
                  height: imageDimensions ? `${imageDimensions.h * zoom}px` : undefined,
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                  maxHeight: zoom <= 1 ? '100%' : 'none',
                  imageRendering: zoom > 2 ? 'pixelated' : 'auto'
                }}
                className="object-contain rounded border border-border/40 shadow-xl bg-surface/20"
                onLoad={(e) => {
                  const img = e.currentTarget
                  setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight })
                  setImageError(false)
                }}
                onError={() => setImageError(true)}
              />
            </div>
          )}
        </div>
      ) : isAudio && audioSrc ? (
        <AudioPreview src={audioSrc} name={entry.name} path={entry.path} />
      ) : draft ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <pre
            ref={gutter}
            aria-hidden="true"
            className="m-0 shrink-0 select-none overflow-hidden border-r border-border bg-surface px-3 py-4 text-right font-mono text-xs leading-5 text-text-subtle"
          >
            {(() => {
              let actualLine = 0
              const total = lines.length
              return lines.map((_, index) => {
                const info = lineInfos[index]
                const isAgentDeleted = info?.kind === 'deleted'
                if (!isAgentDeleted) actualLine++
                const isError = errorLines.has(actualLine)
                const isAdded = info?.kind === 'added'
                const hasGitDeletion = Boolean(
                  info?.gitDeletedCount ||
                  gitDiffInfo.deletedMarkers.has(index) ||
                  (index === total - 1 && gitDiffInfo.deletedMarkers.has(total))
                )
                const isDeletionAtBottom =
                  index === total - 1 && gitDiffInfo.deletedMarkers.has(total)

                return (
                  <span
                    key={index}
                    className={cn(
                      'block px-2 text-right relative font-mono text-[11px] tabular-nums h-5 leading-5',
                      isError
                        ? 'border-l-2 border-danger bg-danger/10 text-danger font-semibold'
                        : isAgentDeleted
                          ? 'border-l-2 border-rose-500 bg-rose-500/20 text-rose-400 font-semibold'
                          : isAdded
                            ? 'border-l-[3px] border-emerald-500 bg-emerald-500/15 text-emerald-400 font-semibold'
                            : 'border-l-2 border-transparent text-text-subtle'
                    )}
                  >
                    {hasGitDeletion && (
                      <span
                        className={cn(
                          'absolute left-0 right-0 h-[2.5px] bg-rose-500 z-10 pointer-events-none shadow-[0_0_4px_rgba(244,63,94,0.6)]',
                          isDeletionAtBottom ? 'bottom-0' : 'top-0'
                        )}
                        title="Lines removed"
                      />
                    )}
                    {isAgentDeleted ? '-' : actualLine}
                  </span>
                )
              })
            })()}
            {'\u200b'}
          </pre>
          <div className="relative min-h-0 min-w-0 flex-1 bg-bg">
            <div
              ref={lineHighlightLayer}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 select-none overflow-hidden"
              style={{ padding: '16px 0' }}
            >
              {lines.map((_, index) => {
                const info = lineInfos[index]
                const isAgentDeleted = info?.kind === 'deleted'
                const isAgentAdded = Boolean(activeAligned && info?.kind === 'added')
                return (
                  <div
                    key={index}
                    style={{ height: '20px' }}
                    className={cn(
                      'w-full relative transition-colors min-w-full w-max',
                      isAgentDeleted
                        ? 'bg-rose-500/15 border-l-2 border-rose-500'
                        : isAgentAdded
                          ? 'bg-emerald-500/15 border-l-2 border-emerald-500'
                          : 'bg-transparent'
                    )}
                  />
                )
              })}
            </div>
            <pre
              ref={overlay}
              aria-hidden="true"
              className="file-editor-code pointer-events-none absolute inset-0 select-none overflow-hidden text-text"
              style={{ visibility: 'visible' }}
            >
              {lines.map((lineText, index) => {
                const info = lineInfos[index]
                const isDeleted = info?.kind === 'deleted'
                const lineTokens = fitSyntaxTokensToLine(syntaxTokens?.[index], lineText)

                return (
                  <div
                    key={index}
                    style={{ height: '20px', lineHeight: '20px' }}
                    className="w-full whitespace-pre overflow-hidden min-w-full w-max"
                  >
                    {isDeleted ? (
                      <span
                        className="file-editor-deleted-text text-rose-400 font-mono line-through opacity-85 select-none italic"
                        style={{ color: '#fb7185' }}
                      >
                        {info?.deletedText || '\u200b'}
                      </span>
                    ) : lineTokens && lineTokens.length > 0 ? (
                      lineTokens.map((token, i) => (
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
                        >
                          {token.text}
                        </span>
                      ))
                    ) : (
                      <span>{lineText || '\u200b'}</span>
                    )}
                  </div>
                )
              })}
              {'\u200b'}
            </pre>
            <textarea
              ref={textarea}
              aria-label={t('ide.editor')}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              wrap="off"
              disabled={loading}
              className={cn(
                'file-editor-code file-editor-input relative block h-full w-full resize-none overflow-auto bg-transparent text-text focus-visible:outline-none',
                showCodePreview && 'editor-hide-v-scrollbar'
              )}
              data-highlighted={!!syntaxTokens}
              value={draft.text}
              onScroll={syncScroll}
              onChange={(event) => {
                draft.text = event.target.value
                draft.userEdited = true
                notify()
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  event.stopPropagation()
                  void save()
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                  event.preventDefault()
                  event.stopPropagation()
                  openFind(false)
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
                  event.preventDefault()
                  event.stopPropagation()
                  openFind(true)
                }
              }}
            />
            {/* Grouped Change Actions Layer */}
            {hunks.length > 0 && (
              <div
                ref={hunkActionsLayer}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 select-none overflow-hidden z-20"
                style={{ padding: '16px 0' }}
              >
                {/* Spacer ensuring hunkActionsLayer scrollHeight matches textarea so last hunk scrolls off-screen properly */}
                <div
                  aria-hidden="true"
                  style={{
                    height: `${lines.length * 20 + 64}px`,
                    width: '1px',
                    pointerEvents: 'none'
                  }}
                />
                {hunks.map((hunk) => (
                  <div
                    key={hunk.id}
                    style={{
                      position: 'absolute',
                      top: `${16 + hunk.startLineIdx * 20}px`,
                      right: '24px'
                    }}
                    className="pointer-events-auto flex items-center gap-1 rounded-md border border-border/80 bg-surface/95 px-2 py-0.5 shadow-lg backdrop-blur-sm text-[11px]"
                  >
                    <span className="font-mono text-[10px] text-text-subtle mr-1 tabular-nums">
                      {hunk.addedCount > 0 && (
                        <span className="text-emerald-400 font-medium">+{hunk.addedCount}</span>
                      )}
                      {hunk.addedCount > 0 && hunk.deletedCount > 0 && ' '}
                      {hunk.deletedCount > 0 && (
                        <span className="text-rose-400 font-medium">-{hunk.deletedCount}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleKeepHunk(hunk.id)}
                      title={t('ide.keepThisChange')}
                      className="press-scale flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors"
                    >
                      <Check className="h-3 w-3" />
                      <span>{t('ide.keep')}</span>
                    </button>
                    <div className="h-3 w-px bg-border" />
                    <button
                      type="button"
                      onClick={() => handleRevertHunk(hunk.id)}
                      title={t('ide.revertThisChange')}
                      className="press-scale flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>{t('ide.revert')}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {showCodePreview && (
            <CodePreviewRail
              lines={previewLines}
              lineInfos={previewLineInfos}
              hunks={hunks}
              errorLines={previewErrorLines}
              syntaxTokens={syntaxTokens}
              scrollContainerRef={textarea}
              onScrollToLine={scrollToLine}
            />
          )}
        </div>
      ) : (
        file && (
          <>
            {file.truncated && <p className="p-3 text-xs">{t('ide.truncated')}</p>}
            {file.binary ? (
              <p className="p-3 text-xs">{t('ide.binary')}</p>
            ) : (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <pre
                  ref={gutter}
                  aria-hidden="true"
                  className="m-0 shrink-0 select-none overflow-hidden border-r border-border bg-surface px-3 py-4 text-right font-mono text-xs leading-5 text-text-subtle"
                >
                  {lines.map((_, index) => {
                    const lineNum = index + 1
                    const info = lineInfos[index]
                    const isAgentDeleted = info?.kind === 'deleted'
                    const isAdded = info?.kind === 'added'
                    const hasGitDeletion = Boolean(
                      info?.gitDeletedCount ||
                      gitDiffInfo.deletedMarkers.has(index) ||
                      (index === lines.length - 1 && gitDiffInfo.deletedMarkers.has(lines.length))
                    )
                    const isDeletionAtBottom =
                      index === lines.length - 1 && gitDiffInfo.deletedMarkers.has(lines.length)

                    return (
                      <span
                        key={index}
                        className={cn(
                          'block px-2 text-right relative font-mono text-[11px] tabular-nums h-5 leading-5',
                          isAgentDeleted
                            ? 'border-l-2 border-rose-500 bg-rose-500/20 text-rose-400 font-semibold'
                            : isAdded
                              ? 'border-l-[3px] border-emerald-500 bg-emerald-500/15 text-emerald-400 font-semibold'
                              : 'border-l-2 border-transparent text-text-subtle'
                        )}
                      >
                        {hasGitDeletion && (
                          <span
                            className={cn(
                              'absolute left-0 right-0 h-[2.5px] bg-rose-500 z-10 pointer-events-none shadow-[0_0_4px_rgba(244,63,94,0.6)]',
                              isDeletionAtBottom ? 'bottom-0' : 'top-0'
                            )}
                            title="Lines removed"
                          />
                        )}
                        {isAgentDeleted ? '-' : lineNum}
                      </span>
                    )
                  })}
                  {'\u200b'}
                </pre>
                <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                  <div
                    ref={lineHighlightLayer}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 select-none overflow-hidden"
                    style={{ padding: '16px 0' }}
                  >
                    {lines.map((_, index) => {
                      const info = lineInfos[index]
                      const isAgentDeleted = info?.kind === 'deleted'
                      const isAgentAdded = Boolean(activeAligned && info?.kind === 'added')
                      return (
                        <div
                          key={index}
                          style={{ height: '20px' }}
                          className={cn(
                            'w-full relative transition-colors min-w-full w-max',
                            isAgentDeleted
                              ? 'bg-rose-500/15 border-l-2 border-rose-500'
                              : isAgentAdded
                                ? 'bg-emerald-500/15 border-l-2 border-emerald-500'
                                : 'bg-transparent'
                          )}
                        />
                      )
                    })}
                  </div>
                  <pre
                    ref={readOnlyCode}
                    tabIndex={0}
                    onScroll={(event) => {
                      if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop
                      if (lineHighlightLayer.current)
                        lineHighlightLayer.current.scrollTop = event.currentTarget.scrollTop
                    }}
                    className={cn(
                      'file-editor-code relative min-h-0 min-w-0 flex-1 overflow-auto text-text',
                      showCodePreview && 'editor-hide-v-scrollbar'
                    )}
                  >
                    {lines.map((lineText, index) => {
                      const info = lineInfos[index]
                      const isDeleted = info?.kind === 'deleted' && !lineText
                      const lineTokens = fitSyntaxTokensToLine(syntaxTokens?.[index], lineText)

                      return (
                        <div
                          key={index}
                          style={{ height: '20px', lineHeight: '20px' }}
                          className="w-full whitespace-pre overflow-hidden min-w-full w-max"
                        >
                          {isDeleted ? (
                            <span
                              className="file-editor-deleted-text text-rose-400 font-mono line-through opacity-85 select-none italic"
                              style={{ color: '#fb7185' }}
                            >
                              {info.deletedText}
                            </span>
                          ) : lineTokens && lineTokens.length > 0 ? (
                            lineTokens.map((token, i) => (
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
                              >
                                {token.text}
                              </span>
                            ))
                          ) : (
                            <span>{lineText || '\u200b'}</span>
                          )}
                        </div>
                      )
                    })}
                    {'\u200b'}
                  </pre>
                </div>
                {showCodePreview && (
                  <CodePreviewRail
                    lines={lines}
                    lineInfos={lineInfos}
                    hunks={hunks}
                    errorLines={errorLines}
                    syntaxTokens={syntaxTokens}
                    scrollContainerRef={readOnlyCode}
                    onScrollToLine={scrollToLine}
                  />
                )}
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}
