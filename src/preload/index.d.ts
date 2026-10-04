import type { CairixAPI } from '@shared/api'

declare global {
  interface Window {
    cairix: CairixAPI
  }
}

export {}
