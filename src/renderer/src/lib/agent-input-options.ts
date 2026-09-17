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
  /<(?:agent-question|agent-questions|questions|question|ask-questions?|user-questions?|user-inputs?)>[\s\S]*?(?:<\/(?:agent-question|agent-questions|questions|question|ask-questions?|user-questions?|user-inputs?)>|$)/gi

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
  const tagMatch =
    text.match(
      /<(?:agent-question|agent-questions|questions|question|ask-questions?|user-questions?|user-inputs?)>([\s\S]*?)(?:<\/(?:agent-question|agent-questions|questions|question|ask-questions?|user-questions?|user-inputs?)>|$)/i
    ) ||
    text.match(
      /```(?:agent-question|agent-questions|questions|question|json:questions?)\s*([\s\S]*?)\s*```/i
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
              ('question' in (parsed as Record<string, unknown>) ||
                'options' in (parsed as Record<string, unknown>))
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

  // Universal question punctuation (English, CJK, Arabic, Spanish, Greek)
  const QUESTION_MARK_RE = /[?？؟;¿]/

  // Multilingual change summary headers
  const CHANGE_SUMMARY_HEADER_RE =
    /\b(?:changes?\s+(?:made|applied|done|summary|list)|summary of changes|list of changes|here(?:'s| is) (?:a summary of )?changes|here(?:'s| is) what (?:i did|was done|changed)|what (?:was )?changed|completed (?:the following|tasks?|steps?|work|changes?)|following (?:changes?|tasks?|steps?|modifications?|files?|updates?)|files? (?:modified|changed|created|updated)|steps? (?:taken|completed)|tasks? completed|work completed|modifications? made|cambios\s+(?:realizados|hechos)|resumen de cambios|siguientes cambios|modifications\s+(?:apportées|effectuées)|résumé des modifications|änderungen\s+(?:vorgenommen|durchgeführt)|zusammenfassung der änderungen|folgende änderungen|список изменений|внесенные изменения|сделанные изменения|alterações\s+(?:feitas|realizadas)|resumo das alterações)\b|^(?:changes?|summary|modifications?|updates?|修改|变更|更新|変更点?|修正点?|cambios|modifications|änderungen|изменения|alterações)[:：\s]*$|(?:修改|变更|更改|更新|完成)(?:内容|如下|记录|汇总|清单|列表|总结)|以下是(?:修改|变更|更改|更新)|完成的工作|已完成(?:任务|步骤)|(?:変更|修正|対応|更新)(?:内容|点|一覧|について)|以下の(?:変更|修正|通り)|行った(?:変更|修正)|完了した(?:タスク|作業)/i

  // Multilingual past action verbs
  const PAST_ACTION_VERB_RE =
    /^(?:added|updated|fixed|removed|deleted|created|modified|refactored|configured|implemented|installed|changed|replaced|renamed|cleaned up|resolved|migrated|adjusted|set up|tested|built|ran|executed|agregad[oa]s?|actualizad[oa]s?|corregid[oa]s?|eliminad[oa]s?|cread[oa]s?|modificad[oa]s?|ajouté[es]?|mis à jour|corrigé[es]?|supprimé[es]?|créé[es]?|modifié[es]?|hinzugefügt|aktualisiert|behoben|gelöscht|erstellt|geändert|добавлен[оы]?|обновлен[оы]?|исправлен[оы]?|удален[оы]?|создан[оы]?|изменен[оы]?|adicionad[oa]s?|atualizad[oa]s?|corrigid[oa]s?|removid[oa]s?|criad[oa]s?|modificad[oa]s?)\b|^(?:已)?(?:添加|更新|修复|删除|修改|重构|创建|实现|配置|安装|调整|迁移|测试)(?:了)?|^(?:追加|更新|修正|削除|作成|変更|実装|設定)/i

  // Language-agnostic file path / symbol pattern
  const FILE_PATH_OR_SYMBOL_RE =
    /(?:`?[a-zA-Z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|html|css|scss|md|py|go|rs|java|c|cpp|h|hpp|sh|yaml|yml|toml|sql|vue|svelte)`?|`[a-zA-Z0-9_./\\-]+`)(?:\s*[:：—\-]\s*|\s+)/i

  const isChangeSummaryItem = (itemText: string): boolean => {
    const clean = itemText.trim().replace(/^[*_~`#\s]+/, '')
    if (PAST_ACTION_VERB_RE.test(clean)) return true
    if (FILE_PATH_OR_SYMBOL_RE.test(clean)) return true
    if (/\b(?:[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,6})\b/.test(clean) && /[:：—\-]/.test(clean)) {
      return true
    }
    if (/\(\s*[+-]\d+[\s,]*(?:[+-]\d+)?\s*\)/.test(clean)) return true
    return false
  }

  // Multilingual completion / sign-off phrases
  const COMPLETION_SIGN_OFF_RE =
    /(?:\b(?:anything else|something else|any other|other changes?|further changes?|more changes?|additional changes?|any questions?|what do you think|how does (?:this|that) look|let me know if|does this look (?:good|right)|algo más|otra cosa|algún otro|qué te parece|alguna pregunta|autre chose|d'autres modifications|qu'en pensez-vous|des questions|noch etwas|weitere änderungen|wie sieht das aus|fragen haben|weitere fragen|что-то еще|что-нибудь еще|другие изменения|как вам|есть вопросы|чем-то еще|чем-нибудь еще|mais alguma coisa|outra coisa|outras alterações)\b|还有其他|其他需要|还需要|有什么问题|您看如何|怎么样|如果有任何|其他修改|其他帮助|任何疑问|他にお手伝い|他にご要望|いかがでしょうか|何かあれば|ご不明な点|質問はありますか|他に何か)/i

  // Multilingual choice question patterns
  const CHOICE_QUESTION_RE =
    /(?:\b(?:which|cuál|qué|quel|quelle|welche|welcher|welches|какой|какую|какое|какие)\b.*?[?？؟;¿]|(?:哪[个种项一]|何种|どちら|どの).*?[?？]|\b(?:please\s+)?(?:choose|select|pick)\s+(?:one|an\s+option|from|between)\b|\b(?:select|choose|pick)\s+(?:an?\s+)?option[:?]?\s*$|\b(?:available\s+options|available\s+choices)[:?]\s*$|(?:elija|seleccione|escoja)\s+(?:una\s+opción|entre)?[:：?？]|(?:choisir|sélectionner)\s+(?:une\s+option)?[:：?？]|(?:wählen\s+sie)\s+(?:eine\s+option)?[:：?？]|(?:выберите)\s+(?:вариант|один\s+из)?[:：?？]|(?:请)?(?:从(?:以下|这些)?选项中)?(?:选择|挑选)[:：?？]|(?:以下|次)の(?:選択肢|オプション)(?:から|を)(?:選んで|選択して)?[:：?？]|(?:利用可能な|以下の)(?:オプション|選択肢|方案)[:：])/i

  // Multilingual confirmation question patterns
  const CONFIRM_PROCEED_RE =
    /(?:\b(?:would you like|do you want|should (?:i|we)|shall (?:i|we)|can i proceed|ready to proceed|want me to)\s+(?:me\s+to\s+)?(?:proceed|apply|continue|run|execute|commit|push|start|deploy|delete|remove|install)\b|\b(?:confirm|are you sure you want to)\b|¿?(?:desea|quieres|deberíamos|listo para)\s+(?:proceder|aplicar|continuar|ejecutar|confirmar).*?[?？]|(?:souhaitez-vous|voulez-vous|prêt à)\s+(?:continuer|appliquer|exécuter|confirmer).*?[?？]|(?:möchten sie|soll(?:en)?\s+(?:ich|wir)|bereit\s+zu)\s+(?:fortfahren|anwenden|ausführen|bestätigen).*?[?？]|(?:хотите|готовы)\s+(?:продолжить|применить|выполнить|подтвердить).*?[?？]|(?:是否|要|准备好|确认)(?:继续|应用|执行|运行|提交|部署|删除|安装).*?[?？]|准备好继续了吗|是否立即应用|(?:適用|続行|実行|コミット|デプロイ|削除|インストール)(?:しますか|してよろしいですか|を進めますか).*?[?？]|よろしいですか[?？]|確認してください)/i

  const hasChangeSummaryHeader = lastLines.some(
    (l) =>
      CHANGE_SUMMARY_HEADER_RE.test(l) ||
      /^(?:changes|summary|modifications|updates)[:\s]*$/i.test(l)
  )

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
      CHOICE_QUESTION_RE.test(line) &&
      !COMPLETION_SIGN_OFF_RE.test(line) &&
      !CHANGE_SUMMARY_HEADER_RE.test(line)
    ) {
      questionLine = line.replace(/^[*_#\s]+|[*_#\s]+$/g, '')
    }
  }

  if (
    numbered.length >= 2 &&
    numbered.length <= 8 &&
    questionLine &&
    !hasChangeSummaryHeader &&
    !numbered.some((o) => isChangeSummaryItem(o.label))
  ) {
    const id = last.id ?? `msg-${messages.length}`
    const qItem: AgentQuestionItem = {
      id: 'q-1',
      question: questionLine,
      options: numbered
    }
    return {
      hasQuestion: true,
      questions: [qItem],
      question: questionLine,
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
      CHOICE_QUESTION_RE.test(line) &&
      !COMPLETION_SIGN_OFF_RE.test(line) &&
      !CHANGE_SUMMARY_HEADER_RE.test(line)
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

  if (
    bullets.length >= 2 &&
    bulletQuestion &&
    !hasChangeSummaryHeader &&
    !bullets.some((b) => isChangeSummaryItem(b.label))
  ) {
    const id = last.id ?? `msg-${messages.length}`
    const qItem: AgentQuestionItem = {
      id: 'q-1',
      question: bulletQuestion,
      options: bullets
    }
    return {
      hasQuestion: true,
      questions: [qItem],
      question: bulletQuestion,
      options: bullets,
      messageId: id,
      changeKey: `${id}:${bullets.map((o) => o.id).join(',')}`
    }
  }

  // 2c. Confirmation Yes/No question
  const lastLine = lastLines[lastLines.length - 1]
  const prevLine = lastLines.length > 1 ? lastLines[lastLines.length - 2] : ''
  const targetLine = QUESTION_MARK_RE.test(lastLine)
    ? lastLine
    : QUESTION_MARK_RE.test(prevLine)
      ? prevLine
      : ''

  if (
    targetLine &&
    !hasChangeSummaryHeader &&
    !COMPLETION_SIGN_OFF_RE.test(targetLine) &&
    CONFIRM_PROCEED_RE.test(targetLine)
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
