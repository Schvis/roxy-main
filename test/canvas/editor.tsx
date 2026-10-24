import './bridge'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/renderer/src/assets/main.css'
import '../../src/renderer/src/i18n'
import FileEditor from '../../src/renderer/src/components/WorkspaceFileEditor'
import {
  editorDocuments,
  monaco,
  openEditorDocument,
  editorDocumentKey,
  discardWorkspaceDrafts
} from '../../src/renderer/src/lib/workspace-editor'
import { getTypeScriptWorker } from 'monaco-editor/languages/features/typescript/register.js'

import { useRoxyStore } from '../../src/renderer/src/lib/store'
let content = 'const greeting = "hello";\ngreeting.'
let revision = 'first'
let discard = false
Object.assign(window.roxy, {
  files: { ...window.roxy.files, diagnostics: async () => [] },
  workspace: {
    read: async () => ({ ok: true, before: '', after: content, revision }),
    write: async (
      _session: string,
      _root: string,
      _path: string,
      value: string,
      expected: string
    ) => {
      if (revision !== expected) return { ok: false, reason: 'changed' }
      content = value
      revision = crypto.randomUUID()
      return { ok: true, revision }
    },
    confirmDiscard: async () => discard
  }
})
Object.assign(window, {
  __editorRuntime: {
    monaco,
    editorDocuments,
    openEditorDocument,
    editorDocumentKey,
    discardWorkspaceDrafts,
    changeDisk: (value: string) => {
      content = value
      revision += 1
      window.dispatchEvent(new Event('focus'))
    },
    getTypeScriptWorker,
    setReview: () => {
      const before = 'const a = 1;\nconst stable = true;\nconst b = 1;\n'
      const after = 'const a = 2;\nconst stable = true;\nconst b = 2;\n'
      monaco.editor.getEditors()[0].getModel()!.setValue(after)
      useRoxyStore.setState({
        chats: [{ id: 'fixture', workspacePath: '/fixture' }],
        activeChatId: 'fixture',
        messages: [
          {
            id: 'review',
            chatId: 'fixture',
            role: 'assistant',
            content: '',
            createdAt: 0,
            parts: [
              {
                type: 'tool',
                tool: 'write',
                state: 'done',
                diff: { path: 'example.ts', before, after }
              }
            ]
          }
        ]
      })
    },
    content: () => content,
    allowDiscard: () => {
      discard = true
    }
  }
})
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FileEditor
      sessionId="fixture"
      selection={{ rootId: 'workspace', path: 'example.ts', comparison: false }}
      snapshot={null}
      onBack={() => {}}
    />
  </StrictMode>
)
