/** Renderer preferences regression smoke; real components, isolated hooks and bridge. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildSync, transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const storage = new Map()
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
}
const key = 'roxy.quota.order.v1'
const quotasModule = { exports: {} }
new Function(
  'module',
  'exports',
  buildSync({
    entryPoints: ['src/shared/quota.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false
  }).outputFiles[0].text
)(quotasModule, quotasModule.exports)
const provider = { id: 'a', seedId: 'claude-subscription', name: 'Claude', enabled: true }
const sibling = { ...provider, id: 'b' }
const bucket = (id, label, remaining, family) => ({
  id,
  label,
  remaining,
  ...(family ? { family } : {})
})
const weekly = bucket('seven_day', 'Weekly', 2)
const five = bucket('five_hour', '5-hour', 91)
const sonnet = bucket('seven_day_sonnet', 'Weekly Sonnet', 10, 'sonnet')
const opus = bucket('seven_day_opus', 'Weekly Opus', 20, 'opus')
const quota = (id, buckets) => ({ connectionId: id, upstream: 'claude', buckets })
const state = {
  providers: [provider, sibling],
  quotas: {
    a: quota('a', [five, weekly, sonnet, opus]),
    b: quota('b', [bucket('five_hour', '5-hour', 1), bucket('seven_day', 'Weekly', 80)])
  },
  quotaLoading: {},
  modelCatalog: {},
  settings: {},
  ensureModels: () => {},
  refreshQuota: () => {}
}

let current
const hooks = {
  memo: (component) => component,
  useState(initial) {
    const index = current.index++
    const context = current
    if (!(index in context.values))
      context.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      context.values[index],
      (next) => {
        context.values[index] = typeof next === 'function' ? next(context.values[index]) : next
      }
    ]
  },
  useRef(initial) {
    const index = current.index++
    return (current.values[index] ??= { current: initial })
  },
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useId: () => 'test-id',
  useEffect: (effect) => current.effects.push(effect)
}
const windowEvents = new Map()
const window = {
  addEventListener: (name, callback) => windowEvents.set(name, callback),
  removeEventListener: (name) => windowEvents.delete(name)
}
const document = { querySelector: () => null, activeElement: null }
function load(path, extra = '', overrides = {}) {
  const source = readFileSync(path, 'utf8') + extra
  const module = { exports: {} }
  const dependencies = {
    react: hooks,
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@shared/quota': quotasModule.exports,
    '@shared/cliproxy': {
      upstreamFor: (seed) => {
        const upstream = {
          'claude-subscription': 'claude',
          'gemini-subscription': 'antigravity',
          'codex-subscription': 'codex'
        }[seed]
        return upstream ? { upstream, accountLabel: upstream } : undefined
      }
    },
    '../lib/store': { useRoxyStore: (selector) => selector(state) },
    '../lib/api': { api: {} },
    './ContextMenu': {
      ContextMenuSurface: () => null,
      ContextMenuRow: () => null,
      ContextMenuSeparator: () => null,
      CONTEXT_ROW_H: 30,
      CONTEXT_SEPARATOR_H: 5,
      CONTEXT_MENU_PAD: 8
    },
    './BotAvatar': { BotAvatar: () => null },
    './SidebarFrame': { SidebarFrame: () => null, SidebarNavItem: () => null },
    './WindowControls': { WindowControls: () => null },
    '../components/Sidebar': { Sidebar: () => null },
    '../components/ChatView': { ChatView: () => null },
    '../components/IdeWorkspace': { IdeWorkspace: () => null },
    '../components/IdeModeToggle': { IdeModeToggle: () => null },
    '../components/TopNavbar': { TopNavbar: () => null },
    '../lib/background': {
      useBackground: () => ({
        rendered: null,
        settings: { sidebarStyle: 'default', sidebarOpacity: 66 }
      })
    },
    '../components/BackgroundMedia': { BackgroundMedia: () => null },
    '../lib/chat-dock': { chatDockAtPoint: () => null },
    './ui': { Button: () => null },
    '../lib/cn': { cn: (...parts) => parts.filter(Boolean).join(' ') }
  }
  new Function(
    'require',
    'module',
    'exports',
    'localStorage',
    'window',
    'document',
    transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  )(
    (name) => overrides[name] ?? dependencies[name] ?? require(name),
    module,
    module.exports,
    localStorage,
    window,
    document
  )
  return module.exports
}
function render(Component, props, context = { values: [], effects: [] }) {
  current = context
  current.index = 0
  current.effects = []
  return { tree: Component(props), context }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
const find = (tree, type) => nodes(tree).find((node) => node.type === type)
const quotaUI = load(
  'src/renderer/src/components/QuotaMeter.tsx',
  '\nexport { BucketList, Meter, applyOrder, loadOrder }'
)
const pageUI = load('src/renderer/src/components/PageShell.tsx')
const botsUI = load('src/renderer/src/components/BotsSection.tsx')
globalThis.getComputedStyle = () => ({ direction: 'ltr' })
state.bots = ['alpha', 'beta', 'gamma'].map((id) => ({ id, username: id, chatId: 'chat-' + id }))
state.runningAutomation = {}
const botMoves = []
const botSelections = []
state.reorderBots = async (ids) => botMoves.push(ids)
state.selectChat = async (id) => botSelections.push(id)
const botButton = (tree, id) =>
  nodes(tree).find((node) => node.type === 'button' && node.props['aria-label'] === '@' + id)
for (const rail of [false, true]) {
  let strip = render(botsUI.BotsSection, { rail })
  const alpha = botButton(strip.tree, 'alpha')
  assert.equal(alpha.props.draggable, true)
  alpha.props.onDragStart({ dataTransfer: { setData() {} } })
  strip = render(botsUI.BotsSection, { rail }, strip.context)
  const beta = botButton(strip.tree, 'beta')
  beta.props.onDragOver({
    preventDefault() {},
    dataTransfer: {},
    clientX: 75,
    clientY: 75,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }
  })
  strip = render(botsUI.BotsSection, { rail }, strip.context)
  botButton(strip.tree, 'beta').props.onDrop({ preventDefault() {} })
  assert.deepEqual(botMoves.at(-1), ['beta', 'alpha', 'gamma'])
  strip = render(botsUI.BotsSection, { rail }, strip.context)
  botButton(strip.tree, 'alpha').props.onClick()
  assert.equal(botSelections.length, 0, 'drop must not open a chat')
  botButton(strip.tree, 'alpha').props.onKeyDown({ key: 'Enter' })
  botButton(strip.tree, 'alpha').props.onMouseDown()
  botButton(strip.tree, 'alpha').props.onClick()
  assert.equal(botSelections.pop(), 'chat-alpha')
  botButton(strip.tree, 'alpha').props.onKeyDown({
    key: 'ArrowRight',
    shiftKey: true,
    preventDefault() {},
    currentTarget: {}
  })
  assert.deepEqual(botMoves.at(-1), ['beta', 'alpha', 'gamma'])
}
globalThis.getComputedStyle = () => ({ direction: 'rtl' })
const rtlStrip = render(botsUI.BotsSection, {})
botButton(rtlStrip.tree, 'gamma').props.onKeyDown({
  key: 'ArrowRight',
  shiftKey: true,
  preventDefault() {},
  currentTarget: {}
})
assert.deepEqual(botMoves.at(-1), ['alpha', 'gamma', 'beta'])
delete globalThis.getComputedStyle

for (const raw of ['invalid', '[]', 'null', '{"claude":["five_hour",null,1,"five_hour"]}']) {
  storage.set(key, raw)
  const loaded = quotaUI.loadOrder()
  assert.deepEqual(loaded.claude ?? [], raw.startsWith('{') ? ['five_hour'] : [])
}
storage.set(
  key,
  JSON.stringify({ claude: ['removed-model', 'seven_day'], codex: ['primary', 'secondary'] })
)
const props = { provider, model: 'claude-sonnet-5-5' }
let mounted = render(quotaUI.QuotaMeter, props)
mounted.context.values[1] = state.quotas
find(mounted.tree, 'button').props.onClick()
mounted = render(quotaUI.QuotaMeter, props, mounted.context)
const limits = find(mounted.tree, quotaUI.BucketList)
assert.equal(typeof limits.props.onReorder, 'function')
limits.props.onReorder(['five_hour', 'seven_day_sonnet', 'seven_day'])
mounted = render(quotaUI.QuotaMeter, props, mounted.context)
assert.equal(find(mounted.tree, quotaUI.Meter).props.value, 91)
assert.equal(find(mounted.tree, quotaUI.Meter).props.status, 2)
assert.ok(nodes(mounted.tree).some((node) => node.props?.children === 'quota.pillHint'))
assert.equal(nodes(mounted.tree).filter((node) => node.type === quotaUI.BucketList).length, 2)
assert.ok(
  nodes(mounted.tree).some(
    (node) => node.type === quotaUI.BucketList && node.props.buckets[0]?.id === 'seven_day_opus'
  )
)
const saved = JSON.parse(storage.get(key))
assert.deepEqual(saved.claude, ['five_hour', 'seven_day_sonnet', 'seven_day'])
assert.deepEqual(saved.codex, ['primary', 'secondary'])
const reopened = render(quotaUI.QuotaMeter, props)
reopened.context.values[1] = state.quotas
assert.equal(
  find(render(quotaUI.QuotaMeter, props, reopened.context).tree, quotaUI.Meter).props.value,
  91
)
const storageSet = localStorage.setItem
localStorage.setItem = () => {
  throw new Error('storage blocked')
}
limits.props.onReorder(['five_hour', 'seven_day', 'seven_day_sonnet'])
mounted = render(quotaUI.QuotaMeter, props, mounted.context)
assert.equal(find(mounted.tree, quotaUI.Meter).props.value, 91)
localStorage.setItem = storageSet
find(mounted.tree, 'select').props.onChange({ target: { value: 'b' } })
mounted = render(quotaUI.QuotaMeter, props, mounted.context)
const siblingLimits = find(mounted.tree, quotaUI.BucketList)
assert.equal(typeof siblingLimits.props.onReorder, 'function')
assert.ok(find(render(quotaUI.BucketList, siblingLimits.props).tree, quotaUI.BucketRow).props.grip)
assert.ok(!nodes(mounted.tree).some((node) => node.props?.children === 'quota.pillHint'))
assert.equal(find(mounted.tree, quotaUI.Meter).props.value, 91)
siblingLimits.props.onReorder(['seven_day', 'five_hour'])
mounted = render(quotaUI.QuotaMeter, props, mounted.context)
assert.equal(find(mounted.tree, quotaUI.Meter).props.value, 2)
assert.deepEqual(JSON.parse(storage.get(key)).claude, ['seven_day', 'five_hour'])
assert.deepEqual(
  quotaUI.applyOrder([weekly, five], []).map((b) => b.id),
  ['seven_day', 'five_hour']
)
assert.deepEqual(
  quotaUI.applyOrder([weekly, five], ['unknown', 'five_hour']).map((b) => b.id),
  ['five_hour', 'seven_day']
)
const meter = render(quotaUI.Meter, { value: 91, status: 2 }).tree
assert.ok(nodes(meter).some((node) => node.props?.className?.includes('bg-danger')))
const hidden = render(quotaUI.BucketRow, { bucket: weekly, now: 0 }).tree
assert.ok(nodes(hidden).some((node) => node.props?.className?.includes('invisible h-9 w-5')))

const moves = []
let list = render(quotaUI.BucketList, {
  buckets: [weekly, five],
  now: 0,
  onReorder: (ids) => moves.push(ids)
})
const row = find(list.tree, quotaUI.BucketRow)
const grip = row.props.grip
assert.equal(grip.type, 'button')
assert.equal(grip.props['aria-haspopup'], 'menu')
grip.props.onKeyDown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} })
assert.deepEqual(moves[0], ['five_hour', 'seven_day'])
grip.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } })
list = render(
  quotaUI.BucketList,
  { buckets: [weekly, five], now: 0, onReorder: (ids) => moves.push(ids) },
  list.context
)
const menu = nodes(list.tree).find((node) => node.props?.role === 'menu')
assert.ok(menu)
const actions = nodes(menu).filter((node) => node.props?.role === 'menuitem')
assert.equal(actions[0].props.disabled, true)
actions[1].props.onSelect()
assert.deepEqual(moves[1], ['five_hour', 'seven_day'])
let dragging = render(quotaUI.BucketList, {
  buckets: [weekly, five],
  now: 0,
  onReorder: (ids) => moves.push(ids)
})
find(dragging.tree, quotaUI.BucketRow).props.grip.props.onDragStart({
  dataTransfer: { setData() {} }
})
dragging = render(
  quotaUI.BucketList,
  { buckets: [weekly, five], now: 0, onReorder: (ids) => moves.push(ids) },
  dragging.context
)
const target = nodes(dragging.tree).filter((node) => node.props?.onDragOver)[1]
target.props.onDragOver({
  preventDefault() {},
  clientY: 75,
  currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) }
})
dragging = render(
  quotaUI.BucketList,
  { buckets: [weekly, five], now: 0, onReorder: (ids) => moves.push(ids) },
  dragging.context
)
nodes(dragging.tree)
  .filter((node) => node.props?.onDrop)[1]
  .props.onDrop({ preventDefault() {} })
assert.deepEqual(moves[2], ['five_hour', 'seven_day'])
const readOnly = render(quotaUI.BucketList, { buckets: [weekly, five], now: 0 })
assert.equal(find(readOnly.tree, quotaUI.BucketRow).props.grip, undefined)
const single = render(quotaUI.BucketList, { buckets: [weekly], now: 0, onReorder() {} })
assert.equal(find(single.tree, quotaUI.BucketRow).props.grip, undefined)

// Every allowance is reorderable, including when browsing another provider.
const gemini = { ...provider, id: 'google', seedId: 'gemini-subscription' }
const copilot = { ...provider, id: 'github', seedId: 'github-copilot' }
state.providers.push(gemini, copilot)
const modelBucket = (id, remaining) => ({ ...bucket(id, id, remaining), models: [id] })
state.quotas.google = {
  connectionId: 'google',
  upstream: 'antigravity',
  buckets: [modelBucket('gemini-pro', 75), modelBucket('gemini-flash', 10)]
}
state.quotas.github = {
  connectionId: 'github',
  upstream: 'copilot',
  buckets: [bucket('premium', 'Premium requests', 60), bucket('completions', 'Completions', 5)]
}
for (const [account, model, ids] of [
  [gemini, 'gemini-pro', ['gemini-flash', 'gemini-pro']],
  [copilot, 'paid-model', ['completions', 'premium']]
]) {
  const activeProps = { provider: account, model }
  let view = render(quotaUI.QuotaMeter, activeProps)
  view.context.values[1] = state.quotas
  find(view.tree, 'button').props.onClick()
  view = render(quotaUI.QuotaMeter, activeProps, view.context)
  const all = nodes(view.tree).filter((node) => node.type === quotaUI.BucketList)
  assert.equal(all.length, 1)
  assert.equal(all[0].props.buckets.length, 2)
  const rows = nodes(render(quotaUI.BucketList, all[0].props).tree).filter(
    (node) => node.type === quotaUI.BucketRow
  )
  assert.ok(rows.every((row) => row.props.grip?.props.draggable))
  const applicableId = account === gemini ? 'gemini-pro' : 'premium'
  for (const row of rows) {
    assert.equal(row.props.appliesTo, row.props.bucket.id === applicableId ? model : undefined)
    const rendered = render(quotaUI.BucketRow, row.props).tree
    assert.equal(
      nodes(rendered).some((node) => node.props?.children === 'quota.currentModel'),
      row.props.bucket.id === applicableId
    )
  }
  const before = find(view.tree, quotaUI.Meter).props
  all[0].props.onReorder(ids)
  view = render(quotaUI.QuotaMeter, activeProps, view.context)
  assert.deepEqual(
    find(view.tree, quotaUI.BucketList).props.buckets.map((b) => b.id),
    ids
  )
  assert.equal(find(view.tree, quotaUI.Meter).props.value, before.value)
  assert.equal(find(view.tree, quotaUI.Meter).props.status, before.status)
  const reloaded = render(quotaUI.QuotaMeter, activeProps)
  reloaded.context.values[1] = state.quotas
  reloaded.context.values[4] = true
  assert.deepEqual(
    find(
      render(quotaUI.QuotaMeter, activeProps, reloaded.context).tree,
      quotaUI.BucketList
    ).props.buckets.map((b) => b.id),
    ids
  )
  find(mounted.tree, 'select').props.onChange({ target: { value: account.id } })
  mounted = render(quotaUI.QuotaMeter, props, mounted.context)
  const browsed = find(mounted.tree, quotaUI.BucketList)
  assert.equal(browsed.props.buckets.length, 2)
  assert.equal(typeof browsed.props.onReorder, 'function')
  assert.equal(browsed.props.modelScope, undefined)
  browsed.props.onReorder([...ids].reverse())
  mounted = render(quotaUI.QuotaMeter, props, mounted.context)
  assert.deepEqual(
    find(mounted.tree, quotaUI.BucketList).props.buckets.map((b) => b.id),
    [...ids].reverse()
  )
  assert.equal(find(mounted.tree, quotaUI.Meter).props.value, 2)
}

// Loaded quota with no applicable limits displays '--' with an explanatory label and no Loader2
const unmeteredProps = { provider: gemini, model: 'unmetered-model' }
let unmeteredView = render(quotaUI.QuotaMeter, unmeteredProps)
unmeteredView.context.values[1] = state.quotas
const unmeteredTree = render(quotaUI.QuotaMeter, unmeteredProps, unmeteredView.context).tree
assert.ok(
  nodes(unmeteredTree).some(
    (node) =>
      node.props?.children === '--' &&
      node.props?.title === 'quota.noModelLimit' &&
      node.props?.['aria-label'] === 'quota.noModelLimit'
  )
)
assert.ok(
  !nodes(unmeteredTree).some(
    (node) => node.type === 'Loader2' || node.props?.className?.includes('animate-spin')
  )
)

const settingsSource = readFileSync('src/renderer/src/routes/Settings.tsx', 'utf8')
const escapeOverride = settingsSource.match(/onEscape=\{(\(\) => \{[\s\S]*?\n      \})\}/)[1]
const makeOverride = new Function(
  'resetting',
  'confirmingReset',
  'setConfirmingReset',
  'promptDialogOpen = false',
  'creatingPrompt = false',
  'setPromptDialogOpen = () => {}',
  'return ' + escapeOverride
)
assert.equal(makeOverride(true, false, () => assert.fail('busy reset must not cancel'))(), true)
let resetConfirmation = true
assert.equal(
  makeOverride(false, true, (value) => {
    resetConfirmation = value
  })(),
  true
)
assert.equal(resetConfirmation, false)
assert.equal(makeOverride(false, false, () => assert.fail('no confirmation to cancel'))(), false)
let promptOpen = true
assert.equal(
  makeOverride(
    false,
    false,
    () => assert.fail('no reset confirmation'),
    true,
    false,
    (value) => {
      promptOpen = value
    }
  )(),
  true
)
assert.equal(promptOpen, false)
assert.equal(
  makeOverride(
    false,
    false,
    () => assert.fail('no reset confirmation'),
    true,
    true,
    () => {
      assert.fail('busy prompt creation must not close dialog')
    }
  )(),
  true
)

let backs = 0
const page = render(pageUI.PageShell, { title: 'test', onBack: () => backs++ })
const dispose = page.context.effects[0]()
const onKey = windowEvents.get('keydown')
for (const event of [
  { key: 'Enter' },
  { key: 'Escape', defaultPrevented: true },
  { key: 'Escape', repeat: true },
  { key: 'Escape', isComposing: true }
])
  onKey(event)
assert.equal(backs, 0)
document.querySelector = () => ({})
onKey({ key: 'Escape' })
assert.equal(backs, 0)
document.querySelector = () => null
onKey({ key: 'Escape', preventDefault() {} })
assert.equal(backs, 1)
dispose()
assert.equal(windowEvents.size, 0)
let consumed = 0
const special = render(pageUI.PageShell, {
  title: 'test',
  onBack: () => backs++,
  onEscape: () => {
    consumed++
    return true
  }
})
special.context.effects[0]()
windowEvents.get('keydown')({ key: 'Escape', preventDefault() {} })
assert.equal(consumed, 1)
assert.equal(backs, 1)
const ideUI = load('src/renderer/src/components/IdeModeToggle.tsx')
let finishIdeSave
const ideSaves = []
state.settings = { ideMode: false }
state.setIdeMode = (enabled) => {
  ideSaves.push(enabled)
  return new Promise((resolve) => {
    finishIdeSave = () => {
      state.settings = { ...state.settings, ideMode: enabled }
      resolve()
    }
  })
}
let ide = render(ideUI.IdeModeToggle, {})
let toggle = find(ide.tree, 'button')
assert.equal(toggle.props.role, 'switch')
assert.equal(toggle.props['aria-checked'], false)
const savingIde = toggle.props.onClick()
await toggle.props.onClick()
assert.deepEqual(ideSaves, [true], 'Rapid clicks save only once')
ide = render(ideUI.IdeModeToggle, {}, ide.context)
assert.equal(find(ide.tree, 'button').props.disabled, true)
assert.equal(find(ide.tree, 'button').props['aria-busy'], true)
finishIdeSave()
await savingIde
ide = render(ideUI.IdeModeToggle, {}, ide.context)
toggle = find(ide.tree, 'button')
assert.equal(toggle.props['aria-checked'], true)
assert.equal(toggle.props.disabled, false)
const disablingIde = toggle.props.onClick()
finishIdeSave()
await disablingIde
assert.deepEqual(ideSaves, [true, false], 'Toggle saves both modes')
state.setIdeMode = async () => {
  throw new Error('save failed')
}
ide = render(ideUI.IdeModeToggle, {}, ide.context)
await find(ide.tree, 'button').props.onClick()
ide = render(ideUI.IdeModeToggle, {}, ide.context)
assert.equal(find(ide.tree, 'button').props['aria-checked'], false)
assert.equal(find(ide.tree, 'button').props.disabled, false)
assert.equal(find(ide.tree, 'button').props.title, 'ide.saveError')
assert.ok(nodes(ide.tree).some((node) => node.props?.role === 'alert'))
state.settings = null
ide = render(ideUI.IdeModeToggle, {}, ide.context)
assert.equal(find(ide.tree, 'button').props.disabled, true)

const chatUI = load('src/renderer/src/routes/Chat.tsx')
state.chats = []
state.activeChatId = null
storage.set('roxy.ide.chatCollapsed.v1', 'true')
state.settings = { ideMode: false }
let chat = render(chatUI.default, {})
assert.equal(nodes(chat.tree).filter((node) => node.type?.name === 'IdeModeToggle').length, 0)
assert.ok(!nodes(chat.tree).some((node) => node.props?.className?.includes('invisible')))
state.settings = { ideMode: true }
chat = render(chatUI.default, {}, chat.context)
assert.equal(nodes(chat.tree).filter((node) => node.type?.name === 'IdeModeToggle').length, 0)
assert.equal(nodes(chat.tree).filter((node) => node.type?.name === 'IdeWorkspace').length, 1)
assert.ok(nodes(chat.tree).some((node) => node.props?.className?.includes('invisible')))
const ideSource = readFileSync('src/renderer/src/components/IdeWorkspace.tsx', 'utf8')
assert.ok(!ideSource.includes('<IdeModeToggle />'), 'IDE activity bar has no duplicate toggle')
const sidebarUI = load('src/renderer/src/components/Sidebar.tsx', '', {
  'react-router-dom': { useNavigate: () => () => {} },
  'morphicons/react': { MorphIcon: () => null },
  '@shared/forge': { isPullRequestPhase: () => false },
  '@shared/workstream': { statusKeyForSession: () => null },
  '@shared/repos': { repoCountBadge: () => null },
  '../lib/motion': { useMotion: () => ({ reduced: true }) },
  '../lib/lifecycle': { TONE_BG: {}, TONE_TEXT_STATIC: {} },
  './BotsSection': { BotsSection: () => null },
  './ThinkingIndicator': { BrailleSpinner: () => null },
  './UpdateCard': { UpdateCard: () => null },
  './IdeModeToggle': ideUI
})
state.projectOrder = []
state.bots = []
state.sidebarRailed = true
for (const enabled of [false, true]) {
  state.settings = { ideMode: enabled }
  const sidebar = render(sidebarUI.Sidebar, {})
  const railNodes = nodes(sidebar.tree)
  const toggleIndex = railNodes.findIndex((node) => node.type === ideUI.IdeModeToggle)
  const folderIndex = railNodes.findIndex(
    (node) => node.type === 'button' && node.props.title === 'sidebar.newProject'
  )
  assert.equal(toggleIndex, -1, 'IDE opens from file links, without a manual toggle')
  assert.ok(folderIndex >= 0, 'New-project button remains available')
}
state.sidebarRailed = false
assert.ok(
  !nodes(render(sidebarUI.Sidebar, {}).tree).some((node) => node.type === ideUI.IdeModeToggle)
)
const toolSelections = []
const tabSelections = []
state.setIdeTab = (tab) => tabSelections.push(tab)
state.setSidebarRailed = (value) => {
  state.sidebarRailed = value
}
for (const rail of [false, true]) {
  state.sidebarRailed = rail
  for (const enabled of [false, true]) {
    state.settings = { ideMode: enabled }
    const sidebar = render(sidebarUI.Sidebar, {
      tool: 'git',
      onToolChange: (tool) => toolSelections.push(tool)
    })
    const buttons = nodes(sidebar.tree).filter((node) => node.type === 'button')
    const toolButton = (label) => buttons.find((node) => node.props['aria-label'] === label)
    assert.equal(Boolean(toolButton('ide.filesTab')), enabled)
    assert.equal(Boolean(toolButton('ide.searchTab')), enabled)
    const gitButton = toolButton('ide.gitTab')
    assert.ok(gitButton, 'Git workflow is available in both modes')
    assert.equal(gitButton.props['aria-pressed'], true)
    gitButton.props.onClick()
    assert.equal(tabSelections.at(-1), 'git')
    assert.equal(toolSelections.at(-1), null)
    if (rail) assert.equal(state.sidebarRailed, true, 'Git does not expand the main sidebar')
    if (!rail) {
      assert.ok(
        nodes(sidebar.tree).some(
          (node) =>
            node.props?.className?.includes('overflow-y-auto') &&
            !node.props.className.includes('hidden')
        ),
        'Session list stays visible with Git open'
      )
    }
    state.sidebarRailed = rail
  }
}
for (const rail of [false, true]) {
  state.sidebarRailed = rail
  for (const count of [0, 7, 120]) {
    const sidebar = render(sidebarUI.Sidebar, { changedFileCount: count, onToolChange: () => {} })
    const button = nodes(sidebar.tree).find(
      (node) => node.type === 'button' && node.props['aria-label']?.startsWith('ide.gitTab')
    )
    assert.ok(button)
    assert.equal(button.props.title, count ? `ide.gitTab (${count})` : 'ide.gitTab')
    const badge = nodes(button).find(
      (node) => node.type === 'span' && node.props['aria-hidden'] === 'true'
    )
    assert.equal(Boolean(badge), count > 0)
    if (badge) assert.equal(badge.props.children, count > 99 ? '99+' : count)
  }
}
state.settings = { ideMode: false }
chat = render(chatUI.default, {}, chat.context)
nodes(chat.tree)
  .find((node) => node.type?.name === 'IdeWorkspace')
  .props.onChangedFileCount(9)
chat = render(chatUI.default, {}, chat.context)
assert.equal(
  nodes(chat.tree).find((node) => node.type?.name === 'Sidebar').props.changedFileCount,
  9
)
let chatSidebar = nodes(chat.tree).find((node) => node.type?.name === 'Sidebar')
chatSidebar.props.onToolChange('files')
chat = render(chatUI.default, {}, chat.context)
chatSidebar = nodes(chat.tree).find((node) => node.type?.name === 'Sidebar')
assert.equal(chatSidebar.props.tool, null, 'File tools cannot remain visible outside IDE mode')
chatSidebar.props.onToolChange('git')
chat = render(chatUI.default, {}, chat.context)
chatSidebar = nodes(chat.tree).find((node) => node.type?.name === 'Sidebar')
assert.equal(chatSidebar.props.tool, 'git')
const workspace = nodes(chat.tree).find((node) => node.type?.name === 'IdeWorkspace')
assert.equal(workspace.props.sidebarTab, 'git')
assert.equal(workspace.props.ideMode, false)
const gitPanel = nodes(chat.tree).find(
  (node) => node.type === 'aside' && node.props['aria-label'] === 'ide.gitTab'
)
assert.ok(gitPanel, 'Git opens in an independent panel beside the sidebar')
const gitHost = nodes(gitPanel).find((node) => node.ref)
const gitPortalTarget = {}
gitHost.ref(gitPortalTarget)
chat = render(chatUI.default, {}, chat.context)
assert.equal(
  nodes(chat.tree).find((node) => node.type?.name === 'IdeWorkspace').props.sidebarTarget,
  gitPortalTarget
)
find(gitPanel, 'button').props.onClick()
chat = render(chatUI.default, {}, chat.context)
assert.ok(
  !nodes(chat.tree).some((node) => node.type === 'aside'),
  'Git panel close button dismisses it'
)
state.settings = { ideMode: true }
for (const tool of ['files', 'search']) {
  const label = tool === 'files' ? 'ide.filesTab' : 'ide.searchTab'
  chatSidebar.props.onToolChange(tool)
  chat = render(chatUI.default, {}, chat.context)
  const panel = nodes(chat.tree).find(
    (node) => node.type === 'aside' && node.props['aria-label'] === label
  )
  assert.ok(panel, `${tool} opens independently beside the sidebar`)
  const host = {}
  nodes(panel)
    .find((node) => node.ref)
    .ref(host)
  chat = render(chatUI.default, {}, chat.context)
  const editor = nodes(chat.tree).find((node) => node.type?.name === 'IdeWorkspace')
  assert.equal(editor.props.sidebarTarget, host)
  assert.equal(editor.props.sidebarTab, tool)
  for (const rail of [false, true]) {
    state.sidebarRailed = rail
    const sidebar = render(sidebarUI.Sidebar, {
      tool,
      onToolChange: (next) => toolSelections.push(next)
    })
    const button = nodes(sidebar.tree).find(
      (node) => node.type === 'button' && node.props['aria-label'] === label
    )
    button.props.onClick()
    assert.equal(toolSelections.at(-1), null, 'Active tool button closes independent panel')
    assert.equal(state.sidebarRailed, rail, 'File tools preserve sidebar collapse state')
    if (!rail)
      assert.ok(
        nodes(sidebar.tree).some(
          (node) =>
            node.props?.className?.includes('overflow-y-auto') &&
            !node.props.className.includes('hidden')
        ),
        'Session list remains visible'
      )
  }
  find(panel, 'button').props.onClick()
  chat = render(chatUI.default, {}, chat.context)
  assert.ok(!nodes(chat.tree).some((node) => node.type === 'aside'))
}
const openedChanges = []
state.messages = []
state.streamingChats = {}
state.setIdeSelectedFile = (...args) => openedChanges.push(args)
const changedFile = {
  path: 'src/example.ts',
  fileName: 'example.ts',
  addedLines: 12,
  removedLines: 4,
  isModified: true,
  reviewStatus: 'pending'
}
const changesUI = load('src/renderer/src/components/AgentFileChangesPopup.tsx', '', {
  '../lib/agent-file-changes': {
    extractAgentFileChanges: () => ({ files: [changedFile], latestTurnFiles: [changedFile] }),
    subscribeFileReviews: () => () => {}
  }
})
let changes = render(changesUI.AgentFileChangesPopup, {})
assert.ok(
  !nodes(changes.tree).some((node) => node.props?.role === 'dialog'),
  'Changed files start as a badge'
)
const badge = find(changes.tree, 'button')
assert.equal(badge.props['aria-haspopup'], 'dialog')
assert.ok(
  nodes(badge).some((node) => node.props?.children?.includes?.(12)),
  'Badge includes added lines'
)
badge.props.onClick()
changes = render(changesUI.AgentFileChangesPopup, {}, changes.context)
assert.ok(
  nodes(changes.tree).some((node) => node.props?.role === 'dialog'),
  'Badge opens file picker'
)
nodes(changes.tree)
  .find((node) => node.props?.role === 'button')
  .props.onClick()
assert.equal(openedChanges.at(-1)[0].path, changedFile.path)
changes = render(changesUI.AgentFileChangesPopup, {}, changes.context)
assert.ok(
  !nodes(changes.tree).some((node) => node.props?.role === 'dialog'),
  'Selecting a file closes picker'
)
const storeSource = readFileSync('src/renderer/src/lib/store.ts', 'utf8')
const fileActionsSource = storeSource.slice(
  storeSource.indexOf('  setIdeSelectedFile: (entry, line, root) => {'),
  storeSource.indexOf('  pendingContextAttachments: {},')
)
let editorState = {
  settings: { ideMode: false, ttsEnabled: true },
  chats: [{ id: 'chat', workspacePath: 'D:\\project' }],
  activeChatId: 'chat',
  projectOrder: []
}
const persistedModes = []
const editorActions = new Function(
  'get',
  'set',
  'api',
  'saveSessionActiveFile',
  'saveActiveFile',
  transformSync(`return ({${fileActionsSource}})`, { loader: 'ts' }).code
)(
  () => editorState,
  (update) => {
    editorState = { ...editorState, ...update }
  },
  { settings: { setIdeMode: async (enabled) => persistedModes.push(enabled) } },
  () => {},
  () => {}
)
Object.assign(editorState, editorActions)
editorActions.openFileInEditor('src/main.ts', 12)
assert.equal(editorState.settings.ideMode, true, 'Chat file mention opens IDE')
assert.equal(editorState.ideSelectedLine, 12)
assert.equal(editorState.settings.ttsEnabled, false)
assert.deepEqual(persistedModes, [true])
editorActions.setIdeSelectedFile(null, undefined, 'D:\\project')
assert.equal(editorState.settings.ideMode, false, 'Closing last file closes IDE')
assert.equal(editorState.ideSelectedFile, null)
assert.deepEqual(persistedModes, [true, false], 'Closing IDE persists the disabled state')
editorActions.setIdeSelectedFile(
  { path: 'changed.ts', name: 'changed.ts', directory: false },
  undefined,
  'D:\\project'
)
assert.equal(editorState.settings.ideMode, true, 'File change selection reopens IDE')
assert.deepEqual(persistedModes, [true, false, true])
assert.ok(
  ideSource.includes('if (selected && ideMode)'),
  'Restored files do not reopen a closed IDE on mount'
)
// Chat route supplies shared wallpaper for translucent/hidden sidebars, but
// overlays render ChatView directly and must keep their own background layer.
const chatViewSource = readFileSync('src/renderer/src/components/ChatView.tsx', 'utf8')
const localBackgroundConditions = [
  ...chatViewSource.matchAll(
    /\{([^{}\n]+) && (?:\(\s*)?<ChatBackground empty(?:=\{isEmpty\})?\s*\/>/g
  )
].map((match) => match[1])
assert.equal(localBackgroundConditions.length, 2, 'empty and active chat background guards found')
for (const condition of localBackgroundConditions) {
  const visible = new Function('isOverlay', 'background', 'wallpaper', `return ${condition}`)
  for (const sidebarStyle of ['default', 'translucent', 'hidden']) {
    const background = { settings: { sidebarStyle } }
    assert.equal(visible(true, background, true), true, `overlay retains ${sidebarStyle} wallpaper`)
    assert.equal(
      visible(false, background, true),
      sidebarStyle === 'default',
      'main avoids duplicate shared wallpaper'
    )
  }
}
console.log(
  'UI PREFERENCES OK: quota ordering, bot drag/keyboard/RTL/click isolation, alert color, storage, menus, Escape lifecycle and automatic IDE lifecycle'
)
