/**
 * Model-aware system-prompt assembly, mirroring opencode's `session/system.ts`
 * (github.com/sst/opencode, MIT). The tuned per-model prompt TEXT lives in
 * `resources/prompts/<name>.txt` and is supplied by `prompt-text.ts` (which does
 * the bundler `?raw` imports).
 *
 * This module is deliberately PURE string logic — it imports no assets — so it is
 * safe to pull into the main-process harness and the esbuild-bundled smoke test,
 * neither of which can process Vite's `?raw` imports.
 */

/** The tuned prompt families roxy vendors from opencode (one per model style). */
export type PromptName =
  | 'anthropic'
  | 'beast'
  | 'codex'
  | 'gpt'
  | 'gemini'
  | 'kimi'
  | 'trinity'
  | 'default'

/**
 * Pick the tuned system prompt for a model id, mirroring opencode's `provider()`
 * selector: gpt-4/o1/o3 get the "beast" prompt; other gpt (codex vs plain),
 * gemini, claude, trinity, and kimi models get their family prompt; everything
 * else falls back to the default prompt.
 */
export function selectPromptName(modelId: string | undefined): PromptName {
  const id = (modelId ?? '').toLowerCase()
  if (id.includes('gpt-4') || id.includes('o1') || id.includes('o3')) return 'beast'
  if (id.includes('gpt')) return id.includes('codex') ? 'codex' : 'gpt'
  if (id.includes('gemini')) return 'gemini'
  if (id.includes('claude')) return 'anthropic'
  if (id.includes('trinity')) return 'trinity'
  if (id.includes('kimi')) return 'kimi'
  return 'default'
}

/** Facts about the machine/session the model is running in (for the `<env>` block). */
export interface EnvironmentInfo {
  /** The session's working directory (workspace folder). */
  cwd?: string
  /** The repo/worktree root, when it differs from `cwd`. */
  worktree?: string
  /** Whether `cwd` sits inside a git repository. */
  isGitRepo?: boolean
  /**
   * The dev-server port this session owns, when it has one.
   *
   * PORT is exported into every command Roxy spawns, but plenty of projects
   * hardcode a port in vite.config.ts / next.config.js and ignore it — so the
   * model is told the number outright and can pass `--port` itself. Without
   * this, parallel sessions silently fight over :3000.
   */
  devPort?: number
  /** `process.platform` (e.g. "darwin", "win32", "linux"). */
  platform?: string
  /** The active model id (e.g. "claude-sonnet-4"). */
  modelId?: string
  /** The connected provider id (e.g. "github-copilot"). */
  providerId?: string
  /** A human date string, e.g. `new Date().toDateString()`. */
  date?: string
}

/**
 * Render the environment grounding opencode appends to every system prompt so the
 * model knows where it's running. Mirrors opencode's `system.ts` environment():
 * a natural-language model-identity sentence followed by an `<env>` block (cwd,
 * workspace root, git, platform, date). Only the fields that are provided are
 * emitted; an empty info object yields "".
 */
export function buildEnvironment(env: EnvironmentInfo): string {
  const sections: string[] = []

  // Model identity as a sentence (mirrors opencode) — models ground on this
  // phrasing better than a bare key/value line inside the env block.
  if (env.modelId) {
    const exactId = env.providerId ? `${env.providerId}/${env.modelId}` : env.modelId
    sections.push(
      `You are powered by the model named ${env.modelId}. The exact model ID is ${exactId}.`
    )
  }

  const inner: string[] = []
  if (env.cwd) inner.push(`  Working directory: ${env.cwd}`)
  if (env.worktree && env.worktree !== env.cwd)
    inner.push(`  Workspace root folder: ${env.worktree}`)
  if (env.isGitRepo !== undefined)
    inner.push(`  Is directory a git repo: ${env.isGitRepo ? 'yes' : 'no'}`)
  if (env.devPort)
    inner.push(
      `  Dev server port: ${env.devPort} (use this port for dev servers; other sessions own other ports)`
    )
  if (env.platform) inner.push(`  Platform: ${env.platform}`)
  if (env.date) inner.push(`  Today's date: ${env.date}`)
  if (inner.length > 0) {
    sections.push(
      [
        'Here is some useful information about the environment you are running in:',
        '<env>',
        ...inner,
        '</env>'
      ].join('\n')
    )
  }

  return sections.join('\n')
}

/** The pieces that make up a full system prompt, assembled in a stable order. */
export interface AssembleInput {
  /** The tuned per-model base prompt text. */
  base: string
  /** The rendered `<env>` block (see {@link buildEnvironment}). */
  environment?: string
  /** A compaction summary of earlier conversation, if the chat was compacted. */
  contextSummary?: string
  /** Extra sections (e.g. AGENTS.md instructions) appended after the base prompt. */
  extra?: string[]
}

/**
 * Roxy's commit co-author identity. Mirrors how GitHub Copilot attributes its
 * work with a `Co-authored-by` trailer, so commits Roxy helps write render as
 * "<you> and Roxy" on GitHub. This is the single source of truth for the
 * identity — change this one line to rebrand it.
 *
 * The address is the GitHub-provided noreply email for the dedicated
 * @roxy-commits account (`<id>+<login>@users.noreply.github.com`). Using that
 * exact form is what makes GitHub link the co-author to the profile and render
 * its avatar — the same trick Copilot's `223556219+Copilot@users.noreply.github.com`
 * trailer uses. (A branded address like `noreply@roxy.gg` would only show an
 * avatar if it were added and verified on the account first.) So the avatar that
 * appears is simply whatever profile picture is uploaded to @roxy-commits.
 */
export const ROXY_COAUTHOR_TRAILER =
  'Co-authored-by: Roxy <299891354+roxy-commits@users.noreply.github.com>'

/**
 * The system-prompt instruction that tells the model to append {@link
 * ROXY_COAUTHOR_TRAILER} to commits it authors — the same mechanism Copilot CLI
 * uses to co-author every commit. Kept as a standalone block so it reads clearly
 * in the assembled prompt and can be reused by the subagent prompt path. Phrased
 * conditionally ("When you create a git commit") so it never conflicts with the
 * tuned prompts that forbid committing unless the user asks.
 */
export const GIT_COMMIT_TRAILER_PROMPT = [
  '<git_commit_trailer>',
  'When you create a git commit, add the following Co-authored-by trailer at the end of the commit message so the work is attributed to Roxy, unless the user explicitly asks you not to:',
  '',
  ROXY_COAUTHOR_TRAILER,
  '</git_commit_trailer>'
].join('\n')

/**
 * System-prompt instruction for Fish Audio emotion control (Method 2: stream-filtered tags).
 * Instructs model to prefix conversational sentences with emotional tone tags that the TTS
 * streamer strips before rendering in chat.
 */
export const FISH_AUDIO_EMOTION_PROMPT = [
  '# Emotion Tags (MANDATORY)',
  'You must prefix EVERY sentence or thought in your response with a Fish Audio emotion tag in square brackets matching the sentiment and tone of that sentence.',
  '',
  'Available emotion tags:',
  '- Positive & Engaging: [happy], [cheerful], [delighted], [excited], [enthusiastic], [proud], [satisfied], [grateful], [hopeful], [optimistic], [relaxed], [friendly], [moved]',
  '- Technical & Assertive: [confident], [thoughtful], [determined], [focused], [curious], [intrigued], [reassuring], [calm]',
  '- Uncertainty & Surprise: [surprised], [confused], [uncertain], [doubtful], [nervous], [anxious], [worried], [nostalgic]',
  '- Distress & Negative: [sad], [unhappy], [disappointed], [upset], [frustrated], [depressed], [angry], [scared], [hysterical], [pessimistic], [lonely], [bored], [resigned]',
  '- Social & Interpersonal: [empathetic], [sympathetic], [compassionate], [embarrassed], [regretful], [guilty], [ashamed], [sarcastic], [disdainful], [contemptuous], [disgusted], [jealous], [envious], [indifferent]',
  '- Tone & Delivery: [whispering], [soft tone], [shouting], [screaming], [in a hurry tone]',
  '- Human Audio Effects: [laughing], [chuckling], [sighing], [groaning], [gasping], [yawning], [panting], [sobbing], [crying loudly], [clear throat]',
  '',
  'Rules:',
  '1. Every sentence outside code blocks MUST start with an emotion tag in square brackets, e.g. [confident], [thoughtful], [determined], [cheerful].',
  '2. Choose the emotion tag that best matches the active tone and intent of each sentence.',
  '3. DIVERSITY & NATURAL EXPRESSION (CRITICAL): Avoid repeatedly using [calm]. In voice synthesis, [calm] sounds flat and monotonous. Use expressive and dynamic emotions:',
  '   - Explanations, technical analysis, or showing code: use [thoughtful], [confident], or [focused].',
  '   - Taking action, proposing fixes, next steps: use [determined] or [confident].',
  '   - Confirming success, completions, positive results: use [satisfied], [happy], or [proud].',
  '   - Asking questions, exploring alternatives: use [curious] or [intrigued].',
  '   - Casual conversation, greetings, assistance: use [cheerful], [friendly], or [relaxed].',
  '   - Reserve [calm] ONLY for genuinely soothing, quiet, or meditative moments.',
  '4. Never put emotion tags inside code blocks (``` or `), markdown tables, shell commands, or URLs.',
  '',
  'Examples:',
  "- [cheerful] Hello! Let's inspect the recent changes.",
  '- [thoughtful] The issue occurs because the stream buffers before flushing.',
  '- [determined] I will update the configuration and run the test suite.',
  '- [confident] Here is the updated implementation:',
  '- [satisfied] All tests pass without any warnings.',
  '- [curious] Would you like me to proceed with the refactor?'
].join('\n')

/**
 * System-prompt instruction for planning and task tracking.
 * Instructs the model to output a concise markdown checklist plan at the start of non-trivial turns,
 * skip planning for simple/trivial single-step tasks, and never emit a new plan/checklist at the end.
 */
export const AGENT_PLAN_PROMPT = [
  '# Planning & Task Tracking',
  'When a task requires multiple steps, complex modifications, refactoring, or running multiple tools:',
  '- Initial Plan: Before taking action, output a concise plan at the beginning of your response using a markdown checklist (`- [ ] <step>`). All initial steps MUST be `- [ ]` (pending). Keep each step brief, specific, and actionable (typically 2–5 steps).',
  '- Inform Step Completion (MANDATORY): Whenever you finish a step, you MUST explicitly inform the user by stating `Completed: <step>` (e.g. `Completed: Inspect files`). Do NOT repeat or re-output the full plan checklist when steps finish. Simply announce completion of the finished step so the UI plan checklist updates automatically. Do this immediately as each step finishes, before starting the next step or concluding your turn. Never move to the next step without explicitly reporting completion of the finished step.',
  '- In-Progress Steps: Inform the user when each step starts (e.g. `Starting: <step>`). NEVER mark steps completed in advance before actually executing and finishing them.',
  '- High-Impact Changes: When the task involves a lot of changes (modifying multiple files, major refactoring, deleting/creating files):',
  '  1. Give the plan to the user with a concise summary of what you are going to do and allow or cancel decisions.',
  '  2. If you need user input or decisions, use the `<agent-question>` tag to present options.',
  '- Simple Tasks: If the request is simple, trivial, or a quick single-step action (answering a question, reading a file, minor edit), do NOT output a checklist.',
  '- Final Summary: Do NOT output an unchecked checklist at the end. When all steps are done, state what was completed and provide a concise summary of changes.'
].join('\n')

/**
 * System-prompt instruction for asking questions and presenting options to the user.
 * Instructs model to output a structured `<agent-question>` JSON block when it needs user decisions.
 */
export const AGENT_QUESTIONS_PROMPT = [
  '# Asking User Questions & Options',
  'When you need input, decisions, preferences, or choices from the user before proceeding:',
  '- MANDATORY STOP & WAIT: Whenever you ask questions with `<agent-question>`, you MUST STOP and end your turn immediately. NEVER invoke any tools in the same turn. You must wait for the user to select options or provide input.',
  '- Do NOT output questions as plain conversational chat text.',
  '- Output an `<agent-question>` XML tag containing a valid JSON array of questions.',
  '- Multilingual: Regardless of the conversation language (English, Chinese, Japanese, Spanish, French, German, Russian, etc.), you MUST ALWAYS output interactive questions using the `<agent-question>` XML tag. The tag name and JSON keys (`question`, `header`, `options`, `label`, `description`) remain in English; the text values must match the user’s language.',
  '- Each question in the array must be an object with:',
  '  - "question": string (the clear question prompt for the user)',
  '  - "header": optional string (short category or topic, <= 30 characters, e.g. "Database", "Styling")',
  '  - "options": array of 2 to 6 suggested choices. Each option can be an object `{"label": string, "description"?: string}` or a simple string.',
  '- Multiple questions: When you have multiple questions or decisions, include them ALL as separate items in the JSON array. The user interface paginates them and allows the user to answer them one by one.',
  '- Custom input: The user interface automatically provides a custom input option for every question, so you do NOT need to include an option like "Other" or "Custom".',
  '- Chat display: The `<agent-question>` block is hidden from the chat transcript and directly triggers the interactive questionnaire form in the user interface. Do not repeat the questions outside the tag.',
  '',
  'Example format:',
  '<agent-question>',
  '[',
  '  {',
  '    "header": "Database",',
  '    "question": "Which database would you like to use for this project?",',
  '    "options": [',
  '      { "label": "SQLite", "description": "Zero-config local file database" },',
  '      { "label": "PostgreSQL", "description": "Full-featured relational database" }',
  '    ]',
  '  },',
  '  {',
  '    "header": "ORM",',
  '    "question": "Which database client or ORM should we use?",',
  '    "options": [',
  '      { "label": "Prisma", "description": "Type-safe ORM with automated migrations" },',
  '      { "label": "Drizzle", "description": "Lightweight SQL-like schema builder" }',
  '    ]',
  '  }',
  ']',
  '</agent-question>'
].join('\n')

/** Join the base prompt, environment, any extra sections, and a compaction summary. */
export function assembleSystemPrompt(input: AssembleInput): string {
  const sections: (string | undefined)[] = [
    input.base,
    input.environment,
    ...(input.extra ?? []),
    AGENT_PLAN_PROMPT,
    AGENT_QUESTIONS_PROMPT,
    // Attribute Roxy on every commit the model writes (mirrors Copilot). Placed
    // after the base/env/extra so it sits with the standing instructions, and
    // before the compaction summary so the summary stays last.
    GIT_COMMIT_TRAILER_PROMPT,
    input.contextSummary
      ? `Summary of the earlier conversation (compacted to save context):\n${input.contextSummary}`
      : undefined
  ]
  return sections
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .join('\n\n')
}
