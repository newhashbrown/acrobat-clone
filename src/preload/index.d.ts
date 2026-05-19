import type { AkvApi } from './index'

declare global {
  interface Window {
    akv: AkvApi
  }
}

export {}
