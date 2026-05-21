# AstroBalkan — uputstvo za projekat

Aplikacija koju koriste radnice za astro analize. Frontend (ovaj repo, Vite/React,
deploy na Vercel) + backend (`MojMarko/astrobalkan-backend`, Node/Express, deploy na
Render). Oba se auto-deployuju kad se mergeuje na `main`.

## Automatsko rešavanje prijava problema ("Prijavi problem")

Radnice iz softvera prijavljuju probleme. Backend (`POST /api/report`) tada otvori
GitHub issue u OVOM repou sa labelom `prijava-radnice`, sa opisom, ekranom i
screenshotom. Kad si pokrenut povodom takvog issue-a, postupi ovako:

1. **Pročitaj issue** — opis problema, koje ekrane je radnica označila, i screenshot.
2. **Nađi uzrok** u kodu. Većina je u ovom (frontend) repou, u `src/App.jsx`.
   Ako je problem na backendu, izmene guraj u `MojMarko/astrobalkan-backend`.
3. **Popravi** minimalno i ciljano — ne refaktoriši okolo.
4. **Proveri** sa `npm run build`. Build MORA da prođe.
5. **Ako build prođe:** mergeuj na `main` (to deployuje na produkciju).
6. **Označi prijavu rešenom** (samo ako si mergovao): pozovi
   `POST https://astrobalkan-backend.onrender.com/api/reports/<ID_PRIJAVE>/status`
   sa telom `{"status":"reseno","note":"<kratak opis šta je popravljeno>"}`.
   Time se status u softveru prebaci na "Rešeno" i adminu stigne email.
7. **Ako build padne, ili je problem nejasan / zahteva veliku izmenu / dira
   naplatu/login/bazu:** NE mergeuj i NE označavaj rešenim. Otvori PR sa nalazom
   i ostavi za ljudski pregled.

Cilj: radnica dobije popravku bez čekanja na vlasnika, ali se rizične izmene ne
deployuju automatski.

## Korisne tačke u kodu
- `src/App.jsx` — cela aplikacija (jedan veliki fajl, React.createElement, bez JSX).
- Sekcija "Prijavi problem": traži `tab==="prijava"` i funkcije `submitReport`,
  `handleRepImage`, `loadReports`.
- API baza: `var API` na vrhu `App.jsx`.
- Backend prijave: `astrobalkan-backend/server.js`, traži `/api/report`.
