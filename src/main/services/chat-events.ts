import { BrowserWindow } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { MessagesUpdated } from '../../shared/api'
import { getLastActiveChatId, setLastActiveChatId, getChat } from '../db/repo'

let activeChatId: string | null = null

type ActiveChatListener = (id: string | null) => void
type TurnStateListener = (sessionId: string, state: TurnLifecycleState) => void

const activeChatListeners = new Set<ActiveChatListener>()
const turnStateListeners = new Set<TurnStateListener>()

export function onActiveChat(cb: ActiveChatListener): () => void {
  activeChatListeners.add(cb)
  return () => activeChatListeners.delete(cb)
}

export function onTurnState(cb: TurnStateListener): () => void {
  turnStateListeners.add(cb)
  return () => turnStateListeners.delete(cb)
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    } catch {
      // A window can close while broadcasting. Persistence must still succeed.
    }
  }
}

export function setActiveChat(id: string | null): void {
  if (activeChatId === id) return
  activeChatId = id
  setLastActiveChatId(id)
  if (id) {
    broadcast(CHANNELS.chatsActiveChanged, id)
  }
  for (const cb of activeChatListeners) {
    try {
      cb(id)
    } catch {
      // listener error must not disrupt chat activation
    }
  }
}

export function getActiveChat(): string | null {
  if (!activeChatId) {
    const persisted = getLastActiveChatId()
    if (persisted && getChat(persisted)) {
      activeChatId = persisted
    }
  } else if (!getChat(activeChatId)) {
    activeChatId = null
    setLastActiveChatId(null)
  }
  return activeChatId
}

export function emitMessagesUpdated(chatId: string): void {
  broadcast(CHANNELS.messagesUpdated, { chatId } satisfies MessagesUpdated)
}

export type TurnLifecycleState = 'thinking' | 'speaking' | 'idle'

export function emitTurnState(sessionId: string, state: TurnLifecycleState): void {
  broadcast(CHANNELS.chatTurnState, { sessionId, state })
  for (const cb of turnStateListeners) {
    try {
      cb(sessionId, state)
    } catch {
      // listener error must not disrupt turn state broadcast
    }
  }
}
