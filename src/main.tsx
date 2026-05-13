import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

function showFatalClientError(message: string) {
  const root = document.getElementById('root')

  if (!root) {
    return
  }

  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#1b120b;color:#fff7ed;font-family:Aptos,Segoe UI,sans-serif;">
      <div style="width:min(720px,100%);border-radius:28px;padding:24px;background:#fffaf4;color:#2b170b;box-shadow:0 28px 56px rgba(10,6,4,0.28);">
        <p style="margin:0;font-size:0.8rem;letter-spacing:0.12em;text-transform:uppercase;color:#b45309;">KasiRunner client error</p>
        <h1 style="margin:12px 0 10px;font-size:2rem;line-height:1;">The web app could not start.</h1>
        <p style="margin:0;color:#7d5b45;">${message}</p>
      </div>
    </div>
  `
}

window.addEventListener('error', (event) => {
  console.error('Uncaught client error', event.error ?? event.message)
  showFatalClientError(event.error?.message ?? event.message ?? 'Unknown browser error.')
})

window.addEventListener('unhandledrejection', (event) => {
  const message =
    event.reason instanceof Error
      ? event.reason.message
      : typeof event.reason === 'string'
        ? event.reason
        : 'Unhandled promise rejection.'

  console.error('Unhandled client rejection', event.reason)
  showFatalClientError(message)
})

async function bootstrap() {
  try {
    const [{ default: App }, { AppErrorBoundary }] = await Promise.all([
      import('./App.tsx'),
      import('./AppErrorBoundary.tsx'),
    ])

    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    console.error('KasiRunner bootstrap failure', error)
    showFatalClientError(error instanceof Error ? error.message : 'Unable to load the app bundle.')
  }
}

void bootstrap()
