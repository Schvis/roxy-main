import { PartsFold, partsToContent } from '../../shared/parts'
import type { LlmEvent } from '../../shared/api'
import type { MessagePart } from '../../shared/types'
import * as repo from '../db/repo'
import { emitMessagesUpdated, emitTurnState } from './chat-events'

export interface ActiveTurn {
  requestId: string
  sessionId: string
  fold: PartsFold
  controller: AbortController
  persisted: boolean
  finalizeTimer?: NodeJS.Timeout
}

const activeTurns = new Map<string, ActiveTurn>() // keyed by requestId
const activeTurnsBySession = new Map<string, ActiveTurn>() // keyed by sessionId
const recentlyFlushedSessions = new Map<string, number>() // sessionId -> timestamp

export function beginActiveTurn(
  requestId: string,
  sessionId: string,
  controller: AbortController
): ActiveTurn {
  recentlyFlushedSessions.delete(sessionId)
  const turn: ActiveTurn = {
    requestId,
    sessionId,
    fold: new PartsFold(),
    controller,
    persisted: false
  }
  activeTurns.set(requestId, turn)
  activeTurnsBySession.set(sessionId, turn)
  return turn
}

export function applyTurnEvent(requestId: string, event: LlmEvent): void {
  const turn = activeTurns.get(requestId)
  if (!turn || turn.persisted) return
  turn.fold.apply(event)
}

export function getActiveTurnParts(sessionId: string): MessagePart[] | null {
  const turn = activeTurnsBySession.get(sessionId)
  if (!turn || turn.persisted) return null
  return turn.fold.parts
}

export function markTurnPersisted(sessionId: string): boolean {
  const turn = activeTurnsBySession.get(sessionId)
  if (!turn) {
    const flushedAt = recentlyFlushedSessions.get(sessionId)
    if (flushedAt && Date.now() - flushedAt < 5000) {
      return true
    }
    return false
  }
  turn.persisted = true
  if (turn.finalizeTimer) {
    clearTimeout(turn.finalizeTimer)
    turn.finalizeTimer = undefined
  }
  activeTurns.delete(turn.requestId)
  activeTurnsBySession.delete(sessionId)
  return false
}

export function isTurnAlreadyFlushed(sessionId: string): boolean {
  const flushedAt = recentlyFlushedSessions.get(sessionId)
  return Boolean(flushedAt && Date.now() - flushedAt < 5000)
}

export function finalizeInFlightParts(parts: MessagePart[], reason = 'interrupted'): MessagePart[] {
  const note = `\n\n_[${reason}]_`
  let hasTextOrReasoning = false

  const updated = parts.map((part, index) => {
    if (part.type === 'tool') {
      const isRunning = part.state === 'running'
      const updatedChildren = part.children
        ? finalizeInFlightParts(part.children, reason)
        : undefined

      if (isRunning) {
        if (part.diff || part.output) {
          return {
            ...part,
            state: 'done' as const,
            output: part.output ? `${part.output}${note}` : `[${reason}]`,
            children: updatedChildren
          }
        }
        return {
          ...part,
          state: 'error' as const,
          output: `[${reason}]`,
          children: updatedChildren
        }
      }

      if (updatedChildren) {
        return { ...part, children: updatedChildren }
      }
      return part
    }

    if (part.type === 'text' || part.type === 'reasoning') {
      hasTextOrReasoning = true
      if (index === parts.length - 1) {
        if (!part.text.includes('_[interrupted]_') && !part.text.includes('_[stopped]_')) {
          return { ...part, text: `${part.text.trimEnd()}${note}` }
        }
      }
    }
    return part
  })

  if (!hasTextOrReasoning && updated.length > 0) {
    updated.push({ type: 'text', text: `_[${reason}]_` })
  }

  return updated
}

export function flushActiveTurn(turn: ActiveTurn, reason = 'interrupted'): void {
  if (turn.persisted) return
  turn.persisted = true

  if (turn.finalizeTimer) {
    clearTimeout(turn.finalizeTimer)
    turn.finalizeTimer = undefined
  }

  activeTurns.delete(turn.requestId)
  activeTurnsBySession.delete(turn.sessionId)
  recentlyFlushedSessions.set(turn.sessionId, Date.now())

  if (!turn.controller.signal.aborted) {
    try {
      turn.controller.abort()
    } catch {}
  }

  const rawParts = turn.fold.parts
  if (!rawParts || rawParts.length === 0) {
    emitTurnState(turn.sessionId, 'idle')
    return
  }

  const finalized = finalizeInFlightParts(rawParts, reason)
  try {
    repo.addMessage({
      chatId: turn.sessionId,
      role: 'assistant',
      content: partsToContent(finalized),
      parts: finalized
    })
    emitMessagesUpdated(turn.sessionId)
  } catch (err) {
    console.error('[turn-recovery] Failed to persist interrupted turn:', err)
  } finally {
    emitTurnState(turn.sessionId, 'idle')
  }
}

export function flushAllActiveTurns(reason = 'interrupted'): void {
  const turns = Array.from(activeTurns.values())
  for (const turn of turns) {
    flushActiveTurn(turn, reason)
  }
}

export function endActiveTurn(requestId: string, aborted: boolean): void {
  const turn = activeTurns.get(requestId)
  if (!turn || turn.persisted) return

  if (aborted) {
    flushActiveTurn(turn, 'stopped')
    return
  }

  // Safety fallback: if renderer doesn't persist within 1 second, flush it
  turn.finalizeTimer = setTimeout(() => {
    flushActiveTurn(turn, 'interrupted')
  }, 1000)
}
