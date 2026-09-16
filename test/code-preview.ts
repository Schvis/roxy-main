import assert from 'node:assert/strict'
import { extractCodeStructure } from '../src/renderer/src/components/CodePreviewRail'
import type { GroupedHunk } from '../src/renderer/src/components/FileEditor'

function testExtractCodeStructure(): void {
  const codeLines = [
    '// Top comment',
    'import { useState } from "react"',
    '',
    'export interface UserProfile {',
    '  id: string',
    '  name: string',
    '}',
    '',
    'export class AuthManager {',
    '  validate() {',
    '    return true',
    '  }',
    '}',
    '',
    'export function loginUser() {',
    '  return "ok"',
    '}',
    '',
    'const handleToken = (token: string) => {',
    '  return token',
    '}',
    '',
    '# Documentation Section',
    'Some markdown note.'
  ]

  const hunks: GroupedHunk[] = [
    {
      id: 'hunk-0',
      startLineIdx: 8,
      endLineIdx: 12,
      deletedCount: 1,
      addedCount: 4
    }
  ]

  const symbols = extractCodeStructure(codeLines, hunks)

  // 1. Check that hunk is detected at line 8
  const hunkSym = symbols.find((s) => s.kind === 'hunk')
  assert.ok(hunkSym, 'Change hunk should be included in code structure')
  assert.equal(hunkSym?.lineIdx, 8)
  assert.equal(hunkSym?.hunk?.addedCount, 4)
  assert.equal(hunkSym?.hunk?.deletedCount, 1)

  // 2. Check interface extraction
  const ifaceSym = symbols.find((s) => s.kind === 'interface')
  assert.ok(ifaceSym, 'Interface should be detected')
  assert.equal(ifaceSym?.name, 'UserProfile')
  assert.equal(ifaceSym?.lineIdx, 3)

  // 3. Check class extraction
  const classSym = symbols.find((s) => s.kind === 'class')
  assert.ok(classSym, 'Class should be detected')
  assert.equal(classSym?.name, 'AuthManager')
  assert.equal(classSym?.lineIdx, 8)

  // 4. Check function extractions
  const funcSyms = symbols.filter((s) => s.kind === 'function')
  assert.ok(funcSyms.some((s) => s.name === 'loginUser'))
  assert.ok(funcSyms.some((s) => s.name === 'handleToken'))

  // 5. Check markdown heading
  const headingSym = symbols.find((s) => s.kind === 'heading')
  assert.ok(headingSym, 'Markdown heading should be detected')
  assert.equal(headingSym?.name, 'Documentation Section')
  assert.equal(headingSym?.lineIdx, 22)
}

function testEmptyLinesAndComments(): void {
  const lines = ['', '   ', '// comment 1', '/* comment 2 */', '* block comment continuation']

  const symbols = extractCodeStructure(lines, [])
  assert.equal(symbols.length, 0)
}

function main(): void {
  testExtractCodeStructure()
  testEmptyLinesAndComments()
  console.log('✓ All code preview tests passed')
}

main()
