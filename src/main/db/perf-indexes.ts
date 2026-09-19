/**
 * Creates the v27 performance indexes, idempotently and defensively.
 *
 * Why a function and not a plain SQL string:
 *   - `repairSchema` runs its DDL BEFORE it adds columns that later migrations
 *     introduced, so an index naming `chats.worktree_path` would explode on a
 *     database that predates that column.
 *   - the smoke test replays the migration ladder against deliberately truncated
 *     schemas (missing columns) and asserts it still opens; a bare
 *     `CREATE INDEX ... ON chats(worktree_path)` fails there with
 *     "no such column".
 *
 * Each index is created only when every column it references is present, so this
 * is safe to call from anywhere in the startup sequence. `ANALYZE` runs once at
 * the end so the planner picks these indexes by real cardinality rather than
 * guessing (measured: without stats it prefers idx_chats_workspace_kind over the
 * correctly-selective idx_chats_parent for the subagent lookup).
 */
import type { Database } from 'better-sqlite3'

/**
 * Columns of `table`, via PRAGMA. Inlined rather than imported from
 * `migrations.ts` so this module has no import edge back to it — that would be a
 * cycle, since `migrations.ts` imports `createPerfIndexes` from here.
 */
function tableColumns(db: Database, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(cols.map((c) => c.name))
}

export function createPerfIndexes(db: Database): void {
  const cache = new Map<string, Set<string>>()
  const has = (table: string, ...cols: string[]): boolean => {
    let present = cache.get(table)
    if (!present) {
      present = tableColumns(db, table)
      cache.set(table, present)
    }
    return cols.every((c) => present!.has(c))
  }

  const indexes: [table: string, columns: string[], sql: string][] = [
    [
      'chats',
      ['parent_id', 'created_at'],
      'CREATE INDEX IF NOT EXISTS idx_chats_parent ON chats(parent_id, created_at)'
    ],
    [
      'chats',
      ['kind', 'workspace_path'],
      'CREATE INDEX IF NOT EXISTS idx_chats_workspace_kind ON chats(kind, workspace_path)'
    ],
    [
      'chats',
      ['worktree_path'],
      'CREATE INDEX IF NOT EXISTS idx_chats_worktree ON chats(worktree_path)'
    ],
    [
      'chats',
      ['sort_order', 'updated_at'],
      'CREATE INDEX IF NOT EXISTS idx_chats_sort_order ON chats(sort_order DESC, updated_at DESC)'
    ],
    [
      'loops',
      ['enabled', 'next_run_at'],
      'CREATE INDEX IF NOT EXISTS idx_loops_due ON loops(enabled, next_run_at)'
    ],
    ['usage', ['chat_id'], 'CREATE INDEX IF NOT EXISTS idx_usage_chat ON usage(chat_id)']
  ]

  const exists = (name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name)

  let created = false
  for (const [table, cols, sql] of indexes) {
    if (!has(table, ...cols)) continue
    // `CREATE INDEX IF NOT EXISTS` is a no-op when the index is already there, so
    // check sqlite_master first — otherwise we cannot tell "created" from "was
    // already present" and would re-run ANALYZE on every single launch.
    const name = /idx_[a-z_]+/.exec(sql)?.[0]
    if (name && exists(name)) continue
    try {
      db.exec(sql)
      created = true
    } catch {
      // A partial/unexpected schema must never block startup — the indexes are
      // an optimization, and repairSchema will re-attempt next launch.
    }
  }
  if (created) {
    try {
      db.exec('ANALYZE')
    } catch {
      // Statistics are optional; a failure only means a less-informed planner.
    }
  }
}
