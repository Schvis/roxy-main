import net from 'node:net'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import * as repo from '../db/repo'
import { getActiveChat, onActiveChat, onTurnState, type TurnLifecycleState } from './chat-events'
import { DEFAULT_DISCORD_CLIENT_ID } from '../../shared/discord'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

export interface DiscordActivity {
  details?: string
  state?: string
  timestamps?: {
    start?: number
    end?: number
  }
  assets?: {
    large_image?: string
    large_text?: string
    small_image?: string
    small_text?: string
  }
  buttons?: Array<{
    label: string
    url: string
  }>
}

function getIpcPath(id: number): string {
  if (process.platform === 'win32') {
    return `\\\\?\\pipe\\discord-ipc-${id}`
  }
  const prefix =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    process.env.TEMP ||
    '/tmp'
  return path.join(prefix, `discord-ipc-${id}`)
}

function sanitizeString(str: string | undefined | null, maxLen = 128): string | undefined {
  if (!str) return undefined
  const trimmed = str.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length === 1) return `${trimmed} `
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
}

class DiscordRpcClient {
  private socket: net.Socket | null = null
  private readBuffer = Buffer.alloc(0)
  private clientId: string
  private isConnected = false
  private isConnecting = false
  private isReady = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private currentTurnState: TurnLifecycleState = 'idle'
  private appStartTime = Date.now()
  private isShuttingDown = false

  constructor(clientId: string) {
    this.clientId = clientId || DEFAULT_DISCORD_CLIENT_ID
  }

  public async start(): Promise<void> {
    this.isShuttingDown = false
    await this.connect()
  }

  public setTurnState(state: TurnLifecycleState): void {
    this.currentTurnState = state
    this.updateActivity()
  }

  public setClientId(clientId: string): void {
    const next = clientId.trim() || DEFAULT_DISCORD_CLIENT_ID
    if (this.clientId === next) return
    this.clientId = next
    this.disconnect(false)
    const settings = repo.getSettings()
    if (settings.discordRpcEnabled && !this.isShuttingDown) {
      void this.connect()
    }
  }

  public setEnabled(enabled: boolean): void {
    if (enabled) {
      this.isShuttingDown = false
      if (!this.isConnected && !this.isConnecting) {
        void this.connect()
      }
    } else {
      this.disconnect(true)
    }
  }

  private disconnect(stopReconnect = true): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      try {
        if (this.isReady) {
          this.sendActivity(null)
        }
        this.socket.destroy()
      } catch {
        // ignore
      }
      this.socket = null
    }
    this.isConnected = false
    this.isReady = false
    this.readBuffer = Buffer.alloc(0)
    if (!stopReconnect && !this.isShuttingDown) {
      this.scheduleReconnect()
    }
  }

  public shutdown(): void {
    this.isShuttingDown = true
    this.disconnect(true)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isShuttingDown) return
    const settings = repo.getSettings()
    if (!settings.discordRpcEnabled) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 15000)
    this.reconnectTimer.unref?.()
  }

  private async connect(): Promise<void> {
    if (this.isConnecting || this.isConnected || this.isShuttingDown) return
    this.isConnecting = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    let connectedSocket: net.Socket | null = null

    for (let i = 0; i < 10; i++) {
      if (this.isShuttingDown) break
      const socketPath = getIpcPath(i)
      try {
        connectedSocket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection(socketPath)
          const onErr = (err: Error): void => {
            s.destroy()
            reject(err)
          }
          s.once('error', onErr)
          s.once('connect', () => {
            s.removeListener('error', onErr)
            resolve(s)
          })
        })
        break
      } catch {
        // probe next socket pipe
      }
    }

    this.isConnecting = false

    if (!connectedSocket) {
      this.scheduleReconnect()
      return
    }

    this.socket = connectedSocket
    this.isConnected = true
    this.readBuffer = Buffer.alloc(0)

    this.socket.on('data', (chunk: Buffer) => {
      this.handleData(chunk)
    })

    this.socket.on('error', () => {
      this.handleDisconnect()
    })

    this.socket.on('close', () => {
      this.handleDisconnect()
    })

    // Send handshake frame
    this.sendPacket(OP_HANDSHAKE, {
      v: 1,
      client_id: this.clientId
    })
  }

  private handleDisconnect(): void {
    if (this.socket) {
      try {
        this.socket.destroy()
      } catch {
        // ignore
      }
      this.socket = null
    }
    this.isConnected = false
    this.isReady = false
    this.readBuffer = Buffer.alloc(0)

    if (!this.isShuttingDown) {
      this.scheduleReconnect()
    }
  }

  private handleData(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk])

    while (this.readBuffer.length >= 8) {
      const op = this.readBuffer.readInt32LE(0)
      const len = this.readBuffer.readInt32LE(4)

      if (this.readBuffer.length < 8 + len) {
        break
      }

      const bodyBuffer = this.readBuffer.subarray(8, 8 + len)
      this.readBuffer = this.readBuffer.subarray(8 + len)

      try {
        const payload = JSON.parse(bodyBuffer.toString('utf8'))
        this.handleMessage(op, payload)
      } catch {
        // malformed frame, ignore
      }
    }
  }

  private handleMessage(op: number, data: unknown): void {
    if (op === OP_PING) {
      this.sendPacket(OP_PONG, data)
      return
    }
    if (op === OP_CLOSE) {
      this.handleDisconnect()
      return
    }
    if (op === OP_FRAME) {
      const record = data as { cmd?: string; evt?: string } | undefined
      if (record?.cmd === 'DISPATCH' && record?.evt === 'READY') {
        this.isReady = true
        this.updateActivity()
      }
    }
  }

  private sendPacket(op: number, payload: unknown): void {
    if (!this.socket || this.socket.destroyed) return
    try {
      const json = JSON.stringify(payload)
      const len = Buffer.byteLength(json, 'utf8')
      const buffer = Buffer.alloc(8 + len)
      buffer.writeInt32LE(op, 0)
      buffer.writeInt32LE(len, 4)
      buffer.write(json, 8, len, 'utf8')
      this.socket.write(buffer)
    } catch {
      // ignore socket write errors
    }
  }

  public sendActivity(activity: DiscordActivity | null): void {
    if (!this.isConnected || !this.isReady || !this.socket) return

    const packet = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity
      },
      nonce: randomUUID()
    }

    this.sendPacket(OP_FRAME, packet)
  }

  public updateActivity(): void {
    const settings = repo.getSettings()
    if (!settings.discordRpcEnabled || !this.isReady) return

    const chatId = getActiveChat()
    const chat = chatId ? repo.getChat(chatId) : undefined

    let details = 'Coding with Roxy'
    let state = 'Idle'

    if (chat) {
      if (chat.workspacePath) {
        const folderName = path.basename(chat.workspacePath)
        details = `Workspace: ${folderName}`
      } else {
        details = chat.title || 'Coding session'
      }

      if (this.currentTurnState === 'thinking') {
        state = `Thinking: ${chat.title || 'Working'}`
      } else if (this.currentTurnState === 'speaking') {
        state = `Speaking: ${chat.title || 'Replying'}`
      } else {
        state = chat.title ? `Working on: ${chat.title}` : 'Idle'
      }
    } else {
      if (this.currentTurnState === 'thinking') {
        state = 'Thinking...'
      } else if (this.currentTurnState === 'speaking') {
        state = 'Speaking...'
      }
    }

    const activity: DiscordActivity = {
      details: sanitizeString(details),
      state: sanitizeString(state),
      timestamps: {
        start: this.appStartTime
      },
      assets: {
        large_image: 'roxy',
        large_text: 'Roxy AI Coding Agent',
        small_image: this.currentTurnState === 'thinking' ? 'thinking' : 'idle',
        small_text: this.currentTurnState === 'thinking' ? 'Thinking...' : 'Idle'
      },
      buttons: [
        {
          label: 'Roxy on GitHub',
          url: 'https://github.com/Schvis/roxy-main'
        }
      ]
    }

    this.sendActivity(activity)
  }
}

let client: DiscordRpcClient | null = null

export function initDiscordRpc(): void {
  if (client) return
  const settings = repo.getSettings()
  client = new DiscordRpcClient(settings.discordRpcClientId)

  onActiveChat(() => {
    client?.updateActivity()
  })

  onTurnState((_sessionId, state) => {
    client?.setTurnState(state)
  })

  if (settings.discordRpcEnabled) {
    void client.start()
  }
}

export function shutdownDiscordRpc(): void {
  if (client) {
    client.shutdown()
    client = null
  }
}

export function updateDiscordRpcActivity(): void {
  client?.updateActivity()
}

export function setDiscordRpcTurnState(state: TurnLifecycleState): void {
  client?.setTurnState(state)
}

export function setDiscordRpcEnabledState(enabled: boolean): void {
  client?.setEnabled(enabled)
}

export function setDiscordRpcClientIdState(clientId: string): void {
  client?.setClientId(clientId)
}
