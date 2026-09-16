import assert from 'node:assert/strict'
import {
  parseTasksInput,
  extractMarkdownChecklist,
  extractPlainBulletPlan,
  extractAgentSteps,
  applyCompletionSignals,
  stripPlanSteps,
  mergeResumedSteps,
  stopTasks
} from '../src/renderer/src/lib/agent-steps'
import type { Chat, Message, MessagePart, SessionTask } from '../src/shared/types'

function testParseTasksInput(): void {
  // String array
  const strings = parseTasksInput(['Step 1', 'Step 2'])
  assert.equal(strings.length, 2)
  assert.equal(strings[0].title, 'Step 1')
  assert.equal(strings[0].status, 'pending')

  // Object array with various flags
  const objects = parseTasksInput([
    { title: 'Task 1', status: 'completed' },
    { title: 'Task 2', status: 'in_progress' },
    { text: 'Task 3', done: true },
    { name: 'Task 4', status: 'pending' }
  ])
  assert.equal(objects.length, 4)
  assert.equal(objects[0].status, 'completed')
  assert.equal(objects[1].status, 'in_progress')
  assert.equal(objects[2].status, 'completed')
  assert.equal(objects[3].status, 'pending')

  // Malformed / invalid
  assert.equal(parseTasksInput(null).length, 0)
  assert.equal(parseTasksInput('not an array').length, 0)
  assert.equal(parseTasksInput([{}]).length, 0)
}

function testExtractMarkdownChecklist(): void {
  const markdown = `
Here is my plan:
- [x] 1. Inspect existing files
- [/] 2. Modify component
- [ ] 3. Run typecheck and tests
  * [x] Subtask done
  1. [ ] Numbered task
Just some normal text.
- Regular bullet point
`
  const tasks = extractMarkdownChecklist(markdown)
  assert.equal(tasks.length, 5)
  assert.equal(tasks[0].title, '1. Inspect existing files')
  assert.equal(tasks[0].status, 'completed')
  assert.equal(tasks[1].status, 'in_progress')
  assert.equal(tasks[2].status, 'pending')
  assert.equal(tasks[3].status, 'completed')
  assert.equal(tasks[4].status, 'pending')
}

function testExtractAgentStepsFromChatTasks(): void {
  const dummyChat: Chat = {
    id: 'c1',
    title: 'Chat 1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main',
    tasks: [
      { title: 'Design database', status: 'completed' },
      { title: 'Implement migrations', status: 'in_progress' },
      { title: 'Write tests', status: 'pending' }
    ]
  }

  const summary = extractAgentSteps(dummyChat, [], null)
  assert.equal(summary.source, 'session_tasks')
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.completedCount, 1)
  assert.equal(summary.inProgressCount, 1)
  assert.equal(summary.pendingCount, 1)
  assert.equal(summary.progress, 33)
  assert.equal(summary.activeTask?.title, 'Implement migrations')
}

function testExtractAgentStepsFromStreamingTool(): void {
  const dummyChat: Chat = {
    id: 'c2',
    title: 'Chat 2',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main',
    tasks: []
  }

  const streamingParts: MessagePart[] = [
    {
      type: 'tool',
      tool: 'change_session_metadata',
      state: 'running',
      input: {
        tasks: [
          { title: 'Read file', status: 'completed' },
          { title: 'Edit code', status: 'in_progress' }
        ]
      }
    }
  ]

  const summary = extractAgentSteps(dummyChat, [], streamingParts)
  assert.equal(summary.source, 'streaming_tool')
  assert.equal(summary.totalCount, 2)
  assert.equal(summary.completedCount, 1)
  assert.equal(summary.inProgressCount, 1)
  assert.equal(summary.progress, 50)
  assert.equal(summary.activeTask?.title, 'Edit code')
}

function testExtractAgentStepsFromMarkdown(): void {
  const dummyChat: Chat = {
    id: 'c3',
    title: 'Chat 3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }

  const messages: Message[] = [
    {
      id: 'm1',
      chatId: 'c3',
      role: 'assistant',
      content: '- [x] Step A\n- [ ] Step B\n- [ ] Step C'
    }
  ]

  const summary = extractAgentSteps(dummyChat, messages, null)
  assert.equal(summary.source, 'markdown')
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.completedCount, 1)
  assert.equal(summary.pendingCount, 2)
  assert.equal(summary.progress, 33)
  assert.equal(summary.activeTask?.title, 'Step B')
}

function testExtractPlainBulletPlan(): void {
  const plainPlan = `
Plan:
- Fix IImages Not redendring
- Check if it compiles
- Do a last clean up
`
  const tasks = extractPlainBulletPlan(plainPlan)
  assert.equal(tasks.length, 3)
  assert.equal(tasks[0].title, 'Fix IImages Not redendring')
  assert.equal(tasks[1].title, 'Check if it compiles')
  assert.equal(tasks[2].title, 'Do a last clean up')

  const dummyChat: Chat = {
    id: 'c4',
    title: 'Chat 4',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }

  const messages: Message[] = [
    {
      id: 'm2',
      chatId: 'c4',
      role: 'assistant',
      content: plainPlan
    }
  ]

  const summary = extractAgentSteps(dummyChat, messages, null)
  assert.equal(summary.source, 'markdown')
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.tasks[0].title, 'Fix IImages Not redendring')
  assert.equal(summary.tasks[1].title, 'Check if it compiles')
  assert.equal(summary.tasks[2].title, 'Do a last clean up')
}

function testIgnoreSummaryAtEnd(): void {
  const summaryText = `
Done — components/page-status.njk has been fully reworked. Summary of what changed:

Design (more modern + simpler)

- Card grid -> clean list layout: heavy 140px image cards with background overlays were replaced with compact rows
- New "All systems operational" banner at the top
- Dropdown filter -> pill chips for category filtering
- Slimmer palette: removed the unused surface/shadow/glow variables
- Status badges -> status dots: small colored dots with the status text
- Refresh button now has an icon and a spin animation while loading
- Added prefers-reduced-motion support.

Code (much simpler)

- Dropped ~250 lines
- Rewrote rendering to use textContent
- Replaced the multi-function cache helpers
`
  const dummyChat: Chat = {
    id: 'c5',
    title: 'Chat 5',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }

  const messages: Message[] = [
    {
      id: 'm5',
      chatId: 'c5',
      role: 'assistant',
      content: summaryText
    }
  ]

  const summary = extractAgentSteps(dummyChat, messages, null)
  assert.equal(summary.totalCount, 0)
  assert.equal(summary.source, 'none')
}

function testSimpleQueryNoSteps(): void {
  const simpleText = `The dev server is listening on port 3000.`
  const dummyChat: Chat = {
    id: 'c6',
    title: 'Chat 6',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }
  const messages: Message[] = [
    {
      id: 'm6',
      chatId: 'c6',
      role: 'assistant',
      content: simpleText
    }
  ]
  const summary = extractAgentSteps(dummyChat, messages, null)
  assert.equal(summary.totalCount, 0)
  assert.equal(summary.source, 'none')
}

function testPlanWithSummaryAtEnd(): void {
  const fullText = `
- [ ] Inspect existing component
- [ ] Refactor layout to compact list
- [ ] Add reduced-motion support

I will start by inspecting the component...

Done — components/page-status.njk has been fully reworked. Summary of what changed:
- Card grid -> clean list layout
- Added prefers-reduced-motion support
`
  const dummyChat: Chat = {
    id: 'c7',
    title: 'Chat 7',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }
  const messages: Message[] = [
    {
      id: 'm7',
      chatId: 'c7',
      role: 'assistant',
      content: fullText
    }
  ]
  const summary = extractAgentSteps(dummyChat, messages, null)
  // Must use the 3 planned steps from the start, NOT the summary at the end!
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.tasks[0].title, 'Inspect existing component')
  assert.equal(summary.tasks[1].title, 'Refactor layout to compact list')
  assert.equal(summary.tasks[2].title, 'Add reduced-motion support')
  assert.equal(summary.completedCount, 3) // all finished cleanly
}

function testExtractAgentStepsEmpty(): void {
  const summary = extractAgentSteps(undefined, [], null)
  assert.equal(summary.source, 'none')
  assert.equal(summary.totalCount, 0)
  assert.equal(summary.progress, 0)
  assert.equal(summary.activeTask, null)
}

function testPendingStepsStayPending(): void {
  const dummyChat: Chat = {
    id: 'c8',
    title: 'Chat 8',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }
  const pendingText = `
Here is my plan:
- [ ] 1. Read files and locate imports
- [ ] 2. Refactor store subscription
- [ ] 3. Run test suite and check diagnostics
`
  const messages: Message[] = [
    {
      id: 'm8',
      chatId: 'c8',
      role: 'assistant',
      content: pendingText
    }
  ]
  const summary = extractAgentSteps(dummyChat, messages, null)
  assert.equal(summary.source, 'markdown')
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.completedCount, 0)
  assert.equal(summary.pendingCount, 3)
  assert.equal(summary.progress, 0)
  assert.equal(summary.activeTask?.title, '1. Read files and locate imports')
}

function testStripPlanSteps(): void {
  // Checklist with header
  const withHeader = `Here is what we should do:

### Plan:
- [ ] 1. Read files
- [ ] 2. Refactor code

Please review before proceeding.`
  assert.equal(
    stripPlanSteps(withHeader),
    'Here is what we should do:\n\nPlease review before proceeding.'
  )

  // Pure checklist with nothing else
  const pureChecklist = `- [ ] 1. Step A\n- [x] 2. Step B\n- [ ] 3. Step C`
  assert.equal(stripPlanSteps(pureChecklist), '')

  // Plain bullets under a plan header
  const bulletPlan = `Plan:
- Step 1
- Step 2

Please let me know.`
  assert.equal(stripPlanSteps(bulletPlan), 'Please let me know.')

  // Normal bullet list NOT under a plan header should be preserved
  const regularList = `Here are the features:
- Feature A
- Feature B`
  assert.equal(stripPlanSteps(regularList), regularList)

  // Checklist with emotion tags
  const emotionChecklist = `[confident] - [ ] Inspect workspace and available build tools
[confident] - [ ] Create Fabric 1.21.1 mod
[confident] - [ ] Build and verify mod artifact
[thoughtful] Starting workspace inspection. Mod needs server-authoritative block removal.

_[stopped]_`
  assert.equal(
    stripPlanSteps(emotionChecklist),
    `[thoughtful] Starting workspace inspection. Mod needs server-authoritative block removal.\n\n_[stopped]_`
  )

  // Doubled tokens checklist format
  const doubledChecklist = `-- [ [ ] ] Inspect Inspect workspace workspace and and available available build build tools tools
-- [ [ ] ] Create Create Fabric Fabric  11..2121..11 mod mod
StartingStarting workspace workspace inspection inspection..`
  assert.equal(
    stripPlanSteps(doubledChecklist),
    'StartingStarting workspace workspace inspection inspection..'
  )
}

function testStopPlanOnCancel(): void {
  const dummyChat: Chat = {
    id: 'c9',
    title: 'Chat 9',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }

  // Assistant message stopped mid-way stops in-progress tasks to pending
  const stoppedMessages: Message[] = [
    {
      id: 'm9',
      chatId: 'c9',
      role: 'assistant',
      content:
        'Here is my plan:\n- [x] 1. Inspect workspace\n- [/] 2. Create Fabric mod\n- [ ] 3. Build artifact\n\n_[stopped]_'
    }
  ]

  const stoppedSummary = extractAgentSteps(dummyChat, stoppedMessages, null)
  assert.equal(stoppedSummary.totalCount, 3)
  assert.equal(stoppedSummary.completedCount, 1)
  assert.equal(stoppedSummary.inProgressCount, 0) // Stopped: in_progress became pending!
  assert.equal(stoppedSummary.pendingCount, 2)
  assert.equal(stoppedSummary.tasks[1].status, 'pending')

  // User explicitly typed "cancel" clears the plan
  const userCancelMessages: Message[] = [
    {
      id: 'm10',
      chatId: 'c9',
      role: 'assistant',
      content: 'Here is my plan:\n- [ ] 1. Do something\n- [ ] 2. Do something else'
    },
    {
      id: 'm11',
      chatId: 'c9',
      role: 'user',
      content: 'cancel'
    }
  ]

  const cancelSummary = extractAgentSteps(dummyChat, userCancelMessages, null)
  assert.equal(cancelSummary.totalCount, 0)
  assert.equal(cancelSummary.source, 'none')
}

function testResumeWithSameSteps(): void {
  const previousTasks: SessionTask[] = [
    { title: 'Inspect workspace and available build tools', status: 'completed' },
    { title: 'Create Fabric 1.21.1 mod', status: 'pending' },
    { title: 'Build and verify mod artifact', status: 'pending' }
  ]

  const newTurnTasks: SessionTask[] = [
    { title: '1. Inspect workspace and available build tools', status: 'pending' },
    { title: '2. Create Fabric 1.21.1 mod', status: 'pending' },
    { title: '3. Build and verify mod artifact', status: 'pending' }
  ]

  const merged = mergeResumedSteps(newTurnTasks, previousTasks)
  assert.equal(merged[0].status, 'completed') // Retains completed from earlier turn!
  assert.equal(merged[1].status, 'pending')
  assert.equal(merged[2].status, 'pending')

  // If new turn has completely different steps, do not merge
  const differentTasks: SessionTask[] = [
    { title: 'Fix CSS styling on header', status: 'pending' },
    { title: 'Update button colors', status: 'pending' }
  ]
  const notMerged = mergeResumedSteps(differentTasks, previousTasks)
  assert.equal(notMerged[0].status, 'pending')
  assert.equal(notMerged[1].status, 'pending')
}

function testApplyCompletionSignals(): void {
  const initialTasks: SessionTask[] = [
    { title: 'Inspect files', status: 'pending' },
    { title: 'Update store logic', status: 'pending' },
    { title: 'Run tests', status: 'pending' }
  ]

  // Inform Step 1 completed
  const res1 = applyCompletionSignals(initialTasks, [
    'Completed: Inspect files.\nStarting: Update store logic.'
  ])
  assert.equal(res1[0].status, 'completed')
  assert.equal(res1[1].status, 'in_progress')
  assert.equal(res1[2].status, 'pending')

  // Inform Step 2 completed via numbered step
  const res2 = applyCompletionSignals(res1, ['Step 2 is completed. Starting: Run tests.'])
  assert.equal(res2[0].status, 'completed')
  assert.equal(res2[1].status, 'completed')
  assert.equal(res2[2].status, 'in_progress')

  // Inform Step 3 completed
  const res3 = applyCompletionSignals(res2, ['Completed: Run tests. All done.'])
  assert.equal(res3[0].status, 'completed')
  assert.equal(res3[1].status, 'completed')
  assert.equal(res3[2].status, 'completed')

  // Test across multiple turns via extractAgentSteps
  const dummyChat: Chat = {
    id: 'c10',
    title: 'Chat 10',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspacePath: '/ws',
    kind: 'main'
  }

  const messages: Message[] = [
    {
      id: 'm1',
      chatId: 'c10',
      role: 'assistant',
      content: 'Plan:\n- [ ] Inspect files\n- [ ] Update store logic\n- [ ] Run tests'
    },
    {
      id: 'm2',
      chatId: 'c10',
      role: 'assistant',
      content: 'Completed: Inspect files.\nStarting: Update store logic.'
    }
  ]

  const summary = extractAgentSteps(dummyChat, messages, null)
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.completedCount, 1)
  assert.equal(summary.inProgressCount, 1)
  assert.equal(summary.pendingCount, 1)
  assert.equal(summary.progress, 33)
  assert.equal(summary.tasks[0].status, 'completed')
  assert.equal(summary.tasks[1].status, 'in_progress')
  assert.equal(summary.tasks[2].status, 'pending')
}

function testDeduplicateRepeatedChecklists(): void {
  // Scenario: Agent outputs initial checklist, runs tools, then outputs updated checklist with step 1 completed
  const repeatedText = `Plan:
- [ ] Inspect files
- [ ] Update store logic
- [ ] Run tests

I'm inspecting the files...

Completed: Inspect files
- [x] Inspect files
- [ ] Update store logic
- [ ] Run tests`

  const tasks = extractMarkdownChecklist(repeatedText)
  assert.equal(tasks.length, 3)
  assert.equal(tasks[0].title, 'Inspect files')
  assert.equal(tasks[0].status, 'completed')
  assert.equal(tasks[1].title, 'Update store logic')
  assert.equal(tasks[1].status, 'pending')
  assert.equal(tasks[2].title, 'Run tests')
  assert.equal(tasks[2].status, 'pending')

  // Scenario: Single completed checklist item emitted after initial plan with Step 1 prefix
  const partialRepeat = `Plan:
- [ ] Inspect files
- [ ] Update store logic
- [ ] Run tests

Tool finished.
- [x] Step 1: Inspect files`

  const partialTasks = extractMarkdownChecklist(partialRepeat)
  assert.equal(partialTasks.length, 3)
  assert.equal(partialTasks[0].status, 'completed')
  assert.equal(partialTasks[1].status, 'pending')
  assert.equal(partialTasks[2].status, 'pending')

  // Scenario: stripPlanSteps strips both initial checklist and repeated checklist
  const stripped = stripPlanSteps(repeatedText)
  assert.ok(!stripped.includes('- [ ]'))
  assert.ok(!stripped.includes('- [x]'))
  assert.ok(stripped.includes("I'm inspecting the files..."))
  assert.ok(stripped.includes('Completed: Inspect files'))
}

function main(): void {
  testParseTasksInput()
  testExtractMarkdownChecklist()
  testExtractPlainBulletPlan()
  testIgnoreSummaryAtEnd()
  testSimpleQueryNoSteps()
  testPlanWithSummaryAtEnd()
  testExtractAgentStepsFromChatTasks()
  testExtractAgentStepsFromStreamingTool()
  testExtractAgentStepsFromMarkdown()
  testPendingStepsStayPending()
  testStripPlanSteps()
  testStopPlanOnCancel()
  testResumeWithSameSteps()
  testExtractAgentStepsEmpty()
  testApplyCompletionSignals()
  testDeduplicateRepeatedChecklists()
  console.log('✓ All agent steps tests passed')
}

main()
