/**
 * Token → USD cost math, shared by the main-process recorder and the tests.
 * Isomorphic (no Node/Electron): pure functions over plain data.
 *
 * `ModelCost` is USD per 1,000,000 tokens (the unit models.dev reports), split
 * by kind. We charge cache-read at its own (cheaper) rate and fall back to the
 * input rate when a provider doesn't break cache pricing out.
 */
import type { ModelCost } from './api'
import type {
  TokenUsage,
  UsageRecord,
  UsageStats,
  ProviderUsage,
  UsageDay,
  UsageBucket
} from './types'

/** An empty usage tally (all zeros, real not estimated). */
export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, estimated: false }
}

/** Sum two usage tallies; the result is estimated if EITHER side was. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
    estimated: a.estimated || b.estimated
  }
}

/**
 * The `usage` object an OpenAI-compatible endpoint sends. Providers agree on
 * `prompt_tokens` but each reports its prompt cache under a different field.
 */
export interface OpenAiCompatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
  /** DeepSeek. */
  prompt_cache_hit_tokens?: number
  /** Moonshot / Kimi. */
  cached_tokens?: number
  /** Anthropic-shaped fields some gateways (LiteLLM) pass through. */
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

const count = (n: unknown): number => (typeof n === 'number' && n > 0 ? n : 0)

/**
 * Normalise an OpenAI-compatible `usage` into `TokenUsage`. Every variant counts
 * cached tokens inside `prompt_tokens`, so they are subtracted back out to keep
 * `input` fresh-only, matching the other paths.
 */
export function openAiCompatUsage(u: OpenAiCompatUsage): TokenUsage {
  const cacheRead =
    count(u.prompt_tokens_details?.cached_tokens) ||
    count(u.prompt_cache_hit_tokens) ||
    count(u.cached_tokens) ||
    count(u.cache_read_input_tokens)
  const cacheWrite =
    count(u.prompt_tokens_details?.cache_write_tokens) || count(u.cache_creation_input_tokens)
  return {
    input: Math.max(0, count(u.prompt_tokens) - cacheRead - cacheWrite),
    output: count(u.completion_tokens),
    cacheRead,
    cacheWrite,
    reasoning: count(u.completion_tokens_details?.reasoning_tokens),
    estimated: false
  }
}

/** Total billable tokens for a call (fresh input + cache + output; reasoning is part of output). */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

/**
 * Price one call's usage in USD. Returns 0 when no pricing is known (so the UI
 * can treat cost as a floor rather than inventing a number). Reasoning tokens
 * are billed as output — providers already fold them into `output`, so we only
 * add them when they were reported separately AND not already inside `output`.
 */
export function usageCost(u: TokenUsage, cost: ModelCost | undefined): number {
  if (!cost) return 0
  const perM = (tokens: number, rate: number | undefined): number =>
    rate && tokens ? (tokens / 1_000_000) * rate : 0
  const inputRate = cost.input
  const cacheReadRate = cost.cacheRead ?? cost.input // fall back to input if not split
  const cacheWriteRate = cost.cacheWrite ?? cost.input
  return (
    perM(u.input, inputRate) +
    perM(u.output, cost.output) +
    perM(u.cacheRead, cacheReadRate) +
    perM(u.cacheWrite, cacheWriteRate)
  )
}

/** True when a model has at least one usable price (so cost math means something). */
export function isPriced(cost: ModelCost | undefined): boolean {
  return (
    !!cost &&
    (typeof cost.input === 'number' ||
      typeof cost.output === 'number' ||
      typeof cost.cacheRead === 'number' ||
      typeof cost.cacheWrite === 'number')
  )
}

// ---- Aggregation (pure, shared by the service + tests) ----------------------

/** Local YYYY-MM-DD for an epoch-ms timestamp (uses the host's timezone). */
export function localDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Billable tokens for one record (matches `totalTokens` but over a record). */
function recordTokens(r: UsageRecord): number {
  return r.input + r.output + r.cacheRead + r.cacheWrite
}

/** Build a 30-entry daily series (oldest→newest) from records, zero-filled. */
function dailySeries(records: UsageRecord[], now: number): UsageDay[] {
  const byDay = new Map<string, { tokens: number; cost: number }>()
  for (const r of records) {
    const key = localDay(r.createdAt)
    const cur = byDay.get(key) ?? { tokens: 0, cost: 0 }
    cur.tokens += recordTokens(r)
    cur.cost += r.cost
    byDay.set(key, cur)
  }
  const days: UsageDay[] = []
  const DAY = 24 * 60 * 60 * 1000
  for (let i = 29; i >= 0; i--) {
    const key = localDay(now - i * DAY)
    const v = byDay.get(key) ?? { tokens: 0, cost: 0 }
    days.push({ date: key, tokens: v.tokens, cost: v.cost })
  }
  return days
}

/** Sum a bucket over a record set. */
function bucket(records: UsageRecord[]): UsageBucket {
  let tokens = 0
  let cached = 0
  let cost = 0
  for (const r of records) {
    tokens += recordTokens(r)
    cached += r.cacheRead
    cost += r.cost
  }
  return { tokens, cached, cost, calls: records.length }
}

/** Most-used model (by token volume) across a record set, or null. */
function topModel(records: UsageRecord[]): string | null {
  const byModel = new Map<string, number>()
  for (const r of records) byModel.set(r.model, (byModel.get(r.model) ?? 0) + recordTokens(r))
  let best: string | null = null
  let bestTokens = -1
  for (const [model, tokens] of byModel) {
    if (tokens > bestTokens) {
      best = model
      bestTokens = tokens
    }
  }
  return best
}

/**
 * Roll usage records (last 30 days) into the dashboard payload: an Overview plus
 * one tab per provider that has records. Pure so the smoke tests can pin the math
 * without a DB. `now` and `todayStart` are injected for deterministic tests.
 */
export function aggregateUsage(
  records: UsageRecord[],
  providerNames: Record<string, string>,
  now: number,
  todayStart: number
): UsageStats {
  const today = records.filter((r) => r.createdAt >= todayStart)
  // Seven local calendar days, today included - matches the graph's day buckets.
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000
  const week = (recs: UsageRecord[]): UsageRecord[] => recs.filter((r) => r.createdAt >= weekStart)
  const overview = {
    today: bucket(today),
    last30d: bucket(records),
    last7d: bucket(week(records)),
    topModel7d: topModel(week(records)),
    topModel: topModel(records),
    daily: dailySeries(records, now),
    hasEstimates: records.some((r) => r.estimated),
    hasUnpriced: records.some((r) => r.cost === 0 && recordTokens(r) > 0)
  }

  const byProvider = new Map<string, UsageRecord[]>()
  for (const r of records) {
    const arr = byProvider.get(r.providerId) ?? []
    arr.push(r)
    byProvider.set(r.providerId, arr)
  }

  const providers: ProviderUsage[] = [...byProvider.entries()]
    .map(([providerId, recs]) => ({
      providerId,
      name: providerNames[providerId] ?? providerId,
      today: bucket(recs.filter((r) => r.createdAt >= todayStart)),
      last30d: bucket(recs),
      last7d: bucket(week(recs)),
      topModel7d: topModel(week(recs)),
      topModel: topModel(recs),
      daily: dailySeries(recs, now),
      hasEstimates: recs.some((r) => r.estimated),
      hasUnpriced: recs.some((r) => r.cost === 0 && recordTokens(r) > 0)
    }))
    // Busiest provider first (by 30-day cost, then tokens).
    .sort((a, b) => b.last30d.cost - a.last30d.cost || b.last30d.tokens - a.last30d.tokens)

  return { overview, providers }
}
