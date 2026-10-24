const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'roxy-editor-built-')))
let win
const errors = []
const evaluate = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true)
const wait = () => new Promise((resolve) => setTimeout(resolve, 80))
async function until(code) {
  for (let n = 0; n < 150; n++) {
    if (await evaluate(`return ${code}`)) return
    await wait()
  }
  console.error(
    await evaluate(
      'return {value:window.__editor?.getValue(),text:document.body.textContent.slice(0,1000)}'
    )
  )
  throw new Error(`Timed out: ${code}`)
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) errors.push(message)
    })
    await win.loadFile(path.resolve('test/.out/editor-build/editor.html'))
    await until('window.__editorRuntime?.monaco.editor.getEditors().length === 1')
    await evaluate(
      `window.__editor = window.__editorRuntime.monaco.editor.getEditors()[0]; const model = window.__editor.getModel(); window.__worker = await (await window.__editorRuntime.getTypeScriptWorker())(model.uri); window.__completions = await window.__worker.getCompletionsAtPosition(model.uri.toString(), model.getValueLength());`
    )
    assert(
      await evaluate(
        'return window.__completions.entries.some(entry => entry.name === "toUpperCase")'
      )
    )
    await evaluate(`window.__editor.getModel().setValue('const broken: =')`)
    await until(
      'window.__editorRuntime.monaco.editor.getModelMarkers({resource:window.__editor.getModel().uri}).length > 0'
    )
    await evaluate(
      `window.__editor.getModel().setValue('const saved = true\\n'); document.querySelector('[aria-label="Save file"]').click()`
    )
    await until(`window.__editorRuntime.content() === 'const saved = true\\n'`)
    assert(
      await evaluate(`
      const runtime = window.__editorRuntime;
      const key = runtime.editorDocumentKey('fixture', 'fixture', 'draft.ts');
      const first = runtime.openEditorDocument('fixture', 'fixture', 'draft.ts', 'original', 'revision');
      first.model.setValue('draft text');
      const stored = JSON.parse(localStorage.getItem('roxy:workspace-draft:' + key));
      first.subscription.dispose(); first.model.dispose(); runtime.editorDocuments.delete(key);
      const restored = runtime.openEditorDocument('fixture', 'fixture', 'draft.ts', 'external edit', 'new revision');
      const valid = stored.content === 'draft text' && restored.model.getValue() === 'draft text' && restored.dirty && restored.error === 'changed' && restored.revision === 'revision';
      restored.model.setValue(restored.baseline);
      const cleared = localStorage.getItem('roxy:workspace-draft:' + key) === null;
      restored.subscription.dispose(); restored.model.dispose(); runtime.editorDocuments.delete(key);
      return valid && cleared;
    `),
      'draft restoration preserves edits and detects external changes'
    )
    await evaluate('window.__editorRuntime.setReview()')
    await until(
      `document.querySelectorAll('section[aria-label="View changes"] button').length === 6`
    )
    await evaluate(
      `const button = [...document.querySelectorAll('section button')].find(button => button.textContent === 'Revert this change'); button.click()`
    )
    await until(
      `window.__editor.getValue() === 'const a = 1;\\nconst stable = true;\\nconst b = 2;\\n'`
    )
    await evaluate(`window.__editor.trigger('test', 'undo', null)`)
    await until(
      `window.__editor.getValue() === 'const a = 2;\\nconst stable = true;\\nconst b = 2;\\n'`
    )
    await evaluate(`await window.__editorRuntime.discardWorkspaceDrafts('/fixture', 'example.ts')`)
    await until(`window.__editor.getValue() === 'const saved = true\\n'`)
    assert(
      await evaluate(
        `return localStorage.getItem('roxy:workspace-draft:' + window.__editorRuntime.editorDocumentKey('fixture', 'workspace', 'example.ts')) === null`
      ),
      'Git discard removes persisted drafts'
    )
    await evaluate(`window.__editorRuntime.changeDisk("external disk edit")`)
    await until(`window.__editor.getValue() === 'external disk edit'`)
    await evaluate(
      `window.__editor.getModel().setValue("local draft"); window.__editorRuntime.changeDisk("second disk edit")`
    )
    await until(
      `window.__editorRuntime.editorDocuments.get(window.__editorRuntime.editorDocumentKey('fixture', 'workspace', 'example.ts')).error === 'changed'`
    )
    assert.equal(
      await evaluate(`return window.__editor.getValue()`),
      'local draft',
      'Disk refresh preserves dirty drafts'
    )
    await evaluate(
      `window.__editor.getModel().setValue('unsaved'); window.__unload = new Event('beforeunload',{cancelable:true}); window.dispatchEvent(window.__unload)`
    )
    assert(await evaluate('return window.__unload.defaultPrevented'))
    win.close()
    await wait()
    assert(!win.isDestroyed(), 'Keep editing cancels native close')
    app.quit()
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert(!win.isDestroyed(), 'Keep editing cancels application quit')
    assert.equal(
      errors.filter((message) => !message.includes('Electron Security Warning')).length,
      0,
      errors.join('\n')
    )
    await evaluate('window.__editorRuntime.allowDiscard()')
    const closed = new Promise((resolve) => win.once('closed', resolve))
    win.close()
    await closed
    console.log(
      'BUILT EDITOR OK: file:// loading, inline TypeScript worker, completion, syntax diagnostics, saving, unload protection'
    )
  } catch (error) {
    console.error(error)
    console.error(errors.join('\n'))
    process.exitCode = 1
  } finally {
    win?.destroy()
    app.exit(process.exitCode || 0)
  }
})
