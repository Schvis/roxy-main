/**
 * Subscription quota: how much of a sidecar-backed subscription is left.
 *
 * None of these upstreams expose quota through the OpenAI-compatible surface
 * the sidecar serves. Each has its own private usage endpoint, reached through
 * the sidecar's Management `api-call` passthrough so the OAuth token never
 * leaves the sidecar (it substitutes `$TOKEN$` itself). This module holds the
 * per-upstream request descriptions and response parsers; the main process only
 * does the transport.
 *
 * Isomorphic: types + pure helpers only, no Node or Electron.
 */
import type { CliProxyUpstream } from './cliproxy'

/** One quota window or per-model allowance. */
export interface QuotaBucket {
  /** Stable key within one upstream (`five_hour`, a model id, ...). */
  id: string
  /** Human label. Upstream-provided names are kept verbatim. */
  label: string
  /** Percent remaining, 0-100. */
  remaining: number
  /** When the window refills, epoch ms. */
  resetsAt?: number
  /**
   * Model ids this bucket applies to. Absent means it governs the whole
   * account (every model draws from it).
   */
  models?: string[]
  /**
   * Model-family substring (lowercase) this bucket applies to, for upstreams
   * that meter a family rather than exact ids (Claude's weekly Opus cap).
   */
  family?: string
  /**
   * Substrings (lowercase) of models this bucket never meters, e.g. Gemini's
   * separately metered weekly Argon pool. With no `family`, the bucket meters
   * every model outside these.
   */
  excludeFamilies?: string[]
}

/** Where a quota comes from: a sidecar upstream, or GitHub Copilot directly. */
export type QuotaSource = CliProxyUpstream | 'copilot'

/**
 * GitHub Copilot's monthly allowance. Two billing models are live:
 *
 *  - `credits` (usage-based, the default since June 2026): every token is
 *    priced per model in GitHub AI credits (1 credit = $0.01) and drawn from a
 *    monthly credit allowance.
 *  - `requests` (legacy annual plans): each prompt costs its model's premium
 *    request multiplier, overage billed at a flat rate per request.
 *
 * `entitlement`/`remaining`/`used`/`overageCount` are in the plan's own unit.
 */
export interface PremiumUsage {
  unit: 'credits' | 'requests'
  entitlement: number
  remaining: number
  used: number
  /** Units beyond the allowance this cycle, billed per `copilotUnitUsd`. */
  overageCount: number
  /** Whether the account may exceed the allowance (a budget is set) or is hard-capped. */
  overagePermitted: boolean
  unlimited: boolean
  /** No more paid usage this cycle: allowance spent and no overage budget. */
  blocked: boolean
}

/** One account's quota, as the renderer sees it. */
export interface ConnectionQuota {
  connectionId: string
  upstream: QuotaSource
  /** Subscription tier, when the upstream reports one (`plus`, `pro`, ...). */
  plan?: string
  buckets: QuotaBucket[]
  /** Copilot only. */
  premium?: PremiumUsage
  fetchedAt: number
  /** Set when nothing could be read; `buckets` is then empty. */
  error?: string
}

/**
 * Whether a provider seed is billed by plan allowance (and so gets the quota
 * pill) rather than per token, and how to label its accounts.
 */
export function planSource(
  seedId: string,
  upstreamOf: (seedId: string) => { upstream: CliProxyUpstream; accountLabel: string } | undefined
): { source: QuotaSource; accountLabel: string } | undefined {
  if (seedId === 'github-copilot') return { source: 'copilot', accountLabel: 'GitHub Copilot' }
  const spec = upstreamOf(seedId)
  return spec ? { source: spec.upstream, accountLabel: spec.accountLabel } : undefined
}

/** GitHub's published price per legacy premium request. */
export const COPILOT_OVERAGE_USD = 0.04
/** GitHub AI credit value: 1 credit = $0.01. */
export const COPILOT_CREDIT_USD = 0.01

export function copilotUnitUsd(unit: PremiumUsage['unit']): number {
  return unit === 'credits' ? COPILOT_CREDIT_USD : COPILOT_OVERAGE_USD
}
export const COPILOT_USER_URL = 'https://api.github.com/copilot_internal/user'

/** A request the sidecar performs on the account's behalf. */
export interface QuotaRequest {
  method: 'GET' | 'POST'
  url: string
  header: Record<string, string>
  data?: string
}

export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
/**
 * The grouped 5-hour/weekly limits Antigravity itself shows. Only the daily
 * endpoints reflect real usage; prod answers but reports every group full.
 */
export const ANTIGRAVITY_SUMMARY_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary'
]
/**
 * Per-model fallback for when the summary is unavailable. Tried in order: the
 * daily endpoints answer for accounts the prod one rejects.
 */
export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'
]
/**
 * Upstream gates models and quota groups on the client string: without `hub/`
 * the Argon group and models are omitted, and the version must be full semver
 * ("2.34" alone is treated as an old client).
 */
export const ANTIGRAVITY_USER_AGENT = 'antigravity/hub/2.34.0 windows/amd64'

/** `$TOKEN$` is replaced by the sidecar; the literal never reaches upstream. */
const BEARER = 'Bearer $TOKEN$'

/** The request(s) that read one upstream's quota, in fallback order. */
export function quotaRequests(
  upstream: CliProxyUpstream,
  opts: { accountId?: string } = {}
): QuotaRequest[] {
  switch (upstream) {
    case 'codex':
      return [
        {
          method: 'GET',
          url: CODEX_USAGE_URL,
          header: {
            Authorization: BEARER,
            'Content-Type': 'application/json',
            'User-Agent': 'codex_cli_rs/0.76.0 (Windows 10.0.26100; x86_64) WindowsTerminal',
            ...(opts.accountId ? { 'Chatgpt-Account-Id': opts.accountId } : {})
          }
        }
      ]
    case 'claude':
      return [
        {
          method: 'GET',
          url: CLAUDE_USAGE_URL,
          header: {
            Authorization: BEARER,
            'anthropic-beta': 'oauth-2025-04-20',
            Accept: 'application/json'
          }
        }
      ]
    case 'antigravity':
      // The grouped summary first; the per-model list only if it yields nothing.
      return [...ANTIGRAVITY_SUMMARY_URLS, ...ANTIGRAVITY_QUOTA_URLS].map((url) => ({
        method: 'POST' as const,
        url,
        header: {
          Authorization: BEARER,
          'Content-Type': 'application/json',
          'User-Agent': ANTIGRAVITY_USER_AGENT
        },
        data: '{}'
      }))
    default:
      return []
  }
}

// ---- Parsing -----------------------------------------------------------------

type Obj = Record<string, unknown>

function asObj(value: unknown): Obj | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(/%$/, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Accepts epoch seconds, epoch ms, or an ISO string. */
function toEpochMs(value: unknown): number | undefined {
  const n = num(value)
  if (n !== null && n > 0) return n < 1e11 ? n * 1000 : n
  if (typeof value === 'string' && value) {
    const t = Date.parse(value)
    if (Number.isFinite(t)) return t
  }
  return undefined
}

export interface ParsedQuota {
  plan?: string
  buckets: QuotaBucket[]
}

/** Label a Codex window by its length rather than its slot, when it says. */
function codexWindowLabel(seconds: number | null, fallback: string): string {
  if (!seconds) return fallback
  const hours = Math.round(seconds / 3600)
  if (hours >= 24 * 6 && hours <= 24 * 8) return 'Weekly'
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}-day`
  return `${hours}-hour`
}

/** ChatGPT's `/wham/usage`: rolling windows shared by every Codex model. */
export function parseCodexUsage(body: unknown, now = Date.now()): ParsedQuota {
  const payload = asObj(body)
  if (!payload) return { buckets: [] }
  const buckets: QuotaBucket[] = []
  const window = (id: string, fallback: string, raw: unknown): void => {
    const w = asObj(raw)
    if (!w) return
    const used = num(w.used_percent ?? w.usedPercent)
    let remaining: number
    if (used !== null) remaining = 100 - used
    else {
      const left = num(w.remaining_count ?? w.remainingCount)
      const total = num(w.total_count ?? w.totalCount)
      if (left === null || !total) return
      remaining = (left / total) * 100
    }
    const after = num(w.reset_after_seconds ?? w.resetAfterSeconds)
    const resetsAt =
      toEpochMs(w.reset_at ?? w.resetAt) ?? (after && after > 0 ? now + after * 1000 : undefined)
    const seconds = num(w.limit_window_seconds ?? w.limitWindowSeconds)
    buckets.push({
      id,
      label: codexWindowLabel(seconds, fallback),
      remaining: clampPct(remaining),
      ...(resetsAt ? { resetsAt } : {})
    })
  }
  const rl = asObj(payload.rate_limit ?? payload.rateLimit)
  if (rl) {
    window('primary', '5-hour', rl.primary_window ?? rl.primaryWindow)
    window('secondary', 'Weekly', rl.secondary_window ?? rl.secondaryWindow)
  }
  const plan = payload.plan_type ?? payload.planType
  return { ...(typeof plan === 'string' && plan ? { plan: plan.toLowerCase() } : {}), buckets }
}

/** Anthropic's `/api/oauth/usage`: `utilization` is percent USED. */
export function parseClaudeUsage(body: unknown): ParsedQuota {
  const payload = asObj(body)
  if (!payload) return { buckets: [] }
  const buckets: QuotaBucket[] = []
  const add = (key: string, label: string, family?: string): void => {
    const w = asObj(payload[key])
    const used = w ? num(w.utilization) : null
    if (!w || used === null) return
    const resetsAt = toEpochMs(w.resets_at ?? w.resetsAt)
    buckets.push({
      id: key,
      label,
      remaining: clampPct(100 - used),
      ...(resetsAt ? { resetsAt } : {}),
      ...(family ? { family } : {})
    })
  }
  add('five_hour', '5-hour')
  add('seven_day', 'Weekly')
  add('seven_day_opus', 'Weekly Opus', 'opus')
  add('seven_day_sonnet', 'Weekly Sonnet', 'sonnet')
  return { buckets }
}

type AntigravityGroup = 'argon' | 'gemini' | 'other'

/** Which model family an upstream quota group meters. Argon first: its name also says Gemini. */
function antigravityGroup(name: string): AntigravityGroup {
  const n = name.toLowerCase()
  if (n.includes('argon')) return 'argon'
  if (n.includes('gemini')) return 'gemini'
  return 'other'
}

const ANTIGRAVITY_GROUP_LABEL = {
  argon: 'Argon',
  gemini: 'Gemini',
  other: 'Claude & GPT'
} as const satisfies Record<AntigravityGroup, string>

/**
 * `retrieveUserQuotaSummary`: the grouped limits Antigravity's own UI shows.
 * Models in a group share a 5-hour and a weekly limit: one group for Gemini,
 * one for Claude and GPT, and on Pro plans a separate weekly Argon group (Ultra
 * plans fold Argon into the Gemini group, so it then meters Argon too).
 */
export function parseAntigravitySummary(body: unknown): ParsedQuota {
  const payload = asObj(body)
  const rawGroups = payload?.groups ?? asObj(payload?.quotaSummary)?.groups
  if (!Array.isArray(rawGroups)) return { buckets: [] }
  const groups = rawGroups.map(asObj).filter((g): g is Obj => !!g)
  const kind = (g: Obj): AntigravityGroup =>
    antigravityGroup(typeof g.displayName === 'string' ? g.displayName : '')
  const separateArgon = groups.some((g) => kind(g) === 'argon')

  const buckets: QuotaBucket[] = []
  for (const group of groups) {
    const family = kind(group)
    const scope: Pick<QuotaBucket, 'family' | 'excludeFamilies'> =
      family === 'argon'
        ? { family: 'argon' }
        : family === 'gemini'
          ? { family: 'gemini', ...(separateArgon ? { excludeFamilies: ['argon'] } : {}) }
          : { excludeFamilies: ['gemini'] }
    const windows: QuotaBucket[] = []
    for (const raw of Array.isArray(group.buckets) ? group.buckets : []) {
      const b = asObj(raw)
      if (!b) continue
      const id = typeof b.bucketId === 'string' && b.bucketId ? b.bucketId : null
      const window = String(b.window ?? '').toLowerCase()
      const weekly = window === 'weekly' || /weekly/i.test(String(id ?? ''))
      const fiveHour = window === '5h' || /(^|-)5h$/i.test(String(id ?? ''))
      if (!id || (!weekly && !fiveHour)) continue
      // Upstream disables the 5-hour window once the weekly one is spent; a
      // disabled weekly window is not in force at all.
      if (b.disabled === true && weekly) continue
      const resetsAt = toEpochMs(b.resetTime ?? b.reset_time)
      const fraction = num(b.remainingFraction ?? b.remaining_fraction)
      // Proto JSON drops a zero fraction, so a window with a reset but no
      // fraction is exhausted, not full.
      const remaining =
        b.disabled === true ? 0 : fraction !== null ? fraction * 100 : resetsAt ? 0 : null
      if (remaining === null) continue
      windows.push({
        id,
        label: `${ANTIGRAVITY_GROUP_LABEL[family]} ${weekly ? 'Weekly' : '5-hour'}`,
        remaining: clampPct(remaining),
        ...(resetsAt ? { resetsAt } : {}),
        ...scope
      })
    }
    // Shorter window first, as the other upstreams list them.
    windows.sort((a, b) => Number(/weekly/i.test(a.label)) - Number(/weekly/i.test(b.label)))
    buckets.push(...windows)
  }
  return { buckets }
}

/**
 * Fallback when the summary is unavailable: `fetchAvailableModels` reports one
 * entry per model id, folded here into the same families as the summary.
 */
const ANTIGRAVITY_POOLS = [
  { id: 'gemini', label: 'Gemini', family: 'gemini', excludeFamilies: ['argon'] },
  { id: 'gemini-argon', label: 'Argon Weekly', family: 'argon' },
  { id: 'non-gemini', label: 'Claude & GPT', excludeFamilies: ['gemini'] }
] as const

type AntigravityPool = (typeof ANTIGRAVITY_POOLS)[number]['id']

function antigravityPool(modelId: string): AntigravityPool {
  const id = modelId.toLowerCase()
  if (id.includes('argon')) return 'gemini-argon'
  if (id.startsWith('gemini')) return 'gemini'
  return 'non-gemini'
}

/** Cloud Code's `fetchAvailableModels`, folded into its shared pools. */
export function parseAntigravityModels(body: unknown): ParsedQuota {
  const perModel = parseAntigravityModelEntries(body)
  const buckets: QuotaBucket[] = []
  for (const pool of ANTIGRAVITY_POOLS) {
    const members = perModel.filter((b) => antigravityPool(b.id) === pool.id)
    if (!members.length) continue
    // A pool is only as full as its most drained member says it is.
    const tightest = members.reduce((min, b) =>
      b.remaining < min.remaining ||
      (b.remaining === min.remaining && (b.resetsAt ?? Infinity) < (min.resetsAt ?? Infinity))
        ? b
        : min
    )
    buckets.push({
      id: pool.id,
      label: pool.label,
      remaining: tightest.remaining,
      ...(tightest.resetsAt ? { resetsAt: tightest.resetsAt } : {}),
      models: [...new Set(members.flatMap((b) => b.models ?? [b.id]))],
      ...('family' in pool ? { family: pool.family } : {}),
      ...('excludeFamilies' in pool ? { excludeFamilies: [...pool.excludeFamilies] } : {})
    })
  }
  return { buckets }
}

/** One allowance per model id, as upstream reports them. */
function parseAntigravityModelEntries(body: unknown): QuotaBucket[] {
  const payload = asObj(body)
  const models = asObj(payload?.models)
  if (!models) return []
  const buckets: QuotaBucket[] = []
  for (const [key, raw] of Object.entries(models)) {
    const m = asObj(raw)
    if (!m || m.isInternal === true) continue
    // Autocomplete/tab and internal chat models aren't selectable in Roxy.
    if (key.startsWith('chat_') || key.startsWith('tab_')) continue
    const info = asObj(m.quotaInfo ?? m.quota_info)
    // No quota info means no metered allowance; listing it at 100% would be a guess.
    if (!info) continue
    const fraction = num(info.remainingFraction ?? info.remaining_fraction ?? info.remaining)
    const resetsAt = toEpochMs(info.resetTime ?? info.reset_time)
    // Upstream omits the fraction entirely once a model is exhausted.
    const remaining = fraction !== null ? fraction * 100 : resetsAt ? 0 : 100
    const name = m.displayName ?? m.display_name
    const isTiered = key.endsWith('-tiered')
    const base = isTiered ? key.slice(0, -'-tiered'.length) : key
    const modelKeys = isTiered
      ? [key, base, `${base}-high`, `${base}-medium`, `${base}-low`]
      : [key]
    const fallbackLabel = isTiered
      ? base
          .split('-')
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
          .join(' ')
      : key
    buckets.push({
      id: key,
      label: typeof name === 'string' && name ? name : fallbackLabel,
      remaining: clampPct(remaining),
      ...(resetsAt ? { resetsAt } : {}),
      models: modelKeys
    })
  }
  return buckets
}

export function parseQuota(
  upstream: CliProxyUpstream,
  body: unknown,
  now = Date.now()
): ParsedQuota {
  switch (upstream) {
    case 'codex':
      return parseCodexUsage(body, now)
    case 'claude':
      return parseClaudeUsage(body)
    case 'antigravity': {
      // One upstream, two endpoints: the grouped summary or the per-model list.
      const summary = parseAntigravitySummary(body)
      return summary.buckets.length ? summary : parseAntigravityModels(body)
    }
    default:
      return { buckets: [] }
  }
}

function copilotPlan(payload: Obj): string | undefined {
  const sku = String(payload.access_type_sku ?? '').toLowerCase()
  const plan = String(payload.copilot_plan ?? '').toLowerCase()
  if (sku.includes('enterprise') || plan === 'enterprise') return 'enterprise'
  if (sku.includes('business') || plan === 'business') return 'business'
  if (sku.includes('free_limited') || sku === 'free' || plan.includes('free')) return 'free'
  if (sku.includes('pro_plus') || plan.includes('pro_plus') || plan.includes('pro+')) return 'pro+'
  if (sku.includes('educational') || sku.includes('pro') || plan.includes('pro')) return 'pro'
  if (plan === 'individual') return 'pro'
  return plan || undefined
}

/**
 * `copilot_internal/user`: the monthly allowance that drives billing (AI
 * credits, or premium requests on legacy plans), plus chat/completion caps on
 * the Free plan. Field semantics follow VS Code's `parseQuotas`.
 */
export function parseCopilotUser(body: unknown): ParsedQuota & { premium?: PremiumUsage } {
  const payload = asObj(body)
  if (!payload) return { buckets: [] }
  const resetsAt = toEpochMs(
    payload.quota_reset_date_utc ?? payload.quota_reset_date ?? payload.limited_user_reset_date
  )
  const reset = resetsAt ? { resetsAt } : {}
  const buckets: QuotaBucket[] = []
  let premium: PremiumUsage | undefined

  const snaps = asObj(payload.quota_snapshots)
  const snapshot = (key: string, id: string, label: string): Obj | null => {
    const s = asObj(snaps?.[key])
    if (!s || s.unlimited === true) return s
    const pct = num(s.percent_remaining)
    const left = num(s.remaining)
    const total = num(s.entitlement)
    const remaining = pct ?? (left !== null && total ? (left / total) * 100 : null)
    if (remaining !== null) buckets.push({ id, label, remaining: clampPct(remaining), ...reset })
    return s
  }
  const credits = payload.token_based_billing === true
  const p = snapshot('premium_interactions', 'premium', credits ? 'AI credits' : 'Premium requests')
  snapshot('chat', 'chat', 'Chat messages')
  snapshot('completions', 'completions', 'Code completions')
  if (p) {
    const entitlement = num(p.entitlement) ?? 0
    // `quota_remaining` shares the entitlement's basis; `remaining` is the older name.
    const remaining = Math.max(0, num(p.quota_remaining) ?? num(p.remaining) ?? 0)
    // Credit plans report an absolute counter that keeps counting past the allowance.
    const creditsUsed = credits ? num(p.credits_used) : null
    const used = creditsUsed ?? Math.max(0, entitlement - remaining)
    premium = {
      unit: credits ? 'credits' : 'requests',
      entitlement,
      remaining,
      used,
      overageCount: Math.max(
        0,
        num(p.overage_count) ?? 0,
        // Only billable when the account may exceed; otherwise it's the last
        // request overshooting a hard cap, not a charge.
        creditsUsed !== null && entitlement > 0 && p.overage_permitted === true
          ? creditsUsed - entitlement
          : 0
      ),
      overagePermitted: p.overage_permitted === true,
      unlimited: p.unlimited === true,
      // Business/Enterprise: the org can switch usage off regardless of the numbers.
      blocked: p.has_quota === false && p.overage_permitted !== true
    }
  }

  // Free plan: remaining/total come as two parallel maps instead of snapshots.
  if (!snaps) {
    const left = asObj(payload.limited_user_quotas)
    const total = asObj(payload.monthly_quotas)
    for (const [key, label] of [
      ['chat', 'Chat messages'],
      ['completions', 'Code completions']
    ] as const) {
      const l = num(left?.[key])
      const t = num(total?.[key])
      if (l !== null && t)
        buckets.push({ id: key, label, remaining: clampPct((l / t) * 100), ...reset })
    }
  }

  const plan = copilotPlan(payload)
  return { ...(plan ? { plan } : {}), buckets, ...(premium ? { premium } : {}) }
}

/**
 * The account-wide buckets that meter a Copilot model. An included model (0x
 * multiplier on request plans) spends nothing from the allowance, so the
 * allowance doesn't constrain it.
 */
export function copilotBucketsForModel(
  quota: ConnectionQuota,
  multiplier: number | undefined
): QuotaBucket[] {
  const included = quota.premium?.unit !== 'credits' && multiplier === 0
  return quota.buckets
    .filter((b) => b.id !== 'completions' && !(b.id === 'premium' && included))
    .sort((a, b) => a.remaining - b.remaining)
}

/** Overage spend so far this cycle, USD. */
export function copilotOverageUsd(premium: PremiumUsage): number {
  return premium.overageCount * copilotUnitUsd(premium.unit)
}

/**
 * Copilot `/models` `billing.token_prices` -> USD per 1M tokens. GitHub quotes
 * AI credits per `batch_size` tokens (1 credit = $0.01).
 */
export function copilotTokenCost(
  billing: unknown
): { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined {
  const prices = asObj(asObj(billing)?.token_prices)
  const tier = asObj(prices?.default)
  if (!prices || !tier) return undefined
  const batch = num(prices.batch_size) ?? 1_000_000
  if (!(batch > 0)) return undefined
  const toUsdPerM = (v: unknown): number | undefined => {
    const n = num(v)
    return n === null || n < 0 ? undefined : n * (1_000_000 / batch) * COPILOT_CREDIT_USD
  }
  const cost = {
    input: toUsdPerM(tier.input_price),
    output: toUsdPerM(tier.output_price),
    cacheRead: toUsdPerM(tier.cache_read_price ?? tier.cache_price),
    cacheWrite: toUsdPerM(tier.cache_write_price)
  }
  const defined = Object.fromEntries(Object.entries(cost).filter(([, v]) => v !== undefined))
  return Object.keys(defined).length ? defined : undefined
}

/** A short, secret-free message for a failed upstream quota call. */
export function quotaErrorMessage(status: number, body: string): string {
  if (status === 401) return 'Sign-in expired. Reconnect this account.'
  if (status === 403) return 'This account cannot read its usage.'
  if (status === 429) return 'Usage lookup is rate limited. Try again shortly.'
  const obj = asObj(body)
  const err = asObj(obj?.error)
  const msg = err?.message ?? obj?.message ?? obj?.error
  const text = typeof msg === 'string' && msg ? msg : `HTTP ${status}`
  return text.length > 100 ? `${text.slice(0, 100)}...` : text
}

// ---- Model scoping -----------------------------------------------------------

function bareModel(model: string): string {
  // Strip a routing prefix (`roxy-<hash>/`) and any provider namespace.
  const slash = model.lastIndexOf('/')
  return (slash >= 0 ? model.slice(slash + 1) : model).toLowerCase()
}

/** Whether a bucket meters this model. Account-wide buckets meter every model. */
export function bucketAppliesTo(bucket: QuotaBucket, model: string | undefined): boolean {
  if (!bucket.models && !bucket.family && !bucket.excludeFamilies) return true
  if (!model) return false
  const bare = bareModel(model)
  if (bucket.excludeFamilies?.some((f) => bare.includes(f))) return false
  const listed = bucket.models?.some((m) => {
    const metered = bareModel(m)
    if (metered === bare) return true
    // Gemini tiered allowances cover every thinking level of the same model.
    if (!metered.startsWith('gemini-') || !metered.endsWith('-tiered')) return false
    const base = metered.slice(0, -'-tiered'.length)
    return bare.replace(/-(?:minimal|low|medium|high)$/, '').replace(/-tiered$/, '') === base
  })
  if (listed) return true
  if (bucket.family) return bare.includes(bucket.family)
  // Only exclusions: a catch-all for everything the excluded families don't cover.
  return !!bucket.excludeFamilies
}

/**
 * The buckets that constrain a model, tightest first. Falls back to the
 * account-wide ones when the model isn't individually metered.
 */
export function bucketsForModel(quota: ConnectionQuota, model: string | undefined): QuotaBucket[] {
  return quota.buckets
    .filter((b) => bucketAppliesTo(b, model))
    .sort((a, b) => a.remaining - b.remaining)
}
