import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'

// Sentry init - PRE rendera, da bi hvatao i greske u inicijalizaciji.
// Bez VITE_SENTRY_DSN-a Sentry tiho preskace (lokalni dev, testovi). DSN ide u
// Vercel env varijablu VITE_SENTRY_DSN (VITE_ prefix je obavezan da bi env stigao
// do browsera u Vite build-u).
if (import.meta.env.VITE_SENTRY_DSN) {
  // DEBUG init: minimum konfiguracija + debug:true da Sentry stampa svaki korak
  // u Console. Privremeno bez replayIntegration da iskljucim da je integration kriv.
  // Kad init proradi (uocimo "Sentry Logger [log]: Integration installed:"), vraticemo
  // replayIntegration i ostale opcije.
  try {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE || 'production',
      skipBrowserExtensionCheck: true,
      tunnel: '/api/monitoring',
      debug: true,
      sampleRate: 1.0,
      tracesSampleRate: 0,
      sendDefaultPii: true
    })
    console.log('[Sentry] init returned, client:', Sentry.getClient())
  } catch (e) {
    console.error('[Sentry] init THREW:', e)
  }
}

// SentryErrorBoundary wrapuje App da React greske u render funkcijama ne sruse
// celu aplikaciju - umesto belog ekrana radnica vidi fallback poruku, a ja vidim
// gresku u Sentry-ju sa stack trace-om i komponentom koja je pukla.
const FallbackUI = () => (
  <div style={{ padding: 24, color: '#ede5ff', background: '#02000d', minHeight: '100vh', fontFamily: 'Jost, sans-serif' }}>
    <h2 style={{ color: '#e8c96d', fontFamily: 'Marcellus, serif' }}>Nesto nije u redu</h2>
    <p>Aplikacija je naisla na neocekivanu gresku. Probaj da osvezis stranicu (povuci nadole). Greska je vec prijavljena adminu.</p>
    <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '10px 18px', background: '#c9a84c', color: '#1a0e00', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Osvezi stranicu</button>
  </div>
)

const AppWithBoundary = () => (
  <Sentry.ErrorBoundary fallback={FallbackUI} showDialog={false}>
    <App />
  </Sentry.ErrorBoundary>
)

ReactDOM.createRoot(document.getElementById('root')).render(<AppWithBoundary />)
