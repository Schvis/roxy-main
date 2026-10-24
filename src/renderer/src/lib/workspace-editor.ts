import * as monaco from 'monaco-editor/editor.js'
import 'monaco-editor/features/register.all.js'
// Monaco's feature barrel does not register these core keyboard/controllers.
import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js'
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus.js'
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/languages/definitions/register.all.js'
import 'monaco-editor/languages/features/json/register.js'
import 'monaco-editor/languages/features/css/register.js'
import 'monaco-editor/languages/features/html/register.js'
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  JsxEmit
} from 'monaco-editor/languages/features/typescript/register.js'
import type { WorkspaceInspectorApi } from '@shared/workspace-inspector'
import { api } from './api'
import i18n from '../i18n'
import { registerDraftReverter } from './agent-file-changes'

self.MonacoEnvironment = {
  async getWorker(_moduleId, label) {
    // Lazy inline workers also work from packaged Electron's file:// renderer.
    const { default: Worker } = await (label === 'typescript' || label === 'javascript'
      ? import('monaco-editor/languages/features/typescript/ts.worker.js?worker&inline')
      : label === 'json'
        ? import('monaco-editor/languages/features/json/json.worker.js?worker&inline')
        : label === 'css' || label === 'scss' || label === 'less'
          ? import('monaco-editor/languages/features/css/css.worker.js?worker&inline')
          : label === 'html' || label === 'handlebars' || label === 'razor'
            ? import('monaco-editor/languages/features/html/html.worker.js?worker&inline')
            : import('monaco-editor/editor/editor.worker.js?worker&inline'))
    return new Worker()
  }
}

for (const defaults of [typescriptDefaults, javascriptDefaults]) {
  defaults.setCompilerOptions({
    target: ScriptTarget.ESNext,
    allowJs: true,
    jsx: JsxEmit.ReactJSX,
    allowNonTsExtensions: true
  })
  // The worker has open documents, not the project's node_modules/tsconfig.
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, onlyVisible: true })
}

export { monaco }

type SaveResult = Awaited<ReturnType<WorkspaceInspectorApi['write']>>
export interface EditorDocument {
  model: monaco.editor.ITextModel
  sessionId: string
  rootId: string
  path: string
  revision: string
  baseline: string
  dirty: boolean
  saving: boolean
  reloading: boolean
  mounted: boolean
  error: Exclude<SaveResult, { ok: true }>['reason'] | null
  mixedEol: boolean
  viewState: monaco.editor.ICodeEditorViewState | null
  changed: () => void
  subscription: monaco.IDisposable
}

// Unsaved documents survive file/session navigation.
export const editorDocuments = new Map<string, EditorDocument>()
const DRAFT_PREFIX = 'roxy:workspace-draft:'
type StoredDraft = { content: string; baseline: string; revision: string }

registerDraftReverter((sessionId, path) => {
  void (async () => {
    const { useRoxyStore } = await import('./store')
    const chats = useRoxyStore.getState().chats
    const chat = chats.find((candidate) => candidate.id === sessionId)
    const owner = chat?.parentId ? chats.find((candidate) => candidate.id === chat.parentId) : chat
    const root =
      chat?.worktreePath ?? chat?.workspacePath ?? owner?.worktreePath ?? owner?.workspacePath
    if (!root) return
    const relative = path
      .replace(/\\/g, '/')
      .replace(root.replace(/\\/g, '/').replace(/\/$/, '') + '/', '')
    await discardWorkspaceDrafts(root, relative)
  })().catch(console.error)
})
export async function discardWorkspaceDrafts(repository: string, file?: string): Promise<void> {
  const { useRoxyStore } = await import('./store')
  const chats = useRoxyStore.getState().chats
  const normalize = (value: string): string => {
    const path = value.replace(/\\/g, '/').replace(/\/$/, '')
    return document.documentElement.dataset.platform === 'win32' ? path.toLowerCase() : path
  }
  const targetRoot = normalize(repository)
  const target = file ? `${targetRoot}/${normalize(file)}` : null
  const keys = new Set(editorDocuments.keys())
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(DRAFT_PREFIX)) keys.add(key.slice(DRAFT_PREFIX.length))
    }
  } catch {
    /* Storage may be disabled. */
  }
  const repositories = new Map<string, Promise<string[]>>()
  for (const key of keys) {
    try {
      const [sessionId, rootId, path] = JSON.parse(key) as [string, string, string]
      const chat = chats.find((candidate) => candidate.id === sessionId)
      const owner = chat?.parentId
        ? chats.find((candidate) => candidate.id === chat.parentId)
        : chat
      const workspace =
        chat?.worktreePath ?? chat?.workspacePath ?? owner?.worktreePath ?? owner?.workspacePath
      if (!workspace) continue
      let root = workspace
      if (rootId !== 'workspace') {
        if (!repositories.has(workspace))
          repositories.set(workspace, api.git.repositories(workspace))
        const roots = await repositories.get(workspace)!
        root = roots[Number(rootId)]
        if (!root) continue
      }
      const absolute = `${normalize(root)}/${normalize(path)}`
      if (target ? absolute !== target : !absolute.startsWith(targetRoot + '/')) continue
      try {
        localStorage.removeItem(DRAFT_PREFIX + key)
      } catch {
        /* Storage may be disabled. */
      }
      const entry = editorDocuments.get(key)
      if (!entry || entry.saving) continue
      entry.reloading = true
      entry.changed()
      try {
        const result = await api.workspace.read(sessionId, rootId, path, false)
        if (result.ok && result.revision) {
          entry.model.setValue(result.after)
          entry.baseline = entry.model.getValue(undefined, true)
          entry.revision = result.revision
          entry.mixedEol = hasMixedEol(result.after)
          entry.error = null
        } else {
          entry.model.setValue('')
          entry.baseline = ''
          entry.error = result.ok ? 'unavailable' : result.reason
        }
        entry.dirty = false
        persistEditorDraft(entry)
      } finally {
        entry.reloading = false
        entry.changed()
        releaseEditorDocument(entry)
      }
    } catch {
      // One unavailable root must not block clearing other discarded drafts.
    }
  }
}
export function persistEditorDraft(entry: EditorDocument): void {
  const key = DRAFT_PREFIX + editorDocumentKey(entry.sessionId, entry.rootId, entry.path)
  try {
    if (!entry.dirty) localStorage.removeItem(key)
    else
      localStorage.setItem(
        key,
        JSON.stringify({
          content: entry.model.getValue(undefined, true),
          baseline: entry.baseline,
          revision: entry.revision
        })
      )
  } catch {
    // Quota/privacy failures must never interrupt editing or saving.
  }
}

function readEditorDraft(key: string): StoredDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_PREFIX + key) ?? 'null')
    return value &&
      typeof value.content === 'string' &&
      typeof value.baseline === 'string' &&
      typeof value.revision === 'string'
      ? value
      : null
  } catch {
    return null
  }
}
let discarding = false
let confirming = false
window.addEventListener('beforeunload', (event) => {
  if (discarding || ![...editorDocuments.values()].some((entry) => entry.dirty || entry.saving))
    return
  event.preventDefault()
  event.returnValue = ''
  if (confirming) return
  confirming = true
  void api.workspace
    .confirmDiscard(
      i18n.t('inspector.closeUnsaved'),
      i18n.t('inspector.closeDiscard'),
      i18n.t('inspector.closeKeep')
    )
    .then((confirmed) => {
      if (confirmed) {
        discarding = true
        window.close()
      }
    })
    .catch(() => {})
    .finally(() => {
      confirming = false
    })
})
export const editorDocumentKey = (sessionId: string, rootId: string, path: string): string =>
  JSON.stringify([sessionId, rootId, path])

export function releaseEditorDocument(entry: EditorDocument): void {
  // Effect cleanup/setup can replay in StrictMode. Evict only after a new mount
  // has had a chance to acquire the model, and never while an operation owns it.
  queueMicrotask(() => {
    if (entry.mounted || entry.dirty || entry.saving || entry.reloading) return
    const key = editorDocumentKey(entry.sessionId, entry.rootId, entry.path)
    if (editorDocuments.get(key) !== entry) return
    editorDocuments.delete(key)
    entry.subscription.dispose()
    entry.model.dispose()
  })
}

export function openEditorDocument(
  sessionId: string,
  rootId: string,
  path: string,
  content: string,
  revision: string
): EditorDocument {
  const key = editorDocumentKey(sessionId, rootId, path)
  const existing = editorDocuments.get(key)
  if (existing) return existing
  const basename = path.split('/').pop()!.toLowerCase()
  const language =
    monaco.languages
      .getLanguages()
      .find(
        (language) =>
          language.filenames?.some((name) => name.toLowerCase() === basename) ||
          language.extensions?.some((extension) => basename.endsWith(extension))
      )?.id ?? (basename === '.editorconfig' ? 'ini' : 'plaintext')
  const model = monaco.editor.createModel(
    content,
    language,
    monaco.Uri.from({
      scheme: 'file',
      path: `/roxy/${encodeURIComponent(sessionId)}/${encodeURIComponent(rootId)}/${path}`
    })
  )
  model.detectIndentation(true, language === 'python' ? 4 : 2)
  const draft = readEditorDraft(key)
  const entry: EditorDocument = {
    model,
    sessionId,
    rootId,
    path,
    revision,
    baseline: model.getValue(undefined, true),
    dirty: false,
    saving: false,
    reloading: false,
    mounted: false,
    error: null,
    mixedEol: hasMixedEol(content),
    viewState: null,
    changed: () => {},
    subscription: model.onDidChangeContent(() => {
      entry.dirty = model.getValue(undefined, true) !== entry.baseline
      persistEditorDraft(entry)
      entry.changed()
    })
  }
  if (draft && !entry.mixedEol) {
    entry.model.setValue(draft.content)
    entry.baseline = draft.baseline
    entry.revision = draft.revision
    entry.dirty = entry.model.getValue(undefined, true) !== entry.baseline
    if (draft.revision !== revision) entry.error = 'changed'
    persistEditorDraft(entry)
  }
  editorDocuments.set(key, entry)
  return entry
}

export function hasMixedEol(content: string): boolean {
  return /\r(?!\n)/.test(content) || (/\r\n/.test(content) && /(?<!\r)\n/.test(content))
}

export async function saveEditorDocument(entry: EditorDocument): Promise<void> {
  if (!entry.dirty || entry.saving || entry.reloading || entry.mixedEol) return
  const content = entry.model.getValue(undefined, true)
  entry.saving = true
  entry.error = null
  entry.changed()
  try {
    const result = await api.workspace.write(
      entry.sessionId,
      entry.rootId,
      entry.path,
      content,
      entry.revision
    )
    if (result.ok) {
      entry.revision = result.revision
      entry.baseline = content
      entry.dirty = entry.model.getValue(undefined, true) !== content
      window.dispatchEvent(new Event('focus'))
    } else entry.error = result.reason
  } catch {
    entry.error = 'unavailable'
  } finally {
    entry.saving = false
    persistEditorDraft(entry)
    entry.changed()
    releaseEditorDocument(entry)
  }
}
