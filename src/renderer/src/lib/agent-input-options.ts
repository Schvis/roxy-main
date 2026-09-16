import type { Message } from '@shared/types'

export interface AgentInputOption {
  id: string
  label: string
  value: string
  isDefault?: boolean
  description?: string
}

export interface AgentQuestionItem {
  id: string
  question: string
  header?: string
  options: AgentInputOption[]
}

export interface AgentQuestionSummary {
  hasQuestion: boolean
  questions: AgentQuestionItem[]
  question: string
  options: AgentInputOption[]
  messageId: string
  changeKey: string
}

const QUESTION_TAG_RE =
  /<(?:agent-question|agent-questions|questions)>[\s\S]*?(?:<\/(?:agent-question|agent-questions|questions)>|$)/gi

/** Strip `<agent-question>` and `<questions>` tags and their contents from text for chat display. */
export function stripQuestionTags(text: string): string {
  if (!text) return ''
  return text.replace(QUESTION_TAG_RE, '')
}

/** Strip ANSI control codes from terminal output. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

/**
 * Extract suggested options from running terminal output when an agent command
 * needs interactive input / confirmation (e.g. y/n, numbered choices, continue).
 * Returns an empty array if the output does not indicate that interactive input/confirmation is required.
 */
export function extractTerminalInputOptions(output: string): AgentInputOption[] {
  if (!output || !output.trim()) {
    return []
  }

  const clean = stripAnsi(output).trimEnd()
  if (!clean) return []

  const tail = clean.slice(-1000)
  const lastLine = clean.split(/\r?\n/).pop()?.trim() ?? ''

  // 1. PowerShell confirm prompt:
  // [Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"):
  if (/\[y\]\s+yes.*?\[n\]\s+no/i.test(tail)) {
    const defaultIsY = !/default is "n"/i.test(tail)
    return [
      { id: 'yes', label: 'Yes (y)', value: 'y', isDefault: defaultIsY },
      { id: 'all', label: 'Yes to All (a)', value: 'a' },
      { id: 'no', label: 'No (n)', value: 'n', isDefault: !defaultIsY },
      { id: 'none', label: 'No to All (l)', value: 'l' }
    ]
  }

  // 2. Standard [y/n], (y/n), [Y/n], [y/N], (Y/N), [y/n/q], [y/n/c], etc. at prompt end:
  // e.g. "Do you want to continue? [Y/n] ", "Overwrite? (y/n):", "Terminate batch job (Y/N)?"
  const ynMatch = tail.match(
    /(?:\[|\()([yYnN])\/([yYnN])(?:\/([a-zA-Z]))?(?:\]|\))\s*[:?›>=-]?\s*$/
  )
  if (ynMatch) {
    const first = ynMatch[1]
    const second = ynMatch[2]
    const third = ynMatch[3]

    const firstIsY = first.toLowerCase() === 'y'
    const yesChar = firstIsY ? first : second
    const noChar = firstIsY ? second : first

    const yesDefault = yesChar === 'Y' || (yesChar === 'y' && noChar === 'n')
    const noDefault = noChar === 'N'

    const opts: AgentInputOption[] = [
      { id: 'yes', label: 'Yes (y)', value: 'y', isDefault: yesDefault },
      { id: 'no', label: 'No (n)', value: 'n', isDefault: noDefault }
    ]

    if (third) {
      const char = third.toLowerCase()
      const name =
        char === 'q' ? 'Quit' : char === 'c' ? 'Cancel' : char === 'a' ? 'All' : third.toUpperCase()
      opts.push({ id: char, label: `${name} (${char})`, value: char })
    }
    return opts
  }

  // 3. Pattern: [yes/no], (yes/no)
  if (/(?:\[|\()(yes|no)\/(yes|no)(?:\]|\))\s*[:?›>=-]?\s*$/i.test(tail)) {
    return [
      { id: 'yes', label: 'Yes', value: 'yes', isDefault: true },
      { id: 'no', label: 'No', value: 'no' }
    ]
  }

  // 4. Pattern: Ok to proceed? (y) / Proceed? (y) / Continue? (y)
  if (/(?:ok to proceed|proceed|continue)\?\s*\(([yYnN])\)\s*[:?›>=-]?\s*$/i.test(tail)) {
    return [
      { id: 'yes', label: 'Yes (y)', value: 'y', isDefault: true },
      { id: 'no', label: 'No (n)', value: 'n' }
    ]
  }

  // 5. Pattern: confirmation question ending line with (y/n) somewhere inside:
  // e.g. "Are you sure you want to delete (y/n)?" or "Confirm replacement? (y/n)"
  if (
    /\b(?:are you sure|confirm|proceed|continue|overwrite|delete|remove)\b.*?\([yY]\/[nN]\)\s*\??\s*$/i.test(
      lastLine
    )
  ) {
    return [
      { id: 'yes', label: 'Yes (y)', value: 'y', isDefault: true },
      { id: 'no', label: 'No (n)', value: 'n' }
    ]
  }

  // 6. Pattern: explicit confirmation prompt questions like "override ...? ", "remove ...? " at end:
  if (/^(?:override|overwrite|remove|delete)\s+.*?\?\s*$/i.test(lastLine)) {
    return [
      { id: 'yes', label: 'Yes (y)', value: 'y', isDefault: true },
      { id: 'no', label: 'No (n)', value: 'n' }
    ]
  }

  // 7. Pattern: Press Enter to continue / Press any key
  if (
    /(?:press\s+(?:\[enter\]|enter|<enter>|any key)|hit\s+enter)\s*(?:to\s+(?:continue|proceed|run))?[^a-zA-Z0-9]*$/i.test(
      tail
    )
  ) {
    return [{ id: 'enter', label: 'Continue (Enter)', value: '', isDefault: true }]
  }

  // 8. Numbered interactive choices:
  // Must have a selection prompt indicator and the last line ending with prompt punctuation
  const isInteractiveSelectionPrompt =
    /(?:\b(?:select|choose|choice|which|option|pick)\b|\?)\s*.*?(?::|›|>|\?|$)/i.test(tail) &&
    /[:?›>]\s*$/.test(lastLine)

  if (isInteractiveSelectionPrompt) {
    const lines = tail
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const lastLines = lines.slice(-15)
    const numberedOptions: AgentInputOption[] = []

    for (const line of lastLines) {
      const m = line.match(/^(?:\[(\d{1,2})\]|(\d{1,2})[\).:])\s+([^\r\n]+)$/)
      if (m) {
        const num = m[1] || m[2]
        const text = m[3].trim().replace(/^[*_~`]+|[*_~`]+$/g, '')
        if (text && numberedOptions.length < 8) {
          numberedOptions.push({
            id: num,
            label: `${num}. ${text}`,
            value: num
          })
        }
      }
    }

    if (numberedOptions.length >= 2) {
      return numberedOptions
    }
  }

  // No interactive confirmation / input prompt detected -> return empty array
  return []
}

function getMessageText(message: Message): string {
  if (typeof message.content === 'string' && message.content) {
    return message.content
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter(
        (p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string'
      )
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

/**
 * Extract question and suggested options from the agent's latest assistant message
 * when a turn ends asking for user input or decision.
 * Supports structured `<agent-question>` JSON blocks (multiple questions with pagination)
 * as well as natural language fallback (numbered lists, bullets, confirmation questions).
 */
export function extractAgentQuestionOptions(
  messages: Message[],
  isStreaming: boolean
): AgentQuestionSummary | null {
  if (isStreaming || !messages || messages.length === 0) return null

  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return null

  const text = getMessageText(last).trim()
  if (!text || text.includes('_[stopped]_') || text.includes('[stopped]')) return null

  // 1. Check for structured <agent-question> or <questions> tag
  const tagMatch = text.match(
    /<(?:agent-question|agent-questions|questions)>([\s\S]*?)<\/(?:agent-question|agent-questions|questions)>/i
  )
  if (tagMatch) {
    const rawJson = tagMatch[1]
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawJson)
      } catch {
        // Strip trailing commas and retry
        parsed = JSON.parse(rawJson.replace(/,\s*([\]}])/g, '$1'))
      }

      const rawQuestions = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as Record<string, unknown>).questions)
          ? ((parsed as Record<string, unknown>).questions as unknown[])
          : parsed &&
              typeof parsed === 'object' &&
              'question' in (parsed as Record<string, unknown>)
            ? [parsed]
            : []

      const questions: AgentQuestionItem[] = []
      for (let i = 0; i < rawQuestions.length; i++) {
        const q = rawQuestions[i]
        if (!q || typeof q !== 'object') continue
        const rec = q as Record<string, unknown>
        const question = String(rec.question ?? rec.prompt ?? rec.title ?? '').trim()
        if (!question) continue
        const header = rec.header ? String(rec.header).trim() : undefined

        const rawOpts = Array.isArray(rec.options) ? rec.options : []
        const options: AgentInputOption[] = []
        for (let j = 0; j < rawOpts.length; j++) {
          const opt = rawOpts[j]
          if (typeof opt === 'string') {
            const val = opt.trim()
            if (val) {
              options.push({
                id: String(j + 1),
                label: val,
                value: val
              })
            }
          } else if (opt && typeof opt === 'object') {
            const oRec = opt as Record<string, unknown>
            const label = String(
              oRec.label ?? oRec.text ?? oRec.title ?? oRec.name ?? oRec.value ?? ''
            ).trim()
            const value = String(oRec.value ?? label).trim()
            const description = oRec.description ? String(oRec.description).trim() : undefined
            const isDefault = Boolean(oRec.isDefault || oRec.default)
            if (label) {
              options.push({
                id: String(j + 1),
                label,
                value,
                description,
                isDefault
              })
            }
          }
        }

        if (options.length > 0) {
          questions.push({
            id: `q-${i + 1}`,
            question,
            header,
            options
          })
        }
      }

      if (questions.length > 0) {
        const id = last.id ?? `msg-${messages.length}`
        return {
          hasQuestion: true,
          questions,
          question: questions[0].question,
          options: questions[0].options,
          messageId: id,
          changeKey: `${id}:${questions.map((q) => q.id + ':' + q.options.map((o) => o.id).join(',')).join(';')}`
        }
      }
    } catch {
      // Fall through to natural language parsing
    }
  }

  // 2. Natural language fallback
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  const lastLines = lines.slice(-20)

  // 2a. Numbered options
  const numbered: AgentInputOption[] = []
  let questionLine = ''

  for (let i = 0; i < lastLines.length; i++) {
    const line = lastLines[i]
    const m = line.match(/^(?:\[(\d{1,2})\]|(\d{1,2})[\).:])\s+([^\r\n]+)$/)
    if (m) {
      const num = m[1] || m[2]
      const label = m[3].trim().replace(/^[*_~`]+|[*_~`]+$/g, '')
      if (label) {
        numbered.push({
          id: num,
          label: `${num}. ${label}`,
          value: `${num}. ${label}`
        })
      }
    } else if (
      line.endsWith('?') ||
      /(?:which|select|choose|prefer|option|options|following)[:?]?$/i.test(line)
    ) {
      questionLine = line.replace(/^[*_#\s]+|[*_#\s]+$/g, '')
    }
  }

  if (numbered.length >= 2 && numbered.length <= 8) {
    const question = questionLine || 'Select an option to continue:'
    const id = last.id ?? `msg-${messages.length}`
    const qItem: AgentQuestionItem = {
      id: 'q-1',
      question,
      options: numbered
    }
    return {
      hasQuestion: true,
      questions: [qItem],
      question,
      options: numbered,
      messageId: id,
      changeKey: `${id}:${numbered.map((o) => o.id).join(',')}`
    }
  }

  // 2b. Bullet list under question header
  const bullets: AgentInputOption[] = []
  let bulletQuestion = ''
  let foundHeader = false

  for (let i = 0; i < lastLines.length; i++) {
    const line = lastLines[i]
    if (
      !foundHeader &&
      (line.endsWith('?') ||
        /(?:options?|choices?|select|choose|prefer|which|do you want|should (?:we|i)|would you like)[:?]\s*$/i.test(
          line
        ))
    ) {
      bulletQuestion = line.replace(/^[*_#\s]+|[*_#\s]+$/g, '')
      foundHeader = true
      continue
    }

    if (foundHeader) {
      const bMatch = line.match(/^[-*+]\s+([^\r\n]+)$/)
      if (bMatch) {
        const itemText = bMatch[1].trim().replace(/^[*_~`]+|[*_~`]+$/g, '')
        if (itemText && bullets.length < 8) {
          bullets.push({
            id: `opt-${bullets.length + 1}`,
            label: itemText,
            value: itemText
          })
        }
      }
    }
  }

  if (bullets.length >= 2) {
    const question = bulletQuestion || 'Select an option to continue:'
    const id = last.id ?? `msg-${messages.length}`
    const qItem: AgentQuestionItem = {
      id: 'q-1',
      question,
      options: bullets
    }
    return {
      hasQuestion: true,
      questions: [qItem],
      question,
      options: bullets,
      messageId: id,
      changeKey: `${id}:${bullets.map((o) => o.id).join(',')}`
    }
  }

  // 2c. Confirmation Yes/No question
  const lastLine = lastLines[lastLines.length - 1]
  const prevLine = lastLines.length > 1 ? lastLines[lastLines.length - 2] : ''
  const targetLine = lastLine.endsWith('?') ? lastLine : prevLine.endsWith('?') ? prevLine : ''

  if (
    targetLine &&
    /(?:would you like|do you want|should (?:i|we)|shall (?:i|we)|can i proceed|proceed with|confirm|are you sure|ready to proceed|want me to)\b/i.test(
      targetLine
    )
  ) {
    const question = targetLine.replace(/^[*_#\s]+|[*_#\s]+$/g, '')
    const options: AgentInputOption[] = [
      { id: 'yes', label: 'Yes, proceed', value: 'Yes, proceed', isDefault: true },
      { id: 'no', label: 'No, cancel', value: 'No, cancel' }
    ]
    const id = last.id ?? `msg-${messages.length}`
    const qItem: AgentQuestionItem = {
      id: 'q-1',
      question,
      options
    }
    return {
      hasQuestion: true,
      questions: [qItem],
      question,
      options,
      messageId: id,
      changeKey: `${id}:yes-no`
    }
  }

  return null
}
