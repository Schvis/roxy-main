import type { ToolResult } from '../../shared/types'
import { parseQuestions } from '../../shared/interaction-tools'
import type { ToolContext } from './tools'

/** The existing tools.input IPC delivers answers; the tool result resumes the model. */
export async function askUser(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const questions = parseQuestions(input.questions)
  if (!ctx.onInputReady) return { ok: false, output: 'ask_user requires an interactive session.' }
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: ToolResult): void => {
      if (settled) return
      settled = true
      ctx.signal?.removeEventListener('abort', abort)
      ctx.onInputReady?.(() => false)
      resolve(result)
    }
    const abort = (): void =>
      finish({ ok: false, output: 'User input cancelled. Do not retry without user direction.' })
    if (ctx.signal?.aborted) return abort()
    ctx.signal?.addEventListener('abort', abort, { once: true })
    ctx.onInputReady?.((data) => {
      if (settled) return false
      try {
        const answers: unknown = JSON.parse(data)
        if (
          !Array.isArray(answers) ||
          answers.length !== questions.length ||
          answers.some((answer) => typeof answer !== 'string' || !answer.trim())
        )
          return false
        finish({
          ok: true,
          output: JSON.stringify({
            answers: questions.map((question, index) => ({
              question: question.question,
              answer: answers[index]
            }))
          })
        })
        return true
      } catch {
        return false
      }
    })
  })
}
