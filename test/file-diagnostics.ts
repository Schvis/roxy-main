import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

    console.log('File diagnostics tests passed')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
