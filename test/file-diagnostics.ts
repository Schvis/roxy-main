import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { getWorkspaceFileDiagnostics } from '../src/main/services/workspace-files'

async function main(): Promise<void> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'roxy-diag-'))
  const root = path.join(temp, 'root')
  try {
    await mkdir(root)
    await mkdir(path.join(root, 'sub'))
    await writeFile(path.join(root, 'sub', 'exporter.ts'), 'export const goodValue = 42;\n')
    await writeFile(path.join(root, 'target.ts'), '')

    // 1. Wrong relative import: module does not exist
    const missingMod = await getWorkspaceFileDiagnostics(
      root,
      'target.ts',
      'import { foo } from "./sub/missing";\n'
    )
    assert.ok(missingMod.length > 0, 'missing module should produce diagnostic')
    assert.ok(missingMod.some((d) => d.code === 2307 || d.message.includes('Cannot find module')))

    // 2. Wrong named export from existing module
    const wrongMember = await getWorkspaceFileDiagnostics(
      root,
      'target.ts',
      'import { nonExistent } from "./sub/exporter";\n'
    )
    assert.ok(wrongMember.length > 0, 'missing export should produce diagnostic')
    assert.ok(
      wrongMember.some((d) => d.code === 2305 || d.message.includes('has no exported member'))
    )

    // 3. Syntax error
    const syntaxErr = await getWorkspaceFileDiagnostics(root, 'target.ts', 'const broken = ;\n')
    assert.ok(syntaxErr.length > 0, 'syntax error should produce diagnostic')
    assert.equal(syntaxErr[0].line, 1)

    // 4. Correct import -> 0 errors
    const clean = await getWorkspaceFileDiagnostics(
      root,
      'target.ts',
      'import { goodValue } from "./sub/exporter";\nconsole.log(goodValue);\n'
    )
    assert.equal(clean.length, 0, 'valid code should have 0 errors')

    // 5. JSON syntax error
    await writeFile(path.join(root, 'data.json'), '{}')
    const badJson = await getWorkspaceFileDiagnostics(root, 'data.json', '{\n  "broken": ,\n}\n')
    assert.ok(badJson.length > 0, 'bad json should produce diagnostic')
    assert.equal(badJson[0].line, 2)

    // 6. Good JSON -> 0 errors
    const goodJson = await getWorkspaceFileDiagnostics(root, 'data.json', '{\n  "ok": true\n}\n')
    assert.equal(goodJson.length, 0, 'good json should have 0 errors')

    // 7. Path outside workspace rejects
    await assert.rejects(getWorkspaceFileDiagnostics(root, '../outside.ts', 'const x = 1;'))

    // 8. tsconfig path aliases resolved without 2307
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          paths: {
            '@/*': ['./sub/*']
          }
        }
      })
    )
    const aliasImport = await getWorkspaceFileDiagnostics(
      root,
      'target.ts',
      'import { goodValue } from "@/exporter";\nconsole.log(goodValue);\n'
    )
    assert.equal(aliasImport.length, 0, 'path alias from tsconfig should resolve with 0 errors')

    // Electron can report its executable, not typescript.js, as the executing file.
    // Standard library paths must still resolve for a TSX project using DOM libs.
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { lib: ['dom', 'dom.iterable', 'esnext'], jsx: 'react-jsx' }
      })
    )
    await writeFile(path.join(root, 'target.tsx'), '')
    const executingFile = ts.sys.getExecutingFilePath
    ts.sys.getExecutingFilePath = () => path.join(root, 'electron.exe')
    try {
      const valid = await getWorkspaceFileDiagnostics(
        root,
        'target.tsx',
        'const values: Record<string, Set<number>> = { ids: new Set([1]) };\n' +
          'const source: EventSource | undefined = undefined;\n' +
          'console.log(values.ids, source);\n'
      )
      assert.deepEqual(valid, [], 'valid DOM and ES globals must not produce diagnostics')

      const invalid = await getWorkspaceFileDiagnostics(
        root,
        'target.tsx',
        'const invalid: number = "not a number";\n'
      )
      assert.ok(
        invalid.some((d) => d.code === 2322),
        'real type errors must still be reported'
      )
    } finally {
      ts.sys.getExecutingFilePath = executingFile
    }

    // A solution config must defer to the referenced project that owns the file.
    const node = path.join(root, 'node')
    const web = path.join(root, 'web')
    await mkdir(node)
    await mkdir(web)
    await writeFile(path.join(node, 'target.ts'), '')
    await writeFile(path.join(node, 'globals.d.ts'), 'declare const projectGlobal: number;\n')
    await writeFile(path.join(node, 'value.ts'), 'export const projectValue = 1;\n')
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ files: [], references: [{ path: './node' }, { path: './web' }] })
    )
    await writeFile(
      path.join(node, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { paths: { '#project': ['./value.ts'] } },
        include: ['*.ts']
      })
    )
    await writeFile(path.join(web, 'tsconfig.json'), JSON.stringify({ include: ['*.ts'] }))
    await writeFile(
      path.join(root, 'tsconfig.web.json'),
      JSON.stringify({
        compilerOptions: { paths: { '#project': ['./missing.ts'] } },
        include: ['web']
      })
    )
    const owned = await getWorkspaceFileDiagnostics(
      root,
      'node/target.ts',
      'import { projectValue } from "#project";\nconsole.log(projectGlobal, projectValue);\n'
    )
    assert.deepEqual(owned, [], 'owning project aliases and ambient declarations should resolve')

    // A JavaScript-only workspace can specify aliases in jsconfig.json.
    const js = path.join(root, 'js')
    await mkdir(js)
    await writeFile(path.join(js, 'target.js'), '')
    await writeFile(path.join(js, 'value.js'), 'export const value = 1;\n')
    await writeFile(
      path.join(js, 'jsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '#value': ['./value.js'] } } })
    )
    const jsAlias = await getWorkspaceFileDiagnostics(
      root,
      'js/target.js',
      'import { value } from "#value";\nconsole.log(value);\n'
    )
    assert.deepEqual(jsAlias, [], 'jsconfig path aliases should resolve')

    const checkedJs = await getWorkspaceFileDiagnostics(
      root,
      'js/target.js',
      '// @ts-check\nconst number = 1;\nnumber.toUpperCase();\n'
    )
    assert.ok(
      checkedJs.some((d) => d.code === 2339),
      '@ts-check should report real JS errors'
    )

    await writeFile(
      path.join(js, 'jsconfig.json'),
      JSON.stringify({ extends: './missing-config.json' })
    )
    const brokenExtends = await getWorkspaceFileDiagnostics(root, 'js/target.js', 'const ok = 1;\n')
    assert.ok(brokenExtends.some((d) => d.message.includes('missing-config.json')))

    // Broken config must not silently turn project diagnostics into misleading defaults.
    await writeFile(path.join(js, 'jsconfig.json'), '{ broken config')
    const brokenConfig = await getWorkspaceFileDiagnostics(root, 'js/target.js', 'const ok = 1;\n')
    assert.ok(brokenConfig.some((d) => d.message.includes('jsconfig.json')))

    console.log('File diagnostics tests passed')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
