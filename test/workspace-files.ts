import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  chmod,
  readdir,
  symlink,
  rm
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  renameWorkspaceFile,
  replaceWorkspaceFiles,
  searchWorkspaceFiles,
  writeWorkspaceFile,
  MAX_FILE_BYTES
} from '../src/main/services/workspace-files'
import { isGitAvailable } from '../src/main/services/git'

async function main(): Promise<void> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'roxy-files-'))
  const root = path.join(temp, 'root')
  const outside = path.join(temp, 'root-other')
  try {
    await mkdir(root)
    await mkdir(outside)
    await mkdir(path.join(root, 'z-folder'))
    await writeFile(path.join(root, 'a.txt'), 'hello 世界')
    await writeFile(path.join(root, 'empty'), '')
    await writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]))
    await writeFile(path.join(root, 'invalid-utf8'), Buffer.from([255]))
    await writeFile(path.join(root, 'large'), Buffer.alloc(MAX_FILE_BYTES + 10, 97))
    await writeFile(path.join(root, 'exact'), Buffer.alloc(MAX_FILE_BYTES, 97))
    await writeFile(path.join(outside, 'secret'), 'outside')
    // Windows junctions need no symlink privilege and exercise directory escapes.
    await symlink(outside, path.join(root, 'escape'), 'junction')
    await symlink(path.join(root, 'z-folder'), path.join(root, 'inside'), 'junction')
    const entries = await listWorkspaceFiles(root, '')
    assert.equal(entries[0].name, 'z-folder')
    assert.equal(entries[0].directory, true)
    assert(!entries.some((entry) => ['escape', 'inside'].includes(entry.name)))
    assert(entries.every((entry) => !path.isAbsolute(entry.path) && !entry.path.includes('\\')))
    const first = await readWorkspaceFile(root, 'a.txt')
    assert.deepEqual(first, {
      content: 'hello 世界',
      truncated: false,
      binary: false,
      revision: first.revision
    })
    assert.match(first.revision!, /^[a-f0-9]{64}$/)
    assert.equal((await readWorkspaceFile(root, 'empty')).content, '')
    for (const name of ['binary', 'invalid-utf8']) {
      assert.deepEqual(await readWorkspaceFile(root, name), {
        content: '',
        truncated: false,
        binary: true,
        revision: null
      })
    }
    const large = await readWorkspaceFile(root, 'large')
    assert.equal(large.content.length, MAX_FILE_BYTES)
    assert.equal(large.truncated, true)
    assert.equal(large.revision, null)
    assert.equal((await readWorkspaceFile(root, 'exact')).truncated, false)
    for (const target of ['../root-other/secret', path.join(outside, 'secret'), 'escape/secret']) {
      await assert.rejects(readWorkspaceFile(root, target))
    }
    await assert.rejects(listWorkspaceFiles(root, 'escape'))
    await assert.rejects(listWorkspaceFiles(root, '../root-other'))
    await assert.rejects(readWorkspaceFile(root, 'z-folder'))
    await assert.rejects(readWorkspaceFile(root, 'missing'))
    await assert.rejects(listWorkspaceFiles('', ''))
    await assert.rejects(readWorkspaceFile(root, '\0'))
    assert.deepEqual(await listWorkspaceFiles(root, '.'), entries)

    const saved = await writeWorkspaceFile(root, 'a.txt', 'edited 世界', first.revision!)
    assert.equal(saved.status, 'saved')
    assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'edited 世界')
    assert.deepEqual(saved, {
      status: 'saved',
      revision: (await readWorkspaceFile(root, 'a.txt')).revision
    })
    assert.deepEqual(await writeWorkspaceFile(root, 'a.txt', 'stale', first.revision!), {
      status: 'conflict'
    })
    const beforeExternal = await readWorkspaceFile(root, 'a.txt')
    await writeFile(path.join(root, 'a.txt'), 'external edit')
    assert.deepEqual(
      await writeWorkspaceFile(root, 'a.txt', 'lost edit', beforeExternal.revision!),
      { status: 'conflict' }
    )
    assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'external edit')

    await writeFile(path.join(root, 'bom'), '\uFEFForiginal\r\n')
    const bom = await readWorkspaceFile(root, 'bom')
    assert.equal(bom.content, '\uFEFForiginal\r\n')
    await writeWorkspaceFile(root, 'bom', bom.content + 'new\r\n', bom.revision!)
    assert.deepEqual(
      await readFile(path.join(root, 'bom')),
      Buffer.from('\uFEFForiginal\r\nnew\r\n')
    )
    await writeFile(path.join(root, 'copy'), 'external edit')
    const current = await readWorkspaceFile(root, 'a.txt')
    assert.notEqual((await readWorkspaceFile(root, 'copy')).revision, current.revision)
    assert.deepEqual(await writeWorkspaceFile(root, 'copy', 'wrong target', current.revision!), {
      status: 'conflict'
    })
    const concurrent = await Promise.all([
      writeWorkspaceFile(root, 'a.txt', 'winner one', current.revision!),
      writeWorkspaceFile(root, './a.txt', 'winner two', current.revision!)
    ])
    assert.deepEqual(concurrent.map((result) => result.status).sort(), ['conflict', 'saved'])
    await writeFile(path.join(root, 'z-folder', 'linked'), 'link content')
    const linked = await readWorkspaceFile(root, 'inside/linked')
    assert.equal(linked.revision, (await readWorkspaceFile(root, 'z-folder/linked')).revision)
    const aliases = await Promise.all([
      writeWorkspaceFile(root, 'inside/linked', 'one', linked.revision!),
      writeWorkspaceFile(root, 'z-folder/linked', 'two', linked.revision!)
    ])
    assert.deepEqual(aliases.map((result) => result.status).sort(), ['conflict', 'saved'])
    assert.notEqual(
      (await readWorkspaceFile(path.join(root, 'z-folder'), 'linked')).revision,
      (await readWorkspaceFile(root, 'z-folder/linked')).revision
    )
    for (const target of [
      '../root-other/secret',
      path.join(outside, 'secret'),
      'escape/secret',
      'missing',
      'z-folder',
      '\0'
    ]) {
      await assert.rejects(writeWorkspaceFile(root, target, 'bad', first.revision!))
    }
    for (const target of ['binary', 'invalid-utf8', 'large']) {
      assert.deepEqual(await writeWorkspaceFile(root, target, 'bad', first.revision!), {
        status: 'conflict'
      })
    }
    const exact = await readWorkspaceFile(root, 'exact')
    for (const content of [
      'a'.repeat(MAX_FILE_BYTES + 1),
      '界'.repeat(Math.ceil(MAX_FILE_BYTES / 3)),
      '\0',
      '\ud800'
    ]) {
      await assert.rejects(writeWorkspaceFile(root, 'exact', content, exact.revision!))
    }
    await assert.rejects(writeWorkspaceFile(root, 'exact', '', null as unknown as string))
    await assert.rejects(writeWorkspaceFile(root, 'exact', '', 'bad-revision'))
    assert.equal(
      (await writeWorkspaceFile(root, 'exact', 'b'.repeat(MAX_FILE_BYTES), exact.revision!)).status,
      'saved'
    )
    const empty = await readWorkspaceFile(root, 'empty')
    assert.equal((await writeWorkspaceFile(root, 'empty', '', empty.revision!)).status, 'saved')
    if (process.platform !== 'win32') {
      await chmod(path.join(root, 'copy'), 0o640)
      const copy = await readWorkspaceFile(root, 'copy')
      await writeWorkspaceFile(root, 'copy', 'mode kept', copy.revision!)
      assert.equal((await stat(path.join(root, 'copy'))).mode & 0o777, 0o640)
    }
    assert(!(await readdir(root)).some((name) => name.startsWith('.roxy-save-')))
    assert.equal(await readFile(path.join(outside, 'secret'), 'utf8'), 'outside')

    // Test workspace file searching
    await writeFile(
      path.join(root, 'search-test.ts'),
      'const greeting = "hello world";\nconst other = "HELLO";'
    )
    const searchAll = await searchWorkspaceFiles(root, 'hello')
    assert(searchAll.length >= 2)
    assert(searchAll.some((m) => m.path === 'search-test.ts' && m.line === 1))

    const searchCase = await searchWorkspaceFiles(root, 'hello', { caseSensitive: true })
    assert(searchCase.some((m) => m.path === 'search-test.ts' && m.line === 1))
    assert(!searchCase.some((m) => m.path === 'search-test.ts' && m.line === 2))

    const searchWholeWord = await searchWorkspaceFiles(root, 'greet', { wholeWord: true })
    assert.equal(searchWholeWord.length, 0)

    const searchEmpty = await searchWorkspaceFiles(root, '')
    assert.deepEqual(searchEmpty, [])

    // Test maxResultsPerFile distribution across multiple files
    await writeFile(path.join(root, 'search-multi-1.ts'), 'match match match')
    await writeFile(path.join(root, 'search-multi-2.ts'), 'match match match')
    const searchPerFile = await searchWorkspaceFiles(root, 'match', { maxResultsPerFile: 1 })
    assert.equal(searchPerFile.filter((m) => m.path === 'search-multi-1.ts').length, 1)
    assert.equal(searchPerFile.filter((m) => m.path === 'search-multi-2.ts').length, 1)

    // Test workspace file replace
    await writeFile(path.join(root, 'replace-test.ts'), 'const foo = "bar";\nconst foo2 = "bar";')
    const replaceSpecific = await replaceWorkspaceFiles(root, 'bar', 'baz', undefined, [
      'replace-test.ts'
    ])
    assert.equal(replaceSpecific.filesChanged, 1)
    assert.equal(replaceSpecific.replacements, 2)
    assert.equal(
      await readFile(path.join(root, 'replace-test.ts'), 'utf8'),
      'const foo = "baz";\nconst foo2 = "baz";'
    )

    const replaceAll = await replaceWorkspaceFiles(root, 'baz', 'qux')
    assert(replaceAll.filesChanged >= 1)
    assert(replaceAll.replacements >= 2)
    assert.equal(
      await readFile(path.join(root, 'replace-test.ts'), 'utf8'),
      'const foo = "qux";\nconst foo2 = "qux";'
    )

    // Test createWorkspaceFile
    const createdFile = await createWorkspaceFile(root, 'new-file.txt', false)
    assert.equal(createdFile.success, true)
    assert.equal(createdFile.path, 'new-file.txt')
    assert.equal(await readFile(path.join(root, 'new-file.txt'), 'utf8'), '')

    const createdDir = await createWorkspaceFile(root, 'new-dir', true)
    assert.equal(createdDir.success, true)
    assert((await stat(path.join(root, 'new-dir'))).isDirectory())

    const createdNested = await createWorkspaceFile(root, 'new-dir/nested.txt', false)
    assert.equal(createdNested.success, true)
    assert.equal(createdNested.path, 'new-dir/nested.txt')

    await assert.rejects(createWorkspaceFile(root, 'new-file.txt', false))
    await assert.rejects(createWorkspaceFile(root, '../root-other/evil.txt', false))

    // Test renameWorkspaceFile
    const renamed = await renameWorkspaceFile(root, 'new-file.txt', 'renamed-file.txt')
    assert.equal(renamed.success, true)
    assert.equal(renamed.newPath, 'renamed-file.txt')
    assert(await stat(path.join(root, 'renamed-file.txt')))
    await assert.rejects(stat(path.join(root, 'new-file.txt')))

    const renamedDir = await renameWorkspaceFile(root, 'new-dir', 'renamed-dir')
    assert.equal(renamedDir.success, true)
    assert.equal(renamedDir.newPath, 'renamed-dir')
    assert(await stat(path.join(root, 'renamed-dir', 'nested.txt')))

    await assert.rejects(renameWorkspaceFile(root, '', 'bad'))
    await assert.rejects(renameWorkspaceFile(root, 'renamed-file.txt', '../root-other/escaped.txt'))

    // Test deleteWorkspaceFile (files and directories)
    assert.equal(await deleteWorkspaceFile(root, 'renamed-file.txt'), true)
    await assert.rejects(stat(path.join(root, 'renamed-file.txt')))

    assert.equal(await deleteWorkspaceFile(root, 'renamed-dir'), true)
    await assert.rejects(stat(path.join(root, 'renamed-dir')))

    await assert.rejects(deleteWorkspaceFile(root, ''))

    // Test git ignored paths handling (including Git on Windows CRLF blank line bug and negation rules)
    const gitOk = await isGitAvailable()
    if (gitOk) {
      const gitRoot = path.join(temp, 'git-repo')
      await mkdir(gitRoot)
      await writeFile(
        path.join(gitRoot, '.gitignore'),
        'ignored-dir/\r\n\r\n*.log\r\n!kept.log\r\n'
      )
      await mkdir(path.join(gitRoot, 'ignored-dir'))
      await mkdir(path.join(gitRoot, 'normal-dir'))
      await writeFile(path.join(gitRoot, 'ignored-dir/nested.txt'), 'nested')
      await writeFile(path.join(gitRoot, 'normal-dir/nested.txt'), 'nested')
      await writeFile(path.join(gitRoot, 'app.log'), 'log')
      await writeFile(path.join(gitRoot, 'kept.log'), 'kept')
      await writeFile(path.join(gitRoot, 'normal.txt'), 'normal')

      await new Promise<void>((resolve, reject) => {
        const cp = spawn('git', ['init', '--initial-branch=main'], {
          cwd: gitRoot,
          stdio: 'ignore'
        })
        cp.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`git init exited with ${code}`))
        )
      })

      const gitEntries = await listWorkspaceFiles(gitRoot, '')
      const entryMap = new Map(gitEntries.map((e) => [e.name, e]))

      assert.equal(entryMap.get('ignored-dir')?.ignored, true, 'ignored-dir should be ignored')
      assert.equal(
        entryMap.get('normal-dir')?.ignored,
        undefined,
        'normal-dir should NOT be ignored'
      )
      assert.equal(entryMap.get('app.log')?.ignored, true, 'app.log should be ignored')
      assert.equal(entryMap.get('kept.log')?.ignored, undefined, 'kept.log should NOT be ignored')
      assert.equal(
        entryMap.get('normal.txt')?.ignored,
        undefined,
        'normal.txt should NOT be ignored'
      )
    }

    console.log('workspace-files: passed')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
