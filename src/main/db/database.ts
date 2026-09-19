import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { MIGRATIONS, repairSchema } from './migrations'

let instance: Database.Database | null = null

/**
 * Cached prepared statements, keyed on SQL text.
 *
 * `better-sqlite3` compiles and plans a statement on every `db.prepare(...)`, and
 * the repo layer calls `.prepare()` inline in its hottest functions —
 * `listMessages` (once per transcript reload), `getSettings` (every settings read
 * and every agent turn), `getChat`, `addMessage`, `recordUsage`. Measured, that
 * re-preparation is ~11% of a `listMessages` on a 1700-message transcript and a
 * similar slice of the write path, all of it avoidable: the SQL strings are
 * literals and the schema is fixed for the life of the process.
 *
 * A handful of functions already did this by hand (reorderProviders, forkChat,
 * …); this makes it the default instead of a special case. Cached statements
 * belong to one connection, so `closeDb` must drop them — a statement from a
 * closed database must never be handed back out.
 */
const stmtCache = new Map<string, Database.Statement>()

/** Prepare `sql`, reusing the compiled statement if this exact SQL ran before. */
export function prepareCached(sql: string): Database.Statement {
  const db = getDb()
  let stmt = stmtCache.get(sql)
  if (!stmt) {
    stmt = db.prepare(sql)
    stmtCache.set(sql, stmt)
  }
  return stmt
}

/** Lazily open the SQLite database, applying migrations on first access. */
export function getDb(): Database.Database {
  if (instance) return instance

  const file = join(app.getPath('userData'), 'roxy.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Durability/speed trade-offs, all safe for a desktop app's local store:
  //   synchronous=NORMAL — under WAL this fsyncs at CHECKPOINT rather than on
  //     every commit, so a crash can lose the last transaction but never
  //     corrupts the database. That turns a per-message disk flush into a
  //     rarely-paid one; the default (FULL) was the single biggest cost in
  //     `addMessage`, which runs once per user AND assistant message.
  //   busy_timeout — better-sqlite3 is synchronous, but another process (or a
  //     checkpoint) can still hold the write lock; wait 5s instead of throwing
  //     SQLITE_BUSY immediately.
  //   cache_size (negative = KiB) — 64 MiB page cache. The messages table is the
  //     hot read and SQLite's default (2 MiB) thrashes on long transcripts.
  //   temp_store=MEMORY — sorts (e.g. listChats' ORDER BY) stay off disk.
  //   mmap_size — let SQLite mmap up to 256 MiB of the DB file for reads.
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -65536')
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456')
  migrate(db)
  // Then re-assert the schema, unconditionally. `user_version` counts the steps
  // that RAN, not what the database contains: a counter that ran ahead of
  // reality (two branches numbering a migration the same, a partial upgrade, a
  // restored backup) leaves a DB that skips the whole ladder while missing a
  // table or column, and only crashes later at runtime. This is idempotent, so
  // it costs nothing when everything is already correct.
  repairSchema(db)

  instance = db
  return instance
}

function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version]
    const apply = db.transaction(() => {
      // A step is raw SQL, or a function for one that must inspect the schema
      // first (SQLite has no ADD COLUMN IF NOT EXISTS).
      if (typeof step === 'string') db.exec(step)
      else step(db)
      db.pragma(`user_version = ${version + 1}`)
    })
    apply()
  }
}

export function closeDb(): void {
  instance?.close()
  instance = null
  // Statements are bound to the connection that compiled them; leak them and
  // the next open would hand out a statement pointing at a dead database.
  stmtCache.clear()
}
