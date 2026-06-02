import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'

// Sentry init - PRE rendera, da bi hvatao i greske u inicijalizaciji.
// Bez VITE_SENTRY_DSN-a Sentry tiho preskace (lokalni dev, testovi). DSN ide u
// Vercel env varijablu VITE_SENTRY_DSN (VITE_ prefix je obavezan da bi env stigao
// do browsera u Vite build-u).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE || 'production',
    // Session Replay snima sesije radnica (klik, kucanje, scroll, navigacija)
    // tako da admin moze pregledati tacno sta je radnica radila pre greske.
    // Marko trazio 2.6: "snima svaka radnja u softveru da vidim sta tacno rade".
    // Konfiguracija:
    //   maskAllText=false - vidim sta klijent/radnica unose (potrebno za debugging
    //   konkretnih analiza). Lozinke se automatski maskiraju preko mask-class-name.
    //   blockAllMedia=false - prikazi screenshot-ove i slike u replay-u.
    integrations: [
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
        // Mask password input-e bez obzira (sigurnost - lozinke ne smeju u replay).
        maskAllInputs: false,
        mask: ['input[type="password"]', '.sentry-mask']
      })
    ],
    // 100% gresaka (free tier 5K mesecno - dovoljno)
    sampleRate: 1.0,
    // Performance monitoring iskljucen (trosi posebnu kvotu)
    tracesSampleRate: 0,
    // Session Replay sample rate:
    //   replaysSessionSampleRate=0.1 - 10% normalnih sesija snima (za uzorke)
    //   replaysOnErrorSampleRate=1.0 - SVE sesije sa greskama se snimaju i cuvaju
    //     30 sek pre greske, dovoljno da admin vidi sta je radnica radila.
    // Free tier (50 replays/mesec) - error replay-i su prioritet, normalni su uzorak.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Salji default PII (browser, OS, lokacija) da znamo koja radnica je dozivela
    sendDefaultPii: true,
    // Filter ranking: ne hvataj poznate non-actionable greske
    ignoreErrors: [
      // Browser ekstenzije/ad blockeri (nije nasa greska)
      'top.GLOBALS',
      'ResizeObserver loop',
      // Network blip-ovi koje vec retriramo
      /^Failed to fetch$/,
      'AbortError'
    ]
  })
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
