import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // Tests that run real git start by resolving the login-shell environment (~2 s), which runs long when ~40 files share the CPU.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20_000 }
})
