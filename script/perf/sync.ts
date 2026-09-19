/**
 * Attributes the write-path change: real repo.addMessage with synchronous=NORMAL
 * vs FULL, measured on the SAME code so only the pragma differs.
 *
 * Runs under Electron: esbuild + electron (see perf:db for the pattern).
 */
import { app } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'roxy-sync-')))

import * as repo from '../../src/main/db/repo'
import { getDb } from '../../src/main/db/database'

function ms(fn: () => void): number {
  const t = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t) / 1e6
}

app.whenReady().then(() => {
  const N = 500
  const chat = repo.createChat({ title: 'sync bench' })
  for (let i = 0; i < 50; i++) repo.addMessage({ chatId: chat.id, role: 'user', content: 'w' })

  const normal = ms(() => {
    for (let i = 0; i < N; i++) repo.addMessage({ chatId: chat.id, role: 'user', content: 'x' })
  })
  getDb().pragma('synchronous = FULL')
  const full = ms(() => {
    for (let i = 0; i < N; i++) repo.addMessage({ chatId: chat.id, role: 'user', content: 'x' })
  })
  getDb().pragma('synchronous = NORMAL')

  const out =
    `\naddMessage x${N} on the real repo path:\n` +
    `  synchronous=NORMAL  ${normal.toFixed(1)} ms  (${((normal / N) * 1000).toFixed(1)} us/msg)\n` +
    `  synchronous=FULL    ${full.toFixed(1)} ms  (${((full / N) * 1000).toFixed(1)} us/msg)\n` +
    `  write speedup       ${(full / normal).toFixed(1)}x\n`
  const dest = join(process.cwd(), 'test/.out/perf-sync.txt')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, out)
  process.stdout.write(out)
  app.quit()
})
