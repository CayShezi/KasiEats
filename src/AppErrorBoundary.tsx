import { Component, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  errorMessage: string | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    errorMessage: null,
  }

  static getDerivedStateFromError(error: Error) {
    return {
      errorMessage: error.message || 'Unknown client error.',
    }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('KasiRunner render failure', error, info.componentStack)
  }

  render() {
    if (this.state.errorMessage) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: '#1b120b',
            color: '#fff7ed',
            fontFamily: "'Aptos', 'Segoe UI', sans-serif",
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: '28px',
              padding: '24px',
              background: '#fffaf4',
              color: '#2b170b',
              boxShadow: '0 28px 56px rgba(10, 6, 4, 0.28)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#b45309' }}>
              KasiRunner client error
            </p>
            <h1 style={{ margin: '12px 0 10px', fontSize: '2rem', lineHeight: 1 }}>The web app hit a runtime error.</h1>
            <p style={{ margin: 0, color: '#7d5b45' }}>
              {this.state.errorMessage}
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
