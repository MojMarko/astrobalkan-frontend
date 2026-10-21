import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'

// Sentry init - PRE rendera, da bi hvatao i greske u inicijalizaciji.
// Bez VITE_SENTRY_DSN-a Sentry tiho preskace (lokalni dev, testovi). DSN ide u
// Vercel env varijablu VITE_SENTRY_DSN (VITE_ prefix je obavezan da bi env stigao
// do browsera u Vite build-u).
if (import.meta.env.VITE_SENTRY_DSN) {
  // Sentry init: konacna konfiguracija sa Session Replay-em + Tunnel-om.
  // Tri kljucne stvari iz prethodnog debug-a:
  //   1. skipBrowserExtensionCheck:true - Sentry v9 ima false-positive ekstenzija
  //      check koji u nekim Chrome instalacijama tiho gasi init.
  //   2. tunnel:'/api/monitoring' - SDK ne salje direktno na sentry.io (ad blockeri
  //      to blokiraju), nego na nas /api/monitoring koji proxy-uje server-side.
  //   3. replayIntegration kreirana defanzivno (try/catch) - ako replay setup pukne,
  //      ostatak Sentry-ja i dalje radi (error tracking se ne gubi).
  let replayIntegration = null;
  try {
    replayIntegration = Sentry.replayIntegration({
      // maskAllText:false - vidim sta klijent/radnica unose (potrebno za debugging
      // konkretnih analiza). Password input-i se i dalje maskiraju preko 'mask' opcije.
      maskAllText: false,
      blockAllMedia: false,
      maskAllInputs: false,
      mask: ['input[type="password"]', '.sentry-mask']
    });
  } catch (e) {
    try { console.error('[Sentry] replayIntegration setup failed:', e); } catch (_) {}
  }

  try {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE || 'production',
      skipBrowserExtensionCheck: true,
      tunnel: '/api/monitoring',
      integrations: replayIntegration ? [replayIntegration] : [],
      // 100% gresaka (free tier 5K mesecno - dovoljno za nas)
      sampleRate: 1.0,
      // Performance monitoring iskljucen (trosi posebnu kvotu)
      tracesSampleRate: 0,
      // Session Replay (free tier: 50 snimaka mesecno):
      // SNIMANJE SESIJA UGASENO (Marko 21.10.: Sentry javio 41/50 replay-a potroseno za
      // 5 dana). Vrednost 1.0 je bila PRIVREMENA za proveru podesavanja 2.6. i nikad nije
      // vracena - snimala se svaka sesija svake radnice, a snimke nismo ni gledali.
      // Sada: obicne sesije se ne snimaju (0), a kad se desi greska snima se svaka peta
      // (0.2) - 50 mesecno je onda dovoljno, a greske i dalje imaju snimak za uvid.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.2,
      sendDefaultPii: true,
      ignoreErrors: [
        // Browser ekstenzije/ad blockeri (nije nasa greska)
        'top.GLOBALS',
        'ResizeObserver loop',
        // Network blip-ovi koje vec retriramo
        /^Failed to fetch$/,
        'AbortError'
      ]
    });
  } catch (e) {
    try { console.error('[Sentry] init failed:', e); } catch (_) {}
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
