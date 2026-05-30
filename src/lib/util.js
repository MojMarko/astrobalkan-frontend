// Helper funkcije izvucene iz App.jsx da bi mogle da se testiraju.
// Ne menjati ponasanje bez azuriranja test/util.test.js (test ce pasti).

// Lepo formatirano polje "pitanja klijenta" - razdvaja datume, imena i pitanja u
// posebne redove kad poruka stigne kao zgusnut jedan paragraf. Bez ovoga astrolog
// teško razlikuje koji datum pripada kome, gde počinje koje pitanje.
export function prettifyPitanja(text){
  if(!text) return text;
  var t=String(text);
  // Razlomi pre datuma (DD.MM.YYYY) ako su nalepljeni na prethodni tekst
  t=t.replace(/([^\n])[ \t]+(\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}\b)/g,"$1\n$2");
  // Razlomi pre cestih starters pitanja (case-insensitive, posle tacke/zareza)
  t=t.replace(/([.!?,;])\s+(Da li|Recite mi|Reci mi|Kako |Kada |Hoće li|Hoce li|Hoću |Hocu |Zanima me|Pitam se|Pitam te|Klijent pita|Klijent brine|Pitanje:|Sin |Sina |Kćer|Cerka |Cerku |Ćerka |Brat |Sestra |Muž |Suprug |Žena |Supruga |Mama |Tata |Otac |Majka )/gi,"$1\n\n$2");
  // Trim svaki red (cuva prazne redove kao paragraph break-ove, ne brise ih!)
  t=t.split(/\n/).map(function(l){return l.trim();}).join("\n");
  // Sazmi visestruke prazne redove (3+ \n) na max dva (=jedan prazan red)
  t=t.replace(/\n{3,}/g,"\n\n");
  // Skini leading/trailing prazne redove
  t=t.replace(/^\n+|\n+$/g,"");
  return t;
}

// Konvencionalni datumski sunčev znak (newspaper-style koji ocekuju astrolozi i klijenti).
// Razlika od astronomske preciznosti: 23.8 = uvek Devica, 22.8 = uvek Lav, bez obzira na godinu.
// Koristi se kad nema tacnog vremena rodjenja (cusp datumi - Sunce prelazi znak u toku dana).
// Standardne granice iz astrologskih tabela (newspaper horoskop).
export function conventionalSunSign(iso){
  if(!iso||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return "";
  var parts=iso.split("-"),m=parseInt(parts[1],10),d=parseInt(parts[2],10);
  if((m===3&&d>=21)||(m===4&&d<=19))return "Ovan";
  if((m===4&&d>=20)||(m===5&&d<=20))return "Bik";
  if((m===5&&d>=21)||(m===6&&d<=20))return "Blizanci";
  if((m===6&&d>=21)||(m===7&&d<=22))return "Rak";
  if((m===7&&d>=23)||(m===8&&d<=22))return "Lav";
  if((m===8&&d>=23)||(m===9&&d<=22))return "Devica";
  if((m===9&&d>=23)||(m===10&&d<=22))return "Vaga";
  if((m===10&&d>=23)||(m===11&&d<=21))return "Skorpija";
  if((m===11&&d>=22)||(m===12&&d<=21))return "Strelac";
  if((m===12&&d>=22)||(m===1&&d<=19))return "Jarac";
  if((m===1&&d>=20)||(m===2&&d<=18))return "Vodolija";
  if((m===2&&d>=19)||(m===3&&d<=20))return "Ribe";
  return "";
}

// Retry helper: "Failed to fetch" se desava cesto na mobilnom 4G kad mreza zatrepere
// I cesto kod Render free tier cold start-a (server zaspi posle 15 min, prvi request
// ceka 30-60s da se server probudi).
//
// Strategija: 4 pokusaja sa eksponencijalno rastucim backoff-om (2s, 5s, 15s, 30s).
// Ukupno do ~52 sekundi - dovoljno da preživi cold start. Tokom retry-ja zovemo
// opcionalni onRetry callback (call site moze prikazati toast "server se budi...").
// Ne retrira 4xx (klijent greska, npr. 400 invalid input - tu retry nema smisla).
export async function fetchWithRetry(url, options, attemptsOrOpts){
  // Backward kompatibilan signature: stari kod prosledjuje broj, novi moze object.
  let attempts, onRetry;
  if (typeof attemptsOrOpts === 'object' && attemptsOrOpts !== null) {
    attempts = attemptsOrOpts.attempts || 4;
    onRetry = attemptsOrOpts.onRetry || null;
  } else {
    attempts = attemptsOrOpts || 4;
    onRetry = null;
  }
  const backoffs = [2000, 5000, 15000, 30000]; // index 0..3 (cap pri retry br. i-1)
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, options);
      if (r.ok) return r;
      if (r.status >= 400 && r.status < 500) return r; // klijent greska - ne retriraj
      lastErr = new Error("HTTP " + r.status);
    } catch (e) {
      lastErr = e; // network error (TypeError "Failed to fetch") - retriraj
    }
    if (i < attempts - 1) {
      const wait = backoffs[i] || backoffs[backoffs.length - 1];
      if (onRetry) {
        try { onRetry(i + 1, attempts, wait); } catch (_) { /* callback ne sme da prekine */ }
      }
      await new Promise(function(res){ setTimeout(res, wait); });
    }
  }
  throw lastErr;
}
