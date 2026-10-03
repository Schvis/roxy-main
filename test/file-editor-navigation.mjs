import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(
  new URL('../src/renderer/src/components/FileEditor.tsx', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n')
const effect = source.match(
  /useEffect\(\(\) => \{\n    if \(!initialLine\)[\s\S]*?\}, \[initialLine, key, text\]\)/
)?.[0]
assert.ok(effect, 'Initial-line navigation effect exists')
const code = ts.transpileModule(effect, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const selections = []
const input = {
  focus() {},
  setSelectionRange(start, end) {
    selections.push([start, end])
  },
  scrollTop: 0,
  clientHeight: 100
}
const context = vm.createContext({
  useEffect: (callback) => callback(),
  initialLine: 2,
  key: 'file-a',
  text: '',
  textarea: { current: input },
  initialLineNavigationRef: { current: null },
  syncScroll() {}
})
const render = () => vm.runInContext(code, context)

render()
assert.equal(selections.length, 0, 'Wait for file content')
context.text = 'first\nsecond\nthird'
render()
assert.deepEqual(selections, [[6, 12]], 'Select linked line once after load')
context.text = 'first\nedited\nthird'
render()
render()
assert.equal(selections.length, 1, 'Editing and rerenders preserve user selection')
context.initialLine = 3
render()
assert.deepEqual(selections.at(-1), [13, 18], 'New line target navigates')
context.key = 'file-b'
render()
assert.equal(selections.length, 3, 'New file navigates even with same line target')
context.initialLine = undefined
render()
context.initialLine = 3
render()
assert.equal(selections.length, 4, 'Cleared target allows later navigation')
console.log('File editor navigation checks passed')
