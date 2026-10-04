#!/usr/bin/env node
// A stand-in for the `claude` CLI so end-to-end tests never spend money or need a login.
// Speaks the same envelope as `claude -p --output-format json`.
import { appendFileSync, readFileSync } from 'fs'
import { join } from 'path'

if (process.argv.includes('--version')) {
  console.log('9.9.9 (fake Claude)')
  process.exit(0)
}
const prompt = readFileSync(0, 'utf8')
const streaming = process.argv.includes('stream-json')
const envelope = (o) => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.004, ...o }))

if (streaming) {
  // Agent task (headless run): emit the same stream-json lines Claude Code does.
  const line = (o) => console.log(JSON.stringify(o))
  line({ type: 'system', subtype: 'hook_started' })
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the project.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'server.js' } }] } })
  if (prompt.includes('ADD A FILE')) {
    appendFileSync(join(process.cwd(), 'agent-note.txt'), 'written by the fake agent\n')
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'agent-note.txt' } }] } })
  }
  line({ type: 'result', subtype: 'success', is_error: false, result: prompt.includes('ADD A FILE') ? 'Added agent-note.txt.' : 'The project is a tiny HTTP server.', total_cost_usd: 0.002 })
} else if (prompt.includes('Fix exactly ONE problem')) {
  // Edit the file named in the prompt, inside the worktree we were started in.
  const file = prompt.match(/^File: (\S+)/m)?.[1]
  appendFileSync(join(process.cwd(), file), '// reviewed: input is validated\n')
  envelope({ result: 'Added a note.' })
} else {
  // Audit/review prompt: report one finding on the first file shown.
  const first = prompt.match(/^### (.+)$/m)?.[1]
  envelope({
    result: '',
    structured_output: first
      ? { findings: [{ file: first, line: 1, severity: 'warning', category: 'bugs', title: 'Missing input validation', explanation: 'Values from callers are used without checking them, so a bad value fails far from its cause.', learnTopic: 'async' }] }
      : { findings: [] }
  })
}
