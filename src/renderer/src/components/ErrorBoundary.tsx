import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Last line of defence: a render bug shows a recoverable message, not a white window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Cairix UI error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="selectable mt-2 break-words text-cx-muted">{this.state.error.message}</p>
          <button onClick={() => location.reload()} className="mt-5 rounded-lg bg-cx-accent px-4 py-2 font-medium text-cx-accent-fg">
            Reload Cairix
          </button>
        </div>
      </div>
    )
  }
}
