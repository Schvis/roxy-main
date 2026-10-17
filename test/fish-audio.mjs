import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const source = read('../src/main/services/tts.ts')
const start = source.indexOf('export async function synthesizeFishAudio(')
const end = source.indexOf('export async function synthesizeOpenaiAudio(', start)
assert.ok(start >= 0 && end > start)
const { code } = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' })
const requests = []
const module = { exports: {} }
new Function('module', 'exports', 'fetch', 'stripEmotionTags', 'appendTtsServerLog', code)(
  module,
  module.exports,
  async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) })
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  },
  (text) => text.replace(/\[[a-zA-Z\s-]+\]\s*/g, '').replace(/\[question\d*\]/gi, ''),
  () => {}
)
const settings = {
  fishAudioApiKey: 'test-key',
  fishAudioModel: 's2.1-pro',
  fishAudioVoice: 'voice-id',
  ttsSpeed: 15
}
for (const text of ['Hello world.', '[happy] Hello world.']) {
  const audio = await module.exports.synthesizeFishAudio(text, settings)
  assert.deepEqual([...audio], [1, 2, 3])
  const request = requests.at(-1)
  assert.equal(request.url, 'https://api.fish.audio/v1/tts')
  assert.deepEqual(request.body, {
    text: 'Hello world.',
    format: 'mp3',
    prosody: { speed: 1.15 },
    reference_id: 'voice-id'
  })
  assert.equal(request.headers.model, 's2.1-pro')
}
await assert.rejects(
  module.exports.synthesizeFishAudio('Hello.', { ...settings, fishAudioApiKey: '' }),
  /API key is not configured/
)
for (const path of [
  '../src/shared/prompt.ts',
  '../src/main/harness/agent.ts',
  '../src/renderer/src/lib/store.ts',
  '../src/renderer/src/routes/Settings.tsx',
  '../src/shared/types.ts',
  '../src/main/services/tts.ts'
]) {
  assert.doesNotMatch(
    read(path),
    /FISH_AUDIO_EMOTION|ttsShowEmotions|setTtsShowEmotions|ensureEmotionTags|detectFishAudioEmotion/
  )
}
console.log(
  'Fish Audio: plain speech, legacy tag cleanup, and emotion option/prompt removal passed'
)
