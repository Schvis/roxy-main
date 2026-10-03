import type { LlmEvent } from './api'
import { extractAgentQuestionOptions, extractTerminalInputOptions } from './agent-input-options'

export type AgentNotificationKind = 'input' | 'done' | 'action'

export interface AgentNotificationRequest {
  id: string
  kind: AgentNotificationKind
  name: string
}

export class AgentNotificationTracker {
  private text = ''
  private readonly commands = new Map<string, string>()
  private readonly prompts = new Map<string, string>()

  apply(event: LlmEvent): void {
    if (event.type === 'text') this.text = (this.text + event.delta).slice(-32_000)
    if (event.type === 'tool-start' && (event.tool === 'bash' || event.tool === 'powershell')) {
      this.commands.set(event.callId, '')
      this.prompts.delete(event.callId)
    }
    if (event.type === 'tool-delta' && this.commands.has(event.callId)) {
      this.commands.set(
        event.callId,
        ((this.commands.get(event.callId) ?? '') + event.chunk).slice(-2000)
      )
    }
    if (event.type === 'tool-end') {
      this.commands.delete(event.callId)
      this.prompts.delete(event.callId)
    }
  }

  pollInput(): boolean {
    let changed = false
    for (const [id, output] of this.commands) {
      if (extractTerminalInputOptions(output).length === 0) {
        this.prompts.delete(id)
        continue
      }
      const prompt =
        output
          .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
          .trim()
          .split(/\r?\n/)
          .pop() ?? ''
      if (this.prompts.get(id) !== prompt) {
        this.prompts.set(id, prompt)
        changed = true
      }
    }
    return changed
  }

  finish(ok: boolean, stopped: boolean): AgentNotificationKind | null {
    if (stopped) return null
    if (!ok) return 'action'
    const question = extractAgentQuestionOptions(
      [{ id: 'turn', chatId: '', role: 'assistant', content: this.text, parts: [], createdAt: 0 }],
      false
    )
    const lastLine = this.text.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
    const asksQuestion =
      /[?？؟]\s*[*_`]*$/.test(lastLine) &&
      !/\b(?:anything else|any questions|let me know|what do you think|how does (?:this|that) look)\b/i.test(
        lastLine
      )
    const structuredQuestion =
      /<(?:agent-question|agent-questions|ask-questions?|user-questions?|user-inputs?)>/i.test(
        this.text
      )
    return question?.hasQuestion || asksQuestion || structuredQuestion ? 'input' : 'done'
  }
}
