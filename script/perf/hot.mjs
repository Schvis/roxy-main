/**
 * Pure-Node benchmark for the per-token / per-frame hot paths that don't touch
 * Electron: the streamed-parts fold and the renderer's agent-steps extraction.
 *
 *   node script/perf/hot.mjs          (bundles with esbuild, then runs)
 *   npm run perf:hot
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'test/.out/perf'

async function bundle(entry, outfile) {
  mkdirSync(OUT, { recursive: true })
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile
  })
  return import(pathToFileURL(join(process.cwd(), outfile)).href)
}

function ms(fn) {
  const t = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - t) / 1e6
}

async function main() {
  const results = {}

  // ---------- 1. Streamed-parts fold ----------
  // A realistic long turn: many tool cards, then a long prose reply streamed in.
  const { PartsFold } = await bundle('src/shared/parts.ts', join(OUT, 'parts.cjs'))
  const { extractAgentSteps } = await bundle(
    'src/renderer/src/lib/agent-steps.ts',
    join(OUT, 'steps.cjs')
  )

  // Seed a fold with 200 tool cards, then stream 5000 text deltas (a long reply).
  function foldTurn(toolCards, tokens) {
    const fold = new PartsFold()
    for (let i = 0; i < toolCards; i++) {
      fold.apply({ type: 'tool-start', tool: 'bash', callId: 'c' + i, input: { command: 'ls' } })
      fold.apply({ type: 'tool-delta', callId: 'c' + i, chunk: 'some output line\n' })
      fold.apply({ type: 'tool-end', callId: 'c' + i, ok: true, output: 'done' })
    }
    fold.apply({ type: 'text', delta: 'Here is what I found: ' })
    for (let i = 0; i < tokens; i++) {
      fold.apply({ type: 'text', delta: 'word' + (i % 7) + ' ' })
    }
    return fold.parts
  }
  results['fold: 20 cards + 5000 tokens'] = ms(() => foldTurn(20, 5000))
  results['fold: 200 cards + 5000 tokens'] = ms(() => foldTurn(200, 5000))
  results['fold: 400 cards + 5000 tokens'] = ms(() => foldTurn(400, 5000))

  // ---------- 2. extractAgentSteps over a long transcript ----------
  // Build a History of N assistant messages, the last carrying a plan-ish body,
  // and call extractAgentSteps with a live streaming turn (as the popup does).
  function makeMessages(n) {
    const out = []
    for (let i = 0; i < n; i++) {
      const body = 'Some prose about the work. '.repeat(30)
      out.push({
        id: 'm' + i,
        chatId: 'chat',
        role: i % 2 ? 'assistant' : 'user',
        content: body,
        createdAt: i,
        parts: [
          { type: 'text', text: body },
          {
            type: 'tool',
            tool: 'bash',
            state: 'done',
            callId: 'c' + i,
            input: { command: 'ls' },
            output: 'out'
          }
        ]
      })
    }
    return out
  }
  const chat = { id: 'chat', tasks: [] }
  const streaming = [
    { type: 'text', text: '- [x] step one\n- [ ] step two\n- [~] step three\n' },
    ...Array.from({ length: 20 }, (_, i) => ({
      type: 'tool',
      tool: 'bash',
      state: 'done',
      callId: 's' + i,
      input: { command: 'ls' },
      output: 'out'
    }))
  ]
  const msgs200 = makeMessages(200)
  const msgs800 = makeMessages(800)
  results['extractAgentSteps: 200 msgs'] = ms(() => {
    for (let i = 0; i < 200; i++) extractAgentSteps(chat, msgs200, streaming, {})
  })
  results['extractAgentSteps: 800 msgs'] = ms(() => {
    for (let i = 0; i < 200; i++) extractAgentSteps(chat, msgs800, streaming, {})
  })

  console.log('\nHot-path benchmark (lower is better)')
  console.log('='.repeat(60))
  for (const [k, v] of Object.entries(results)) {
    console.log('  ' + k.padEnd(40) + v.toFixed(1).padStart(10) + ' ms')
  }
  console.log('='.repeat(60))
}

main().catch(async (e) => {
  const fs = await import('node:fs')
  const { mkdirSync } = await import('node:fs')
  mkdirSync('test/.out', { recursive: true })
  fs.writeFileSync('test/.out/perf-hot-err.txt', String(e?.stack ?? e))
  console.error(e)
  process.exit(1)
})
