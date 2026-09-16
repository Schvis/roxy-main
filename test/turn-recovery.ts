import assert from 'node:assert/strict'
import { app } from 'electron'
import {
  beginActiveTurn,
  applyTurnEvent,
  finalizeInFlightParts,
  flushAllActiveTurns,
  markTurnPersisted,
  isTurnAlreadyFlushed
} from '../src/main/services/turn-recovery'
import * as repo from '../src/main/db/repo'
import { getDb } from '../src/main/db/database'
import type { MessagePart } from '../src/shared/types'

function testFinalizeInFlightParts(): void {
  const parts: MessagePart[] = [
    { type: 'reasoning', text: 'Thinking about the problem' },
    {
      type: 'tool',
      tool: 'edit',
      state: 'done',
      diff: { path: 'file.ts', before: 'a', after: 'b' },
      output: 'Replaced 1 line'
    },
    {
      type: 'tool',
      tool: 'write',
      state: 'running',
      diff: { path: 'new.ts', before: '', after: 'content' }
    },
    {
      type: 'tool',
      tool: 'bash',
      state: 'running'
    },
    { type: 'text', text: 'I am editing the files' }
  ]

  const finalized = finalizeInFlightParts(parts, 'interrupted')
  assert.equal(finalized.length, 5)

  // Tool 1: already done
  assert.equal(finalized[1].type === 'tool' && finalized[1].state, 'done')

  // Tool 2: was running with diff -> finalized to done
  assert.equal(finalized[2].type === 'tool' && finalized[2].state, 'done')

  // Tool 3: was running without diff/output -> finalized to error
  assert.equal(finalized[3].type === 'tool' && finalized[3].state, 'error')
  assert.equal(finalized[3].type === 'tool' && finalized[3].output, '[interrupted]')

  // Trailing text: appended _[interrupted]_
  assert.equal(finalized[4].type === 'text' && finalized[4].text.includes('_[interrupted]_'), true)
}

function testTurnRecoveryPersistence(): void {
  // Ensure DB is initialized
  getDb()

  const chat = repo.createChat({ title: 'Recovery Test Chat' })
  const controller = new AbortController()
  const reqId = 'req_test_123'

  // 1. Begin active turn
  beginActiveTurn(reqId, chat.id, controller)

  // 2. Stream some reasoning and a tool edit
  applyTurnEvent(reqId, { type: 'reasoning', delta: 'Let us edit the code' })
  applyTurnEvent(reqId, {
    type: 'tool-start',
    callId: 'call_1',
    tool: 'edit',
    title: 'edit file.ts'
  })
  applyTurnEvent(reqId, {
    type: 'tool-end',
    callId: 'call_1',
    ok: true,
    output: 'Edited file.ts',
    diff: { path: 'file.ts', before: 'old', after: 'new' }
  })
  applyTurnEvent(reqId, { type: 'text', delta: 'First edit finished, doing next...' })
  applyTurnEvent(reqId, {
    type: 'tool-start',
    callId: 'call_2',
    tool: 'edit',
    title: 'edit second.ts'
  })

  // 3. User closes app -> flushAllActiveTurns
  flushAllActiveTurns('interrupted')

  assert.equal(isTurnAlreadyFlushed(chat.id), true)

  // 4. Verify message exists in SQLite
  const messages = repo.listMessages(chat.id)
  const last = messages[messages.length - 1]
  assert.ok(last, 'Interrupted assistant message must be saved')
  assert.equal(last.role, 'assistant')
  assert.ok(last.parts && last.parts.length >= 3, 'Must retain parts')

  // Find the completed tool
  const tool1 = last.parts?.find((p) => p.type === 'tool' && p.callId === 'call_1')
  assert.ok(tool1, 'First edit must be present')
  assert.equal(tool1?.type === 'tool' && tool1.state, 'done')
  assert.ok(tool1?.type === 'tool' && tool1.diff, 'Must retain diff')

  // Find the interrupted tool
  const tool2 = last.parts?.find((p) => p.type === 'tool' && p.callId === 'call_2')
  assert.ok(tool2, 'Second edit must be present')
  assert.equal(tool2?.type === 'tool' && tool2.state, 'error')

  // Clean up test chat
  repo.removeChat(chat.id)
}

function testNormalTurnNoDuplicate(): void {
  getDb()
  const chat = repo.createChat({ title: 'Normal Turn Test' })
  const controller = new AbortController()
  const reqId = 'req_normal_123'

  beginActiveTurn(reqId, chat.id, controller)
  applyTurnEvent(reqId, { type: 'text', delta: 'Clean reply' })

  // Renderer finishes and marks persisted
  markTurnPersisted(chat.id)

  // Now flushAllActiveTurns should be a no-op because it was already persisted
  flushAllActiveTurns('interrupted')

  // listMessages should be empty because flush didn't run and messagesAdd wasn't called
  const msgs = repo.listMessages(chat.id)
  assert.equal(msgs.length, 0)

  repo.removeChat(chat.id)
}

function main(): void {
  testFinalizeInFlightParts()
  testTurnRecoveryPersistence()
  testNormalTurnNoDuplicate()
  console.log('✓ All turn recovery tests passed')
  app.quit()
}

main()
