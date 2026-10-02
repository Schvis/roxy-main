/// <reference types="node" />

import assert from 'node:assert/strict'
import { chatDockAtPoint } from '../src/renderer/src/lib/chat-dock'

const rect = { left: 200, right: 1200, top: 100, bottom: 900, width: 1000, height: 800 }
assert.equal(chatDockAtPoint(rect, 250, 200), 'left')
assert.equal(chatDockAtPoint(rect, 1150, 200), 'right')
assert.equal(chatDockAtPoint(rect, 700, 200), 'right')
assert.equal(chatDockAtPoint(rect, 250, 700), 'bottom')
assert.equal(chatDockAtPoint(rect, 1150, 850), 'bottom')
assert.equal(chatDockAtPoint(rect, 200, 100), 'left')
assert.equal(chatDockAtPoint(rect, 1200, 900), 'bottom')
for (const [x, y] of [
  [199, 400],
  [1201, 400],
  [500, 99],
  [500, 901]
]) {
  assert.equal(chatDockAtPoint(rect, x, y), null)
}
console.log('Chat docking: 11 checks passed')
