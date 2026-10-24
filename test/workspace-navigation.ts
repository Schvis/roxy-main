import assert from 'node:assert/strict'

async function main(): Promise<void> {
  let roots = ['/repo/a', '/repo/a/nested', '/repo/b']
  Object.assign(globalThis, {
    document: { documentElement: { dataset: { platform: 'linux' } } },
    window: { roxy: { git: { repositories: async () => roots } } }
  })
  const { resolveWorkspaceFile } = await import('../src/renderer/src/lib/workspace-navigation')
  const snapshot = { roots: roots.map((_, index) => ({ id: String(index) })) } as any
  assert.deepEqual(await resolveWorkspaceFile('session', '/repo', 'a/nested/file.ts', snapshot), {
    rootId: '1',
    path: 'file.ts'
  })
  assert.deepEqual(await resolveWorkspaceFile('session', '/repo', '/repo/b/file.ts', snapshot), {
    rootId: '2',
    path: 'file.ts'
  })
  assert.equal(await resolveWorkspaceFile('session', '/repo', 'A/file.ts', snapshot), null)
  assert.equal(await resolveWorkspaceFile('session', '/repo', '../outside', snapshot), null)
  assert.equal(await resolveWorkspaceFile('session', '/repo', '/outside/file.ts', snapshot), null)
  const single = { roots: [{ id: 'workspace' }] } as any
  assert.deepEqual(await resolveWorkspaceFile('session', '/repo', './src/file.ts', single), {
    rootId: 'workspace',
    path: 'src/file.ts'
  })
  document.documentElement.dataset.platform = 'win32'
  roots = ['C:/Repo/a']
  assert.deepEqual(
    await resolveWorkspaceFile('session', 'C:\\Repo', 'c:\\repo\\a\\file.ts', snapshot),
    { rootId: '0', path: 'file.ts' }
  )
  console.log(
    'WORKSPACE NAVIGATION OK: nested repositories, containment, case sensitivity and Windows paths'
  )
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
