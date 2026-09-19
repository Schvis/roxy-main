import type { Chat, Message, MessagePart, SessionTask } from '@shared/types'

export interface AgentStepsSummary {
  tasks: SessionTask[]
  completedCount: number
  inProgressCount: number
  pendingCount: number
  totalCount: number
  progress: number
  activeTask: SessionTask | null
  changeKey: string
  source: 'session_tasks' | 'streaming_tool' | 'markdown' | 'subagents' | 'none'
}

const EMOTION_PREFIX_RE =
  /^\s*\[(?:happy|cheerful|delighted|excited|enthusiastic|proud|satisfied|grateful|hopeful|optimistic|relaxed|friendly|moved|confident|thoughtful|determined|focused|curious|intrigued|reassuring|calm|surprised|confused|uncertain|doubtful|nervous|anxious|worried|nostalgic|sad|unhappy|disappointed|upset|frustrated|depressed|angry|scared|hysterical|pessimistic|lonely|bored|resigned|empathetic|sympathetic|compassionate|embarrassed|regretful|guilty|ashamed|sarcastic|disdainful|contemptuous|disgusted|jealous|envious|indifferent|whispering|soft tone|shouting|screaming|in a hurry tone|laughing|chuckling|sighing|groaning|gasping|yawning|panting|sobbing|crying loudly|clear throat|[a-zA-Z\s_-]+)\]\s*/i

const MARKDOWN_CHECKLIST_RE =
  /^\s*(?:\[[a-zA-Z\s_-]+\]\s*)?(?:[-*+]|\d+[.)]|--)\s+(?:\[\s*\[?\s*([ xX\-\/])\s*\]?\s*\]|\[([ xX\-\/])\])(?:\s+(.+))?$/i

const CHECKLIST_LINE_RE =
  /^\s*(?:\[[a-zA-Z\s_-]+\]\s*)?(?:[-*+]|\d+[.)]|--)\s*(?:\[\s*\[?\s*[ xX\-\/]\s*\]?\s*\]|\[[ xX\-\/]\])/i

const BULLET_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:(?:Step|Task|Phase)\s*\d*[:.-]?\s*)?(.+)$/i

const PLAN_HEADER_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{1,2}|_{1,2})?(?:plan|steps|approach|tasks|todo|to-do|action\s*plan|next\s*steps|what\s*(?:i(?:'ll|\s+will|\s+am\s+going\s+to)?|to)\s*do|implementation\s*steps)(?:\*{1,2}|_{1,2})?\s*[:\-—]?\s*(?:\n|$)/i

const PLAN_INTRO_RE =
  /(?:i\s*will|i'll|i\s*am\s*going\s*to|let's|let\s*me|here\s*(?:is|'s)\s*(?:the|my|our)?\s*(?:plan|steps)|planned\s*steps?|steps?\s*to\s*take|following\s*steps)/i

const SUMMARY_HEADER_RE =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{1,2}|_{1,2})?(?:summary(?:\s+of\s+what\s+changed|\s+of\s+changes)?|what\s*(?:changed|was\s+done)|changes\s*made|changes|done(?:\s+(?:work|tasks|steps|summary))?|completed\s+(?:work|tasks|steps|summary)|recap|results|overview\s+of\s+changes|changelog)(?:\*{1,2}|_{1,2})?\s*[:\-—]?\s*(?:\n|$)/i

const SUMMARY_INTRO_RE =
  /(?:summary\s+of\s+(?:what\s+changed|changes)|what\s+(?:was|has\s+been)\s+(?:done|changed)|here(?:'s|\s+is)\s+what\s+(?:changed|i\s+did)|changes\s+(?:made|included)|done\s*[-—]\s*.*summary|completed\s+the\s+following)/i

const PAST_TENSE_VERB_RE =
  /^\s*(?:dropped|rewrote|replaced|removed|deleted|added|fixed|updated|created|migrated|refactored|cleaned|configured|installed|checked|switched|optimized|improved|resolved|modified|built|reworked|adjusted)\b/i

const ACTION_VERB_RE =
  /^(?:fix|check|do|add|create|update|remove|delete|refactor|inspect|investigate|test|verify|run|build|review|implement|modify|read|write|setup|configure|ensure|extract|clean|compile|install|search|find|change|replace|handle|support|enable|disable|move|rename|migrate|optimize|resolve|start|prepare|make|look|see|examine|reproduce|debug|analyze|assess|patch|wire|connect|render|display|show|hide|validate|document|upgrade|bump)\b/i

/** Parse string or object arrays into typed SessionTask items. */
export function parseTasksInput(raw: unknown): SessionTask[] {
  if (!Array.isArray(raw)) return []
  const out: SessionTask[] = []
  const seen = new Map<string, number>()
  for (const item of raw) {
    let title = ''
    let status: SessionTask['status'] = 'pending'
    if (typeof item === 'string') {
      title = item.trim()
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      title = String(rec.title ?? rec.text ?? rec.name ?? '').trim()
      const statusRaw = String(rec.status ?? '').toLowerCase()
      if (
        statusRaw === 'completed' ||
        statusRaw === 'done' ||
        rec.done === true ||
        rec.completed === true
      ) {
        status = 'completed'
      } else if (statusRaw === 'in_progress' || statusRaw === 'running' || statusRaw === 'active') {
        status = 'in_progress'
      }
    }
    if (!title) continue
    const norm = normalizeTaskTitle(title)
    const existing = seen.get(norm)
    if (existing !== undefined) {
      if (status === 'completed') {
        out[existing].status = 'completed'
      } else if (status === 'in_progress' && out[existing].status === 'pending') {
        out[existing].status = 'in_progress'
      }
    } else {
      seen.set(norm, out.length)
      out.push({ title, status })
    }
  }
  return out
}

/** Extract markdown checkbox items (`- [ ]`, `- [x]`, `- [/]`) from text. */
export function extractMarkdownChecklist(text: string): SessionTask[] {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const tasks: SessionTask[] = []
  const taskIndexByTitle = new Map<string, number>()
  let inSummarySection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (SUMMARY_HEADER_RE.test(line) || SUMMARY_INTRO_RE.test(line)) {
      inSummarySection = true
      continue
    }
    if (PLAN_HEADER_RE.test(line) || PLAN_INTRO_RE.test(line)) {
      inSummarySection = false
    }
    if (inSummarySection) continue

    const clean = line.replace(EMOTION_PREFIX_RE, '').trim()
    const match = clean.match(MARKDOWN_CHECKLIST_RE) || line.match(MARKDOWN_CHECKLIST_RE)
    if (match) {
      const mark = (match[1] || match[2] || ' ').toLowerCase()
      const title = (match[3] || '').trim().replace(/^[*_~`]+|[*_~`]+$/g, '')
      if (!title) continue
      let status: SessionTask['status'] = 'pending'
      if (mark === 'x') {
        status = 'completed'
      } else if (mark === '/' || mark === '-') {
        status = 'in_progress'
      }

      const norm = normalizeTaskTitle(title)
      const existingIdx = taskIndexByTitle.get(norm)
      if (existingIdx !== undefined) {
        // Task already in plan. Update status without creating duplicates.
        const existing = tasks[existingIdx]
        if (status === 'completed') {
          existing.status = 'completed'
        } else if (status === 'in_progress' && existing.status === 'pending') {
          existing.status = 'in_progress'
        }
      } else {
        taskIndexByTitle.set(norm, tasks.length)
        tasks.push({ title, status })
      }
    }
  }
  return tasks
}

const PLAN_HEADER_LINE_RE =
  /^(?:#{1,6}\s*)?(?:\*{1,2}|_{1,2})?(?:(?:updated|current|initial|action|next|implementation)?\s*(?:plan|steps|approach|tasks|todo|to-do)|what\s*(?:i(?:'ll|\s+will|\s+am\s+going\s+to)?|to)\s*do)(?:\s*(?:update|progress))?(?:\*{1,2}|_{1,2})?\s*[:\-—]?$/i

/**
 * Strip plan checklists and preceding plan headings from text for chat display,
 * so plan steps are only shown in the dedicated AgentStepsPopup.
 */
export function stripPlanSteps(text: string): string {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  const kept: string[] = []
  let inPlanBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cleanLine = line.replace(EMOTION_PREFIX_RE, '').trim()
    const isChecklist =
      CHECKLIST_LINE_RE.test(cleanLine) ||
      CHECKLIST_LINE_RE.test(line) ||
      MARKDOWN_CHECKLIST_RE.test(cleanLine) ||
      MARKDOWN_CHECKLIST_RE.test(line)

    const prevKeptClean =
      kept.length > 0 ? kept[kept.length - 1].replace(EMOTION_PREFIX_RE, '').trim() : ''
    const isPlanBullet =
      kept.length > 0 &&
      /^\s*(?:[-*+]|\d+[.)]|--)\s+[^\r\n]+$/.test(cleanLine) &&
      PLAN_HEADER_LINE_RE.test(prevKeptClean)

    if (isChecklist || isPlanBullet) {
      inPlanBlock = true
      if (kept.length > 0 && PLAN_HEADER_LINE_RE.test(prevKeptClean)) {
        kept.pop()
      }
      continue
    }

    if (inPlanBlock) {
      if (
        /^\s*(?:[-*+]|\d+[.)]|--)\s+[^\r\n]+$/.test(cleanLine) ||
        CHECKLIST_LINE_RE.test(cleanLine) ||
        !cleanLine
      ) {
        continue
      }
      inPlanBlock = false
    }

    kept.push(line)
  }

  return kept.join('\n').trim()
}

/** Extract plain bullet points or numbered lists that represent action plans / steps. */
export function extractPlainBulletPlan(
  text: string,
  options: { isStreaming?: boolean } = {}
): SessionTask[] {
  if (!text) return []
  const isStreaming = options.isStreaming ?? false
  const lines = text.split(/\r?\n/)

  interface BulletBlock {
    startIndex: number
    endIndex: number
    lines: string[]
    precededByPlanIntro: boolean
    precededBySummary: boolean
  }

  const blocks: BulletBlock[] = []
  let currentBlock: string[] = []
  let currentStart = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      if (currentBlock.length > 0) {
        const beforeLines = lines.slice(Math.max(0, currentStart - 5), currentStart).join('\n')
        const precededByPlanIntro =
          PLAN_HEADER_RE.test(beforeLines) || PLAN_INTRO_RE.test(beforeLines)
        const precededBySummary =
          SUMMARY_HEADER_RE.test(beforeLines) || SUMMARY_INTRO_RE.test(beforeLines)
        blocks.push({
          startIndex: currentStart,
          endIndex: i - 1,
          lines: currentBlock,
          precededByPlanIntro,
          precededBySummary
        })
        currentBlock = []
        currentStart = -1
      }
      continue
    }

    const match = line.match(BULLET_LINE_RE)
    if (match) {
      if (currentBlock.length === 0) {
        currentStart = i
      }
      currentBlock.push(match[1].trim())
    } else {
      if (currentBlock.length > 0) {
        const beforeLines = lines.slice(Math.max(0, currentStart - 5), currentStart).join('\n')
        const precededByPlanIntro =
          PLAN_HEADER_RE.test(beforeLines) || PLAN_INTRO_RE.test(beforeLines)
        const precededBySummary =
          SUMMARY_HEADER_RE.test(beforeLines) || SUMMARY_INTRO_RE.test(beforeLines)
        blocks.push({
          startIndex: currentStart,
          endIndex: i - 1,
          lines: currentBlock,
          precededByPlanIntro,
          precededBySummary
        })
        currentBlock = []
        currentStart = -1
      }
    }
  }

  if (currentBlock.length > 0) {
    const beforeLines = lines.slice(Math.max(0, currentStart - 5), currentStart).join('\n')
    const precededByPlanIntro = PLAN_HEADER_RE.test(beforeLines) || PLAN_INTRO_RE.test(beforeLines)
    const precededBySummary =
      SUMMARY_HEADER_RE.test(beforeLines) || SUMMARY_INTRO_RE.test(beforeLines)
    blocks.push({
      startIndex: currentStart,
      endIndex: lines.length - 1,
      lines: currentBlock,
      precededByPlanIntro,
      precededBySummary
    })
  }

  // 1. First priority: any block explicitly introduced as a plan and NOT preceded by a summary
  for (const block of blocks) {
    if (block.lines.length < 2) continue
    if (block.precededBySummary) continue

    const pastTenseCount = block.lines.filter(
      (l) => PAST_TENSE_VERB_RE.test(l) || /\b(?:->|→)\b/.test(l)
    ).length
    if (pastTenseCount >= Math.ceil(block.lines.length * 0.4)) continue

    if (block.precededByPlanIntro) {
      return block.lines.map((rawTitle) => {
        const cleanTitle = rawTitle.replace(/^[*_`~]+|[*_`~]+$/g, '').trim()
        let status: SessionTask['status'] = 'pending'

        if (
          /\b(?:done|completed|finished|resolved)\b/i.test(cleanTitle) ||
          cleanTitle.includes('✓') ||
          cleanTitle.includes('✔') ||
          /^~~.+~~$/.test(rawTitle)
        ) {
          status = 'completed'
        } else if (
          /\b(?:in\s*progress|running|active|current|working\s*on\s*this)\b/i.test(cleanTitle) ||
          cleanTitle.includes('▶') ||
          cleanTitle.includes('⏳')
        ) {
          status = 'in_progress'
        }

        return { title: cleanTitle, status }
      })
    }
  }

  // 2. Second priority: during LIVE streaming turn ONLY (before agent finishes),
  // if an early block near the start of the message is clearly action-oriented future tasks
  if (isStreaming) {
    for (const block of blocks) {
      if (block.lines.length < 2) continue
      if (block.precededBySummary) continue

      const pastTenseCount = block.lines.filter(
        (l) => PAST_TENSE_VERB_RE.test(l) || /\b(?:->|→)\b/.test(l)
      ).length
      if (pastTenseCount > 0) continue

      const actionVerbCount = block.lines.filter((item) => ACTION_VERB_RE.test(item)).length
      const isActionOriented = actionVerbCount >= Math.min(2, Math.ceil(block.lines.length * 0.5))

      // Only accept if near start of response (first 20 lines)
      if (isActionOriented && block.startIndex <= 20) {
        return block.lines.map((rawTitle) => {
          const cleanTitle = rawTitle.replace(/^[*_`~]+|[*_`~]+$/g, '').trim()
          return { title: cleanTitle, status: 'pending' }
        })
      }
    }
  }

  return []
}

/** Correlate step statuses based on tool progress during streaming or finished turns. */
export function correlateStepStatuses(
  tasks: SessionTask[],
  tools: Extract<MessagePart, { type: 'tool' }>[],
  isStreaming: boolean,
  options: { isChecklist?: boolean; hasSummaryAtEnd?: boolean } = {}
): SessionTask[] {
  if (tasks.length === 0) return []

  const hasExplicitCompleted = tasks.some((t) => t.status === 'completed')
  const hasExplicitInProgress = tasks.some((t) => t.status === 'in_progress')

  // If tasks came with explicit markdown checkboxes or explicit statuses:
  if (hasExplicitCompleted || hasExplicitInProgress) {
    if (isStreaming && !hasExplicitInProgress) {
      let markedFirstPending = false
      return tasks.map((t) => {
        if (!markedFirstPending && t.status === 'pending') {
          markedFirstPending = true
          return { ...t, status: 'in_progress' as const }
        }
        return t
      })
    }
    return tasks
  }

  // If all tasks were pending checklist items without explicit completion:
  if (options.isChecklist && !options.hasSummaryAtEnd) {
    if (isStreaming) {
      let markedFirstPending = false
      return tasks.map((t) => {
        if (!markedFirstPending && t.status === 'pending') {
          markedFirstPending = true
          return { ...t, status: 'in_progress' as const }
        }
        return t
      })
    }
    return tasks
  }

  const completedTools = tools.filter((t) => t.state === 'done').length
  const hasRunningTool = tools.some((t) => t.state === 'running')

  return tasks.map((task, index) => {
    if (isStreaming) {
      if (completedTools === 0 && !hasRunningTool) {
        return {
          ...task,
          status: index === 0 ? ('in_progress' as const) : ('pending' as const)
        }
      }

      if (index < completedTools) {
        return { ...task, status: 'completed' as const }
      }
      if (index === completedTools) {
        return { ...task, status: 'in_progress' as const }
      }
      return { ...task, status: 'pending' as const }
    } else {
      if (options.hasSummaryAtEnd || (completedTools > 0 && completedTools >= tasks.length)) {
        return { ...task, status: 'completed' as const }
      }
      if (completedTools > 0 && index < completedTools) {
        return { ...task, status: 'completed' as const }
      }
      return { ...task, status: 'pending' as const }
    }
  })
}

/** Normalize task title for loose matching (case, numbering, punctuation). */
export function normalizeTaskTitle(s: string): string {
  const stripped = s
    .toLowerCase()
    .replace(/^\s*(?:(?:step|task|phase)\s*\d*[:.-]\s*|\d+[\.\)]\s*)/i, '')
    .replace(/[^\w\s]/g, '')
    .trim()
  return (
    stripped ||
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim()
  )
}

/**
 * Update task statuses based on explicit completion and progress announcements in message text:
 * - "Completed: <step>" or "Finished: <step>" or "Done: <step>"
 * - "Step N completed" or "Completed step N"
 * - "- [x] <step>"
 * - "Starting: <step>" or "In progress: <step>"
 */
export function applyCompletionSignals(tasks: SessionTask[], allTexts: string[]): SessionTask[] {
  if (tasks.length === 0 || allTexts.length === 0) return tasks
  const combined = allTexts.join('\n')
  if (!combined.trim()) return tasks

  const updated = tasks.map((t) => ({ ...t }))

  // 1. Check each task against combined text for completion signals
  for (let idx = 0; idx < updated.length; idx++) {
    const task = updated[idx]
    if (task.status === 'completed') continue

    const stepNum = idx + 1
    const cleanTitle = normalizeTaskTitle(task.title)

    // Numbered step completion: "Step 1 completed", "Completed step 1", "Step 1 is done"
    const stepNumRegex = new RegExp(
      `(?:\\b(?:step|task)[ \\t]*${stepNum}\\b[^\\n\\r]{0,35}?\\b(?:completed|done|finished|resolved)\\b|\\b(?:completed|done|finished|resolved)\\b[^\\n\\r]{0,35}?\\b(?:step|task)[ \\t]*${stepNum}\\b)`,
      'i'
    )
    if (stepNumRegex.test(combined)) {
      task.status = 'completed'
      continue
    }

    // Direct checklist checkmark: "- [x] <title>"
    const escapedTitle = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (escapedTitle.length >= 3) {
      const checklistRegex = new RegExp(
        `[-*+][ \\t]*\\[[xX]\\][ \\t]*[^\\n\\r]*?${escapedTitle}`,
        'i'
      )
      if (checklistRegex.test(combined)) {
        task.status = 'completed'
        continue
      }

      // "Completed: <title>", "Finished: <title>", "Done: <title>", "<title> completed"
      const titleRegex = new RegExp(
        `(?:\\b(?:completed|done|finished|resolved)[ \\t]*[:\\-—][ \\t]*[^\\n\\r]*?${escapedTitle}|${escapedTitle}[ \\t]*[:\\-—]?[ \\t]*\\b(?:is[ \\t]+)?(?:completed|done|finished|resolved)\\b)`,
        'i'
      )
      if (titleRegex.test(combined)) {
        task.status = 'completed'
        continue
      }
    }

    // Explicit lines matching "Completed: <text>", "Done: <text>", "Finished: <text>"
    const lineMatches = combined.matchAll(
      /(?:^|\n)\s*(?:[-*+]|\d+[.)])?\s*(?:\*{1,2}|_{1,2})?(?:completed|done|finished|resolved)(?:\*{1,2}|_{1,2})?\s*[:\-—]\s*([^\n\r.]+)/gi
    )
    for (const match of lineMatches) {
      const lineText = normalizeTaskTitle(match[1] || '')
      if (!lineText) continue
      if (
        (lineText.length >= 3 && cleanTitle.includes(lineText)) ||
        (cleanTitle.length >= 3 && lineText.includes(cleanTitle))
      ) {
        task.status = 'completed'
        break
      }
      if (new RegExp(`\\b(?:step|task)\\s*${stepNum}\\b`, 'i').test(lineText)) {
        task.status = 'completed'
        break
      }
    }
  }

  // 2. In-progress / starting announcements:
  // e.g. "Starting: <step>", "Now starting: <step>", "Working on: <step>"
  for (let idx = 0; idx < updated.length; idx++) {
    const task = updated[idx]
    if (task.status === 'completed') continue

    const stepNum = idx + 1
    const cleanTitle = normalizeTaskTitle(task.title)
    const escapedTitle = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const inProgressRegex = new RegExp(
      `(?:\\b(?:starting|in[ \\t]*progress|working[ \\t]*on|now[ \\t]*starting)[ \\t]*[:\\-—]?[ \\t]*[^\\n\\r]*?${escapedTitle}|\\b(?:step|task)[ \\t]*${stepNum}\\b[^\\n\\r]{0,25}?\\b(?:in[ \\t]*progress|underway|started|starting)\\b)`,
      'i'
    )
    if (inProgressRegex.test(combined)) {
      task.status = 'in_progress'
      // When a subsequent step starts, all prior steps in the plan are completed
      for (let prev = 0; prev < idx; prev++) {
        if (updated[prev].status !== 'completed') {
          updated[prev].status = 'completed'
        }
      }
      break
    }
  }

  return updated
}

/**
 * Merge newly extracted steps with previous steps.
 * If the steps resume with the same titles, preserve already completed steps
 * and continue from the first unfinished step.
 */
export function mergeResumedSteps(
  currentTasks: SessionTask[],
  previousTasks: SessionTask[]
): SessionTask[] {
  if (currentTasks.length === 0) return previousTasks
  if (previousTasks.length === 0) return currentTasks

  const prevMap = new Map<string, SessionTask>()
  for (const t of previousTasks) {
    prevMap.set(normalizeTaskTitle(t.title), t)
  }

  const currMap = new Map<string, SessionTask>()
  for (const t of currentTasks) {
    currMap.set(normalizeTaskTitle(t.title), t)
  }

  // Count how many tasks match
  let matches = 0
  for (const t of currentTasks) {
    if (prevMap.has(normalizeTaskTitle(t.title))) matches++
  }

  // If at least 50% or >= 2 tasks match, consider it the same plan resuming
  const isSamePlan = matches >= Math.min(2, Math.ceil(currentTasks.length * 0.5))
  if (!isSamePlan) return currentTasks

  // If currentTasks is a partial subset of previousTasks (e.g. only remaining steps, or just completed steps),
  // preserve the full plan structure from previousTasks and overlay currentTasks statuses:
  if (previousTasks.length > currentTasks.length) {
    return previousTasks.map((prev) => {
      const curr = currMap.get(normalizeTaskTitle(prev.title))
      if (curr) {
        if (curr.status === 'completed' || curr.status === 'in_progress') {
          return { ...prev, status: curr.status }
        }
      }
      return prev
    })
  }

  // Otherwise (currentTasks has at least as many steps as previousTasks):
  // Merge: preserve completed status from previousTasks if current is still pending
  return currentTasks.map((curr) => {
    const prev = prevMap.get(normalizeTaskTitle(curr.title))
    if (prev && prev.status === 'completed' && curr.status === 'pending') {
      return { ...curr, status: 'completed' }
    }
    return curr
  })
}

/** Mark any in-progress task as pending when a plan is stopped / cancelled. */
export function stopTasks(tasks: SessionTask[]): SessionTask[] {
  return tasks.map((t) => (t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t))
}

/**
 * Per-message memo for `extractPlanFromMessage`.
 *
 * That function is pure but expensive: it rebuilds the joined prose/reasoning
 * strings and runs ~8 regexes over the WHOLE message body. `extractAgentSteps`
 * calls it for every assistant message in the history, and the steps popup
 * re-runs `extractAgentSteps` on every animation frame while a turn streams —
 * so a long session paid the full-history regex cost ~60x/second even though the
 * persisted messages never change.
 *
 * A persisted `Message` is immutable and referentially stable between frames
 * (the store replaces the array only on a `messages:updated` reload), so a
 * WeakMap keyed on the message object turns that O(history) per-frame work into
 * O(new messages) once. Eviction is automatic — the entry dies with the message.
 *
 * The cached value is safe to share: every consumer either reads the task fields
 * or copies them (`applyCompletionSignals` / `correlateStepStatuses` map to fresh
 * objects); none mutate the returned tasks in place.
 */
type PlanInfo = {
  tasks: SessionTask[]
  isChecklist: boolean
  hasSummaryAtEnd: boolean
  isStopped: boolean
}

const planCache = new WeakMap<Message, PlanInfo | null>()

/**
 * Memoized "visible assistant text" for a message: the joined text parts, or
 * the plain content column as a fallback. `extractPlanFromMessage` builds this
 * for prose AND reasoning, and `extractAgentSteps` builds it again for prior /
 * post-plan messages — the same work, several times per frame, over the whole
 * history. Same immutability argument as `planCache`: memoize per message.
 */
const textCache = new WeakMap<Message, string>()
function assistantTextOf(msg: Message): string {
  const cached = textCache.get(msg)
  if (cached !== undefined) return cached
  const text =
    msg.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ||
    msg.content ||
    ''
  textCache.set(msg, text)
  return text
}

function extractPlanFromMessage(msg: Message): PlanInfo | null {
  const cached = planCache.get(msg)
  if (cached !== undefined) return cached
  const result = computePlanFromMessage(msg)
  planCache.set(msg, result)
  return result
}

function computePlanFromMessage(msg: Message): PlanInfo | null {
  if (msg.role !== 'assistant') return null

  const prose = assistantTextOf(msg)
  const isStopped = prose.includes('_[stopped]_') || prose.includes('[stopped]')

  if (msg.parts && msg.parts.length > 0) {
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j]
      if (part.type === 'tool' && part.tool === 'change_session_metadata' && part.input?.tasks) {
        const parsed = parseTasksInput(part.input.tasks)
        if (parsed.length > 0) {
          return { tasks: parsed, isChecklist: false, hasSummaryAtEnd: false, isStopped }
        }
      }
    }
  }

  const reasoning =
    msg.parts
      ?.filter((p) => p.type === 'reasoning')
      .map((p) => p.text)
      .join('\n') || ''

  let isChecklist = true
  let extracted = extractMarkdownChecklist(prose)
  if (extracted.length === 0) {
    isChecklist = false
    extracted = extractPlainBulletPlan(prose, { isStreaming: false })
  }
  if (extracted.length === 0) {
    isChecklist = true
    extracted = extractMarkdownChecklist(reasoning)
  }
  if (extracted.length === 0) {
    isChecklist = false
    extracted = extractPlainBulletPlan(reasoning, { isStreaming: false })
  }

  if (extracted.length === 0) return null

  const withSignals = applyCompletionSignals(extracted, [prose, reasoning])
  const hasSummaryAtEnd = SUMMARY_HEADER_RE.test(prose) || SUMMARY_INTRO_RE.test(prose)
  return { tasks: withSignals, isChecklist, hasSummaryAtEnd, isStopped }
}

function buildSummary(
  tasks: SessionTask[],
  source: AgentStepsSummary['source']
): AgentStepsSummary {
  const totalCount = tasks.length
  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length
  const pendingCount = tasks.filter((t) => t.status === 'pending').length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const activeTask =
    tasks.find((t) => t.status === 'in_progress') ??
    (completedCount < totalCount ? tasks.find((t) => t.status === 'pending') : null) ??
    null
  const changeKey = tasks.map((t) => `${t.status}:${t.title}`).join('|')

  return {
    tasks,
    completedCount,
    inProgressCount,
    pendingCount,
    totalCount,
    progress,
    activeTask,
    changeKey,
    source
  }
}

/**
 * Extract the current agent plan / steps from active chat, streaming turn, or recent messages.
 */
export function extractAgentSteps(
  chat: Chat | undefined,
  messages: Message[],
  streaming: MessagePart[] | null,
  options: { isStopped?: boolean } = {}
): AgentStepsSummary {
  // 1. Live change_session_metadata in streaming parts
  if (streaming && streaming.length > 0) {
    for (let i = streaming.length - 1; i >= 0; i--) {
      const part = streaming[i]
      if (part.type === 'tool' && part.tool === 'change_session_metadata' && part.input?.tasks) {
        const liveTasks = parseTasksInput(part.input.tasks)
        if (liveTasks.length > 0) {
          const finalTasks = options.isStopped ? stopTasks(liveTasks) : liveTasks
          return buildSummary(finalTasks, 'streaming_tool')
        }
      }
    }
  }

  // 2. Chat's canonical tasks (maintained by change_session_metadata in SQLite)
  if (chat?.tasks && chat.tasks.length > 0) {
    const finalTasks = options.isStopped ? stopTasks(chat.tasks) : chat.tasks
    return buildSummary(finalTasks, 'session_tasks')
  }

  // Find previous plan tasks across message history for merging/resuming
  let previousPlanTasks: SessionTask[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const plan = extractPlanFromMessage(messages[i])
    if (plan && plan.tasks.length > 0) {
      previousPlanTasks = plan.tasks
      break
    }
  }

  // 3. Check streaming turn (both prose and reasoning)
  if (streaming && streaming.length > 0) {
    const prose = streaming
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    const reasoning = streaming
      .filter((p) => p.type === 'reasoning')
      .map((p) => p.text)
      .join('\n')

    const isStoppedTurn =
      options.isStopped || prose.includes('_[stopped]_') || prose.includes('[stopped]')

    let isChecklist = true
    let extracted = extractMarkdownChecklist(prose)
    if (extracted.length === 0) {
      isChecklist = false
      extracted = extractPlainBulletPlan(prose, { isStreaming: true })
    }
    if (extracted.length === 0) {
      isChecklist = true
      extracted = extractMarkdownChecklist(reasoning)
    }
    if (extracted.length === 0) {
      isChecklist = false
      extracted = extractPlainBulletPlan(reasoning, { isStreaming: true })
    }

    // If streaming has no new plan, but previous turn had a plan, continue that plan
    if (extracted.length === 0 && previousPlanTasks.length > 0) {
      extracted = previousPlanTasks
    } else if (extracted.length > 0 && previousPlanTasks.length > 0) {
      // If it resumes with same steps, merge completed statuses and continue
      extracted = mergeResumedSteps(extracted, previousPlanTasks)
    }

    if (extracted.length > 0) {
      const priorTexts = messages.map((m) => (m.role === 'assistant' ? assistantTextOf(m) : ''))
      const withSignals = applyCompletionSignals(extracted, [...priorTexts, prose, reasoning])

      const toolParts = streaming.filter(
        (p): p is Extract<MessagePart, { type: 'tool' }> => p.type === 'tool'
      )
      const hasSummaryAtEnd = SUMMARY_HEADER_RE.test(prose) || SUMMARY_INTRO_RE.test(prose)
      const correlated = correlateStepStatuses(withSignals, toolParts, true, {
        isChecklist,
        hasSummaryAtEnd
      })
      const finalTasks = isStoppedTurn ? stopTasks(correlated) : correlated
      return buildSummary(finalTasks, 'markdown')
    }
  }

  // 4. If the most recent message is a user cancel, do not show previous plan
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.role === 'user') {
    const userText = typeof lastMsg.content === 'string' ? lastMsg.content : ''
    if (/^\s*(?:cancel|stop|abort|forget it|nevermind)\b/i.test(userText)) {
      return buildSummary([], 'none')
    }
  }

  // 5. Check assistant messages in history
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const plan = extractPlanFromMessage(msg)
    if (plan && plan.tasks.length > 0) {
      // Check if there was an earlier plan before this message to merge resumed steps
      let earlierTasks: SessionTask[] = []
      for (let j = i - 1; j >= 0; j--) {
        const earlierPlan = extractPlanFromMessage(messages[j])
        if (earlierPlan && earlierPlan.tasks.length > 0) {
          earlierTasks = earlierPlan.tasks
          break
        }
      }

      let merged = plan.tasks
      if (earlierTasks.length > 0) {
        merged = mergeResumedSteps(merged, earlierTasks)
      }

      const postPlanTexts = messages
        .slice(i)
        .map((m) => (m.role === 'assistant' ? assistantTextOf(m) : ''))
      const withSignals = applyCompletionSignals(merged, postPlanTexts)

      const msgToolParts =
        msg.parts?.filter((p): p is Extract<MessagePart, { type: 'tool' }> => p.type === 'tool') ??
        []
      const correlated = correlateStepStatuses(withSignals, msgToolParts, false, {
        isChecklist: plan.isChecklist,
        hasSummaryAtEnd: plan.hasSummaryAtEnd
      })

      const isStopped = options.isStopped || plan.isStopped
      const finalTasks = isStopped ? stopTasks(correlated) : correlated
      return buildSummary(finalTasks, 'markdown')
    }
  }

  // 5. Check for subagent tool calls (tool === 'task') in streaming or latest assistant turn
  const subagentParts: Extract<MessagePart, { type: 'tool' }>[] = []
  if (streaming && streaming.length > 0) {
    for (const part of streaming) {
      if (part.type === 'tool' && part.tool === 'task') {
        subagentParts.push(part)
      }
    }
  }
  if (subagentParts.length === 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.parts) {
        for (const part of msg.parts) {
          if (part.type === 'tool' && part.tool === 'task') {
            subagentParts.push(part)
          }
        }
        break
      }
    }
  }

  if (subagentParts.length > 0) {
    const subTasks: SessionTask[] = subagentParts.map((p) => {
      const title =
        p.title ||
        (typeof p.input?.description === 'string' ? p.input.description : 'Subagent task')
      const status: SessionTask['status'] =
        p.state === 'done' ? 'completed' : p.state === 'running' ? 'in_progress' : 'pending'
      return { title, status }
    })
    return buildSummary(subTasks, 'subagents')
  }

  return buildSummary([], 'none')
}
