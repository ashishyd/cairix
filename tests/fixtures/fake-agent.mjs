#!/usr/bin/env node
// Stand-in for `claude` / `cursor-agent` in stream-json mode. Behaviour is chosen by words in the prompt.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'fs'

const args = process.argv.slice(2)
// Cursor passes the prompt as an argument; Claude sends it on stdin.
const prompt = args[0] === '-p' && args[1] && !args[1].startsWith('--') ? args[1] : readFileSync(0, 'utf8')
if (process.env.CX_FAKE_LOG) {
  appendFileSync(process.env.CX_FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid, prompt, files: readdirSync('.') }) + '\n')
}
const out = (o) => console.log(JSON.stringify(o))
const tool = (name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })

out({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup' })
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the code.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } }] } })
out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'file contents' }] } })

if (prompt.includes('GARBAGE')) console.log('this is not json')
if (prompt.includes('NOISY')) for (let i = 0; i < 700; i++) tool('Grep', { pattern: `p${i}` })
if (prompt.includes('SLOW')) await new Promise((r) => setTimeout(r, 30_000))
if (prompt.includes('EDIT:')) {
  writeFileSync('agent-output.txt', 'written by agent\n')
  tool('Write', { file_path: 'agent-output.txt' })
}
if (prompt.includes('NOOP')) process.stderr.write('')
if (prompt.includes('CRASH')) { process.stderr.write('segfault-ish: ' + 'x'.repeat(50)); process.exit(3) }
if (prompt.includes('FAIL')) { out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Something went wrong' }); process.exit(1) }
if (prompt.includes('AUTH')) { out({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired' }); process.exit(1) }
out({ type: 'result', subtype: 'success', is_error: false, result: 'All done. Key was sk-ant-api03-abcdefghijklmnopqrstuvwxyz', total_cost_usd: 0.0123 })
