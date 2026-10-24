import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dir = await mkdtemp(join(tmpdir(), 'roxy-remote-test-'))
const frames = []
const chats = [{ id: 'one', kind: 'main', title: 'One', workspacePath: '/project', updatedAt: 1 }]
const queue = []
let socket
let created = 0
class Socket extends EventEmitter {
  static OPEN = 1
  readyState = 1
  constructor() {
    super()
    socket = this
  }
  send(raw) {
    frames.push(JSON.parse(raw))
  }
  close() {}
}
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    brokerId: 'room',
    hostToken: 'host',
    guestToken: 'guest',
    url: 'https://example.test',
    pin: '123456',
    expiresAt: Date.now() + 100000
  })
})
const mocks = {
  electron: { BrowserWindow: { getAllWindows: () => [] } },
  ws: { default: Socket },
  '../db/repo': {
    getChat: (id) => chats.find((chat) => chat.id === id),
    listChats: () => chats,
    listMessages: () => [],
    listQueue: () => queue,
    listProjectOrder: () => ['/project'],
    getSettings: () => ({}),
    listConnectedProviders: () => [],
    listHiddenModels: () => [],
    listRecentModels: () => [],
    setChatConfig() {},
    createChat: (input) => {
      const chat = { ...chats[0], ...input, id: `new-${++created}` }
      chats.push(chat)
      return chat
    },
    updateQueueItem: (id, text) => {
      const item = queue.find((entry) => entry.id === id)
      if (item) item.content = text
    },
    reorderQueue: () => {},
    removeQueueItem: () => {}
  },
  './automation': {
    enqueuePrompt: (id, text) =>
      queue.push({
        id: `q-${queue.length}`,
        chatId: id,
        content: text,
        state: 'pending',
        fromUser: true
      }),
    notifyAutomation() {}
  },
  './turn-state': { resumeQueue() {}, sessionBusy: () => false, stopTurn() {} },
  './track': { track() {}, trackFeature() {} },
  './workspace': { sessionCwd: () => '/project' },
  './models': { listModelCatalog: async () => ({ models: [] }) },
  './session-events': { emitSessionsUpdated() {} },
  './git': { getChangedFiles: async () => [], repoRoot: async () => '/project' }
}
globalThis.__remoteMocks = mocks
try {
  const source = await readFile('src/main/services/remote.ts', 'utf8')
  await build({
    stdin: {
      contents: source + '\nexport { onFrame as receiveTestFrame }',
      resolveDir: resolve('src/main/services'),
      loader: 'ts'
    },
    outfile: join(dir, 'remote.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'remote-mocks',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined
          )
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
            contents: Object.keys(mocks[args.path])
              .map((name) =>
                name === 'default'
                  ? `export default globalThis.__remoteMocks[${JSON.stringify(args.path)}].default`
                  : `export const ${name} = globalThis.__remoteMocks[${JSON.stringify(args.path)}][${JSON.stringify(name)}]`
              )
              .join('\n'),
            loader: 'js'
          }))
        }
      }
    ]
  })
  const service = require(join(dir, 'remote.cjs'))
  await service.start({ sessionId: 'one', scope: 'all' })
  socket.emit('open')
  const receive = async (frame) => {
    service.receiveTestFrame(JSON.stringify(frame))
    await new Promise((r) => setImmediate(r))
  }
  await receive({
    t: 'request',
    requestId: 'create',
    action: 'create-session',
    title: 'New',
    workspacePath: '/project'
  })
  await receive({
    t: 'request',
    requestId: 'create',
    action: 'create-session',
    title: 'New',
    workspacePath: '/project'
  })
  assert.equal(created, 1, 'lost-ack retry must not duplicate session creation')
  await receive({
    t: 'request',
    requestId: 'prompt',
    action: 'prompt',
    sessionId: 'one',
    text: 'hello'
  })
  await receive({ t: 'switch', sessionId: 'new-1' })
  await receive({
    t: 'request',
    requestId: 'prompt',
    action: 'prompt',
    sessionId: 'one',
    text: 'hello'
  })
  assert.equal(queue.length, 1, 'retry after switch must not duplicate prompt')
  assert.equal(queue[0].chatId, 'one', 'pending prompt stays bound to original session')
  queue[0].state = 'running'
  await receive({
    t: 'request',
    requestId: 'edit',
    action: 'queue-edit',
    sessionId: 'one',
    id: queue[0].id,
    text: 'changed'
  })
  assert.equal(queue[0].content, 'hello', 'running queue item cannot be edited')
  assert.equal(frames.find((f) => f.t === 'ack' && f.requestId === 'edit').ok, false)
  const relay = service.relayLocalTurnStart('one', 'hello')
  service.relayLocalTurnEvent(relay, { type: 'text', delta: 'partial reply' })
  await receive({ t: 'switch', sessionId: 'one' })
  await receive({ t: 'hello' })
  const running = frames.filter((f) => f.t === 'turn' && f.state === 'running' && f.parts).at(-1)
  assert.equal(
    running.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(''),
    'partial reply',
    'reconnect restores live reply exactly once'
  )
  service.relayLocalTurnEnd(relay)
  await receive({
    t: 'request',
    deviceId: 'device-a',
    requestId: 'private',
    action: 'changes',
    sessionId: 'one'
  })
  assert.ok(
    frames.some(
      (f) => f.t === 'routed' && f.deviceId === 'device-a' && f.frame.requestId === 'private'
    ),
    'read response must target its requester'
  )
  await service.stop()
  await service.start({ sessionId: 'one', scope: 'session' })
  socket.emit('open')
  await receive({
    t: 'request',
    requestId: 'scope',
    action: 'prompt',
    sessionId: 'new-1',
    text: 'forbidden'
  })
  assert.equal(
    frames.find((f) => f.requestId === 'scope').ok,
    false,
    'session scope rejects another session'
  )
  const beforeImages = queue.length
  await receive({
    t: 'request',
    requestId: 'bad-image',
    action: 'prompt',
    sessionId: 'one',
    text: 'image',
    images: [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }]
  })
  assert.equal(queue.length, beforeImages, 'malformed image cannot partially enqueue')

  // Custom relay base: validated before use, and the server must hand out links on its own origin.
  await service.stop()
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return realFetch(url, init)
  }
  const rejected = await service.start({ sessionId: 'one', relayBase: 'http://relay.example.com' })
  assert.equal(rejected.phase, 'error', 'plain http to a remote host is refused')
  assert.equal(calls.length, 0, 'a refused address makes no network request')
  const mismatch = await service.start({ sessionId: 'one', relayBase: 'https://other.test' })
  assert.equal(mismatch.phase, 'error', 'a pairing link on a different origin is refused')
  assert.ok(
    calls.some((c) => c.startsWith('POST https://other.test/api/remote/sessions')),
    'mint goes to the chosen server'
  )
  assert.ok(
    calls.some((c) => c.startsWith('DELETE https://other.test/api/remote/sessions/')),
    'the mismatched room is revoked on the same server'
  )
  const matched = await service.start({ sessionId: 'one', relayBase: 'https://example.test/' })
  assert.equal(matched.phase === 'error', false, 'a matching origin is accepted')
  assert.equal(matched.relayBase, 'https://example.test', 'the share reports the normalized server')
  globalThis.fetch = realFetch
  await service.stop()
  console.log(
    'REMOTE SERVICE OK: duplicate creation/prompt retries, session binding, running queue race, live-turn resync'
  )
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.__remoteMocks
  await rm(dir, { recursive: true, force: true })
}
