export interface VoiceSettings {
  enabled: boolean
  modelId: string | null
  microphone: { id: string; name: string; occurrence: number } | null
  hotkeys: [string, string]
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
export const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  modelId: null,
  microphone: null,
  hotkeys: ['', ''],
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
export function normalizeVoice(value: unknown): VoiceSettings {
  if (!value || typeof value !== 'object')
    return { ...DEFAULT_VOICE, hotkeys: ['', ''], wakeWords: [...DEFAULT_WAKE_WORDS] }
  const v = value as Partial<VoiceSettings>
  const mic = v.microphone
  return {
    enabled: v.enabled === true,
    modelId: VOICE_MODELS.some((m) => m.id === v.modelId) ? v.modelId! : null,
    microphone:
      mic &&
      typeof mic.id === 'string' &&
      typeof mic.name === 'string' &&
      Number.isInteger(mic.occurrence) &&
      mic.occurrence >= 0
        ? { id: mic.id.slice(0, 1024), name: mic.name.slice(0, 512), occurrence: mic.occurrence }
        : null,
    hotkeys: [0, 1].map((i) =>
      typeof v.hotkeys?.[i] === 'string' ? v.hotkeys[i].trim().slice(0, 100) : ''
    ) as [string, string],
    holdKey: typeof v.holdKey === 'string' ? v.holdKey.trim().slice(0, 100) : DEFAULT_VOICE.holdKey,
    autoSend: v.autoSend === true,
    wakeWord: v.wakeWord === true,
    wakeWords: normalizeWakeWords(v.wakeWords)
  }
}

function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
export interface VoiceModelFile {
  name: string
  bytes: number
  sha256: string
}
export interface VoiceModel {
  id: string
  name: string
  description: 'parakeet' | 'nemotron'
  multilingual: boolean
  repository: string
  revision: string
  license: string
  licenseUrl: string
  files: readonly VoiceModelFile[]
}
// Only online exports. Ordinary Parakeet/Whisper files are not interchangeable.
export const VOICE_MODELS: readonly VoiceModel[] = [
  {
    id: 'parakeet-unified-en-streaming',
    name: 'Parakeet Unified EN 0.6B',
    description: 'parakeet',
    multilingual: false,
    repository: 'csukuangfj2/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms',
    revision: '7551fd26fc810cc1e4e043e608db4d13b59be31e',
    license: 'NVIDIA Open Model License',
    licenseUrl: 'https://huggingface.co/nvidia/parakeet-unified-en-0.6b',
    files: [
      {
        name: 'encoder.int8.onnx',
        bytes: 654046389,
        sha256: 'e566c3f014598a41724f2df028779a2d4cf7943cbefa324964f6a72e8ee255fb'
      },
      {
        name: 'decoder.int8.onnx',
        bytes: 7257777,
        sha256: '34fea72425d2506600772ba191a6d3f99c0710abdb68d9a3dc89fa8cb2aa473a'
      },
      {
        name: 'joiner.int8.onnx',
        bytes: 1735860,
        sha256: '869f43f7d24595c55581ad3bf249a935fb8a71389fbdaa7504b9f46f93140f8a'
      },
      {
        name: 'tokens.txt',
        bytes: 8952,
        sha256: 'dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff'
      }
    ]
  },
  {
    id: 'nemotron-streaming-3.5',
    name: 'Nemotron Streaming 3.5',
    description: 'nemotron',
    multilingual: true,
    repository: 'csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11',
    revision: 'ab43d895f5985b1bbab8b6eac8607fcdc05343f3',
    license: 'OpenMDW-1.1',
    licenseUrl: 'https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b',
    files: [
      {
        name: 'encoder.int8.onnx',
        bytes: 657601403,
        sha256: '012e9321373af99021415e0b0eb3ec827b4be3153be6f30d9b448fe65e896e68'
      },
      {
        name: 'decoder.int8.onnx',
        bytes: 14978075,
        sha256: '19f9c98fc6d0a2c33a65a43b36fdb2e914c26c0aa9764be3aebc502a1e982fb0'
      },
      {
        name: 'joiner.int8.onnx',
        bytes: 9504438,
        sha256: '4101c7c679a0bc30483794b27a059e34e79232aa2068d78d51231a22c8b0d7ce'
      },
      {
        name: 'tokens.txt',
        bytes: 131440,
        sha256: '729cc103155bafa785f9cd45746cd41cabe97eab7182fc04d594129587958f8a'
      }
    ]
  }
]
export type VoiceError =
  | 'disabled'
  | 'unsupported'
  | 'modelRequired'
  | 'permissionDenied'
  | 'deviceUnavailable'
  | 'captureFailed'
  | 'engineFailed'
  | 'tooSlow'
  | 'busy'
  | 'shortcutInvalid'
  | 'shortcutTaken'
  | 'downloadFailed'
  | 'integrityFailed'
  | 'unknown'
export interface VoiceDevice {
  id: string
  name: string
  occurrence: number
  isDefault: boolean
}
export interface VoiceState {
  settings: VoiceSettings
  supported: boolean
  permission: string
  installed: string[]
  download: { modelId: string; received: number; total: number } | null
  error: VoiceError | null
}
export type VoiceEvent =
  | { type: 'state'; state: VoiceState }
  | { type: 'toggle' }
  | { type: 'transcript'; recordingId: string; sequence: number; text: string }
  | {
      type: 'recording'
      recordingId: string
      phase: 'recording' | 'stopped'
      fallback?: boolean
      error?: VoiceError
    }
  /** Hands-free listening (wake word, VTuber conversation); one utterance per pause. */
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
export type VoiceResult<T = void> = { ok: true; value: T } | { ok: false; error: VoiceError }
// Replace only the verified dictation-owned range, never the whole draft.
export function mergeVoiceDraft(
  current: string,
  range: { start: number; text: string },
  transcript: string
): { value: string; text: string } | null {
  if (!Number.isInteger(range.start) || range.start < 0 || range.start > current.length) return null
  if (current.slice(range.start, range.start + range.text.length) !== range.text) return null
  const prefix = current.slice(0, range.start)
  const suffix = current.slice(range.start + range.text.length)
  const text =
    (transcript && prefix && !/\s$/.test(prefix) ? ' ' : '') +
    transcript +
    (transcript && suffix && !/^\s/.test(suffix) ? ' ' : '')
  return { value: prefix + text + suffix, text }
}
