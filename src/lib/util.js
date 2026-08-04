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

// Pronadje poziciju imena u tekstu (case-insensitive, sa padezima).
// Vraca prvi match ili -1. Eksportovano za testove i bindDatesToNames.
export function findNamePos(rawLower, nameLower){
  if(!rawLower||!nameLower)return -1;
  // NAPOMENA: JS \b je ASCII-only — za imena/reci koje pocinju ili se zavrsavaju na
  // č/ć/đ/š/ž ("muž", "Miloš", "Đorđe") \b NIKAD ne matchuje (nema granice izmedju
  // ž i razmaka). Zato rucne granice preko lookaround-a sa punom klasom slova.
  var L="a-z0-9čćđšž";
  function boundedSearch(stemEsc){
    try{
      // prefiks-granica + (stem + do 2 sufiksna slova za padez) + granica iza
      var re=new RegExp("(?:^|[^"+L+"])("+stemEsc+"[a-zčćđšž]{0,2})(?!["+L+"])");
      var m=re.exec(rawLower);
      if(!m)return -1;
      return m.index+m[0].length-m[1].length;
    }catch(e){return -1;}
  }
  var esc0=nameLower.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  var p0=boundedSearch(esc0);
  if(p0>=0)return p0;
  var vowels="aeiou";
  var stem=nameLower;
  if(stem.length>2&&vowels.indexOf(stem.charAt(stem.length-1))>=0)stem=stem.slice(0,-1);
  if(stem.length<2)return -1;
  var esc=stem.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return boundedSearch(esc);
}

// TIPFELER "03.03.06.1965" (Suzana 4.8: "covek je 1965 a on je napisao 2006"):
// klijent otkuca i dvocifrenu i cetvorocifrenu godinu. Regex uhvati "03.03.06" (posle
// "06" je tacka = granica reci) pa 2-cifrena "06" postane 2006, a prava godina 1965
// se izgubi. Ako ODMAH iza dvocifrene godine sledi separator + 4-cifrena godina, ta
// 4-cifrena je prava. Vraca {year, end} - end pomeren preko potrosenog dela.
export function resolveTypoYear(raw, year, matchEnd){
  var y=String(year==null?"":year);
  if(y.length!==2)return {year:y,end:matchEnd};
  var tail=String(raw||"").slice(matchEnd,matchEnd+6);
  var m=tail.match(/^[.\/\- ](\d{4})\b/);
  if(!m)return {year:y,end:matchEnd};
  return {year:m[1],end:matchEnd+m[0].length};
}

// Pairs persons (sa AI-parsiranog izvora) sa datumima iz teksta po ADJACENCY
// (broj non-whitespace/non-punctuation chars izmedju). To garantuje da formati
// "DATUM Ime", "Ime DATUM" i "DATUM.Ime" svi rade — bind se nikada nije kasnije
// zamenio za AI halucinacije imena-na-datum.
//
// Pravi koren bug-a koji je ovo ispravio (Dragana Micic prijava 2.6.2026):
// Tekst: "17.01.2023.Kalina , moja cerka\n02.05.1985. moj Brat Mirko"
// AI parser je zamenio datume: Kalini dao 02.05.1985, Mirku dao 17.01.2023.
// Stari algoritam (penalty za date-before-name = +1000) nije ispravio — sad
// algoritam je adjacency-based (broji ne-whitespace/punkt chars u "gap"-u izmedju).
export function bindDatesToNames(rawText, persons){
  if(!rawText||!persons||persons.length===0)return persons;
  var raw=String(rawText);
  var rawLow=raw.toLowerCase();

  // 1. Nadji sve datume sa pozicijama. Godina mora biti 1900..danas i datum ne sme
  // biti u buducnosti - "od 5.6.2027" (period iz pitanja) nije datum rodjenja i ne
  // sme da udje u pool za vezivanje (inace binder dodeli buduci datum osobi).
  var dates=[];
  var maxIso=new Date().toISOString().slice(0,10);
  // Datum u kontekstu SMRTI/DOGADJAJA nije datum rodjenja i ne sme u pool za
  // vezivanje. Suzana 2.7. prijava #80 "Mesa datume": "...a 25.08.2004 je datum
  // kada mi je muž umro" - binder bi vezao datum smrti za ime/muza.
  var EVENT_CTX_RE=/umr[loa]|premin|smrt|sahran|pogin|ven[cč]a[nl]|razvod|razvel|razveden|operacij|operis|datum\s+kada/i;
  var dRe=/\b(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{2,4})\b/g,m;
  while((m=dRe.exec(raw))!==null){
    var mEnd=m.index+m[0].length;
    var fx=resolveTypoYear(raw,m[3],mEnd);
    var d=parseInt(m[1],10),mo=parseInt(m[2],10),y=fx.year;
    dRe.lastIndex=fx.end; // ne skeniraj zaostatak "…1965" kao zaseban datum
    var yN=y.length===2?(parseInt(y,10)<=30?2000+parseInt(y,10):1900+parseInt(y,10)):parseInt(y,10);
    if(d>=1&&d<=31&&mo>=1&&mo<=12&&yN>=1900){
      var iso=yN+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0");
      if(iso>maxIso)continue;
      if(EVENT_CTX_RE.test(raw.slice(Math.max(0,m.index-70),fx.end+70)))continue;
      dates.push({
        iso:iso,
        start:m.index,
        end:fx.end
      });
    }
  }
  // Dedup
  var seenIso={},uniqDates=[];
  dates.forEach(function(dt){if(!seenIso[dt.iso]){seenIso[dt.iso]=true;uniqDates.push(dt);}});
  if(uniqDates.length===0)return persons;

  // 2. Nadji pozicije svih imena. Ako osoba NEMA ime (samo relaciju: "muz mi 16.5.1979",
  // "osoba koja me zanima 21.9.1975"), sidri se na RELACIJSKU rec u tekstu - inace se
  // pogresan LLM datum ne ispravlja (Suzana 23.7. "Mesa datume": muz i osoba zamenjeni).
  // rawLow je lowercase ALI zadrzava dijakritike (ž,ć,č,š,đ) pa regexi pokrivaju oba oblika.
  var REL_ANCHOR=[
    ["muz",/mu[zž]|suprug(?!a)/],["zena",/[zž]en[aeiou]|suprug[ae]/],
    ["sin",/\bsin/],["cerka",/[ck][ćc]erk|k[ćc]er/],
    ["brat",/\bbrat/],["sestra",/sestr/],
    ["tata",/\btat[aeiou]|\botac|\boca\b/],["mama",/\bmam[aeiou]|majk/],
    ["baba",/\bbab[aeiou]/],["deda",/\bded[aeiou]/],
    ["partner",/partner|dev(ojk|ojc)|de[čc]k|momak|dragi|draga|zanima|interesuje|svi[đdj]a|osoba|mladi[ćc]|verenik|verenic/],
    ["bivsi",/biv[sš]/]
  ];
  function findRelPos(odnos){
    if(!odnos)return -1;
    var od=String(odnos).toLowerCase();
    for(var i=0;i<REL_ANCHOR.length;i++){
      // Podudari LLM-ov odnos sa kljucem (muz, zena, partner...) ILI direktno regex
      if(od.indexOf(REL_ANCHOR[i][0])>=0||REL_ANCHOR[i][1].test(od)){
        var m=rawLow.match(REL_ANCHOR[i][1]);
        if(m)return m.index;
      }
    }
    return -1;
  }
  var namedPersons=[];
  persons.forEach(function(p,pi){
    if(!p)return;
    var ni=p.ime?findNamePos(rawLow,String(p.ime).toLowerCase()):-1;
    var anchorLen=p.ime?String(p.ime).length:3;
    if(ni<0){ni=findRelPos(p.odnos);}
    if(ni<0)return;
    namedPersons.push({p:p,pi:pi,start:ni,end:ni+anchorLen});
  });
  if(namedPersons.length===0)return persons;

  // 3. Adjacency check - vraca true ako su a i b "immediately adjacent" tj. razdvojeni
  // SAMO whitespace-om, tackom, dvotackom, semikolom. NE i zarezom (zarez = SEPARATOR
  // izmedju razlicitih (ime, datum) parova kao u "Marko 5.5, Ana 3.3").
  function isAdjacent(aEnd,bStart){
    if(aEnd>bStart)return false;
    // NOVI RED prekida susedstvo: "16.05.1979\nOsoba" - osoba pripada datumu na SVOM
    // redu, ne datumu sa prethodnog (Suzana 23.7. "Mesa datume"). Zato NE dozvoljavamo \n.
    return /^[ \t.;:]*$/.test(raw.slice(aEnd,bStart));
  }
  // Score: 0 ako immediately adjacent, inace absolute distance
  function pairScore(np,dt){
    if(dt.end<=np.start && isAdjacent(dt.end,np.start)) return 0; // date right-before name
    if(np.end<=dt.start && isAdjacent(np.end,dt.start)) return 0; // date right-after name
    return Math.abs(np.start-dt.start);
  }

  // 4. Compute all pair scores
  var pairs=[];
  namedPersons.forEach(function(np,nIdx){
    uniqDates.forEach(function(dt,dIdx){
      pairs.push({nIdx:nIdx,dIdx:dIdx,score:pairScore(np,dt)});
    });
  });
  pairs.sort(function(a,b){return a.score-b.score;});

  // 5. Greedy bipartite matching
  var usedN={},usedD={};
  // 5a. Zakljucaj parove gde se LLM-ov datum poklapa sa datumom iz teksta I adjacency
  // to potvrdjuje (score 0). Sprecava da tudji "visak" datum kasnije ukrade tu osobu.
  pairs.forEach(function(pair){
    if(usedN[pair.nIdx]||usedD[pair.dIdx])return;
    if(pair.score===0&&namedPersons[pair.nIdx].p.datum===uniqDates[pair.dIdx].iso){
      usedN[pair.nIdx]=true;usedD[pair.dIdx]=true;
    }
  });
  // 5b. Ostatak greedy po blizini (kao originalni algoritam), ali sa DISTANCOM KAO
  // OGRADOM: overwrite samo kad su ime i datum razumno blizu (<60 non-adjacent chars).
  // 60 pokriva "Marka rodjenog 05.07.2018" gap-ove, a iskljucuje kradju usamljenog
  // datuma TREZE osobe iz druge recenice/pasusa ("Moj muz je rodjen 09.04.1968" daleko
  // od imenovanog klijenta - prijava #62 "Mesa datume"). LLM-swap korekcija (Kalina/
  // Mirko) i dalje radi jer su tamo parovi blizu (score 0 ili mali).
  var MAX_BIND_DIST=60;
  pairs.forEach(function(pair){
    if(usedN[pair.nIdx]||usedD[pair.dIdx])return;
    var np=namedPersons[pair.nIdx];
    var dt=uniqDates[pair.dIdx];
    if(np.p.datum!==dt.iso){
      if(pair.score>=MAX_BIND_DIST){
        // Predaleko - zadrzi LLM-ov datum; datum ostaje slobodan za blizu osobu.
        usedN[pair.nIdx]=true;
        return;
      }
      try{console.warn("bindDatesToNames: "+np.p.ime+": "+np.p.datum+" -> "+dt.iso+" (score="+pair.score+")");}catch(e){}
      np.p.datum=dt.iso;
    }
    usedN[pair.nIdx]=true;
    usedD[pair.dIdx]=true;
  });

  return persons;
}

// Retry helper: "Failed to fetch" se desava cesto na mobilnom 4G kad mreza zatrepere
// I cesto kod Render free tier cold start-a (server zaspi posle 15 min, prvi request
// ceka 30-60s da se server probudi).
//
// Strategija: 4 pokusaja sa eksponencijalno rastucim backoff-om (2s, 5s, 15s, 30s).
// Plus per-attempt timeout (default 30s) - bez ovog fetch moze viseti unedogled na
// mrtvi server, status ostane 'generating', UI zaglavljen (Suzana prijava 2.6 11:10:
// "Ocitava, ne uradi analizu" - tacno taj scenario).
// Ukupno worst case ~2 min - dovoljno da preživi cold start, dovoljno kratko da
// radnica ne ceka unedogled bez ikakvog feedback-a.
export async function fetchWithRetry(url, options, attemptsOrOpts){
  let attempts, onRetry, perAttemptTimeoutMs;
  if (typeof attemptsOrOpts === 'object' && attemptsOrOpts !== null) {
    attempts = attemptsOrOpts.attempts || 4;
    onRetry = attemptsOrOpts.onRetry || null;
    perAttemptTimeoutMs = attemptsOrOpts.timeoutMs || 30000;
  } else {
    attempts = attemptsOrOpts || 4;
    onRetry = null;
    perAttemptTimeoutMs = 30000;
  }
  // Backoff: kupivnja Render restart (30-90s) + cold start (~15s).
  // Total cover ~95s preko 4 attempts.
  // Suzana 6.6. 09:46 "Failed to fetch" - moj deploy je restartovao backend
  // tacno kad je ona kliknula Generiši; stari [2s,5s,15s,30s] = 22s nije pokrio
  // 60s restart. Sad [3s,10s,25s,55s] = 93s pokriva svaki realan restart.
  const backoffs = [3000, 10000, 25000, 55000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function(){ controller.abort(); }, perAttemptTimeoutMs);
    try {
      const fetchOptions = Object.assign({}, options || {}, { signal: controller.signal });
      const r = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (r.ok) return r;
      if (r.status >= 400 && r.status < 500) return r; // klijent greska - ne retriraj
      lastErr = new Error("HTTP " + r.status);
    } catch (e) {
      clearTimeout(timeoutId);
      lastErr = e; // network error / timeout abort / TypeError - retriraj
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

// fetchSafe: jedan fetch sa AbortController timeout-om (default 30s).
// Razlika od fetchWithRetry: NE radi retry - samo garantuje da nikad ne visi.
// Default svuda gde NE TREBA retry semantika (npr. polling, GET pozivi, sub-pozivi).
// Bez ovog se redovno dešava da neki fetch visi zauvek i UI ostaje zaglavljen
// (Suzana prijave: 30 min spinner bez ikakvog job-a u DB-u).
//
// API: fetchSafe(url, opts, timeoutMs) ili fetchSafe(url, opts) sa default 30s
export async function fetchSafe(url, options, timeoutMs){
  const ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(function(){ controller.abort(); }, ms);
  try {
    const fetchOptions = Object.assign({}, options || {}, { signal: controller.signal });
    const r = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    return r;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// Popravka ISECENOG JSON odgovora iz AI parsera (Suzana 6.7. "Nece da prepoznaje
// podatke"): v4-flash zna da stane usred stringa ('..."partn') kad potrosi token
// budzet. Secemo tekst unazad do poslednje tacke gde su navodnici upareni i
// vitice/uglaste zagrade balansirane, skidamo zaostali zarez/dvotacku (i kljuc
// bez vrednosti), pa dodajemo zatvarajuce zagrade. Vraca objekat ili null.
export function repairTruncatedJson(s){
  if(!s||typeof s!=="string")return null;
  var start=s.indexOf("{");
  if(start<0)return null;
  s=s.slice(start);
  for(var end=s.length;end>1;end--){
    var cand=s.slice(0,end);
    // Broj neescape-ovanih navodnika - neparan znaci da smo usred stringa
    var quotes=0,i;
    for(i=0;i<cand.length;i++){if(cand[i]==='"'&&cand[i-1]!=="\\")quotes++;}
    if(quotes%2!==0)continue;
    // Skini trailing zarez/dvotacku/whitespace ("...","partn": → "...")
    var trimmed=cand.replace(/[\s,]+$/,"");
    // Kljuc bez vrednosti na kraju ('..., "partner":') - skini i kljuc
    trimmed=trimmed.replace(/,?\s*"[^"]*"\s*:\s*$/,"");
    // Balans zagrada (samo van stringova)
    var opens=0,closes=0,sq=0,sqc=0,inStr=false;
    for(i=0;i<trimmed.length;i++){
      var c=trimmed[i];
      if(c==='"'&&trimmed[i-1]!=="\\"){inStr=!inStr;continue;}
      if(inStr)continue;
      if(c==="{")opens++;else if(c==="}")closes++;
      else if(c==="[")sq++;else if(c==="]")sqc++;
    }
    if(closes>opens||sqc>sq||inStr)continue;
    var fixed=trimmed+Array(sq-sqc+1).join("]")+Array(opens-closes+1).join("}");
    try{
      var obj=JSON.parse(fixed);
      if(obj&&typeof obj==="object")return obj;
    }catch(_){}
  }
  return null;
}
