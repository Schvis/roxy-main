/**
 * Remote Workspace — host side (desktop → roxy.gg relay).
 *
 * The desktop dials *out* to roxy.gg over a WebSocket and hosts the running
 * session for one or more phone **guests**. roxy.gg is a dumb pipe: it pairs a
 * guest (who entered the PIN) with this host and shuttles opaque JSON frames.
 * The desktop stays authoritative — a phone's prompt is run here through the
 * exact same `runSessionTurn` a local prompt uses, and every streamed event is
 * relayed back to the phone. Code and files never leave the machine.
 *
 * State is a single active share: the desktop mints one room and dials the relay
 * once, but the phone can roam the **entire workspace** — it lists every session
 * and switches between them freely, while the desktop's own active session stays
 * put. `start` mints + connects, `stop` tears down + revokes, and `remote:state`
 * pushes keep the desktop dialog live.
 */
import { BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { getChangedFiles, repoRoot } from './git'
import WebSocket from 'ws'
import { CHANNELS } from '../../shared/ipc'
import type { LlmEvent, RemotePhase, RemoteState, RemoteStartInput } from '../../shared/api'
import type { Message } from '../../shared/types'
import { PartsFold } from '../../shared/parts'
import {
  DEFAULT_RELAY_BASE,
  normalizeRelayBase,
  type RelayBaseReason
} from '../../shared/remote-base'
import * as repo from '../db/repo'
import { enqueuePrompt, notifyAutomation } from './automation'
import { isVisibleQueueItem, moveVisibleQueueItem } from '../../shared/queue'
import { resumeQueue, sessionBusy, stopTurn } from './turn-state'
import { track, trackFeature } from './track'
import { sessionCwd } from './workspace'
import { listModelCatalog } from './models'
import { emitSessionsUpdated } from './session-events'
import { modelLabel, pickDefaultModel, resolveProviderModel } from '../../shared/models'
import {
  REASONING_EFFORTS,
  clampReasoningEffort,
  parseReasoningEffort,
  resolveSessionConfig,
  type SessionConfigPatch
} from '../../shared/session-config'
import type { ModelInfo } from '../../shared/api'
import type { ConnectedProvider, ReasoningEffort, QueueImage } from '../../shared/types'
import {
  MAX_FRAME_BYTES,
  parseFrame,
  type ConfigFrame,
  type HostFrame,
  type RemoteModelInfo,
  type RemoteProviderModels,
  type RemoteSessionInfo
} from './remote-protocol'
/**
 * Default relay base. Defaults to roxy.schvis.com. Override with `ROXY_REMOTE_BASE`
 * (e.g. a local URL). A base link chosen in the dialog takes precedence per share.
 */
const DEFAULT_HTTP_BASE = (process.env.ROXY_REMOTE_BASE || DEFAULT_RELAY_BASE).replace(/\/$/, '')

/** ws(s):// base derived from an http(s):// base. */
function toWsBase(httpBase: string): string {
  return httpBase.replace(/^http/, 'ws')
}

const RELAY_BASE_ERRORS: Record<RelayBaseReason, string> = {
  invalid: 'That server address is not a valid link.',
  protocol: 'The server address must start with https://.',
  insecure: 'Plain http:// is only allowed for localhost. Use an https:// address.',
  credentials: 'The server address must not contain a username or password.',
  query: 'The server address must not contain a query string or fragment.'
}

/** Reconnect backoff (ms) after an unexpected host-socket drop; then give up. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000]

/** The mint response from `POST /api/remote/sessions`. */
interface MintResponse {
  brokerId: string
  hostToken: string
  guestToken: string
  url: string
  pin: string
  expiresAt: number
}

/** Everything about the one active share. */
interface Share {
  /** Relay this share was minted on. Fixed for the share's lifetime. */
  httpBase: string
  wsBase: string
  expensiveReads: number
  lastRead: number
  scopeSessionId: string
  scope: 'session' | 'workspace' | 'all'
  workspacePath: string | null
  devices: { id: string }[]
  brokerId: string
  hostToken: string
  url: string
  pin: string
  expiresAt: number
  /** The session the phone is currently viewing + prompting (it can switch). */
  currentSessionId: string
  socket: WebSocket | null
  guests: number
  phase: RemotePhase
  error?: string
  /** Live parts accumulators for in-flight turns, so a guest that joins/switches
   *  mid-turn can be seeded with the reply-so-far (keyed by sessionId). */
  liveTurns: Map<string, PartsFold>
  requests: Map<string, Promise<Extract<HostFrame, { t: 'ack' }>>>
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  /** True once we intentionally tear down, so `close` doesn't try to reconnect. */
  closing: boolean
  rev: number
}

let share: Share | null = null
const responseDevice = new AsyncLocalStorage<string>()
function routeRaw(raw: string): string {
  const deviceId = responseDevice.getStore()
  return deviceId ? JSON.stringify({ t: 'routed', deviceId, frame: JSON.parse(raw) }) : raw
}

// --- Public state ----------------------------------------------------------

const IDLE_STATE: RemoteState = { phase: 'idle', guests: 0, rev: 0 }

/** Project the internal share into the renderer-facing state. */
function toState(): RemoteState {
  if (!share) return { ...IDLE_STATE }
  return {
    phase: share.phase,
    relayBase: share.httpBase,
    brokerId: share.brokerId,
    url: share.url,
    pin: share.pin,
    sessionId: share.currentSessionId,
    guests: share.guests,
    devices: share.devices,
    expiresAt: share.expiresAt,
    error: share.error,
    rev: share.rev
  }
}

/** Push the current state to every open window (guarded against teardown). */
function broadcast(): void {
  const state = toState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.remoteState, state)
  }
}

/** Bump the revision + push. Called on any status change or shared-session activity. */
function bump(patch?: Partial<Pick<Share, 'phase' | 'error' | 'guests' | 'expiresAt'>>): void {
  if (!share) return
  if (patch) Object.assign(share, patch)
  share.rev += 1
  broadcast()
}

// --- Frame helpers ---------------------------------------------------------

/** Send a host frame to the guests via the relay (dropped if oversized/closed). */
function sendFrame(frame: HostFrame): void {
  if (
    'sessionId' in frame &&
    typeof frame.sessionId === 'string' &&
    !sessionAllowed(frame.sessionId)
  )
    return
  const sock = share?.socket
  if (!sock || sock.readyState !== WebSocket.OPEN) return
  const raw = JSON.stringify(frame)
  if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) return
  sock.send(routeRaw(raw))
}

/**
 * Share-bound frame send: a no-op if `active` is no longer the current share
 * (stopped/replaced mid-turn), so a stale turn can't leak frames into a new one.
 */
function sendFrameFor(active: Share, frame: HostFrame): void {
  if (share === active) sendFrame(frame)
}

/** Share-bound bump: only bumps if `active` is still the current share. */
function bumpFor(active: Share): void {
  if (share === active) bump()
}

/**
 * Send the transcript snapshot for `sessionId`, trimming the oldest messages
 * until it fits the relay's frame cap (a fresh phone still gets the recent, most
 * relevant history). Tagged with `sessionId` so the phone can drop a snapshot
 * for a session it already switched away from.
 */
function sendSnapshot(sessionId: string): void {
  if (!sessionAllowed(sessionId)) return
  const sock = share?.socket
  if (!sock || sock.readyState !== WebSocket.OPEN) return
  const messages = repo.listMessages(sessionId)
  for (let start = 0; start < messages.length; start += 1) {
    const slice = messages.slice(start)
    const raw = JSON.stringify({ t: 'snapshot', sessionId, messages: slice })
    if (Buffer.byteLength(raw) <= MAX_FRAME_BYTES) {
      sock.send(routeRaw(raw))
      return
    }
    // A single trailing message that alone exceeds the cap: send a truncated
    // copy so the phone still gets a usable tail instead of an oversized (dropped) frame.
    if (slice.length === 1) {
      sock.send(
        routeRaw(
          JSON.stringify({ t: 'snapshot', sessionId, messages: [truncateMessage(slice[0])] })
        )
      )
      return
    }
  }
  // No messages yet — send an empty snapshot so the phone leaves its loading state.
  sock.send(routeRaw(JSON.stringify({ t: 'snapshot', sessionId, messages: [] })))
}

/** Shrink one message so a snapshot of just it fits under the frame cap. */
function truncateMessage(m: Message): Message {
  // The serialized message carries the text twice (content + parts[].text), so
  // each copy gets half the frame, minus headroom for the JSON envelope/fields.
  const budget = Math.floor(MAX_FRAME_BYTES / 2) - 8_192
  let content = m.content
  if (Buffer.byteLength(content) > budget) {
    content = content.slice(0, budget) // ≤ budget UTF-16 units; tighten by bytes below
    while (content.length > 0 && Buffer.byteLength(content) > budget) {
      content = content.slice(0, Math.floor(content.length * 0.9))
    }
    content += '\n\n… (truncated)'
  }
  return { ...m, content, parts: [{ type: 'text', text: content }] }
}

/** Session title + workspace dir for the phone header. */
function sendMeta(sessionId: string): void {
  const chat = repo.getChat(sessionId)
  sendFrame({
    t: 'meta',
    sessionId,
    title: chat?.title,
    // Show the phone where work actually lands (the worktree, when there is one).
    cwd: sessionCwd(sessionId) || undefined
  })
}

/**
 * Mirror a session's pending prompt queue to the phone(s). The queue is the same
 * persisted `repo` queue the desktop uses, so both ends see one FIFO. Sent on
 * join/switch and whenever the queue changes (phone/desktop enqueue, dequeue, or
 * drain). Text-only — no image blobs cross the wire.
 */
function sendQueue(sessionId: string): void {
  sendFrame({
    t: 'queue',
    sessionId,
    items: repo
      .listQueue(sessionId)
      .filter(isVisibleQueueItem)
      .map((q) => ({ id: q.id, text: q.content }))
  })
}

/** Folder basename used to group sessions on the phone (mirrors the desktop sidebar). */
function projectName(workspacePath: string | null): string {
  if (!workspacePath) return '(no folder)'
  return workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath
}

/**
 * Build the workspace's session list for the phone switcher: every top-level
 * (`main`) session, most-recently-updated first, grouped by project on the phone.
 */
function buildSessionList(): RemoteSessionInfo[] {
  return repo
    .listChats()
    .filter((c) => c.kind === 'main' && sessionAllowed(c.id))
    .map((c) => ({
      id: c.id,
      title: c.title,
      project: projectName(c.workspacePath),
      cwd: c.workspacePath ?? undefined,
      updatedAt: c.updatedAt,
      messageCount: repo.listMessages(c.id).length,
      activity:
        share?.liveTurns.has(c.id) || sessionBusy(c.id)
          ? 'running'
          : repo.listQueue(c.id).some(isVisibleQueueItem)
            ? 'queued'
            : 'idle'
    }))
}

/** Push the workspace session list + the current selection to the phone(s). */
function sendSessions(): void {
  if (!share) return
  sendFrame({ t: 'sessions', sessions: buildSessionList(), currentId: share.currentSessionId })
  sendFrame({
    t: 'workspaces',
    paths:
      share.scope === 'all'
        ? repo.listProjectOrder()
        : share.scope === 'workspace' && share.workspacePath
          ? [share.workspacePath]
          : []
  })
}

/**
 * Push a session's current turn state to the phone(s). If a turn is in flight we
 * include its accumulated parts so a guest that just joined/switched sees the
 * whole reply-so-far, not only the tail of subsequent deltas.
 */
function sendTurnState(sessionId: string): void {
  if (!share) return
  const acc = share.liveTurns.get(sessionId)
  if (acc) sendFrame({ t: 'turn', sessionId, state: 'running', parts: acc.parts })
  else sendFrame({ t: 'turn', sessionId, state: 'idle' })
}

function sessionAllowed(id: string): boolean {
  if (!share) return false
  const chat = repo.getChat(id)
  return Boolean(
    chat &&
    (share.scope === 'all' ||
      (share.scope === 'session'
        ? id === share.scopeSessionId
        : chat.workspacePath === share.workspacePath))
  )
}

function assertCreationAllowed(workspace: unknown): void {
  if (
    !share ||
    share.scope === 'session' ||
    (share.scope === 'workspace' && workspace !== share.workspacePath)
  )
    throw new Error('Creating sessions is outside this share scope.')
}

// --- Model selection -------------------------------------------------------
//
// The phone can pick a session's model and reasoning effort. It writes ONLY the
// session row (`repo.setChatConfig`), never the global default the desktop
// stamps new sessions from: a quick switch on the phone must not silently
// change what the next desktop session starts on. The turn path already reads
// the session row (automation.ts), so nothing downstream needs to know.
//
// Mode (Build/Plan) is deliberately NOT settable remotely: it gates write tools.

/** Per-provider caps tried, in order, when the full list overflows a frame. */
const MODEL_LIST_CAPS = [200, 100, 50, 25, 10]

/** The effort rungs the picker offers for a model (mirrors InferenceControls). */
function effortsFor(info: ModelInfo | undefined): ReasoningEffort[] {
  if (!info?.reasoning) return []
  const supported = info.reasoningEfforts
  return supported
    ? REASONING_EFFORTS.filter((e) => supported.includes(e))
    : REASONING_EFFORTS.filter((e) => e !== 'none')
}

function enabledProviders(): ConnectedProvider[] {
  return repo.listConnectedProviders().filter((p) => p.enabled)
}

/**
 * Resolve the provider + model a session's NEXT turn will actually run on,
 * exactly as the queue does (automation.ts), so the phone never shows a model
 * the turn won't use.
 */
async function resolveRunModel(sessionId: string): Promise<{
  provider: ConnectedProvider | undefined
  model: string | undefined
  info: ModelInfo | undefined
  effort: ReasoningEffort
}> {
  const config = resolveSessionConfig(repo.getChat(sessionId), repo.getSettings())
  const providers = enabledProviders()
  const provider = config.providerId
    ? providers.find((p) => p.id === config.providerId)
    : providers[0]
  if (!provider) {
    return { provider, model: undefined, info: undefined, effort: config.reasoningEffort }
  }
  const catalog = (await listModelCatalog(provider.id)).models
  const selected = config.providerId === provider.id ? config.model : null
  const model =
    provider.seedId === 'github-copilot'
      ? resolveProviderModel(provider, catalog, selected)
      : selected || provider.defaultModel || pickDefaultModel(catalog)
  return {
    provider,
    model,
    info: catalog.find((m) => m.id === model),
    effort: config.reasoningEffort
  }
}

/** Tell the phone(s) which model + effort a session is on. */
async function sendConfig(sessionId: string): Promise<void> {
  const active = share
  if (!active) return
  try {
    const { provider, model, info, effort } = await resolveRunModel(sessionId)
    const frame: ConfigFrame = {
      t: 'config',
      sessionId,
      providerId: provider?.id ?? null,
      providerName: provider?.name,
      model: model ?? null,
      modelName:
        provider && model ? modelLabel(provider.seedId, info?.name ?? model, model) : undefined,
      reasoning: Boolean(info?.reasoning),
      imageInput: info?.imageInput === true,
      reasoningEffort: clampReasoningEffort(effort, info?.reasoningEfforts),
      efforts: effortsFor(info)
    }
    sendFrameFor(active, frame)
  } catch {
    // Best-effort: the picker simply keeps its last value.
  }
}

/**
 * Build the phone's model list: every enabled provider's catalog minus models
 * the user hid on the desktop. A gateway can list hundreds of models, so when
 * the frame would exceed the relay cap each provider is cut down, keeping its
 * recently used models first so the useful ones survive the trim.
 */
async function buildModelsFrame(): Promise<HostFrame> {
  const hidden = new Set(repo.listHiddenModels().map((h) => `${h.providerId}:${h.model}`))
  const full = await Promise.all(
    enabledProviders().map(async (p): Promise<RemoteProviderModels> => {
      const { models, error } = await listModelCatalog(p.id)
      const seen = new Set<string>()
      const rows: RemoteModelInfo[] = []
      for (const m of models) {
        if (seen.has(m.id) || hidden.has(`${p.id}:${m.id}`)) continue
        seen.add(m.id)
        rows.push({
          id: m.id,
          name: modelLabel(p.seedId, m.name || m.id, m.id),
          reasoning: Boolean(m.reasoning),
          ...(m.reasoningEfforts ? { efforts: effortsFor(m) } : {})
        })
      }
      return { id: p.id, name: p.name, models: rows, ...(error ? { error } : {}) }
    })
  )
  const frame = (providers: RemoteProviderModels[]): HostFrame => ({ t: 'models', providers })
  const fits = (f: HostFrame): boolean => Buffer.byteLength(JSON.stringify(f)) <= MAX_FRAME_BYTES
  const untrimmed = frame(full)
  if (fits(untrimmed)) return untrimmed

  for (const cap of MODEL_LIST_CAPS) {
    const trimmed = frame(
      full.map((p) => {
        if (p.models.length <= cap) return p
        const recent = new Set(repo.listRecentModels(p.id).map((r) => r.model))
        const ordered = [
          ...p.models.filter((m) => recent.has(m.id)),
          ...p.models.filter((m) => !recent.has(m.id))
        ]
        return { ...p, models: ordered.slice(0, cap), truncated: true }
      })
    )
    if (fits(trimmed)) return trimmed
  }
  return frame(full.map((p) => ({ ...p, models: [], truncated: p.models.length > 0 })))
}

async function sendModels(): Promise<void> {
  const active = share
  if (!active) return
  try {
    sendFrameFor(active, await buildModelsFrame())
  } catch {
    sendFrameFor(active, { t: 'error', message: 'Couldn\u2019t load the model list.' })
  }
}

/**
 * Apply a phone's model / effort pick to ONE session. Everything in the frame
 * is untrusted: the provider must be connected and enabled, and the model must
 * be in that provider's own (account-aware) catalog, so the phone can never pin
 * a session to a model the turn would 404 on.
 */
async function handleSetConfig(frame: { [k: string]: unknown }): Promise<void> {
  const active = share
  if (!active) return
  const fail = (message: string): void => {
    if (frame.requestId) throw new Error(message)
    sendFrameFor(active, { t: 'error', message })
  }
  const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : active.currentSessionId
  if (!repo.getChat(sessionId)) return fail('That session no longer exists.')

  const patch: SessionConfigPatch = {}
  if (frame.providerId !== undefined || frame.model !== undefined) {
    if (typeof frame.providerId !== 'string' || typeof frame.model !== 'string')
      return fail('Pick a provider and a model together.')
    const provider = enabledProviders().find((p) => p.id === frame.providerId)
    if (!provider) return fail('That provider isn\u2019t connected on the desktop.')
    const { models } = await listModelCatalog(provider.id)
    if (!models.some((m) => m.id === frame.model))
      return fail(`${provider.name} doesn\u2019t offer that model right now.`)
    patch.providerId = provider.id
    patch.model = frame.model
  }
  if (frame.reasoningEffort !== undefined) {
    const effort = parseReasoningEffort(frame.reasoningEffort)
    if (!effort) return fail('Unknown reasoning effort.')
    patch.reasoningEffort = effort
  }
  if (Object.keys(patch).length === 0) return
  // The catalog fetch above awaited; the share may have been stopped meanwhile.
  if (share !== active) return

  try {
    repo.setChatConfig(sessionId, patch)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  // The desktop picker reads the session row; refetch it so both ends agree.
  emitSessionsUpdated({ reason: 'metadata', sessionIds: [sessionId] })
  await sendConfig(sessionId)
  bumpFor(active)
}

/**
 * Re-send a session's config after a DESKTOP-side picker change, so a phone
 * viewing that session doesn't keep showing the old model.
 */
export function notifyConfigChanged(sessionId: string): void {
  if (share?.currentSessionId === sessionId) void sendConfig(sessionId)
}

/**
 * Switch the phone(s) to a different session. Only the phone view moves — the
 * desktop's own active session is untouched. We re-emit the list (to update the
 * highlighted current), then meta + snapshot + the target's live turn state.
 */
function switchSession(sessionId: string): void {
  const active = share
  if (!active) return
  if (!sessionAllowed(sessionId)) {
    sendFrame({ t: 'error', message: 'That session no longer exists.' })
    return
  }
  active.currentSessionId = sessionId
  sendSessions()
  sendMeta(sessionId)
  sendSnapshot(sessionId)
  sendTurnState(sessionId)
  sendQueue(sessionId)
  void sendConfig(sessionId)
  // Surface the phone's current session to the desktop dialog + mirror logic.
  bump()
}

/** Phone prompts join the same durable queue as desktop and scheduled prompts. */
async function handlePrompt(sessionId: string, text: string): Promise<void> {
  const active = share
  if (!active || !text.trim()) return
  try {
    enqueuePrompt(sessionId, text)
    sendQueue(sessionId)
    bumpFor(active)
  } catch (error) {
    sendFrame({ t: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
/**
 * Re-broadcast the shared queue to the phone(s) after a *desktop-side* change
 * (the renderer added/removed/reordered a queued prompt). Called from the queue
 * IPC handlers so both ends stay in sync regardless of who edited the queue.
 */
export function notifyQueueChanged(): void {
  if (share) sendQueue(share.currentSessionId)
}

/**
 * Reconcile a desktop-persisted message with the phone's transcript.
 *
 * Live deltas remain the fast path, but they are not an authoritative record:
 * a provider can fail before emitting one, a local command never enters the LLM
 * stream, and a guest can connect between two events. Every turn now drains
 * through the main-process queue, whose owner calls this from its own `finally`
 * (see `automation.ts`) — so a queued prompt, a scheduled job and an
 * out-of-band bot reply all reconcile the same way a desktop turn does.
 */
export function notifyTranscriptChanged(sessionId: string): void {
  if (share?.currentSessionId === sessionId) sendSnapshot(sessionId)
}

// --- Relaying a *desktop-driven* turn to the phone -------------------------

/** Opaque handle threading one local turn's relay state through the IPC layer. */
export interface LocalTurnRelay {
  active: Share
  sessionId: string
  acc: PartsFold
}

/**
 * Relay a *desktop-typed* turn to the phone(s) — the mirror of `runTurn` for
 * locally-driven prompts. The phone shows the same user bubble, streams the reply
 * token-by-token, and flushes it on end, exactly like a phone-typed turn appears
 * on the desktop. Returns a handle the caller feeds events into, or `null` when
 * nothing is shared (so the local `llm:start` path skips the per-token overhead).
 *
 * A live accumulator is registered in `liveTurns` so a phone that joins/switches
 * to this session mid-turn is still seeded with the reply-so-far via `sendTurnState`.
 * Only phones viewing this session react (`forCurrent`); one on another session
 * re-syncs from the snapshot when it switches back — code/files never cross.
 */
export function relayLocalTurnStart(sessionId: string, userText?: string): LocalTurnRelay | null {
  const active = share
  if (!active) return null
  const acc = new PartsFold()
  active.liveTurns.set(sessionId, acc)
  // `userText` mirrors the drained-queue announce path: the phone never echoed a
  // desktop-typed prompt, so it shows the bubble now and opens the streaming spinner.
  sendFrameFor(active, {
    t: 'turn',
    sessionId,
    state: 'running',
    userText: userText && userText.trim() ? userText : undefined
  })
  return { active, sessionId, acc }
}

/** Fan one streamed event of a desktop-driven turn to the phone(s). */
export function relayLocalTurnEvent(relay: LocalTurnRelay, event: LlmEvent): void {
  relay.acc.apply(event)
  sendFrameFor(relay.active, { t: 'delta', sessionId: relay.sessionId, event })
}

/**
 * Close out a relayed desktop turn: release the busy slot, drop the live
 * accumulator, and tell the phone(s) the turn is idle so they flush the streamed
 * reply into the transcript. The desktop persisted the reply itself (renderer
 * `finishTurn`); the phone's own authoritative snapshot reconciles it on the next
 * switch/reconnect.
 *
 * Queue ownership belongs to automation; relay teardown never drains or cancels it.
 */
export function relayLocalTurnEnd(relay: LocalTurnRelay): void {
  const { active, sessionId, acc } = relay
  if (active.liveTurns.get(sessionId) === acc) active.liveTurns.delete(sessionId)
  sendFrameFor(active, { t: 'turn', sessionId, state: 'idle' })
}

// --- Socket lifecycle ------------------------------------------------------

function connect(): void {
  const active = share
  if (!active) return
  const socket = new WebSocket(
    `${active.wsBase}/api/remote/ws?token=${encodeURIComponent(active.hostToken)}`
  )
  active.socket = socket

  socket.on('open', () => {
    if (share !== active) return
    active.reconnectAttempts = 0
    bump({ phase: 'live', error: undefined })
    // Sync the authoritative guest count / expiry from the relay after (re)connect.
    void refreshStatus()
  })

  socket.on('message', (data: WebSocket.RawData) => {
    if (share !== active) return
    onFrame(data.toString())
  })

  socket.on('close', () => {
    if (share !== active) return
    active.socket = null
    if (active.closing) return
    scheduleReconnect()
  })

  // Swallow socket errors — a following `close` drives reconnect/teardown.
  socket.on('error', () => undefined)
}

function scheduleReconnect(): void {
  const active = share
  if (!active || active.closing) return
  const delay = RECONNECT_DELAYS_MS[active.reconnectAttempts]
  if (delay === undefined) {
    bump({ phase: 'error', error: 'Lost connection to the relay.' })
    return
  }
  active.reconnectAttempts += 1
  bump({ phase: 'offline' })
  active.reconnectTimer = setTimeout(() => {
    if (share === active && !active.closing) connect()
  }, delay)
}

async function handleRequest(frame: Record<string, unknown>): Promise<void> {
  const active = share
  const requestId = frame.requestId
  if (!active || typeof requestId !== 'string' || requestId.length > 100) return
  if (typeof frame.sessionId === 'string' && !sessionAllowed(frame.sessionId)) {
    sendFrameFor(active, {
      t: 'ack',
      requestId,
      ok: false,
      message: 'Session is outside this share scope.'
    })
    return
  }
  if (frame.action === 'changes' || frame.action === 'file-diff') {
    if (active.expensiveReads >= 2 || Date.now() - active.lastRead < 500) {
      sendFrameFor(active, {
        t: 'ack',
        requestId,
        ok: false,
        message: 'Please wait before refreshing again.'
      })
      return
    }
    active.expensiveReads++
    active.lastRead = Date.now()
    try {
      if (typeof frame.sessionId !== 'string' || !repo.getChat(frame.sessionId))
        throw new Error('Session not found.')
      const root = await repoRoot(sessionCwd(frame.sessionId))
      if (!root) throw new Error('This session is not in a Git repository.')
      const files = await getChangedFiles(root)
      if (frame.action === 'changes') {
        sendFrameFor(active, {
          t: 'ack',
          requestId,
          ok: true,
          data: { files: files.slice(0, 100), truncated: files.length > 100 }
        })
        return
      }
      const file = frame.path
      if (
        typeof file !== 'string' ||
        path.isAbsolute(file) ||
        file.split(/[\\/]/).includes('..') ||
        !files.some((entry) => entry.path === file)
      )
        throw new Error('Choose a currently changed file.')
      if (files.some((entry) => entry.path === file && entry.status === 'untracked'))
        throw new Error('Untracked file contents are not shared by this viewer.')
      const diff = await new Promise<{ text: string; truncated: boolean }>((resolve, reject) => {
        execFile(
          'git',
          [
            '--no-pager',
            '--literal-pathspecs',
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            'HEAD',
            '--',
            file
          ],
          {
            cwd: root,
            timeout: 10000,
            maxBuffer: 160 * 1024,
            encoding: 'utf8',
            windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
          },
          (error, stdout) => {
            if (error && error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
              reject(new Error('Could not read this diff. The repository may have no commits yet.'))
              return
            }
            resolve({
              text: stdout.slice(0, 40000),
              truncated: Boolean(error) || stdout.length > 40000
            })
          }
        )
      })
      sendFrameFor(active, {
        t: 'ack',
        requestId,
        ok: true,
        data: { path: file, diff: diff.text, truncated: diff.truncated }
      })
    } catch (error) {
      sendFrameFor(active, {
        t: 'ack',
        requestId,
        ok: false,
        message: error instanceof Error ? error.message : 'Could not read changes.'
      })
    } finally {
      active.expensiveReads--
    }
    return
  }
  const cacheKey = requestId
  let result = active.requests.get(cacheKey)
  if (!result) {
    // Retain every admitted ID for this room's lifetime, including in-flight work.
    if (active.requests.size >= 4096) {
      sendFrameFor(active, {
        t: 'ack',
        requestId,
        ok: false,
        message: 'Request limit reached. Start a new share.'
      })
      return
    }
    result = (async (): Promise<Extract<HostFrame, { t: 'ack' }>> => {
      try {
        switch (frame.action) {
          case 'create-session': {
            const title = frame.title
            const workspacePath = frame.workspacePath ?? null
            assertCreationAllowed(workspacePath)
            if (
              (title !== undefined && (typeof title !== 'string' || title.length > 200)) ||
              (workspacePath !== null && typeof workspacePath !== 'string')
            )
              throw new Error('Invalid session details.')
            if (workspacePath !== null && !repo.listProjectOrder().includes(workspacePath))
              throw new Error('Choose an existing workspace.')
            const chat = repo.createChat({ title, workspacePath })
            emitSessionsUpdated({ reason: 'metadata', sessionIds: [chat.id] })
            switchSession(chat.id)
            break
          }
          case 'set-config':
            if (active.expensiveReads >= 2 || Date.now() - active.lastRead < 500)
              throw new Error('Please wait before changing models again.')
            active.lastRead = Date.now()
            active.expensiveReads++
            try {
              await handleSetConfig(frame)
            } finally {
              active.expensiveReads--
            }
            break
          case 'queue-edit':
          case 'queue-move':
          case 'queue-remove': {
            if (typeof frame.sessionId !== 'string' || typeof frame.id !== 'string')
              throw new Error('Invalid queue request.')
            const items = repo.listQueue(frame.sessionId)
            const item = items.find((entry) => entry.id === frame.id && isVisibleQueueItem(entry))
            if (!item) throw new Error('That prompt has already started or is no longer waiting.')
            if (frame.action === 'queue-edit') {
              if (typeof frame.text !== 'string' || !frame.text.trim())
                throw new Error('A prompt is required.')
              repo.updateQueueItem(item.id, frame.text, item.images)
              resumeQueue(frame.sessionId)
            } else if (frame.action === 'queue-remove') {
              repo.removeQueueItem(item.id)
            } else {
              if (frame.direction !== 'up' && frame.direction !== 'down')
                throw new Error('Invalid queue direction.')
              const ordered = moveVisibleQueueItem(items, item.id, frame.direction)
              if (!ordered) throw new Error('That prompt cannot move further.')
              repo.reorderQueue(
                frame.sessionId,
                ordered.map((entry) => entry.id)
              )
            }
            sendQueue(frame.sessionId)
            sendSnapshot(frame.sessionId)
            notifyAutomation(frame.sessionId)
            break
          }
          case 'prompt': {
            if (
              typeof frame.sessionId !== 'string' ||
              !repo.getChat(frame.sessionId) ||
              typeof frame.text !== 'string' ||
              (!frame.text.trim() && !Array.isArray(frame.images))
            )
              throw new Error('Invalid prompt.')
            const images: QueueImage[] = []
            if (frame.images !== undefined) {
              if (!Array.isArray(frame.images) || frame.images.length > 2)
                throw new Error('Attach at most two images.')
              for (const image of frame.images) {
                if (
                  !image ||
                  typeof image.dataUrl !== 'string' ||
                  !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)
                )
                  throw new Error('Invalid image format.')
                const [header, base64] = image.dataUrl.split(',')
                const bytes = Buffer.from(base64, 'base64')
                const mediaType = header.slice(5, -7)
                const valid =
                  mediaType === 'image/png'
                    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                    : mediaType === 'image/jpeg'
                      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
                      : bytes.toString('ascii', 0, 4) === 'RIFF' &&
                        bytes.toString('ascii', 8, 12) === 'WEBP'
                if (!valid || bytes.length > 120 * 1024 || bytes.toString('base64') !== base64)
                  throw new Error('Invalid image or image exceeds 120 KiB.')
                images.push({
                  dataUrl: image.dataUrl,
                  mediaType,
                  name: typeof image.name === 'string' ? image.name.slice(0, 100) : undefined
                })
              }
              if (Buffer.byteLength(JSON.stringify(frame)) > MAX_FRAME_BYTES - 1024)
                throw new Error('Attachments exceed the message limit.')
              const { info } = await resolveRunModel(frame.sessionId)
              if (images.length && info?.imageInput !== true)
                throw new Error('Select a model with confirmed image input support.')
              if (share !== active || !sessionAllowed(frame.sessionId))
                throw new Error('Share ended.')
            }
            if (!frame.text.trim() && !images.length)
              throw new Error('A prompt or image is required.')
            responseDevice.exit(() =>
              enqueuePrompt(
                frame.sessionId as string,
                frame.text as string,
                images.length ? images : undefined
              )
            )
            sendQueue(frame.sessionId)
            bumpFor(active)
            break
          }
          default:
            throw new Error('Unsupported request.')
        }
        return { t: 'ack', requestId, ok: true }
      } catch (error) {
        return {
          t: 'ack',
          requestId,
          ok: false,
          message: error instanceof Error ? error.message : 'Request failed.'
        }
      }
    })()
    active.requests.set(cacheKey, result)
  }
  sendFrameFor(active, await result)
}

function onFrame(raw: string): void {
  const routed = parseFrame(raw)
  if (typeof routed?.deviceId === 'string' && !responseDevice.getStore()) {
    responseDevice.run(routed.deviceId, () => onFrame(raw))
    return
  }
  const frame = parseFrame(raw)
  if (!frame || typeof frame.t !== 'string' || !share) return
  if (
    frame.t !== 'request' &&
    typeof frame.sessionId === 'string' &&
    !sessionAllowed(frame.sessionId)
  )
    return
  switch (frame.t) {
    case 'request':
      void handleRequest(frame)
      break
    case 'hello':
      sendFrame({
        t: 'capabilities',
        features: [
          'requests',
          ...(share.scope === 'session' ? [] : ['create-session']),
          'set-config',
          'prompt',
          'workspaces',
          'queue-edit',
          'queue-move',
          'queue-remove',
          'changes',
          'file-diff',
          'images'
        ]
      })
      switchSession(share.currentSessionId)
      break
    case 'guest-joined': {
      share.devices = Array.isArray(frame.devices)
        ? frame.devices.filter((d): d is { id: string } => Boolean(d && typeof d.id === 'string'))
        : []
      // A pairing actually completed. Counted here rather than at share start:
      // opening a share nobody scans isn't someone using Remote Workspace.
      track('remote_pair')
      // Also recorded as a capability so it lands in the one feature-adoption
      // breakdown alongside subagents, MCP and the rest, rather than being the
      // one surface you have to remember to look up separately. Keyed globally:
      // pairing is an install-level act, not a session-level one.
      trackFeature(undefined, 'remote_pair')
      // A phone entered the PIN and paired — send it the workspace session list
      // plus the current session's transcript + live turn state.
      share.guests = typeof frame.guests === 'number' ? frame.guests : share.guests
      const current = share.currentSessionId
      sendSessions()
      sendMeta(current)
      sendSnapshot(current)
      sendTurnState(current)
      sendQueue(current)
      void sendConfig(current)
      bump()
      break
    }
    case 'guest-left': {
      share.devices = Array.isArray(frame.devices)
        ? frame.devices.filter((d): d is { id: string } => Boolean(d && typeof d.id === 'string'))
        : []
      share.guests = typeof frame.guests === 'number' ? frame.guests : Math.max(0, share.guests - 1)
      bump()
      break
    }
    case 'list': {
      // Phone asked for a fresh workspace session list (opened the switcher).
      sendSessions()
      break
    }
    case 'switch': {
      // Phone tapped a different session in the switcher.
      if (typeof frame.sessionId === 'string') switchSession(frame.sessionId)
      break
    }
    case 'create-session': {
      if (
        share.scope === 'session' ||
        (share.scope === 'workspace' && (frame.workspacePath ?? null) !== share.workspacePath)
      ) {
        sendFrame({ t: 'error', message: 'Creating sessions is outside this share scope.' })
        break
      }
      const title = frame.title
      const workspacePath = frame.workspacePath ?? null
      if (
        (title !== undefined && (typeof title !== 'string' || title.length > 200)) ||
        (workspacePath !== null && typeof workspacePath !== 'string')
      ) {
        sendFrame({ t: 'error', message: 'Invalid session details.' })
        break
      }
      // Remote callers may choose existing workspaces, never arbitrary host paths.
      if (
        workspacePath !== null &&
        !repo.listChats().some((c) => c.kind === 'main' && c.workspacePath === workspacePath)
      ) {
        sendFrame({ t: 'error', message: 'Choose an existing workspace.' })
        break
      }
      try {
        const chat = repo.createChat({ title, workspacePath })
        emitSessionsUpdated({ reason: 'metadata', sessionIds: [chat.id] })
        switchSession(chat.id)
      } catch {
        sendFrame({ t: 'error', message: 'Could not create the session.' })
      }
      break
    }
    case 'prompt': {
      // Prompts run against whatever session the phone is currently viewing.
      if (typeof frame.text === 'string') void handlePrompt(share.currentSessionId, frame.text)
      break
    }
    case 'abort': {
      stopTurn(share.currentSessionId)
      break
    }
    case 'list-models': {
      if (share.expensiveReads >= 2 || Date.now() - share.lastRead < 1000) break
      const active = share
      active.lastRead = Date.now()
      active.expensiveReads++
      void sendModels().finally(() => active.expensiveReads--)
      break
    }
    case 'set-config': {
      // Phone picked a model and/or effort for the session it's viewing.
      void handleSetConfig(frame)
      break
    }
    case 'dequeue': {
      // Phone tapped × on a queued prompt — drop it from the shared queue and
      // re-broadcast so both ends update. `bump` refreshes the desktop's view.
      if (typeof frame.id === 'string') {
        try {
          repo.removeQueueItem(frame.id)
          notifyTranscriptChanged(share.currentSessionId)
        } catch (error) {
          sendFrame({ t: 'error', message: error instanceof Error ? error.message : String(error) })
        }
        sendQueue(share.currentSessionId)
        bump()
      }
      break
    }
    case 'bye': {
      // The relay tore the room down (expiry, PIN lockout, or capacity). Keep
      // the share in a terminal `error` phase so the dialog can explain why;
      // Start/Stop clears it.
      const reason = typeof frame.reason === 'string' ? frame.reason : 'Session ended.'
      teardown()
      bump({ phase: 'error', error: reason })
      break
    }
    default:
      break
  }
}

async function refreshStatus(): Promise<void> {
  const active = share
  if (!active) return
  try {
    const res = await fetch(`${active.httpBase}/api/remote/sessions/${active.brokerId}`)
    if (!res.ok) return
    const status = (await res.json()) as { guests?: number; expiresAt?: number }
    if (share !== active) return
    if (typeof status.guests === 'number') active.guests = status.guests
    if (typeof status.expiresAt === 'number') active.expiresAt = status.expiresAt
    broadcast()
  } catch {
    // Best-effort — deltas/counts still flow over the socket.
  }
}

/** Close the socket + clear timers for the active share (no server revoke). */
function teardown(): void {
  const active = share
  if (!active) return
  active.closing = true
  if (active.reconnectTimer) {
    clearTimeout(active.reconnectTimer)
    active.reconnectTimer = null
  }
  active.liveTurns.clear()
  const sock = active.socket
  active.socket = null
  if (sock) {
    sock.removeAllListeners()
    // `ws` can still emit 'error' while closing (esp. a CONNECTING socket); keep
    // a no-op handler attached so Node doesn't throw on an unhandled 'error'.
    sock.on('error', () => undefined)
    try {
      sock.close()
    } catch {
      sock.terminate()
    }
  }
}

/** Revoke the room on roxy.gg (host-token gated; idempotent). Best-effort. */
async function revoke(httpBase: string, brokerId: string, hostToken: string): Promise<void> {
  try {
    await fetch(`${httpBase}/api/remote/sessions/${brokerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${hostToken}` }
    })
  } catch {
    // The relay also reaps the room when the host socket drops + on TTL expiry.
  }
}

// --- Public API (called from IPC handlers) ---------------------------------

/**
 * Serialize lifecycle ops (start/stop) through a single chain so a double-click
 * or reentrant IPC can't mint two rooms and leak an orphan host socket.
 */
let lifecycle: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = lifecycle.then(fn, fn)
  lifecycle = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Mint a room + open the host relay socket for a session. Returns the state. */
export function start(input: RemoteStartInput): Promise<RemoteState> {
  return enqueue(() => startInternal(input))
}

/** Tear down the active share + revoke its tokens (Stop sharing). Idempotent. */
export function stop(): Promise<RemoteState> {
  return enqueue(() => stopInternal())
}

async function startInternal(input: RemoteStartInput): Promise<RemoteState> {
  // Seed the phone's initial session with the desktop's active chat; if that's
  // gone (or none was passed), fall back to the most-recently-updated session so
  // the phone always opens onto something real and can switch from there.
  let sessionId = input.sessionId
  if (!sessionId || !repo.getChat(sessionId)) {
    const fallback = repo.listChats().find((c) => c.kind === 'main')
    if (!fallback) {
      return {
        ...IDLE_STATE,
        phase: 'error',
        error: 'Open a session first, then share your workspace.'
      }
    }
    sessionId = fallback.id
  }
  // Resolve the relay before stopping any existing share, so a mistyped address
  // is reported without first ending a working share.
  let httpBase = DEFAULT_HTTP_BASE
  const customBase = Boolean(input.relayBase?.trim())
  if (customBase) {
    const checked = normalizeRelayBase(input.relayBase)
    if (!checked.ok) {
      return { ...IDLE_STATE, phase: 'error', error: RELAY_BASE_ERRORS[checked.reason] }
    }
    httpBase = checked.base
  }

  // Only one active share — stop any previous one first (internal, already serialized).
  if (share) await stopInternal()

  let mint: MintResponse
  try {
    const res = await fetch(`${httpBase}/api/remote/sessions`, { method: 'POST' })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail || `relay responded ${res.status}`)
    }
    mint = (await res.json()) as MintResponse
    if (
      typeof mint?.brokerId !== 'string' ||
      typeof mint.hostToken !== 'string' ||
      typeof mint.url !== 'string' ||
      typeof mint.pin !== 'string'
    ) {
      throw new Error('the server did not return a valid pairing response')
    }
    // A user-chosen server must hand out links on its own address; otherwise the
    // QR shown here could send the phone to a different site than the one relaying.
    if (customBase && new URL(mint.url).origin !== new URL(httpBase).origin) {
      await revoke(httpBase, mint.brokerId, mint.hostToken)
      throw new Error(
        'the server returned a pairing link for a different address (its PUBLIC_URL must match the address you entered)'
      )
    }
  } catch (e) {
    return {
      ...IDLE_STATE,
      phase: 'error',
      error: `Couldn't start sharing: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  share = {
    httpBase,
    wsBase: toWsBase(httpBase),
    expensiveReads: 0,
    lastRead: 0,
    scope: input.scope === 'all' || input.scope === 'workspace' ? input.scope : 'session',
    workspacePath: repo.getChat(sessionId)?.workspacePath ?? null,
    scopeSessionId: sessionId,
    devices: [],
    brokerId: mint.brokerId,
    hostToken: mint.hostToken,
    url: mint.url,
    pin: mint.pin,
    expiresAt: mint.expiresAt,
    currentSessionId: sessionId,
    socket: null,
    guests: 0,
    phase: 'starting',
    liveTurns: new Map(),
    requests: new Map(),
    reconnectAttempts: 0,
    reconnectTimer: null,
    closing: false,
    rev: 1
  }
  connect()
  broadcast()
  return toState()
}

async function stopInternal(): Promise<RemoteState> {
  const active = share
  if (!active) return { ...IDLE_STATE }
  const { brokerId, hostToken, httpBase } = active
  teardown()
  share = null
  broadcast()
  await revoke(httpBase, brokerId, hostToken)
  return { ...IDLE_STATE }
}

/** Current sharing status. */
export function status(): RemoteState {
  return toState()
}

export function revokeDevice(id: string): void {
  if (share?.devices.some((device) => device.id === id))
    sendFrame({ t: 'revoke-device', deviceId: id })
}

/** Close the host socket on app quit (best-effort; the relay reaps on drop). */
export function shutdownRemote(): void {
  teardown()
  share = null
}
