/**
 * Database-layer benchmark. Runs the REAL repo.ts against a temp SQLite file so
 * we can measure before/after a change honestly.
 *
 * `better-sqlite3` here is a native module built for Electron's Node ABI, so this
 * MUST run under Electron (like test/smoke.ts), not system node:
 *
 *   esbuild script/perf/db.ts --bundle --platform=node --format=cjs \
 *     --packages=external --outfile=test/.perf/db.cjs && electron test/.perf/db.cjs
 *
 * or just: npm run perf:db
 *
 * Measures the operations the perf audit flagged as hot:
 *   - settings:  getSettings() x N           (whole table read each call)
 *   - chats:     listChats() x N             (scan+sort, unindexed sort_order)
 *   - append:    addMessage() x N            (INSERT+UPDATE, no stmt cache)
 *   - reload:    listMessages() x N on a long transcript (full history read)
 *   - cycle:     add 1 msg then listMessages() the whole chat (the write->reload
 *                loop the renderer's `messages:updated` handler drives)
 *   - bulk:      insert 1500 messages, then read them all
 */
import { app } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Point Electron's userData at a throwaway dir BEFORE the db module opens it,
// so the benchmark never touches the real ~/Roxy database.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'roxy-perf-')))

import * as repo from '../../src/main/db/repo'

function ms(fn: () => void): number {
  const t = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t) / 1e6
}

function run(): void {
  const results: Record<string, number> = {}
  const N = 400

  results['getSettings x' + N] = ms(() => {
    for (let i = 0; i < N; i++) repo.getSettings()
  })

  for (let i = 0; i < 60; i++) repo.createChat({ title: `chat ${i}` })
  results['listChats x' + N] = ms(() => {
    for (let i = 0; i < N; i++) repo.listChats()
  })

  const chat = repo.createChat({ title: 'bench chat' })
  results['addMessage (empty) x' + N] = ms(() => {
    for (let i = 0; i < N; i++) repo.addMessage({ chatId: chat.id, role: 'user', content: 'x' })
  })

  const big = repo.createChat({ title: 'big' })
  const bulk = ms(() => {
    for (let i = 0; i < 1500; i++) {
      repo.addMessage({
        chatId: big.id,
        role: i % 2 ? 'assistant' : 'user',
        content: 'lorem ipsum '.repeat(40),
        parts: [
          { type: 'text', text: 'lorem ipsum '.repeat(20) },
          { type: 'reasoning', text: 'thinking '.repeat(20) },
          {
            type: 'tool',
            tool: 'bash',
            state: 'done',
            callId: 'c' + i,
            input: { command: 'ls' },
            output: 'out '.repeat(100)
          }
        ]
      })
    }
  })
  results['bulk addMessage x1500'] = bulk

  const bigCount = repo.listMessages(big.id).length
  results['listMessages (' + bigCount + ' msgs) x20'] = ms(() => {
    for (let i = 0; i < 20; i++) repo.listMessages(big.id)
  })

  results['cycle add+reload x' + N + ' (' + bigCount + 'msgs)'] = ms(() => {
    for (let i = 0; i < N; i++) {
      repo.addMessage({ chatId: big.id, role: 'assistant', content: 'more' })
      repo.listMessages(big.id)
    }
  })

  const lines = ['', 'DB benchmark (lower is better)', '='.repeat(60)]
  for (const [k, v] of Object.entries(results)) {
    lines.push('  ' + k.padEnd(40) + v.toFixed(1).padStart(10) + ' ms')
  }
  lines.push('='.repeat(60))
  const out = lines.join('\n') + '\n'
  const dest = join(process.cwd(), 'test/.out/perf-db.txt')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, out)
  process.stdout.write(out)
}

app.whenReady().then(() => {
  try {
    run()
  } catch (e) {
    const dest = join(process.cwd(), 'test/.out/perf-db-err.txt')
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, String((e as Error)?.stack ?? e))
    process.exitCode = 1
  }
  app.quit()
})
