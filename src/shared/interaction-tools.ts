import type { AgentQuestionItem } from './agent-input-options'
import type { SessionTask } from './types'

export function startsNewQueuedRequest(item: {
  sourceChatId?: string | null
  fromUser?: boolean
  requestKind?: 'interruption' | 'new'
}): boolean {
  return item.requestKind !== 'interruption' && (!item.sourceChatId || !!item.fromUser)
}

/** Tool results and explicit machine continuations belong to the existing request. */
export function startsNewRequest(input: {
  continueRequest?: boolean
  requestKind?: 'interruption' | 'new'
  messages: readonly { role: string }[]
}): boolean {
  return (
    !input.continueRequest &&
    input.requestKind !== 'interruption' &&
    input.messages.at(-1)?.role === 'user'
  )
}

export const UPDATE_PLAN_DESCRIPTION =
  'For non-trivial multi-step work, call update_plan before starting substantive work, then whenever a step starts, finishes, or the plan changes. Send the full plan; keep at most one step in_progress and never mark unfinished work completed. An empty plan clears it.'

/** Override stale model-family planning conventions only when the tool is available. */
export function planToolGuidance(tools: readonly string[] | 'all'): string | undefined {
  if (tools !== 'all' && !tools.includes('update_plan')) return undefined
  return [
    '<plan_tool>',
    UPDATE_PLAN_DESCRIPTION,
    'Use update_plan instead of TodoWrite, markdown checklists, or private reasoning to publish progress. Skip plans for simple questions, casual conversation, and trivial single-step tasks.',
    'When interrupted, keep or update the existing plan if the user continues the task. If they switch tasks, immediately clear it with an empty plan or replace it before starting new work.',
    '</plan_tool>'
  ].join('\n')
}

/** Validate before emitting a tool-start so malformed requests never open a form. */
export function parseQuestions(raw: unknown): AgentQuestionItem[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) {
    throw new Error('questions must contain 1–12 questions.')
  }
  return raw.map((item, index) => {
    if (!item || typeof item.question !== 'string' || !item.question.trim()) {
      throw new Error('Each question needs non-empty question text.')
    }
    if (item.options !== undefined && !Array.isArray(item.options)) {
      throw new Error('Question options must be an array.')
    }
    return {
      id: String(index),
      question: item.question.trim(),
      ...(typeof item.header === 'string' ? { header: item.header } : {}),
      options: (item.options ?? []).map((option: unknown, i: number) => {
        const rec = typeof option === 'string' ? { label: option } : option
        if (
          !rec ||
          typeof rec !== 'object' ||
          !('label' in rec) ||
          typeof rec.label !== 'string' ||
          !rec.label.trim()
        ) {
          throw new Error('Each option needs a label.')
        }
        return {
          id: String(i),
          label: rec.label,
          value: rec.label,
          ...('description' in rec && typeof rec.description === 'string'
            ? { description: rec.description }
            : {})
        }
      })
    }
  })
}

/** update_plan replaces the complete local checklist, including an empty reset. */
export function parsePlan(raw: unknown): SessionTask[] {
  if (!Array.isArray(raw) || raw.length > 100)
    throw new Error('plan must be an array of at most 100 steps.')
  const tasks = raw.map((item) => {
    if (
      !item ||
      typeof item.step !== 'string' ||
      !item.step.trim() ||
      !['pending', 'in_progress', 'completed'].includes(item.status)
    ) {
      throw new Error(
        'Each plan step needs step text and a pending, in_progress, or completed status.'
      )
    }
    return { title: item.step.trim(), status: item.status } as SessionTask
  })
  if (tasks.filter((task) => task.status === 'in_progress').length > 1) {
    throw new Error('Only one plan step may be in_progress.')
  }
  return tasks
}
