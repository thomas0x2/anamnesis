import type { Backend } from '../shared/types'

declare global {
  interface Window {
    anamnesis?: Backend
  }
}
export {}
