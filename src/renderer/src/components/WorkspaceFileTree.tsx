import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  ClipboardCopy,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  PencilLine,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InspectionResult, WorkspaceEntry, WorkspaceRoot } from '@shared/workspace-inspector'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import {
  ContextMenuRow,
  ContextMenuSeparator,
  ContextMenuSurface,
  CONTEXT_MENU_PAD,
  CONTEXT_ROW_H,
  CONTEXT_SEPARATOR_H
} from './ContextMenu'
import { FileIcon } from './FileIcon'
import type { WorkspaceSelection } from './WorkspaceInspector'

type Editing =
  | { kind: 'create'; parent: string; isDirectory: boolean }
  | { kind: 'rename'; entry: WorkspaceEntry }

interface Tree {
  sessionId: string
  root: WorkspaceRoot
  version: number
  expanded: Set<string>
  editing: Editing | null
  toggle: (path: string) => void
  cancelEdit: () => void
  create: (parent: string, name: string, isDirectory: boolean) => void
  rename: (entry: WorkspaceEntry, name: string) => void
  remove: (entry: WorkspaceEntry) => void
  startRename: (entry: WorkspaceEntry) => void
  openMenu: (event: React.MouseEvent, entry: WorkspaceEntry | null) => void
  onSelect: (selection: WorkspaceSelection) => void
}

const TreeContext = createContext<Tree | null>(null)

function useTree(): Tree {
  const tree = useContext(TreeContext)
  if (!tree) throw new Error('Workspace tree context missing')
  return tree
}

const parentOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}
const join = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name)
const within = (path: string, target: string): boolean =>
  path === target || path.startsWith(target + '/')

/** The folder and every folder above it, so a nested target ends up visible. */
function withAncestors(set: Set<string>, path: string): Set<string> {
  const next = new Set(set)
  const parts = path.split('/').filter(Boolean)
  for (let index = 1; index <= parts.length; index++) next.add(parts.slice(0, index).join('/'))
  return next
}

/** Shared header for a workspace root: name, branch, and optional actions. */
export function WorkspaceRootHeader({
  root,
  children
}: {
  root: WorkspaceRoot
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="flex h-8 items-center gap-1.5 px-2 text-[10px] text-text-subtle">
      <ChevronRight className="h-3 w-3 shrink-0 rotate-90" />
      <span
        title={root.directory}
        className="min-w-0 truncate font-semibold uppercase tracking-wider text-text-muted"
      >
        {root.name}
      </span>
      {root.branch && (
        <span title={root.branch} className="ml-auto flex min-w-0 items-center gap-1 truncate">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="max-w-28 truncate">{root.branch}</span>
        </span>
      )}
      {children && (
        <div className={cn('flex shrink-0 items-center gap-0.5', !root.branch && 'ml-auto')}>
          {children}
        </div>
      )}
    </div>
  )
}

function HeaderAction({
  label,
  icon: Icon,
  onClick
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="press-scale rounded p-1 text-text-subtle hover:bg-white/5 hover:text-text"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

/** Inline name field used for both creating and renaming, VS Code style. */
function NameInput({
  depth,
  isDirectory,
  initial,
  onCommit,
  onCancel
}: {
  depth: number
  isDirectory: boolean
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    // Select the base name so typing replaces it but keeps the extension.
    const dot = isDirectory ? -1 : initial.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [])
  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    const name = value.trim().replace(/\\/g, '/')
    if (commit && name && name !== initial) onCommit(name)
    else onCancel()
  }
  return (
    <div className="flex h-7 items-center gap-2 pr-2" style={{ paddingLeft: 24 + depth * 14 }}>
      {isDirectory ? (
        <Folder className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      ) : (
        <FileIcon path={value || 'file'} />
      )}
      <input
        ref={ref}
        value={value}
        spellCheck={false}
        aria-label={t(isDirectory ? 'ide.newFolder' : 'ide.newFile')}
        placeholder={t('ide.namePlaceholder')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
        className="min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 py-0.5 text-xs text-text outline-none"
      />
    </div>
  )
}

function rowKeys(event: React.KeyboardEvent, entry: WorkspaceEntry, tree: Tree): void {
  if (event.target !== event.currentTarget) return
  if (event.key === 'F2') {
    event.preventDefault()
    tree.startRename(entry)
  } else if (event.key === 'Delete') {
    event.preventDefault()
    tree.remove(entry)
  }
}

function FileRow({ entry, depth }: { entry: WorkspaceEntry; depth: number }): JSX.Element {
  const tree = useTree()
  const { root, editing } = tree
  if (editing?.kind === 'rename' && editing.entry.path === entry.path)
    return (
      <NameInput
        depth={depth}
        isDirectory={false}
        initial={entry.name}
        onCommit={(name) => tree.rename(entry, name)}
        onCancel={tree.cancelEdit}
      />
    )
  return (
    <button
      type="button"
      disabled={entry.kind === 'link'}
      title={entry.path}
      onClick={() => tree.onSelect({ rootId: root.id, path: entry.path, comparison: false })}
      onContextMenu={(event) => tree.openMenu(event, entry)}
      onKeyDown={(event) => rowKeys(event, entry, tree)}
      className="flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left text-xs hover:bg-white/5 disabled:opacity-40"
      style={{ paddingLeft: 24 + depth * 14 }}
    >
      <FileIcon path={entry.name} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {root.changes.some((change) => change.path === entry.path) && (
        <span className="h-1 w-1 shrink-0 rounded-full bg-success" />
      )}
    </button>
  )
}

function Directory({
  directory = '',
  depth = 0
}: {
  directory?: string
  depth?: number
}): JSX.Element | null {
  const { t } = useTranslation()
  const tree = useTree()
  const { sessionId, root, version, editing } = tree
  const [result, setResult] = useState<InspectionResult<{
    entries: WorkspaceEntry[]
    partial: boolean
  }> | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.workspace
      .list(sessionId, root.id, directory)
      .then((value) => {
        if (!cancelled) setResult(value)
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: false, reason: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, root, directory, version])
  const creating = editing?.kind === 'create' && editing.parent === directory ? editing : null
  const input = creating && (
    <NameInput
      depth={depth}
      isDirectory={creating.isDirectory}
      initial=""
      onCommit={(name) => tree.create(directory, name, creating.isDirectory)}
      onCancel={tree.cancelEdit}
    />
  )
  if (!result) return input || null
  if (!result.ok)
    return (
      <div role="status" className="px-3 py-2 text-[11px] text-text-subtle">
        {t(`inspector.${result.reason}`)}
      </div>
    )
  return (
    <>
      {input}
      {result.entries.map((entry) =>
        entry.kind === 'directory' ? (
          <DirectoryBranch key={entry.path} entry={entry} depth={depth} />
        ) : (
          <FileRow key={entry.path} entry={entry} depth={depth} />
        )
      )}
      {result.partial && (
        <p className="p-3 text-[11px] text-text-subtle">{t('inspector.partial')}</p>
      )}
      {!result.entries.length && !creating && (
        <p
          className="py-2 pr-3 text-[11px] text-text-subtle"
          style={{ paddingLeft: 24 + depth * 14 }}
        >
          {t('inspector.emptyFolder')}
        </p>
      )}
    </>
  )
}

function DirectoryBranch({ depth, entry }: { depth: number; entry: WorkspaceEntry }): JSX.Element {
  const tree = useTree()
  const { root, expanded, editing } = tree
  const open = expanded.has(entry.path)
  const changed = root.changes.some((change) => change.path.startsWith(entry.path + '/'))
  const renaming = editing?.kind === 'rename' && editing.entry.path === entry.path
  return (
    <>
      {renaming ? (
        <NameInput
          depth={depth}
          isDirectory
          initial={entry.name}
          onCommit={(name) => tree.rename(entry, name)}
          onCancel={tree.cancelEdit}
        />
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => tree.toggle(entry.path)}
          onContextMenu={(event) => tree.openMenu(event, entry)}
          onKeyDown={(event) => rowKeys(event, entry, tree)}
          title={entry.path}
          className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-white/5"
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-text-subtle', open && 'rotate-90')} />
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          )}
          <span className={cn('min-w-0 flex-1 truncate', changed && 'text-warning')}>
            {entry.name}
          </span>
        </button>
      )}
      {open && <Directory directory={entry.path} depth={depth + 1} />}
    </>
  )
}

interface MenuItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  danger?: boolean
  run: () => void
}

/** File explorer for one workspace root: header actions, inline create/rename, context menu. */
export function WorkspaceFileTree({
  sessionId,
  root,
  onSelect
}: {
  sessionId: string
  root: WorkspaceRoot
  onSelect: (selection: WorkspaceSelection) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Editing | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: WorkspaceEntry | null } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  // The files API resolves against the session folder, while tree paths are relative to
  // this root (which may be a nested repo) — absolute paths are unambiguous for both.
  const base = root.directory.replace(/[\\/]+$/, '')
  const absolute = (relative: string): string => (relative ? `${base}/${relative}` : base)
  const nativePath = (relative: string): string =>
    absolute(relative).replace(/[\\/]/g, root.directory.includes('\\') ? '\\' : '/')
  const refresh = (): void => setVersion((value) => value + 1)
  const invalid = (name: string): boolean =>
    name.split('/').some((part) => !part || part === '.' || part === '..')
  const hasUnsaved = async (target: string): Promise<boolean> => {
    const { editorDocuments } = await import('../lib/workspace-editor')
    return [...editorDocuments.values()].some(
      (document) =>
        document.sessionId === sessionId &&
        document.rootId === root.id &&
        within(document.path, target) &&
        (document.dirty || document.saving)
    )
  }

  const startCreate = (parent: string, isDirectory: boolean): void => {
    if (parent) setExpanded((previous) => withAncestors(previous, parent))
    setEditing({ kind: 'create', parent, isDirectory })
  }

  const create = async (parent: string, name: string, isDirectory: boolean): Promise<void> => {
    setEditing(null)
    const failure = t(isDirectory ? 'ide.folderCreateError' : 'ide.fileCreateError')
    if (invalid(name)) return setError(failure)
    const path = join(parent, name)
    try {
      const result = await api.files.create(sessionId, absolute(path), isDirectory)
      if (!result.success) throw new Error('Create failed')
      setExpanded((previous) => withAncestors(previous, isDirectory ? path : parentOf(path)))
      refresh()
      if (!isDirectory) onSelect({ rootId: root.id, path, comparison: false })
    } catch {
      setError(failure)
    }
  }

  const rename = async (entry: WorkspaceEntry, name: string): Promise<void> => {
    setEditing(null)
    if (name === entry.name) return
    if (invalid(name)) return setError(t('ide.renameError'))
    if (await hasUnsaved(entry.path)) return setError(t('ide.unsavedBlocked'))
    const next = join(parentOf(entry.path), name)
    try {
      const result = await api.files.rename(sessionId, absolute(entry.path), absolute(next))
      if (!result.success) throw new Error('Rename failed')
      setExpanded((previous) => {
        const moved = new Set<string>()
        for (const path of previous)
          moved.add(within(path, entry.path) ? next + path.slice(entry.path.length) : path)
        return moved
      })
      refresh()
    } catch {
      setError(t('ide.renameError'))
    }
  }

  const remove = async (entry: WorkspaceEntry): Promise<void> => {
    if (await hasUnsaved(entry.path)) return setError(t('ide.unsavedBlocked'))
    if (!window.confirm(t('ide.deleteConfirm', { name: entry.name }))) return
    try {
      if (!(await api.files.delete(sessionId, absolute(entry.path))))
        throw new Error('Delete failed')
      setExpanded((previous) => new Set([...previous].filter((path) => !within(path, entry.path))))
      refresh()
    } catch {
      setError(t('ide.deleteError', { name: entry.name }))
    }
  }

  const tree: Tree = {
    sessionId,
    root,
    version,
    expanded,
    editing,
    toggle: (path) =>
      setExpanded((previous) => {
        const next = new Set(previous)
        if (!next.delete(path)) next.add(path)
        return next
      }),
    cancelEdit: () => setEditing(null),
    create: (parent, name, isDirectory) => void create(parent, name, isDirectory),
    rename: (entry, name) => void rename(entry, name),
    remove: (entry) => void remove(entry),
    startRename: (entry) => setEditing({ kind: 'rename', entry }),
    openMenu: (event, entry) => {
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, entry })
    },
    onSelect
  }

  const menuGroups = (entry: WorkspaceEntry | null): MenuItem[][] => {
    const parent = !entry ? '' : entry.kind === 'directory' ? entry.path : parentOf(entry.path)
    const groups: MenuItem[][] = [
      [
        {
          key: 'file',
          label: t('ide.newFile'),
          icon: FilePlus,
          run: () => startCreate(parent, false)
        },
        {
          key: 'folder',
          label: t('ide.newFolder'),
          icon: FolderPlus,
          run: () => startCreate(parent, true)
        }
      ]
    ]
    if (entry)
      groups.push([
        {
          key: 'rename',
          label: t('ide.rename'),
          icon: PencilLine,
          run: () => setEditing({ kind: 'rename', entry })
        },
        {
          key: 'delete',
          label: t('ide.delete'),
          icon: Trash2,
          danger: true,
          run: () => void remove(entry)
        }
      ])
    const copy = (text: string): void => void navigator.clipboard.writeText(text).catch(() => {})
    groups.push([
      {
        key: 'copyPath',
        label: t('ide.copyPath'),
        icon: ClipboardCopy,
        run: () => copy(nativePath(entry?.path ?? ''))
      },
      ...(entry
        ? [
            {
              key: 'copyRelative',
              label: t('ide.copyRelativePath'),
              icon: ClipboardCopy,
              run: () => copy(entry.path)
            }
          ]
        : []),
      ...(!entry || entry.kind === 'directory'
        ? [
            {
              key: 'reveal',
              label: t('ide.openFolder'),
              icon: FolderOpen,
              run: () =>
                void api.files
                  .openFolder(sessionId, absolute(entry?.path ?? ''))
                  .catch(() => setError(t('ide.openFolderError')))
            }
          ]
        : [])
    ])
    if (!entry)
      groups.push([
        {
          key: 'collapse',
          label: t('ide.collapseAll'),
          icon: ChevronsDownUp,
          run: () => setExpanded(new Set())
        }
      ])
    return groups
  }

  const groups = menu ? menuGroups(menu.entry) : []
  const rows = groups.reduce((sum, group) => sum + group.length, 0)

  return (
    <TreeContext.Provider value={tree}>
      <section
        className="mb-3"
        onContextMenu={(event) => {
          if (event.defaultPrevented || event.target instanceof HTMLInputElement) return
          tree.openMenu(event, null)
        }}
      >
        <WorkspaceRootHeader root={root}>
          <HeaderAction
            label={t('ide.newFile')}
            icon={FilePlus}
            onClick={() => startCreate('', false)}
          />
          <HeaderAction
            label={t('ide.newFolder')}
            icon={FolderPlus}
            onClick={() => startCreate('', true)}
          />
          <HeaderAction label={t('ide.refresh')} icon={RefreshCw} onClick={refresh} />
          <HeaderAction
            label={t('ide.collapseAll')}
            icon={ChevronsDownUp}
            onClick={() => setExpanded(new Set())}
          />
        </WorkspaceRootHeader>
        {error && (
          <p role="alert" className="px-3 pb-1 text-[11px] text-danger">
            {error}
          </p>
        )}
        <Directory />
      </section>
      {menu && (
        <ContextMenuSurface
          x={menu.x}
          y={menu.y}
          height={
            rows * CONTEXT_ROW_H + (groups.length - 1) * CONTEXT_SEPARATOR_H + CONTEXT_MENU_PAD
          }
          onClose={closeMenu}
        >
          {groups.map((group, index) => (
            <div key={group[0].key}>
              {index > 0 && <ContextMenuSeparator />}
              {group.map((item) => (
                <ContextMenuRow
                  key={item.key}
                  role="menuitem"
                  label={item.label}
                  icon={item.icon}
                  danger={item.danger}
                  onSelect={() => {
                    closeMenu()
                    item.run()
                  }}
                />
              ))}
            </div>
          ))}
        </ContextMenuSurface>
      )}
    </TreeContext.Provider>
  )
}
