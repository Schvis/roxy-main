import assert from 'node:assert/strict'
import { AgentNotificationTracker } from '../src/shared/agent-notifications'

const done = new AgentNotificationTracker()
done.apply({ type: 'text', delta: 'Work completed.' })
assert.equal(done.finish(true, false), 'done')
assert.equal(done.finish(false, false), 'action')
assert.equal(done.finish(true, true), null)
assert.equal(done.finish(false, true), null)

const question = new AgentNotificationTracker()
question.apply({ type: 'text', delta: '<agent-question>{"question":"Which database?",' })
question.apply({ type: 'text', delta: '"options":["SQLite","PostgreSQL"]}</agent-question>' })
assert.equal(question.finish(true, false), 'input')

const freeform = new AgentNotificationTracker()
freeform.apply({ type: 'text', delta: 'What project path should I use?' })
assert.equal(freeform.finish(true, false), 'input')
const signoff = new AgentNotificationTracker()
signoff.apply({ type: 'text', delta: 'Done. Anything else?' })
assert.equal(signoff.finish(true, false), 'done')
const noChoices = new AgentNotificationTracker()
noChoices.apply({
  type: 'text',
  delta: '<agent-question>{"question":"Enter project path"}</agent-question>'
})
assert.equal(noChoices.finish(true, false), 'input')

const terminal = new AgentNotificationTracker()
terminal.apply({ type: 'tool-start', callId: 'cmd', tool: 'bash' })
terminal.apply({ type: 'tool-delta', callId: 'cmd', chunk: 'Continue? [Y/' })
assert.equal(terminal.pollInput(), false)
terminal.apply({ type: 'tool-delta', callId: 'cmd', chunk: 'n] ' })
assert.equal(terminal.pollInput(), true)
assert.equal(terminal.pollInput(), false)
terminal.apply({ type: 'tool-delta', callId: 'cmd', chunk: '\r\nInstalling...' })
assert.equal(terminal.pollInput(), false)
terminal.apply({ type: 'tool-delta', callId: 'cmd', chunk: '\r\nContinue? [Y/n] ' })
assert.equal(terminal.pollInput(), true)
terminal.apply({ type: 'tool-end', callId: 'cmd', output: 'Continue? [Y/n]', ok: true })
assert.equal(terminal.pollInput(), false)

const nonCommand = new AgentNotificationTracker()
nonCommand.apply({ type: 'tool-start', callId: 'read', tool: 'read' })
nonCommand.apply({ type: 'tool-delta', callId: 'read', chunk: 'Continue? [Y/n] ' })
assert.equal(nonCommand.pollInput(), false)
console.log('Agent notification tracker: passed')
