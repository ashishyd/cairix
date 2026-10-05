#!/usr/bin/env node
// A stand-in for `cursor`/`code`: records what it was asked to open instead of launching an editor.
import { appendFileSync } from 'fs'
appendFileSync(process.env.CAIRIX_FAKE_EDITOR_LOG, JSON.stringify(process.argv.slice(2)) + '\n')
