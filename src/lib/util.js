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

// Retry helper: "Failed to fetch" se desava cesto na mobilnom 4G kad mreza zatrepere.
// Ranije: jedan blip = radnica vidi "Greska: Failed to fetch" i mora opet sve.
// Sada: automatski 3 pokusaja sa kratkim backoff-om (1s, 2s) na mreznim/5xx greskama.
// Ne retrira 4xx (klijent greska, npr. 400 invalid input - tu retry nema smisla).
export async function fetchWithRetry(url, options, attempts){
  attempts = attempts || 3;
  var lastErr;
  for(var i=0; i<attempts; i++){
    try{
      var r = await fetch(url, options);
      if(r.ok) return r;
      if(r.status >= 400 && r.status < 500) return r; // klijent greska - ne retriraj
      lastErr = new Error("HTTP " + r.status);
    }catch(e){
      lastErr = e; // network error (TypeError "Failed to fetch") - retriraj
    }
    if(i < attempts - 1){
      await new Promise(function(res){setTimeout(res, 1000 * (i + 1));});
    }
  }
  throw lastErr;
}
