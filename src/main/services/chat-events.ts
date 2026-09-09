import { BrowserWindow } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { MessagesUpdated } from '../../shared/api'

let activeChatId: string | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    } catch {
      // A window can close while broadcasting. Persistence must still succeed.
    }
  }
}

export function setActiveChat(id: string): void {
  if (activeChatId === id) return
  activeChatId = id
  broadcast(CHANNELS.chatsActiveChanged, id)
}

export function getActiveChat(): string | null {
  return activeChatId
}

export function emitMessagesUpdated(chatId: string): void {
  broadcast(CHANNELS.messagesUpdated, { chatId } satisfies MessagesUpdated)
}
