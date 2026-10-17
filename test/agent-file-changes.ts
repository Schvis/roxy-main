import assert from 'node:assert/strict'
import type { Message, MessagePart } from '../src/shared/types'
import { PartsFold } from '../src/shared/parts'
import { observeToolFiles, toolDiff } from '../src/main/harness/file-changes'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
  const writes: string[] = []
  let writeStatus: 'saved' | 'conflict' = 'saved'
  const reviews = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => reviews.get(key) ?? null,
    setItem: (key: string, value: string) => reviews.set(key, value)
  }
  ;(globalThis as { window?: unknown }).window = { roxy: { files: {
    create: async () => ({ success: true }),
    read: async () => ({ revision: 'revision' }),
    write: async (_session: string, _path: string, content: string) => {
      writes.push(content)
      return { status: writeStatus }
    }
  } } }
  const { extractAgentFileChanges, pathsMatch, stripWorkspaceRoot, setFileReviewStatus, undoFileChange } =
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

  const large = 'x'.repeat(100_001)
  assert.equal(toolDiff('large.txt', large, large + 'y')?.after, large + 'y')
  assert.equal(toolDiff('unchanged.txt', large, large), undefined)
  const emptyCreated = toolDiff('empty.txt', '', '', false)!
  const emptySummary = extractAgentFileChanges([message([
    { type: 'tool', tool: 'write', state: 'done', diff: emptyCreated }
  ])], null)
  assert.equal(emptySummary.pendingCount, 1)
  assert.equal(emptySummary.files[0].isCreated, true)

  // Equal-length edits beyond the old 40-character cache prefix must not
  // reuse a no-op result and silently mark a new edit as kept.
  const prefix = 'x'.repeat(80)
  setFileReviewStatus('cache-session', 'cache.txt', 'kept', prefix + 'a')
  extractAgentFileChanges([message([tool('cache.txt', prefix + 'a', prefix + 'a')])], null)
  const collision = extractAgentFileChanges([
    message([tool('cache.txt', prefix + 'a', prefix + 'b')])
  ], null, 'cache-session')
  assert.equal(collision.pendingCount, 1)
  assert.equal(collision.totalAdded, 1)

  // Shell snapshots start with the actual dirty working tree, not HEAD.
  const directory = path.resolve('test', '.out', `file-changes-${process.pid}`)
  await fs.mkdir(directory, { recursive: true })
  try {
    await fs.writeFile(path.join(directory, 'dirty.txt'), 'user changes')
    await fs.writeFile(path.join(directory, 'delete.txt'), 'remove me')
    const observed = await observeToolFiles(directory, async () => {
      await promisify(execFile)(process.execPath, ['-e',
        "const fs=require('node:fs');fs.writeFileSync('dirty.txt','agent changes');fs.writeFileSync('new.txt','new');fs.unlinkSync('delete.txt')"
      ], { cwd: directory })
      return { ok: false, output: 'command may fail after writing files' }
    })
    assert.equal(observed.diffs.length, 3)
    assert.equal(observed.diffs.find((d) => d.path === 'dirty.txt')?.before, 'user changes')
    const fold = new PartsFold()
    fold.apply({ type: 'tool-start', callId: 'shell', tool: 'bash', title: 'shell' })
    fold.apply({ type: 'tool-end', callId: 'shell', ...observed.result, diffs: observed.diffs })
    // Simulate SQLite parts JSON roundtrip and stream -> persisted handoff.
    const saved = JSON.parse(JSON.stringify(fold.parts)) as MessagePart[]
    const live = extractAgentFileChanges([], fold.parts, 'shell-session')
    const persisted = extractAgentFileChanges([message(saved)], null, 'shell-session')
    assert.equal(live.pendingCount, 3)
    assert.deepEqual(persisted, live)
    assert.equal(persisted.latestTurnFiles.length, 3)
    const deleted = persisted.files.find((file) => file.isDeleted)!
    writeStatus = 'conflict'
    assert.equal(await undoFileChange('shell-session', deleted), false)
    assert.equal(extractAgentFileChanges([message(saved)], null, 'shell-session').pendingCount, 3)
    writeStatus = 'saved'
    assert.equal(await undoFileChange('shell-session', deleted), true)
    assert.equal(writes.at(-1), 'remove me')
    assert.ok(reviews.get('roxy.file_review_statuses')?.includes('undone'))
    setFileReviewStatus('shell-session', 'dirty.txt', 'kept', 'agent changes')
    assert.equal(extractAgentFileChanges([message(saved)], null, 'shell-session').pendingCount, 1)
    assert.equal((await observeToolFiles(directory, async () => true)).diffs.length, 0)
    const nested: MessagePart[] = [{ type: 'tool', tool: 'task', state: 'done', children: [
      { type: 'tool', tool: 'task', state: 'done', children: saved }
    ] }]
    assert.equal(extractAgentFileChanges([message(nested)], null).latestTurnFiles.length, 3)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }

  console.log('agent file change aggregation checks passed')
}

void main()
