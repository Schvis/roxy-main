import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AGENTS } from '../src/shared/agents'
import { assembleSystemPrompt } from '../src/shared/prompt'
import { PartsFold } from '../src/shared/parts'
import type { Chat, Message } from '../src/shared/types'
import {
  parsePlan,
  parseQuestions,
  startsNewRequest,
  startsNewQueuedRequest,
  planToolGuidance,
  UPDATE_PLAN_DESCRIPTION
} from '../src/shared/interaction-tools'
import { askUser } from '../src/main/harness/interaction'
import { extractAgentSteps } from '../src/renderer/src/lib/agent-steps'
import { startToolRun, registerToolInput, writeToolInput } from '../src/main/services/tool-runs'

async function main(): Promise<void> {
  for (const agent of AGENTS) {
    const guidance = planToolGuidance(agent.tools)
    const available = agent.tools === 'all' || agent.tools.includes('update_plan')
    assert.equal(Boolean(guidance), available, `${agent.id}: guidance matches tool availability`)
    if (guidance) {
      assert.ok(guidance.includes(UPDATE_PLAN_DESCRIPTION))
      assert.match(guidance, /before starting substantive work/)
      assert.match(guidance, /Skip plans for simple questions, casual conversation/)
      assert.ok(guidance.length < 800, 'keep guidance brief')
      for (const family of ['anthropic', 'beast', 'codex', 'default', 'plan']) {
        const base = readFileSync(`resources/prompts/${family}.txt`, 'utf8')
        const prompt = assembleSystemPrompt({ base, extra: [guidance] })
        assert.ok(prompt.indexOf('<plan_tool>') > prompt.indexOf(base))
        assert.match(prompt, /instead of TodoWrite, markdown checklists, or private reasoning/)
      }
    }
  }
  // Guard both real prompt builders and the offered schema, not only the helper.
  const harness = readFileSync('src/main/harness/agent.ts', 'utf8')
  assert.match(harness, /planToolGuidance\(agent\?\.tools \?\? 'all'\)/)
  assert.match(harness, /planToolGuidance\(agent\.tools\)/)
  assert.match(harness, /'update_plan',\s+UPDATE_PLAN_DESCRIPTION/)

  // Exercise the same fold used by the harness, live store, and persisted transcript.
  const fold = new PartsFold()
  const plan = [
    { step: 'Inspect regression', status: 'in_progress' },
    { step: 'Verify fix', status: 'pending' }
  ]
  fold.apply({ type: 'tool-start', callId: 'plan-1', tool: 'update_plan', input: { plan } })
  let parts = fold.apply({ type: 'tool-end', callId: 'plan-1', ok: true, output: 'Updated' })
  assert.deepEqual(extractAgentSteps(undefined, [], parts).tasks, parsePlan(plan))
  fold.apply({ type: 'text', delta: 'All done!' })
  assert.equal(extractAgentSteps(undefined, [], fold.parts).completedCount, 0)
  const finished = plan.map((step) => ({ ...step, status: 'completed' }))
  fold.apply({
    type: 'tool-start',
    callId: 'plan-2',
    tool: 'update_plan',
    input: { plan: finished }
  })
  parts = fold.apply({ type: 'tool-end', callId: 'plan-2', ok: true, output: 'Updated' })
  assert.equal(extractAgentSteps(undefined, [], parts).completedCount, 2)
  const history = [{ role: 'assistant', parts: JSON.parse(JSON.stringify(parts)) }] as Message[]
  assert.equal(extractAgentSteps(undefined, history, null).completedCount, 2)
  // A new request without update_plan must suppress old tools AND legacy prose, even on reload.
  const cleared = { tasks: [], tasksInitialized: true } as unknown as Chat
  const oldHistory = [
    { role: 'assistant', content: 'Plan:\n- [ ] Old step', parts: [] },
    ...history,
    { role: 'user', content: 'Hello', parts: [] }
  ] as Message[]
  for (const streaming of [[], [{ type: 'text', text: 'Hello!' }], null] as (
    | Message['parts']
    | null
  )[]) {
    assert.equal(extractAgentSteps(cleared, oldHistory, streaming ?? null).totalCount, 0)
    assert.equal(
      extractAgentSteps(JSON.parse(JSON.stringify(cleared)), oldHistory, streaming ?? null)
        .totalCount,
      0
    )
  }
  assert.equal(
    extractAgentSteps(cleared, oldHistory, parts).completedCount,
    2,
    'new live plan wins'
  )
  assert.equal(
    extractAgentSteps({ ...cleared, tasks: parsePlan(plan) }, oldHistory, null).totalCount,
    2
  )
  assert.equal(startsNewQueuedRequest({ requestKind: 'interruption' }), false)
  assert.equal(startsNewQueuedRequest({ requestKind: 'new' }), true)
  assert.equal(
    startsNewRequest({ messages: [{ role: 'user' }], requestKind: 'interruption' }),
    false
  )
  assert.equal(startsNewRequest({ messages: [{ role: 'user' }], requestKind: 'new' }), true)
  assert.equal(startsNewQueuedRequest({}), true)
  assert.equal(startsNewQueuedRequest({ sourceChatId: 'caller' }), false)
  assert.equal(startsNewQueuedRequest({ sourceChatId: 'caller', fromUser: true }), true)
  assert.equal(startsNewRequest({ messages: [{ role: 'user' }] }), true)
  assert.equal(
    startsNewRequest({ messages: [{ role: 'tool' }] }),
    false,
    'question answer is a tool continuation'
  )
  assert.equal(startsNewRequest({ messages: [{ role: 'user' }], continueRequest: true }), false)
  fold.apply({ type: 'tool-start', callId: 'plan-3', tool: 'update_plan', input: { plan: [] } })
  parts = fold.apply({ type: 'tool-end', callId: 'plan-3', ok: true, output: 'Cleared' })
  assert.equal(extractAgentSteps(undefined, history, parts).totalCount, 0)
  assert.equal(
    extractAgentSteps(
      undefined,
      [],
      [
        { type: 'reasoning', text: 'Plan:\n- Inspect code\n- Implement fix\n- Test' },
        { type: 'text', text: '- Be concise\n- Use a friendly tone\n- Avoid jargon' }
      ]
    ).totalCount,
    0,
    'neither private plans nor ordinary preference lists create a plan'
  )
  assert.deepEqual(
    parsePlan([
      { step: 'Inspect', status: 'in_progress' },
      { step: 'Test', status: 'pending' }
    ]),
    [
      { title: 'Inspect', status: 'in_progress' },
      { title: 'Test', status: 'pending' }
    ]
  )
  assert.deepEqual(parsePlan([]), [])
  const summary = extractAgentSteps(
    undefined,
    [],
    [
      {
        type: 'tool',
        tool: 'update_plan',
        state: 'done',
        input: { plan: [{ step: 'Test', status: 'pending' }] }
      },
      { type: 'text', text: 'Completed: Test. All done!' }
    ]
  )
  assert.equal(summary.tasks[0].status, 'pending', 'prose cannot complete a structured step')
  assert.equal(
    extractAgentSteps(
      undefined,
      [],
      [{ type: 'tool', tool: 'update_plan', state: 'done', input: { plan: [] } }]
    ).totalCount,
    0
  )
  assert.throws(() => parsePlan([{ step: 'Bad', status: 'done' }]))
  assert.throws(() =>
    parsePlan([
      { step: 'A', status: 'in_progress' },
      { step: 'B', status: 'in_progress' }
    ])
  )
  assert.throws(() => parseQuestions([]))
  assert.throws(() => parseQuestions([{ question: '' }]))
  assert.throws(() => parseQuestions([{ question: 'Q', options: [{}] }]))
  assert.equal(parseQuestions([{ question: 'Q', options: ['Yes'] }])[0].options[0].value, 'Yes')

  const controller = new AbortController()
  const run = startToolRun({
    callId: 'question-test',
    tool: 'ask_user',
    sessionId: 'chat',
    cancel: () => controller.abort()
  })
  let completed = false
  const result = askUser(
    { questions: [{ question: 'First?' }, { question: 'Second?' }] },
    {
      cwd: '.',
      signal: controller.signal,
      onInputReady: (write) => registerToolInput('question-test', write)
    }
  ).then((value) => {
    completed = true
    return value
  })
  await Promise.resolve()
  assert.equal(completed, false, 'question must pause the runtime')
  assert.equal(writeToolInput('question-test', 'not json'), false)
  assert.equal(writeToolInput('question-test', '["one"]'), false)
  assert.equal(completed, false)
  assert.equal(writeToolInput('question-test', '["one","custom answer"]'), true)
  assert.equal((await result).ok, true)
  assert.equal(writeToolInput('question-test', '["one","two"]'), false)
  run.end()
  assert.equal(writeToolInput('question-test', 'late'), false)

  const abort = new AbortController()
  const pending = askUser(
    { questions: [{ question: 'Wait?' }] },
    { cwd: '.', signal: abort.signal, onInputReady: () => {} }
  )
  abort.abort()
  assert.equal((await pending).ok, false)
  const alreadyAborted = await askUser(
    { questions: [{ question: 'Wait?' }] },
    { cwd: '.', signal: abort.signal, onInputReady: () => {} }
  )
  assert.equal(alreadyAborted.ok, false)
  console.log(
    'interaction tools: validation, blocking, answers, stale input and cancellation passed'
  )
}
void main()
