import { BrowserWindow, ipcMain, Notification } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { AgentNotificationTracker } from '../../shared/agent-notifications'
import type {
  AgentNotificationKind,
  AgentNotificationRequest
} from '../../shared/agent-notifications'
import type { LlmEvent } from '../../shared/api'
import { getChat, getSettings } from '../db/repo'
import { focusMainWindow, getMainWindow } from './main-window'
import { isFloatingIconWindow, isOverlayWindow, isVtuberWindow } from './overlay'
import { randomUUID } from 'node:crypto'

const pending = new Map<
  string,
  { sessionId: string; kind: AgentNotificationKind; timer: NodeJS.Timeout }
>()
const visible = new Set<Notification>()

function canNotify(): boolean {
  return (
    getSettings().toastNotificationsEnabled &&
    Notification.isSupported() &&
    !BrowserWindow.getAllWindows().some(
      (win) =>
        !win.isDestroyed() &&
        (win === getMainWindow() ||
          (isOverlayWindow(win) && !isFloatingIconWindow(win) && !isVtuberWindow(win))) &&
        win.isFocused()
    )
  )
}

export function requestAgentNotification(sessionId: string, kind: AgentNotificationKind): void {
  try {
    const win = getMainWindow()
    const chat = getChat(sessionId)
    if (!win || !chat || !canNotify()) return
    const id = randomUUID()
    const timer = setTimeout(() => pending.delete(id), 10_000)
    timer.unref()
    pending.set(id, { sessionId, kind, timer })
    win.webContents.send(CHANNELS.agentNotificationRequested, {
      id,
      kind,
      name: chat.title
    } satisfies AgentNotificationRequest)
  } catch {
    // Desktop alerts must never interrupt agent work.
  }
}

export function initAgentNotifications(): void {
  ipcMain.handle(
    CHANNELS.agentNotificationShow,
    (event, id: string, title: string, body: string) => {
      const win = getMainWindow()
      if (!win || event.sender !== win.webContents) return
      const request = pending.get(id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(id)
      try {
        if (!canNotify() || typeof title !== 'string' || typeof body !== 'string') return
        const notification = new Notification({
          title: title.slice(0, 200),
          body: body.slice(0, 1000)
        })
        visible.add(notification)
        notification.on('click', () => {
          if (getChat(request.sessionId)) {
            focusMainWindow(request.sessionId)
            getMainWindow()?.webContents.send(CHANNELS.agentNotificationClicked)
          } else {
            focusMainWindow()
          }
          visible.delete(notification)
        })
        notification.on('close', () => visible.delete(notification))
        notification.on('failed', () => visible.delete(notification))
        notification.show()
      } catch {
        // OS notification support can disappear after the capability check.
      }
    }
  )
}

export function watchAgentNotifications(
  sessionId: string,
  notifyDone = true
): {
  apply: (event: LlmEvent) => void
  finish: (ok: boolean, stopped: boolean) => void
} {
  const tracker = new AgentNotificationTracker()
  const timer = setInterval(() => {
    if (tracker.pollInput()) requestAgentNotification(sessionId, 'action')
  }, 750)
  timer.unref()
  let finished = false
  return {
    apply: (event) => tracker.apply(event),
    finish: (ok, stopped) => {
      if (finished) return
      finished = true
      clearInterval(timer)
      const kind = tracker.finish(ok, stopped)
      if (kind && (kind !== 'done' || notifyDone)) requestAgentNotification(sessionId, kind)
    }
  }
}
