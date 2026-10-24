import assert from 'node:assert/strict'
import { workspaceReviewHunks } from '../src/renderer/src/lib/workspace-review'

for (const [before, after] of [
  ['', 'created\n'],
  ['deleted\n', ''],
  ['one\nunchanged\ntwo\n', 'ONE\nunchanged\nTWO\n'],
  ['one\r\nunchanged\r\ntwo', 'ONE\r\nunchanged\r\nTWO'],
  ['hello', 'hello\n'],
  ['\uFEFFone\n', '\uFEFFtwo\n'],
  ['\uD83D\uDE00\nunchanged\nold\n', '\uD83D\uDE00\nunchanged\nnew\n']
]) {
  const hunks = workspaceReviewHunks(before, after, after)
  let restored = after
  for (const hunk of [...hunks].reverse()) {
    assert.equal(after.slice(hunk.offset, hunk.offset + hunk.added.length), hunk.added)
    restored =
      restored.slice(0, hunk.offset) +
      hunk.removed +
      restored.slice(hunk.offset + hunk.added.length)
  }
  assert.equal(restored, before)
  assert.deepEqual(hunks, workspaceReviewHunks(before, after, after))
}
assert.deepEqual(workspaceReviewHunks('same', 'same', 'same'), [])
assert.notEqual(
  workspaceReviewHunks('a', 'b', 'b')[0].id,
  workspaceReviewHunks('a', 'b', 'c')[0].id
)
console.log(
  'WORKSPACE REVIEW OK: hunk offsets, reversions, CRLF, BOM, Unicode and revision identity'
)
