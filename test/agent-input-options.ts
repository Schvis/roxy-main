import assert from 'node:assert/strict'
import {
  extractTerminalInputOptions,
  extractAgentQuestionOptions,
  stripAnsi,
  stripQuestionTags
} from '../src/renderer/src/lib/agent-input-options'
import type { Message } from '../src/shared/types'

function testStripAnsi(): void {
  const raw = '\x1b[32mSuccess\x1b[0m: done'
  assert.equal(stripAnsi(raw), 'Success: done')
}

function testStripQuestionTags(): void {
  // Closed tag
  const text1 = 'Here is the plan. <agent-question>[{"question":"Q1"}]</agent-question> Done.'
  assert.equal(stripQuestionTags(text1), 'Here is the plan.  Done.')

  // Unclosed streaming tag
  const text2 = 'Thinking... <agent-question>[{"question":'
  assert.equal(stripQuestionTags(text2), 'Thinking... ')

  // Pure question block
  const text3 = '<agent-question>[{"question":"Q1"}]</agent-question>'
  assert.equal(stripQuestionTags(text3).trim(), '')
}

function testTerminalInputOptions(): void {
  // Case 1: [Y/n]
  const opt1 = extractTerminalInputOptions('Do you want to continue? [Y/n] ')
  assert.equal(opt1.length, 2)
  assert.equal(opt1[0].value, 'y')
  assert.equal(opt1[0].isDefault, true)
  assert.equal(opt1[1].value, 'n')

  // Case 2: [y/N]
  const opt2 = extractTerminalInputOptions('Overwrite existing file? [y/N]:')
  assert.equal(opt2.length, 2)
  assert.equal(opt2[0].value, 'y')
  assert.equal(opt2[1].value, 'n')
  assert.equal(opt2[1].isDefault, true)

  // Case 3: [y/n/c]
  const opt3 = extractTerminalInputOptions('Apply changes? [y/n/c]')
  assert.equal(opt3.length, 3)
  assert.equal(opt3[0].value, 'y')
  assert.equal(opt3[1].value, 'n')
  assert.equal(opt3[2].value, 'c')
  assert.equal(opt3[2].label, 'Cancel (c)')

  // Case 4: Press enter to continue
  const opt4 = extractTerminalInputOptions('Configuration saved. Press [Enter] to continue...')
  assert.equal(opt4.length, 1)
  assert.equal(opt4[0].value, '')
  assert.equal(opt4[0].id, 'enter')

  // Case 5: Numbered choices
  const opt5 = extractTerminalInputOptions(`
Select template:
  1) React
  2) Vue
  3) Svelte
?
`)
  assert.equal(opt5.length, 3)
  assert.equal(opt5[0].value, '1')
  assert.equal(opt5[0].label, '1. React')
  assert.equal(opt5[1].value, '2')
  assert.equal(opt5[2].value, '3')

  // Case 6: Non-interactive command output (e.g. gradlew tasks) -> returns empty array
  const opt6 = extractTerminalInputOptions(
    'Running now: .\\gradlew.bat tasks--info\n> Task :tasks\nBUILD SUCCESSFUL in 1s'
  )
  assert.equal(opt6.length, 0)

  // Case 7: Empty output -> returns empty array
  assert.equal(extractTerminalInputOptions('').length, 0)
  assert.equal(extractTerminalInputOptions('   ').length, 0)

  // Case 8: PowerShell confirm prompt
  const opt8 = extractTerminalInputOptions(
    'Confirm\nAre you sure you want to perform this action?\n[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"):'
  )
  assert.equal(opt8.length, 4)
  assert.equal(opt8[0].value, 'y')
  assert.equal(opt8[0].isDefault, true)
  assert.equal(opt8[2].value, 'n')

  // Case 9: Batch job confirmation
  const opt9 = extractTerminalInputOptions('Terminate batch job (Y/N)? ')
  assert.equal(opt9.length, 2)
  assert.equal(opt9[0].value, 'y')
  assert.equal(opt9[1].value, 'n')
}

function testAgentQuestionOptions(): void {
  // Case 1: Streaming is active -> returns null
  const streamingMessages: Message[] = [
    {
      id: 'm1',
      chatId: 'c1',
      role: 'assistant',
      content: 'Which one?\n1. Option A\n2. Option B',
      parts: [],
      createdAt: Date.now()
    }
  ]
  assert.equal(extractAgentQuestionOptions(streamingMessages, true), null)

  // Case 2: Numbered options
  const msgNumbered: Message[] = [
    {
      id: 'm2',
      chatId: 'c1',
      role: 'assistant',
      content: `
I have two implementation approaches:
1. Use SQLite for local storage
2. Use IndexedDB for web storage
Which approach do you prefer?
`,
      parts: [],
      createdAt: Date.now()
    }
  ]
  const resNumbered = extractAgentQuestionOptions(msgNumbered, false)
  assert.ok(resNumbered)
  assert.equal(resNumbered.hasQuestion, true)
  assert.equal(resNumbered.options.length, 2)
  assert.equal(resNumbered.options[0].id, '1')
  assert.ok(resNumbered.options[0].label.includes('SQLite'))

  // Case 3: Bullets under question header
  const msgBullets: Message[] = [
    {
      id: 'm3',
      chatId: 'c1',
      role: 'assistant',
      content: `
Here are the available options:
- Keep existing styling
- Upgrade to Tailwind CSS v4
- Reset to default theme
`,
      parts: [],
      createdAt: Date.now()
    }
  ]
  const resBullets = extractAgentQuestionOptions(msgBullets, false)
  assert.ok(resBullets)
  assert.equal(resBullets.options.length, 3)
  assert.equal(resBullets.options[0].value, 'Keep existing styling')

  // Case 4: Confirmation question
  const msgConfirm: Message[] = [
    {
      id: 'm4',
      chatId: 'c1',
      role: 'assistant',
      content: 'The changes are ready. Would you like me to apply them now?',
      parts: [],
      createdAt: Date.now()
    }
  ]
  const resConfirm = extractAgentQuestionOptions(msgConfirm, false)
  assert.ok(resConfirm)
  assert.equal(resConfirm.options.length, 2)
  assert.equal(resConfirm.options[0].id, 'yes')
  assert.equal(resConfirm.options[1].id, 'no')

  // Case 5: Non-question message -> null
  const msgNormal: Message[] = [
    {
      id: 'm5',
      chatId: 'c1',
      role: 'assistant',
      content: 'All tasks completed successfully.',
      parts: [],
      createdAt: Date.now()
    }
  ]
  assert.equal(extractAgentQuestionOptions(msgNormal, false), null)

  // Case 6: Structured <agent-question> JSON with multiple questions
  const msgStructured: Message[] = [
    {
      id: 'm6',
      chatId: 'c1',
      role: 'assistant',
      content: `
Before proceeding, please answer these setup questions:
<agent-question>
[
  {
    "header": "Database",
    "question": "Which database would you prefer for this project?",
    "options": [
      { "label": "SQLite", "description": "Local embedded file" },
      { "label": "PostgreSQL", "description": "Full relational DB" }
    ]
  },
  {
    "header": "Auth",
    "question": "Which authentication provider do you prefer?",
    "options": ["NextAuth", "Clerk", "Custom JWT"]
  }
]
</agent-question>
`,
      parts: [],
      createdAt: Date.now()
    }
  ]
  const resStructured = extractAgentQuestionOptions(msgStructured, false)
  assert.ok(resStructured)
  assert.equal(resStructured.hasQuestion, true)
  assert.equal(resStructured.questions.length, 2)
  assert.equal(resStructured.questions[0].header, 'Database')
  assert.equal(resStructured.questions[0].options.length, 2)
  assert.equal(resStructured.questions[0].options[0].label, 'SQLite')
  assert.equal(resStructured.questions[0].options[0].description, 'Local embedded file')
  assert.equal(resStructured.questions[1].header, 'Auth')
  assert.equal(resStructured.questions[1].options.length, 3)
  assert.equal(resStructured.questions[1].options[0].label, 'NextAuth')
}

function run(): void {
  testStripAnsi()
  testStripQuestionTags()
  testTerminalInputOptions()
  testAgentQuestionOptions()
  console.log('agent-input-options tests passed')
}

run()
