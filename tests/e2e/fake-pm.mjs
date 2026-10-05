#!/usr/bin/env node
// A stand-in for npm/pnpm so dependency checks never touch the network. argv: <manager> <command> ...
const [, , , cmd] = process.argv
if (cmd === 'outdated') {
  console.log(JSON.stringify({ react: { current: '17.0.2', wanted: '17.0.2', latest: '19.0.0' }, 'left-pad': { current: '1.2.0', wanted: '1.3.0', latest: '1.3.0' } }))
  process.exit(1) // npm exits 1 when something is outdated
} else if (cmd === 'audit') {
  console.log(JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } }, vulnerabilities: { minimist: { severity: 'high', via: [{ title: 'Prototype Pollution in minimist' }] } } }))
  process.exit(1)
}
