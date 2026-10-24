/**
 * Wire protocol for the Remote Workspace relay — the desktop **host** side.
 *
 * This mirrors roxy.gg's `src/server/remote/protocol.ts`. roxy.gg is a *dumb
 * pipe*: it pairs this desktop host with one or more phone **guests** in an
 * in-memory room and shuttles opaque JSON frames between them, only ever reading
 * a frame's `t` discriminator. The desktop stays authoritative — code/files
 * never touch the server; only transcript text + agent events cross the wire.
 *
 * Keep these three in sync: roxy.gg protocol.ts (relay), this file (host), and
 * roxy.gg web/src (Part 4, the phone guest).
 */

/** Path the desktop (host) dials for the WebSocket relay. */
export const REMOTE_WS_PATH = '/api/remote/ws'

/** Roles a socket can hold in a room. Encoded into the signed token. */
export type RemoteRole = 'host' | 'guest'

// --- Guest (phone) → Host (desktop), relayed to us ------------------------

/** A prompt typed on the phone; we run it as if it were typed locally. */
export interface PromptFrame {
  t: 'prompt'
  text: string
}

/** Abort the in-flight turn. */
export interface AbortFrame {
  t: 'abort'
}

/** Ask us for the full workspace session list (we answer with `sessions`). */
export interface ListFrame {
  t: 'list'
}

/** Switch the phone to a different session; we reply with meta + snapshot + turn. */
export interface SwitchFrame {
  t: 'switch'
  sessionId: string
}

/** Create a normal session in an existing workspace (or with no folder). */
export interface CreateSessionFrame {
  t: 'create-session'
  title?: string
  workspacePath?: string | null
}

/** Remove a pending prompt from the shared queue (the phone's × on a queued item). */
export interface DequeueFrame {
  t: 'dequeue'
  id: string
}

/** Ask us for the selectable models (we answer with `models`). */
export interface ListModelsFrame {
  t: 'list-models'
}

/**
 * Change a session's model and/or reasoning effort from the phone. Applies to
 * that session only, never to the desktop's default for new sessions. The mode
 * (Build/Plan) is deliberately not settable here: it gates write tools.
 */
export interface SetConfigFrame {
  t: 'set-config'
  /** Session the phone was viewing when it picked; defaults to the current one. */
  sessionId?: string
  /** Provider + model move together (see shared/session-config.ts). */
  providerId?: string
  model?: string
  reasoningEffort?: string
}

/** Frames a guest can send that the relay forwards to us. */
export type GuestFrame =
  | { t: 'hello' }
  | {
      t: 'request'
      requestId: string
      action:
        | 'create-session'
        | 'set-config'
        | 'prompt'
        | 'queue-edit'
        | 'queue-move'
        | 'queue-remove'
      id?: string
      direction?: 'up' | 'down'
      sessionId?: string
      text?: string
      title?: string
      workspacePath?: string | null
      providerId?: string
      model?: string
      reasoningEffort?: string
    }
  | PromptFrame
  | AbortFrame
  | ListFrame
  | SwitchFrame
  | CreateSessionFrame
  | DequeueFrame
  | ListModelsFrame
  | SetConfigFrame

// --- Host (desktop) → Guest (phone), sent by us ---------------------------

/**
 * One session in this workspace, for the phone's session switcher. `project` is
 * the workspace folder basename (mirrors the desktop sidebar); `cwd` is the path.
 */
export interface RemoteSessionInfo {
  activity?: 'running' | 'queued' | 'idle'
  id: string
  title: string
  project: string
  cwd?: string
  updatedAt: number
  messageCount: number
}

/** The workspace's sessions + which one the phone is currently viewing. */
export interface SessionsFrame {
  t: 'sessions'
  sessions: RemoteSessionInfo[]
  currentId: string
}

/** Full transcript sent to a guest right after it joins (or switches session). */
export interface SnapshotFrame {
  t: 'snapshot'
  sessionId?: string
  messages: unknown[]
}

/** One streamed agent event (an `LlmEvent`), relayed verbatim. */
export interface DeltaFrame {
  t: 'delta'
  sessionId?: string
  event: unknown
}

/** Whether the desktop is currently running a turn (drives the phone spinner). */
export interface TurnFrame {
  t: 'turn'
  sessionId?: string
  state: 'running' | 'idle'
  /** In-flight assistant parts, sent when a guest joins/switches mid-turn. */
  parts?: unknown[]
  /** The user's text when starting a drained queue item (so the phone shows it). */
  userText?: string
}

/** Session metadata (title / working dir) for the phone header. */
export interface MetaFrame {
  t: 'meta'
  sessionId?: string
  title?: string
  cwd?: string
}

/** One pending prompt in the shared queue, mirrored to the phone. */
export interface RemoteQueueItem {
  id: string
  text: string
}

/** The pending prompt queue for a session, mirrored from our persisted queue. */
export interface QueueFrame {
  t: 'queue'
  sessionId?: string
  items: RemoteQueueItem[]
}

/** A host-side error surfaced to the guest. */
export interface HostErrorFrame {
  t: 'error'
  message: string
}

/** One selectable model, trimmed to what the phone picker renders. */
export interface RemoteModelInfo {
  id: string
  /** Display label (vendor prefix already stripped where the desktop strips it). */
  name: string
  reasoning: boolean
  /** Effort levels the model accepts; absent = the standard Low..Max ladder. */
  efforts?: string[]
}

/** One connected, enabled provider and its models. */
export interface RemoteProviderModels {
  id: string
  name: string
  models: RemoteModelInfo[]
  /** True when the list was cut to fit the relay's frame cap. */
  truncated?: boolean
  /** Catalog couldn't be fetched (fixed code, never provider detail). */
  error?: 'authentication' | 'unavailable'
}

/** Answer to `list-models`. */
export interface ModelsFrame {
  t: 'models'
  providers: RemoteProviderModels[]
}

/** The model + effort a session will actually run its next turn with. */
export interface ConfigFrame {
  imageInput?: boolean
  t: 'config'
  sessionId: string
  providerId: string | null
  providerName?: string
  model: string | null
  modelName?: string
  reasoning: boolean
  /** Effective (already clamped) effort. */
  reasoningEffort: string
  /** Selectable effort levels for this model; empty = no effort control. */
  efforts: string[]
}

/** Frames we send toward the guests. */
export interface RemoteChangesData {
  files?: { path: string; status: string; staged: boolean }[]
  path?: string
  diff?: string
  truncated: boolean
}

export type HostFrame =
  | { t: 'revoke-device'; deviceId: string }
  | { t: 'workspaces'; paths: string[] }
  | { t: 'capabilities'; features: string[] }
  | { t: 'ack'; requestId: string; ok: boolean; message?: string; data?: RemoteChangesData }
  | SnapshotFrame
  | DeltaFrame
  | TurnFrame
  | MetaFrame
  | QueueFrame
  | SessionsFrame
  | HostErrorFrame
  | ModelsFrame
  | ConfigFrame

// --- Relay (roxy.gg) → host (control) -------------------------------------

/**
 * Control frames the *broker itself* generates. They never originate from a
 * client. We only act on the ones relevant to a host.
 */
export type ControlFrame =
  | { t: 'paired' } // legacy/no-op for host
  | { t: 'guest-joined'; guests: number } // a guest authed (PIN ok) — send it a snapshot
  | { t: 'guest-left'; guests: number } // a guest disconnected
  | { t: 'host-online' } // our own (re)connection acknowledged
  | { t: 'host-offline' } // (guests-facing; ignored by host)
  | { t: 'bye'; reason: string } // room is being torn down

/** Any frame that can arrive on the host socket. */
export type IncomingFrame = GuestFrame | ControlFrame

/**
 * Hard cap on a single relayed frame (bytes) — mirrors the server. Transcripts
 * and deltas are small text; anything larger is dropped rather than sent.
 */
export const MAX_FRAME_BYTES = 512 * 1024

/** Parse a raw socket message into a frame, or null if it isn't valid JSON. */
export function parseFrame(raw: string): { t?: string; [k: string]: unknown } | null {
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    return value as { t?: string }
  } catch {
    return null
  }
}
