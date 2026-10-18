/**
 * Fork additions to upstream's local voice (see docs/voice-hands-free.md):
 * hold-to-talk, auto-send, wake word and hands-free listeners. Kept apart from
 * voice.ts so upstream merges only meet the few `voice-handsfree` hook lines there.
 */
import type { VoiceError } from './voice'

/** Extra fields stored in upstream's `voice` settings row. */
export interface HandsFreeSettings {
  /** In-window shortcut held to dictate; releasing it finishes. Empty disables. */
  holdKey: string
  /** Send the composer draft when a dictation finishes with text. */
  autoSend: boolean
  /** Keep the microphone open and start dictation on a wake phrase. */
  wakeWord: boolean
  /** Extra wake phrases matched before the built-in "Hey Roxy" variants. */
  wakeWords: string[]
}
export const DEFAULT_WAKE_WORDS = ['hey roxy', 'roxy', 'hi roxy', 'ok roxy']
export const DEFAULT_HANDS_FREE: HandsFreeSettings = {
  holdKey: 'Alt+V',
  autoSend: false,
  wakeWord: false,
  wakeWords: DEFAULT_WAKE_WORDS
}
function normalizeWakeWords(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_WAKE_WORDS]
  const words = [
    ...new Set(
      value
        .filter((w): w is string => typeof w === 'string')
        .map((w) => w.trim().toLowerCase().slice(0, 60))
        .filter(Boolean)
    )
  ].slice(0, 20)
  return words.length ? words : [...DEFAULT_WAKE_WORDS]
}
export function normalizeHandsFree(value: unknown): HandsFreeSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<HandsFreeSettings>
  return {
    holdKey:
      typeof v.holdKey === 'string' ? v.holdKey.trim().slice(0, 100) : DEFAULT_HANDS_FREE.holdKey,
    autoSend: v.autoSend === true,
    wakeWord: v.wakeWord === true,
    wakeWords: normalizeWakeWords(v.wakeWords)
  }
}

/** Hands-free listening (wake word, VTuber conversation); one utterance per pause. */
export type HandsFreeEvent =
  | {
      type: 'listener'
      listenerId: string
      phase: 'listening' | 'speech' | 'processing' | 'stopped'
      error?: VoiceError
    }
  | { type: 'utterance'; listenerId: string; text: string }
export interface VoiceStartOptions {
  /** Finish on its own after a pause in speech (wake word, auto-send). */
  autoStop?: boolean
}

function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[,.?!:;'"_~`\-()¡¿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
// Built-in phonetic variants of "Hey Roxy" that streaming models commonly emit.
const WAKE_PREFIX =
  /^(?:hey|hi|ok|okay|oye|ey|hola|ay)?\s*(?:roxy|roxi|roxie|rocky|roki|rocsi|rossi|proxie|proxy|rox)(?:\s+|$)/
const WAKE_ANYWHERE =
  /(?:^|\b)(?:hey|hi|ok|okay|oye|ey|hola|ay)?\s*(?:roxy|roxi|roxie|rocky|roki|rocsi|rossi|proxie|proxy|rox)(?:\b|\s|$)/

/**
 * Find a wake phrase in a transcript. `query` is what was said after it, with
 * the transcript's own casing and punctuation; empty when only the phrase was said.
 */
export function matchWakeWord(
  text: string,
  wakeWords: readonly string[] = []
): { matched: boolean; query: string } {
  const found = findWake(text, wakeWords)
  if (!found.query) return found
  // Map the normalized query back onto the original words, from the end.
  const words = text.trim().split(/\s+/)
  const want = found.query.split(' ').length
  let tokens = 0
  let i = words.length
  while (i > 0 && tokens < want)
    tokens += normalizeSpeech(words[--i]).split(' ').filter(Boolean).length
  return { matched: true, query: tokens === want ? words.slice(i).join(' ') : found.query }
}
function findWake(text: string, wakeWords: readonly string[]): { matched: boolean; query: string } {
  let clean = normalizeSpeech(text)
  if (!clean) return { matched: false, query: '' }
  const phrases = wakeWords
    .map(normalizeSpeech)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((p) => new RegExp(`^(?:${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:\\s+|$)`))
  let matched = false
  // Strip repeated leading phrases ("roxy roxy", "hey roxy roxy").
  for (let changed = true; changed; ) {
    changed = false
    for (const regex of [...phrases, WAKE_PREFIX]) {
      if (regex.test(clean)) {
        clean = clean.replace(regex, '').trim()
        matched = changed = true
        break
      }
    }
  }
  if (matched) return { matched, query: clean }
  // Filler before the phrase ("um hey roxy ...").
  const found = clean.match(WAKE_ANYWHERE)
  if (found?.index === undefined) return { matched: false, query: '' }
  const after = clean.slice(found.index + found[0].length).trim()
  const rest = findWake(after, wakeWords)
  return { matched: true, query: rest.matched ? rest.query : after }
}
