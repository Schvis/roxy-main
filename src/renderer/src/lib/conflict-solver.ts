export interface ConflictHunk {
  id: string
  index: number
  startLine: number
  endLine: number
  currentLabel: string
  currentText: string
  incomingLabel: string
  incomingText: string
  baseText?: string
}

/** Parse all standard git merge conflict hunks from file content. */
export function parseConflictHunks(content: string): ConflictHunk[] {
  if (!content || !content.includes('<<<<<<<')) return []

  const lines = content.split('\n')
  const hunks: ConflictHunk[] = []
  let inConflict = false
  let inIncoming = false
  let inBase = false
  let startLine = -1
  let currentLabel = 'Current Change (Ours)'
  let incomingLabel = 'Incoming Change (Theirs)'
  let currentLines: string[] = []
  let incomingLines: string[] = []
  let baseLines: string[] = []
  let hunkCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inConflict && line.startsWith('<<<<<<<')) {
      inConflict = true
      inIncoming = false
      inBase = false
      startLine = i
      currentLabel = line.slice(7).trim() || 'Current Change'
      currentLines = []
      incomingLines = []
      baseLines = []
    } else if (inConflict && line.startsWith('|||||||')) {
      inBase = true
    } else if (inConflict && line.startsWith('=======')) {
      inIncoming = true
      inBase = false
    } else if (inConflict && line.startsWith('>>>>>>>')) {
      incomingLabel = line.slice(7).trim() || 'Incoming Change'
      hunks.push({
        id: `conflict-${hunkCount}`,
        index: hunkCount,
        startLine,
        endLine: i,
        currentLabel,
        currentText: currentLines.join('\n'),
        incomingLabel,
        incomingText: incomingLines.join('\n'),
        baseText: baseLines.length > 0 ? baseLines.join('\n') : undefined
      })
      hunkCount++
      inConflict = false
      inIncoming = false
      inBase = false
    } else if (inConflict) {
      if (inIncoming) {
        incomingLines.push(line)
      } else if (inBase) {
        baseLines.push(line)
      } else {
        currentLines.push(line)
      }
    }
  }

  return hunks
}

export type ConflictResolutionChoice = 'current' | 'incoming' | 'both' | 'discard'

/** Resolve a single conflict hunk by index or ID in the file content. */
export function resolveConflictHunk(
  content: string,
  hunkIndexOrId: number | string,
  choice: ConflictResolutionChoice
): string {
  const targetIndex =
    typeof hunkIndexOrId === 'number'
      ? hunkIndexOrId
      : parseInt(String(hunkIndexOrId).replace(/\D+/g, ''), 10) || 0

  const lines = content.split('\n')
  let curHunkIdx = 0
  let start = -1
  let end = -1
  let inTargetConflict = false
  let inAnyConflict = false
  let inIncoming = false
  let inBase = false
  const curLines: string[] = []
  const inLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!inAnyConflict && l.startsWith('<<<<<<<')) {
      inAnyConflict = true
      if (curHunkIdx === targetIndex) {
        start = i
        inTargetConflict = true
        inIncoming = false
        inBase = false
      }
    } else if (inAnyConflict && l.startsWith('|||||||')) {
      inBase = true
    } else if (inAnyConflict && l.startsWith('=======')) {
      inIncoming = true
      inBase = false
    } else if (inAnyConflict && l.startsWith('>>>>>>>')) {
      inAnyConflict = false
      if (inTargetConflict) {
        end = i
        break
      }
      curHunkIdx++
    } else if (inTargetConflict) {
      if (inIncoming) {
        inLines.push(l)
      } else if (!inBase) {
        curLines.push(l)
      }
    }
  }

  if (start === -1 || end === -1) return content

  let replacement: string[] = []
  if (choice === 'current') replacement = curLines
  else if (choice === 'incoming') replacement = inLines
  else if (choice === 'both') replacement = [...curLines, ...inLines]
  else if (choice === 'discard') replacement = []

  lines.splice(start, end - start + 1, ...replacement)
  return lines.join('\n')
}

/** Resolve all conflict hunks in a file at once with the chosen side. */
export function resolveAllConflictHunks(
  content: string,
  choice: 'current' | 'incoming' | 'both'
): string {
  let result = content
  let hunks = parseConflictHunks(result)
  while (hunks.length > 0) {
    result = resolveConflictHunk(result, 0, choice)
    hunks = parseConflictHunks(result)
  }
  return result
}
