/**
 * Crash-safe checkpoints for queue-driven turns.
 *
 * A turn's reply only becomes a `messages` row when the turn ends. Until then
 * it lives in memory, so a crash, a force-kill or a power cut used to drop all
 * of it, every tool call included, and the next turn ran as if that work had
 * never happened. While the turn streams, this module keeps its latest parts in
 * `turn_checkpoints`. The final save deletes the row in the same transaction,
 * so a row that is still there at the next launch means the app died mid-turn,
 * and `recoverTurnCheckpoints` turns it into an `[interrupted]` reply.
 */
import type { MessagePart } from '../../shared/types'
import { partsToContent } from '../../shared/parts'
import * as repo from '../db/repo'
import { getDb } from '../db/database'
import { finalizeInFlightParts } from './turn-recovery'

/** Longest a streamed change can stay only in memory (for a typical reply). */
export const CHECKPOINT_INTERVAL_MS = 1000
/** A very large reply (long tool output) backs off up to this, about 1 MB per 5 s. */
const MAX_INTERVAL_MS = 5000

function intervalFor(bytes: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(CHECKPOINT_INTERVAL_MS, bytes / 200))
}

export interface TurnCheckpointer {
  /** Record the latest parts. `urgent` (a finished tool) writes on the next tick. */
  update(parts: MessagePart[], urgent?: boolean): void
  /** Stop writing. Pending changes are dropped: the caller is saving the real reply. */
  close(): void
}

export function createTurnCheckpointer(
  queueId: string,
  chatId: string,
  author: { botId?: string; botUsername?: string } = {}
): TurnCheckpointer {
  let latest: MessagePart[] | null = null
  let written: MessagePart[] | null = null
  let lastWrite = 0
  let interval = CHECKPOINT_INTERVAL_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const write = (): void => {
    timer = undefined
    if (closed || !latest || latest === written) return
    const parts = latest
    try {
      const json = JSON.stringify(parts)
      getDb()
        .prepare(
          `INSERT INTO turn_checkpoints(queue_id, chat_id, parts, bot_id, bot_username, updated_at)
           VALUES(?, ?, ?, ?, ?, ?)
           ON CONFLICT(queue_id) DO UPDATE SET parts = excluded.parts, updated_at = excluded.updated_at`
        )
        .run(queueId, chatId, json, author.botId ?? null, author.botUsername ?? null, Date.now())
      written = parts
      interval = intervalFor(json.length)
    } catch (error) {
      // Best effort: a deleted chat (FK) or a busy DB must never fail the turn.
      console.error('[turn-checkpoint] write failed', error)
    }
    lastWrite = Date.now()
  }

  return {
    update(parts, urgent = false) {
      if (closed) return
      latest = parts
      const wait = Math.max(0, (urgent ? 0 : interval) - (Date.now() - lastWrite))
      if (timer) {
        if (!urgent) return
        clearTimeout(timer)
      }
      timer = setTimeout(write, wait)
    },
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      timer = undefined
    }
  }
}

/** Remove a turn's checkpoint. Call inside the transaction that saves its reply. */
export function clearTurnCheckpoint(queueId: string): void {
  getDb().prepare('DELETE FROM turn_checkpoints WHERE queue_id = ?').run(queueId)
}

interface CheckpointRow {
  queue_id: string
  chat_id: string
  parts: string
  bot_id: string | null
  bot_username: string | null
  updated_at: number
}

/**
 * Turn every leftover checkpoint into an `[interrupted]` assistant reply.
 *
 * Runs at startup, before interrupted queue rows are marked failed, and links
 * each reply to its queue row as `response_message_id`. Retrying the failed
 * prompt then replaces the partial reply, the same as the in-process error
 * path. Returns the ids of the chats that gained a message.
 */
export function recoverTurnCheckpoints(): string[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM turn_checkpoints ORDER BY updated_at ASC')
    .all() as CheckpointRow[]
  const chats = new Set<string>()
  for (const row of rows) {
    try {
      db.transaction(() => {
        clearTurnCheckpoint(row.queue_id)
        if (!repo.getChat(row.chat_id)) return
        let raw: unknown
        try {
          raw = JSON.parse(row.parts)
        } catch {
          return
        }
        if (!Array.isArray(raw) || !raw.length) return
        const parts = finalizeInFlightParts(raw as MessagePart[], 'interrupted')
        // A crash mid-tool leaves the note only inside that tool's output. Say
        // it at the end too, so the reader and the next turn can't miss it.
        const last = parts.at(-1)
        if (last?.type !== 'text' || !last.text.includes('_[interrupted]_'))
          parts.push({ type: 'text', text: '_[interrupted]_' })
        const message = repo.addMessage({
          chatId: row.chat_id,
          role: 'assistant',
          content: partsToContent(parts),
          parts,
          ...(row.bot_id ? { botId: row.bot_id } : {}),
          ...(row.bot_username ? { botUsername: row.bot_username } : {})
        })
        // Order the reply by when it was written, not when it was recovered.
        // Its prompt is older still, so the transcript keeps its order.
        db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(
          row.updated_at,
          message.id
        )
        db.prepare(
          "UPDATE queue SET response_message_id = ? WHERE id = ? AND state IN ('starting', 'running')"
        ).run(message.id, row.queue_id)
        chats.add(row.chat_id)
      })()
    } catch (error) {
      console.error('[turn-checkpoint] recovery failed', error)
    }
  }
  return [...chats]
}
