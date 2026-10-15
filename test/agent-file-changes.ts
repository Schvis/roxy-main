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
  const { extractAgentFileChanges, pathsMatch, stripWorkspaceRoot, setFileReviewStatus } =
    await import('../src/renderer/src/lib/agent-file-changes')

  // Basic aggregation checks
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

  // pathsMatch checks: relative paths do not falsely match
  assert.equal(pathsMatch('index.ts', 'src/index.ts'), false)
  assert.equal(pathsMatch('components/Button.tsx', 'Button.tsx'), false)
  assert.equal(pathsMatch('src/index.ts', 'src/index.ts'), true)
  assert.equal(pathsMatch('C:/repo/src/index.ts', 'src/index.ts'), true)
  assert.equal(pathsMatch('C:/repo/src/index.ts', 'C:/repo/index.ts'), false)

  // stripWorkspaceRoot checks
  assert.equal(stripWorkspaceRoot('D:/repo/src/app.ts', 'D:/repo'), 'src/app.ts')
  assert.equal(stripWorkspaceRoot('D:\\repo\\src\\app.ts', 'D:\\repo'), 'src/app.ts')
  assert.equal(stripWorkspaceRoot('src/app.ts', 'D:/repo'), 'src/app.ts')

  // Subagent child tool diffs are extracted
  const taskWithChildren = extractAgentFileChanges(
    [
      message([
        {
          type: 'tool',
          tool: 'task',
          state: 'done',
          children: [tool('subagent-file.ts', 'before', 'after')]
        }
      ])
    ],
    null
  )
  assert.equal(taskWithChildren.files.length, 1)
  assert.equal(taskWithChildren.files[0].path, 'subagent-file.ts')
  assert.equal(taskWithChildren.files[0].isModified, true)

  // changeKey changes even when edit preserves length
  const edit1 = extractAgentFileChanges([message([tool('test.txt', 'cat', 'dog')])], null)
  const edit2 = extractAgentFileChanges([message([tool('test.txt', 'cat', 'cow')])], null)
  assert.notEqual(edit1.changeKey, edit2.changeKey)

  // A kept file modified in the latest turn reverts to pending review
  setFileReviewStatus('test-session', 'edited.ts', 'kept', 'version1')
  const multiTurnChanges = extractAgentFileChanges(
    [
      message([tool('edited.ts', 'original', 'version1')]),
      message([tool('edited.ts', 'version1', 'version2')])
    ],
    null,
    'test-session'
  )
  assert.equal(multiTurnChanges.files.length, 1)
  assert.equal(multiTurnChanges.files[0].reviewStatus, 'pending')
  assert.equal(multiTurnChanges.pendingCount, 1)

  console.log('agent file change aggregation checks passed')
}

void main()
