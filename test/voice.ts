import assert from 'node:assert/strict'
import { DEFAULT_VOICE, VOICE_MODELS, mergeVoiceDraft, normalizeVoice } from '../src/shared/voice'
import { DEFAULT_WAKE_WORDS, matchWakeWord } from '../src/shared/voice-handsfree'

for (const value of [undefined, null, false, '', {}, { enabled: 'true' }, { enabled: 1 }]) {
  assert.equal(normalizeVoice(value).enabled, false)
}
assert.deepEqual(normalizeVoice(null), DEFAULT_VOICE)
assert.deepEqual(normalizeVoice({ hotkeys: [' Ctrl+Space ', 42, 'ignored'] }).hotkeys, [
  'Ctrl+Space',
  ''
])
assert.equal(normalizeVoice({ modelId: '../../model' }).modelId, null)
assert.equal(
  normalizeVoice({ microphone: { id: 'a', name: 'b', occurrence: -1 } }).microphone,
  null
)
assert.equal(
  normalizeVoice({ microphone: { id: 'a', name: 'b', occurrence: 1 } }).microphone?.id,
  'a'
)
assert.equal(normalizeVoice({ enabled: true, modelId: VOICE_MODELS[0].id }).enabled, true)
assert.equal(VOICE_MODELS.length, 2)
for (const model of VOICE_MODELS) {
  assert.match(model.id, /streaming/)
  assert.match(model.revision, /^[a-f0-9]{40}$/)
  assert.equal(model.files.length, 4)
  for (const file of model.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
    assert(file.bytes > 0)
    assert(!file.name.includes('/'))
  }
}

let current = 'Existing draft'
const range = { start: current.length, text: '' }
for (const snapshot of ['hello', 'hello world', 'hello', 'hello world.']) {
  const result = mergeVoiceDraft(current, range, snapshot)!
  assert(result)
  current = result.value
  range.text = result.text
}
assert.equal(current, 'Existing draft hello world.')
assert.equal(
  mergeVoiceDraft(current + ' typed after', range, 'new words')?.value,
  'Existing draft new words typed after'
)
assert.equal(mergeVoiceDraft('Existing draft changed by user', range, 'replacement'), null)
assert.deepEqual(mergeVoiceDraft('', { start: 0, text: '' }, 'hello'), {
  value: 'hello',
  text: 'hello'
})
assert.equal(
  mergeVoiceDraft('before after', { start: 7, text: '' }, 'voice')?.value,
  'before voice after'
)
assert.equal(
  mergeVoiceDraft('hello voice after', { start: 6, text: 'voice ' }, '')?.value,
  'hello after'
)
assert.equal(
  mergeVoiceDraft('draft ', { start: 6, text: '' }, '\u4f60\u597d')?.value,
  'draft \u4f60\u597d'
)
assert.equal(mergeVoiceDraft('short', { start: 99, text: '' }, 'voice'), null)

// Hands-free settings default off; wake phrases are bounded and never empty.
assert.equal(normalizeVoice(null).autoSend, false)
assert.equal(normalizeVoice(null).wakeWord, false)
assert.equal(normalizeVoice(null).holdKey, 'Alt+V')
assert.equal(normalizeVoice({ holdKey: '' }).holdKey, '')
assert.deepEqual(normalizeVoice({ wakeWords: [] }).wakeWords, DEFAULT_WAKE_WORDS)
assert.deepEqual(normalizeVoice({ wakeWords: [' Hey Jarvis ', 'hey jarvis', 4] }).wakeWords, [
  'hey jarvis'
])
assert.equal(
  normalizeVoice({ wakeWords: Array.from({ length: 50 }, (_, i) => `w${i}`) }).wakeWords.length,
  20
)
assert(normalizeVoice(null).wakeWords !== DEFAULT_WAKE_WORDS, 'Defaults are copied, not shared')

assert.deepEqual(matchWakeWord('Hey Roxy, what is the weather in Paris?'), {
  matched: true,
  query: 'what is the weather in Paris?'
})
assert.deepEqual(matchWakeWord('hey roxy'), { matched: true, query: '' })
assert.deepEqual(matchWakeWord('Roxy roxy, run tests.'), { matched: true, query: 'run tests.' })
assert.deepEqual(matchWakeWord('Um, hey Rocky open the file'), {
  matched: true,
  query: 'open the file'
})
assert.deepEqual(matchWakeWord('hey jarvis do it', ['hey jarvis']), {
  matched: true,
  query: 'do it'
})
assert.equal(matchWakeWord('hello there').matched, false)
assert.equal(matchWakeWord('').matched, false)
console.log(
  'VOICE OK: default-off normalization, streaming catalog, revision snapshots, range conflicts, Unicode, wake phrases'
)
