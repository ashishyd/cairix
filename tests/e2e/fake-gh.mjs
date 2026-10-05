#!/usr/bin/env node
// A stand-in for the GitHub CLI: one open pull request with a failing check.
if (process.argv[2] === 'pr' && process.argv[3] === 'view') {
  console.log(JSON.stringify({
    number: 7, title: 'Add e2e coverage', url: 'https://github.com/example/repo/pull/7', state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED',
    statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }, { conclusion: 'FAILURE', status: 'COMPLETED' }, { status: 'IN_PROGRESS' }]
  }))
} else {
  console.error('fake gh: unsupported')
  process.exit(1)
}
