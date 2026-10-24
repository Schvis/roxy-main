import { useEffect, useState } from 'react'
import { workspaceReviewHunks } from '../lib/workspace-review'
import { useTranslation } from 'react-i18next'
import { useRoxyStore } from '../lib/store'
import {
  extractAgentFileChanges,
  pathsMatch,
  stripWorkspaceRoot,
  setFileReviewStatus,
  subscribeFileReviews
} from '../lib/agent-file-changes'
import type { EditorDocument } from '../lib/workspace-editor'

export function WorkspaceAgentReview({
  entry,
  filePath
}: {
  entry: EditorDocument
  filePath: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const messages = useRoxyStore((state) => state.messages)
  const activeChatId = useRoxyStore((state) => state.activeChatId)
  const streaming = useRoxyStore((state) => state.streamingChats[entry.sessionId] ?? null)
  const chats = useRoxyStore((state) => state.chats)
  const [, refresh] = useState(0)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  useEffect(() => subscribeFileReviews(() => refresh((value) => value + 1)), [])
  const [reviewedDraft, setReviewedDraft] = useState<{ signature: string; content: string } | null>(
    null
  )
  const chat = chats.find((candidate) => candidate.id === entry.sessionId)
  const owner = chat?.parentId ? chats.find((candidate) => candidate.id === chat.parentId) : chat
  const root =
    chat?.worktreePath ?? chat?.workspacePath ?? owner?.worktreePath ?? owner?.workspacePath
  const summary = extractAgentFileChanges(
    activeChatId === entry.sessionId ? messages : [],
    streaming,
    entry.sessionId,
    root
  )
  const change = summary.files.find((file) =>
    pathsMatch(file.path, stripWorkspaceRoot(filePath, root))
  )
  if (!change || change.reviewStatus !== 'pending') return null
  const content = entry.model.getValue(undefined, true)
  const signature = change.latestAfter
  const reviewedContent = reviewedDraft?.signature === signature ? reviewedDraft.content : signature
  // Never offer agent reverts for unrelated manual edits or stale disk content.
  if (content !== reviewedContent) return null
  const hunks = workspaceReviewHunks(change.initialBefore, content, signature)
  const locked = entry.saving || entry.reloading || entry.mixedEol || Boolean(streaming)
  const revert = (hunk: (typeof hunks)[number]): void => {
    if (locked) return
    const start = entry.model.getPositionAt(hunk.offset)
    const end = entry.model.getPositionAt(hunk.offset + hunk.added.length)
    entry.model.pushStackElement()
    entry.model.pushEditOperations(
      [],
      [
        {
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column
          },
          text: hunk.removed
        }
      ],
      () => null
    )
    entry.model.pushStackElement()
    setReviewedDraft({ signature, content: entry.model.getValue(undefined, true) })
  }
  return (
    <section
      aria-label={t('chat.viewChanges')}
      className="max-h-64 shrink-0 overflow-auto border-t border-border text-xs"
    >
      <div className="flex gap-3 p-2">
        <button
          type="button"
          disabled={locked || content !== signature}
          onClick={() =>
            setFileReviewStatus(entry.sessionId, change.path, 'kept', change.latestAfter)
          }
          className="text-success disabled:opacity-40"
        >
          {t('chat.keep')}
        </button>
        <button
          type="button"
          disabled={locked || !hunks.length}
          onClick={() =>
            revert({ id: 'all', offset: 0, added: content, removed: change.initialBefore })
          }
          className="text-danger disabled:opacity-40"
        >
          {t('chat.undo')}
        </button>
        <span className="text-text-muted">{t('workspaceMigration.reviewDraft')}</span>
      </div>
      {hunks
        .filter((hunk) => !accepted.has(hunk.id))
        .map((hunk) => (
          <div key={hunk.id} className="border-t border-border p-2">
            <div className="mb-1 flex gap-3">
              <span>{entry.model.getPositionAt(hunk.offset).lineNumber}</span>
              <button
                type="button"
                disabled={locked}
                onClick={() => setAccepted((value) => new Set([...value, hunk.id]))}
                className="text-success disabled:opacity-40"
              >
                {t('ide.keepThisChange')}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => revert(hunk)}
                className="text-danger disabled:opacity-40"
              >
                {t('ide.revertThisChange')}
              </button>
            </div>
            {hunk.removed && <pre className="overflow-x-auto text-danger">{hunk.removed}</pre>}
            {hunk.added && <pre className="overflow-x-auto text-success">{hunk.added}</pre>}
          </div>
        ))}
    </section>
  )
}
