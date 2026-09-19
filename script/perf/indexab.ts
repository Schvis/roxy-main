/**
 * A/B: same seeded database, hot queries measured WITH the v27 indexes and then
 * with them DROPped, so the delta is attributable to the indexes alone.
 *
 * Runs under Electron: npm run perf:indexab
 */
import { app } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'roxy-indexab-')))

import * as repo from '../../src/main/db/repo'
import { getDb } from '../../src/main/db/database'

function ms(fn: () => void): number {
  const t = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t) / 1e6
}

const IDX = [
  'idx_chats_parent',
  'idx_chats_workspace_kind',
  'idx_chats_worktree',
  'idx_chats_sort_order',
  'idx_loops_due',
  'idx_usage_chat'
]

app.whenReady().then(() => {
  const workspaces = ['/proj/a', '/proj/b', '/proj/c']
  const parents: string[] = []
  for (let w = 0; w < workspaces.length; w++) {
    for (let i = 0; i < 60; i++) {
      const c = repo.createChat({ title: `s${w}-${i}`, workspacePath: workspaces[w] })
      if (i === 0) parents.push(c.id)
    }
  }
  for (const p of parents) {
    for (let i = 0; i < 60; i++) repo.createChat({ title: 'sub', parentId: p, kind: 'sub' })
  }
  for (let i = 0; i < 6; i++) repo.createChat({ title: 'loop', kind: 'loop' })

  const db = getDb()
  const N = 500

  const subStmt = db.prepare('SELECT * FROM chats WHERE parent_id = ? ORDER BY created_at ASC')
  const wsStmt = db.prepare("SELECT id FROM chats WHERE kind = 'main' AND workspace_path IS ?")

  const measure = (): Record<string, number> => {
    const r: Record<string, number> = {}
    r.listChats = ms(() => {
      for (let i = 0; i < N; i++) repo.listChats()
    })
    r.subagents = ms(() => {
      for (let i = 0; i < N; i++) subStmt.all(parents[i % parents.length])
    })
    r.workspace = ms(() => {
      for (let i = 0; i < N; i++) wsStmt.all(workspaces[i % workspaces.length])
    })
    r.dueLoops = ms(() => {
      for (let i = 0; i < N; i++) repo.dueLoops(Date.now())
    })
    return r
  }

  const withIdx = measure()

  for (const i of IDX) db.exec('DROP INDEX IF EXISTS ' + i)
  db.exec('ANALYZE')
  const without = measure()

  const rows = ['listChats', 'subagents', 'workspace', 'dueLoops']
  const out =
    `\nIndex A/B on 180 chats + 180 subs + 6 loops, x${N}:\n` +
    '  query        without idx     with idx    speedup\n' +
    rows
      .map((k) => {
        const w = without[k]
        const a = withIdx[k]
        return (
          '  ' +
          k.padEnd(12) +
          w.toFixed(1).padStart(9) +
          ' ms' +
          a.toFixed(1).padStart(10) +
          ' ms' +
          (w / a).toFixed(2).padStart(10) +
          'x'
        )
      })
      .join('\n') +
    '\n'
  const dest = join(process.cwd(), 'test/.out/perf-index.txt')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, out)
  process.stdout.write(out)
  app.quit()
})
