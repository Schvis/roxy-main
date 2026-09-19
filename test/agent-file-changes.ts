import assert from 'node:assert/strict'
import type { Message, MessagePart } from '../src/shared/types'

function message(parts: MessagePart[]): Message {
  return { id: 'message', chatId: 'chat', role: 'assistant', content: '', parts, createdAt: 0 }
}

function tool(path: string, before: string, after: string): MessagePart {
  return {
    type: 'tool',
    tool: 'write',
    state: 'done',
    diff: { path, before, after }
  }
}

async function main(): Promise<void> {
  ;(globalThis as { window?: unknown }).window = { roxy: {} }
  const { extractAgentFileChanges } = await import('../src/renderer/src/lib/agent-file-changes')

  const createdThenDeleted = extractAgentFileChanges(
    [
      message([tool('new-file.txt', '', 'created')]),
      message([tool('new-file.txt', 'created', '')])
    ],
    null
  )
  assert.equal(createdThenDeleted.files.length, 0)
  assert.equal(createdThenDeleted.pendingCount, 0)

  const stillCreated = extractAgentFileChanges(
    [message([tool('new-file.txt', '', 'created')])],
    null
  )
  assert.equal(stillCreated.files.length, 1)
  assert.equal(stillCreated.files[0].isCreated, true)

  console.log('agent file change aggregation checks passed')
}

void main()
