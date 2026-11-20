import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from 'electron'

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'roxy-checkpoint-')))
process.env.ROXY_TRACK_DISABLE = '1'
app.on('window-all-closed', () => undefined)

import { getDb, closeDb } from '../src/main/db/database'
import * as repo from '../src/main/db/repo'
import { PartsFold } from '../src/shared/parts'
import {
  createTurnCheckpointer,
  clearTurnCheckpoint,
  CHECKPOINT_INTERVAL_MS
} from '../src/main/services/turn-checkpoint'
import { startAutomation, stopAutomation } from '../src/main/services/automation'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function stored(queueId: string): { parts: string; bot_username: string | null } | undefined {
  return getDb()
    .prepare('SELECT parts, bot_username FROM turn_checkpoints WHERE queue_id = ?')
    .get(queueId) as { parts: string; bot_username: string | null } | undefined
}

/** A queue row in the state a crash leaves it: claimed, with its prompt saved. */
function interruptedTurn(title: string): { chatId: string; queueId: string; promptId: string } {
  const chat = repo.createChat({ title })
  const prompt = repo.addMessage({ chatId: chat.id, role: 'user', content: 'Refactor it' })
  const item = repo.enqueue(chat.id, 'Refactor it')
  getDb()
    .prepare("UPDATE queue SET state = 'running', message_id = ? WHERE id = ?")
    .run(prompt.id, item.id)
  return { chatId: chat.id, queueId: item.id, promptId: prompt.id }
}

async function testThrottledWrites(): Promise<void> {
  const { chatId, queueId } = interruptedTurn('Throttle')
  const fold = new PartsFold()
  const checkpoint = createTurnCheckpointer(queueId, chatId, { botUsername: 'reviewer' })

  fold.apply({ type: 'text', delta: 'Looking' })
  checkpoint.update(fold.parts)
  // The first change is written on the next tick, since nothing was written yet.
  await sleep(20)
  assert.ok(stored(queueId), 'first change is checkpointed promptly')
  assert.equal(stored(queueId)!.bot_username, 'reviewer')

  fold.apply({ type: 'text', delta: ' around' })
  checkpoint.update(fold.parts)
  await sleep(50)
  assert.ok(!stored(queueId)!.parts.includes('around'), 'text deltas are throttled')

  // A finished tool skips the throttle.
  fold.apply({ type: 'tool-start', callId: 'c1', tool: 'bash', title: 'npm test' })
  checkpoint.update(fold.parts)
  fold.apply({ type: 'tool-end', callId: 'c1', ok: true, output: 'all green' })
  checkpoint.update(fold.parts, true)
  await sleep(20)
  assert.ok(stored(queueId)!.parts.includes('all green'), 'tool-end is written right away')

  fold.apply({ type: 'text', delta: 'Done.' })
  checkpoint.update(fold.parts)
  await sleep(CHECKPOINT_INTERVAL_MS + 100)
  assert.ok(stored(queueId)!.parts.includes('Done.'), 'throttled text lands within the interval')

  // close() drops pending writes, and the final save clears the row.
  fold.apply({ type: 'text', delta: ' extra' })
  checkpoint.update(fold.parts)
  checkpoint.close()
  clearTurnCheckpoint(queueId)
  await sleep(CHECKPOINT_INTERVAL_MS + 100)
  assert.equal(stored(queueId), undefined, 'a closed checkpointer never writes again')

  getDb().prepare('DELETE FROM queue WHERE id = ?').run(queueId)
  repo.removeChat(chatId)
}

function testCrashRecovery(): void {
  const { chatId, queueId, promptId } = interruptedTurn('Crash')
  const fold = new PartsFold()
  fold.apply({ type: 'reasoning', delta: 'Plan the edit' })
  fold.apply({ type: 'tool-start', callId: 'e1', tool: 'edit', title: 'edit a.ts' })
  fold.apply({
    type: 'tool-end',
    callId: 'e1',
    ok: true,
    output: 'Edited a.ts',
    diff: { path: 'a.ts', before: 'x', after: 'y' }
  })
  fold.apply({ type: 'text', delta: 'Now the tests' })
  fold.apply({ type: 'tool-start', callId: 'b1', tool: 'bash', title: 'npm test' })
  // What the last checkpoint held when the process died.
  getDb()
    .prepare(
      'INSERT INTO turn_checkpoints(queue_id, chat_id, parts, updated_at) VALUES(?, ?, ?, ?)'
    )
    .run(queueId, chatId, JSON.stringify(fold.parts), Date.now())
  // An orphan whose chat is gone must be dropped without failing startup.
  getDb().pragma('foreign_keys = OFF')
  getDb()
    .prepare(
      'INSERT INTO turn_checkpoints(queue_id, chat_id, parts, updated_at) VALUES(?, ?, ?, ?)'
    )
    .run('orphan', 'missing-chat', '[]', Date.now())
  getDb().pragma('foreign_keys = ON')

  // Next launch.
  startAutomation()
  stopAutomation()

  const count = getDb().prepare('SELECT COUNT(*) AS n FROM turn_checkpoints').get() as {
    n: number
  }
  assert.equal(count.n, 0, 'every checkpoint is consumed at startup')

  const messages = repo.listMessages(chatId)
  assert.deepEqual(
    messages.map((m) => m.role),
    ['user', 'assistant'],
    'the partial reply follows its prompt'
  )
  const reply = messages[1]
  const edit = reply.parts?.find((p) => p.type === 'tool' && p.callId === 'e1')
  assert.ok(edit?.type === 'tool' && edit.state === 'done' && edit.diff, 'finished tool kept')
  const bash = reply.parts?.find((p) => p.type === 'tool' && p.callId === 'b1')
  assert.ok(bash?.type === 'tool' && bash.state === 'error', 'running tool marked interrupted')
  assert.ok(reply.content.includes('interrupted'), 'reply says it was interrupted')

  const item = repo.listQueue(chatId).find((q) => q.id === queueId)
  assert.equal(item?.state, 'failed')
  assert.equal(item?.messageId, promptId)
  assert.equal(item?.responseMessageId, reply.id, 'retry knows which reply to replace')

  // Retrying replaces the partial reply instead of stacking a second one.
  repo.updateQueueItem(queueId, 'Refactor it')
  assert.deepEqual(
    repo.listMessages(chatId).map((m) => m.id),
    [promptId],
    'retry removes the interrupted reply'
  )

  getDb().prepare('DELETE FROM queue WHERE id = ?').run(queueId)
  repo.removeChat(chatId)
}

async function main(): Promise<void> {
  await app.whenReady()
  getDb()
  await testThrottledWrites()
  testCrashRecovery()
  closeDb()
  console.log('turn checkpoint tests passed')
  app.exit(0)
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
