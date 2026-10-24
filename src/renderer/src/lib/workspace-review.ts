import { diffLines } from 'diff'

export function workspaceReviewHunks(
  before: string,
  content: string,
  signature: string
): {
  id: string
  offset: number
  added: string
  removed: string
}[] {
  const parts = diffLines(before, content)
  const hunks: ReturnType<typeof workspaceReviewHunks> = []
  let offset = 0
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!part.added && !part.removed) {
      offset += part.value.length
      continue
    }
    const removed = part.removed ? part.value : ''
    let added = part.added ? part.value : ''
    if (part.removed && parts[index + 1]?.added) added = parts[++index].value
    hunks.push({ id: JSON.stringify([signature, offset, removed, added]), offset, added, removed })
    offset += added.length
  }
  return hunks
}
