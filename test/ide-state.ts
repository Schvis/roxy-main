import assert from 'node:assert/strict'
import {
  EXPANDED_FOLDERS_STORAGE_PREFIX,
  ACTIVE_FILE_STORAGE_PREFIX,
  normalizeRoot,
  getAncestorPaths,
  loadExpandedFolders,
  saveExpandedFolders,
  loadActiveFile,
  saveActiveFile,
  loadSessionActiveFile,
  saveSessionActiveFile,
  loadLastActiveFile,
  migrateRenamedPath,
  pruneDeletedPath
} from '../src/renderer/src/lib/ide-state'

// Mock localStorage for node test environment
const storage = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, val),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear()
}
;(globalThis as unknown as { localStorage: typeof mockLocalStorage }).localStorage =
  mockLocalStorage

function testNormalizeRoot(): void {
  assert.equal(normalizeRoot('d:\\so\\Roxy\\'), 'd:/so/Roxy')
  assert.equal(normalizeRoot('/home/user/project/'), '/home/user/project')
  assert.equal(normalizeRoot(null), '')
  assert.equal(normalizeRoot(undefined), '')
}

function testGetAncestorPaths(): void {
  assert.deepEqual(getAncestorPaths('src/components/FileEditor.tsx'), ['src', 'src/components'])
  assert.deepEqual(getAncestorPaths('index.ts'), [])
  assert.deepEqual(getAncestorPaths('a/b/c/d/e.txt'), ['a', 'a/b', 'a/b/c', 'a/b/c/d'])
  assert.deepEqual(getAncestorPaths('src\\components\\FileEditor.tsx'), ['src', 'src/components'])
}

function testExpandedFoldersPersistence(): void {
  storage.clear()
  const root = 'd:/workspace/test'

  // Initially empty
  const initial = loadExpandedFolders(root)
  assert.equal(initial.size, 0)

  // Save expanded folders
  saveExpandedFolders(root, new Set(['src', 'src/lib']))
  const key = `${EXPANDED_FOLDERS_STORAGE_PREFIX}:${normalizeRoot(root)}`
  assert.ok(storage.has(key))

  // Load back
  const loaded = loadExpandedFolders(root)
  assert.equal(loaded.size, 2)
  assert.ok(loaded.has('src'))
  assert.ok(loaded.has('src/lib'))

  // Overwrite with empty -> removes key
  saveExpandedFolders(root, new Set())
  assert.equal(storage.has(key), false)
  assert.equal(loadExpandedFolders(root).size, 0)

  // Null root returns empty
  assert.equal(loadExpandedFolders(null).size, 0)
}

function testActiveFilePersistence(): void {
  storage.clear()
  const root = 'd:/workspace/test'

  // Initially null
  assert.equal(loadActiveFile(root), null)

  // Save active file with line
  saveActiveFile(root, { path: 'src/main.ts', name: 'main.ts', line: 42 })
  const key = `${ACTIVE_FILE_STORAGE_PREFIX}:${normalizeRoot(root)}`
  assert.ok(storage.has(key))

  // Load back
  const loaded = loadActiveFile(root)
  assert.deepEqual(loaded, { path: 'src/main.ts', name: 'main.ts', line: 42 })

  // Clear active file
  saveActiveFile(root, null)
  assert.equal(storage.has(key), false)
  assert.equal(loadActiveFile(root), null)
}

function testSessionActiveFilePersistence(): void {
  storage.clear()
  const sessionId = 'session-123'
  const root = 'd:/workspace/test'

  assert.equal(loadSessionActiveFile(sessionId), null)
  assert.equal(loadLastActiveFile(), null)

  saveSessionActiveFile(sessionId, { path: 'src/app.tsx', name: 'app.tsx', line: 10 }, root)
  const sessionFile = loadSessionActiveFile(sessionId)
  assert.deepEqual(sessionFile, { path: 'src/app.tsx', name: 'app.tsx', line: 10, root })

  const lastActive = loadLastActiveFile()
  assert.deepEqual(lastActive, { path: 'src/app.tsx', name: 'app.tsx', line: 10, root, sessionId })

  saveSessionActiveFile(sessionId, null)
  assert.equal(loadSessionActiveFile(sessionId), null)
  assert.equal(loadLastActiveFile(), null)
}

function testMigrateRenamedPath(): void {
  const folders = new Set(['src', 'src/components', 'src/components/diff', 'docs'])
  const migrated = migrateRenamedPath(folders, 'src/components', 'src/ui')
  assert.ok(migrated.has('src'))
  assert.ok(migrated.has('src/ui'))
  assert.ok(migrated.has('src/ui/diff'))
  assert.ok(migrated.has('docs'))
  assert.ok(!migrated.has('src/components'))
  assert.ok(!migrated.has('src/components/diff'))
}

function testPruneDeletedPath(): void {
  const folders = new Set(['src', 'src/components', 'src/components/diff', 'docs'])
  const pruned = pruneDeletedPath(folders, 'src/components')
  assert.ok(pruned.has('src'))
  assert.ok(pruned.has('docs'))
  assert.ok(!pruned.has('src/components'))
  assert.ok(!pruned.has('src/components/diff'))
}

function run(): void {
  testNormalizeRoot()
  testGetAncestorPaths()
  testExpandedFoldersPersistence()
  testActiveFilePersistence()
  testSessionActiveFilePersistence()
  testMigrateRenamedPath()
  testPruneDeletedPath()
  console.log('ide-state tests passed')
}

run()
