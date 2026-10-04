import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** Optional button, e.g. "Force kill". */
  action?: { label: string; run: () => void }
}

interface ToastState {
  toasts: Toast[]
  push(message: string, kind?: ToastKind, action?: Toast['action']): void
  dismiss(id: number): void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info', action) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message, action }] }))
    // Toasts with an action stay long enough to be clicked.
    setTimeout(() => get().dismiss(id), action ? 9000 : kind === 'error' ? 6000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Convenience for non-component code. */
export const toast = {
  success: (m: string): void => useToastStore.getState().push(m, 'success'),
  error: (m: string): void => useToastStore.getState().push(m, 'error'),
  info: (m: string): void => useToastStore.getState().push(m, 'info')
}
