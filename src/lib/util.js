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

// ==================== VRACANJE IMENA IZ TEKSTA =============
// Marko 12.8.: ista pitanja, dva pokretanja - u jednom je parser vratio ime "Duško",
// u drugom "Sin" (rec za odnos umesto imena). Zaglavlje je onda pisalo
// "Ćerka (Ćerka): rođena 5.12.2000" DVA puta, a AI je morao da pogadja koja je koja.
// Ovde deterministicki vracamo ime iz sirovog teksta: radnica pise "Ćerka Ana" /
// "Sin Duško" pa je ime rec KOJA STOJI ODMAH POSLE odnosa, ispred datuma te osobe.
var RN_REL = 'sin|sina|sinu|[ćc]erk[aeiou]|k[ćc]erk[aeiou]|k[ćc]i|brat[aeu]?|sestr[aeiou]|mu[zž][aeu]?|suprug[aeu]?|[zž]en[aeu]|mam[aeu]|majk[aeiou]|tat[aeu]|otac|oca|unuk[aeu]?|partner[kaeu]*|prijatelj[icaeu]*|snah[aeu]|zet[aeu]?|tetk[aeiou]|stric[aeu]?|ujak|ujaka|kum[aeu]?|bab[aeu]|ded[aeu]';
var RN_NOT_NAME = /^(sin|sina|sinu|cerka|cerke|cerku|kcerka|kci|brat|brata|sestra|sestre|muz|muza|suprug|supruga|zena|zene|mama|mame|majka|majke|tata|tate|otac|oca|unuk|unuka|partner|partnerka|prijatelj|prijateljica|snaha|zet|tetka|stric|ujak|kum|kuma|baba|deda|januar|februar|mart|april|maj|jun|jul|avgust|septembar|oktobar|novembar|decembar|godine|godina|sati|casova|ujutru|uvece|podne|ponoc|klijent|osoba)$/;
function rnAscii(s){return String(s||"").toLowerCase().replace(/[ćč]/g,"c").replace(/[žš]/g,"z").replace(/đ/g,"d");}
// Sve pozicije na kojima se datum osobe pojavljuje u tekstu (D.M.YYYY, bez/sa nulom).
function rnDatePositions(raw, iso){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||""));
  if(!m)return [];
  var y=m[1], mo=parseInt(m[2],10), d=parseInt(m[3],10);
  var re=new RegExp("(?:0?"+d+")\\s*[.\\/-]\\s*(?:0?"+mo+")\\s*[.\\/-]\\s*"+y,"g");
  var out=[],mm;
  while((mm=re.exec(String(raw||""))))out.push(mm.index);
  return out;
}
// Vrati kopiju persons gde je "ime" popunjeno pravim imenom kad je bilo prazno ili je
// bila sama rec za odnos. Ne dira osobe koje vec imaju pravo ime.
export function recoverNamesFromText(rawText, persons){
  var raw=String(rawText||"");
  if(!raw||!Array.isArray(persons)||persons.length===0)return persons;
  var relRe=new RegExp("(?:"+RN_REL+")[^A-Za-zČĆŽŠĐčćžšđ0-9]{1,4}([A-ZŠĐČĆŽ][a-zšđčćž]{2,20})","gi");
  return persons.map(function(p){
    if(!p)return p;
    var ime=String(p.ime||"").trim();
    var imeA=rnAscii(ime);
    // pravo ime? ostavi ga na miru
    if(ime&&!RN_NOT_NAME.test(imeA)&&imeA!==rnAscii(p.odnos))return p;
    var positions=rnDatePositions(raw,p.datum);
    if(positions.length===0)return p;
    var found=null;
    positions.forEach(function(pos){
      if(found)return;
      var win=raw.slice(Math.max(0,pos-90),pos);
      var mm,last=null;
      relRe.lastIndex=0;
      while((mm=relRe.exec(win)))last=mm[1];
      if(last&&!RN_NOT_NAME.test(rnAscii(last)))found=last;
    });
    if(!found)return p;
    var out={};for(var k in p)out[k]=p[k];
    out.ime=found;
    return out;
  });
}

// ==================== JEDINSTVENA OZNAKA OSOBE ====================
// Marko 12.8.: "napisemo tacno ko je sin ko je cerka, a on zameni uloge".
// Uzrok: radnica upise samo odnos bez imena ("Ćerka 15.10.1994 / Ćerka 29.10.1986 /
// Sin 3.5.1984"), parser vrati ime:"" pa je u promptu SVE bilo "Osoba (cerka)" —
// dve cerke doslovno identicno oznacene. AI nije imao po cemu da ih razlikuje, pa je
// mesao njihove karte i uloge. Resenje: oznaka je uvek jedinstvena i citljiva
// ("starija ćerka", "mladja ćerka"), nikad "Osoba" kad znamo odnos.
var REL_NICE={sin:"Sin",cerka:"Ćerka",kcerka:"Ćerka","ćerka":"Ćerka","kćerka":"Ćerka",brat:"Brat",sestra:"Sestra",muz:"Muž","muž":"Muž",zena:"Supruga","žena":"Supruga",supruga:"Supruga",suprug:"Suprug",majka:"Majka",mama:"Mama",otac:"Otac",tata:"Tata",unuk:"Unuk",unuka:"Unuka",partner:"Partner",partnerka:"Partnerka",prijatelj:"Prijatelj",prijateljica:"Prijateljica",snaha:"Snaha",zet:"Zet",tetka:"Tetka",stric:"Stric",ujak:"Ujak"};
// Muski odnosi koji se zavrsavaju na "a" (inace pravilo "zavrsava na a = zenski").
var REL_MASC_A={tata:1,deda:1,kolega:1,vojvoda:1};
export function relIsFemale(rel){
  var r=String(rel||"").toLowerCase().trim();
  if(!r)return false;
  if(REL_MASC_A[r])return false;
  return /a$/.test(r);
}
function relPretty(rel){
  var r=String(rel||"").toLowerCase().trim();
  if(!r)return "";
  if(REL_NICE[r])return REL_NICE[r];
  return r.charAt(0).toUpperCase()+r.slice(1);
}
// "starija ćerka" / "mladja ćerka" — po datumu rodjenja, rodno usklađeno.
var ORD2=[["starij","mladj"],["najstarij","srednj","najmladj"]];
function ordWord(word,female){return word+(female?"a":"i");}
// persons: [{ime,odnos,datum}] — vraca niz oznaka iste duzine, garantovano jedinstvenih.
export function personLabels(persons){
  var arr=Array.isArray(persons)?persons:[];
  var base=arr.map(function(p){
    var ime=String((p&&p.ime)||"").trim();
    var odn=String((p&&p.odnos)||"").trim();
    // Radnica cesto u polje imena upise sam odnos ("Cerka", "sin") — ne duplaj ga.
    var imeLow=ime.toLowerCase().replace(/[ćč]/g,"c").replace(/[žš]/g,"z").replace(/đ/g,"d");
    var odnLow=odn.toLowerCase().replace(/[ćč]/g,"c").replace(/[žš]/g,"z").replace(/đ/g,"d");
    if(ime&&(imeLow===odnLow||(odnLow&&imeLow.indexOf(odnLow)===0&&imeLow.length<=odnLow.length+2)))ime="";
    if(ime&&odn)return ime+" ("+odn+")";
    if(ime)return ime;
    if(odn)return relPretty(odn);
    return "Osoba";
  });
  // Grupisi po istoj oznaci — samo tamo treba razlikovanje.
  var groups={};
  base.forEach(function(b,i){(groups[b]=groups[b]||[]).push(i);});
  var out=base.slice();
  Object.keys(groups).forEach(function(b){
    var idxs=groups[b];
    if(idxs.length<2)return;
    // stariji prvi (manji datum = ranije rodjen); bez datuma idu na kraj
    var sorted=idxs.slice().sort(function(a,c){
      var da=String((arr[a]&&arr[a].datum)||"9999"),dc=String((arr[c]&&arr[c].datum)||"9999");
      return da<dc?-1:(da>dc?1:a-c);
    });
    var female=relIsFemale((arr[sorted[0]]&&arr[sorted[0]].odnos)||"")||/a$/.test(b);
    var relLow=b.toLowerCase();
    if(sorted.length===2){
      out[sorted[0]]=ordWord(ORD2[0][0],female)+" "+relLow;
      out[sorted[1]]=ordWord(ORD2[0][1],female)+" "+relLow;
    }else if(sorted.length===3){
      out[sorted[0]]=ordWord(ORD2[1][0],female)+" "+relLow;
      out[sorted[1]]=ordWord(ORD2[1][1],female)+" "+relLow;
      out[sorted[2]]=ordWord(ORD2[1][2],female)+" "+relLow;
    }else{
      // 4+ istih: oznaka po datumu rodjenja (uvek jedinstven posle bind-a)
      sorted.forEach(function(i){
        var d=String((arr[i]&&arr[i].datum)||"");
        out[i]=b+(d?" rodjen/a "+d.split("-").reverse().join("."):" ("+(i+1)+")");
      });
    }
  });
  // Poslednja mreza: ako je i posle svega nesto duplo, dodaj datum.
  var used={};
  out.forEach(function(l,i){
    if(used[l]){
      var d=String((arr[i]&&arr[i].datum)||"");
      out[i]=l+(d?" ("+d.split("-").reverse().join(".")+")":" ("+(i+1)+")");
    }
    used[out[i]]=true;
  });
  return out;
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

// ============================================================================
// EMAIL KLIJENTA (za slanje analize i za kasnije personalizovane ponude)
// ============================================================================

// Namerno labava provera - ista kao cleanEmail na backendu. Svrha je da odbije
// ono sto radnica ukuca u polje kad klijent nema mejl ("nema", "-", "ne zeli"),
// a NE da sudi o egzoticnim ali validnim adresama. Vraca ociscenu adresu ili "".
export function validEmail(v){
  var e=String(v==null?"":v).trim().toLowerCase();
  if(!e||e.length>254)return "";
  return /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/.test(e)?e:"";
}

// Klijenti cesto ostave mejl u samoj Messenger poruci. Regex je za ovo
// pouzdaniji od AI parsera - adresa ima strog oblik, nema sta da se "protumaci".
export function nadjiEmailUTekstu(t){
  var m=String(t||"").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m?validEmail(m[0]):"";
}

// Naslov mejla koji radnica salje klijentu.
export function mailNaslov(tip,ime){
  var ko=String(ime||"").trim();
  var osnov=tip==="pitanja"?"Odgovori na tvoja pitanja"
    :tip==="downsell"?"Tvoja astro prognoza"
    :"Tvoja astro analiza";
  return osnov+(ko?" - "+ko:"")+" | Astrolog Suzana";
}

// Ciscenje teksta analize PRE slanja mejlom. AI u analizu upisuje ostatke iz
// Messenger vremena koji u mejlu nemaju smisla ili su pogresni:
// 1. "Savetujem ti da analizu sacuvas u beleske ako se izbrise" - imalo smisla
//    kad je analiza zivela samo u Messenger cetu; mejl JE trajna kopija.
// 2. Stari potpis "E-mail: astrologsuzana@gmail.com / Astrolog Suzana <srce>" -
//    biznis adresa je sada kontakt@astrologsuzana.com i dodaje se nas potpis,
//    pa je stari i pogresan i dupli.
// VAZNO: primenjuje se SAMO na mejl. Kopiraj dugmici za Messenger ne diraju
// tekst - tamo savet o cuvanju i dalje ima smisla.
export function ocistiZaMejl(t){
  var s=String(t==null?"":t);
  // stari potpis: ceo red "E-mail: astrologsuzana@gmail.com..."
  s=s.replace(/^[ \t]*E-?mail:\s*(astrologsuzana@gmail\.com|kontakt@astrologsuzana\.com)[^\n]*$\n?/gmi,"");
  // pomen stare adrese usred recenice -> zameni novom umesto da secemo recenicu
  s=s.replace(/astrologsuzana@gmail\.com/gi,"kontakt@astrologsuzana.com");
  // samostalan red "Astrolog Suzana" + eventualno srce/emoji (nas potpis vec
  // sadrzi Suzanu, ovo bi bio dupli potpis)
  s=s.replace(/^[ \t]*Astrolog Suzana[^\w\n]*$\n?/gmi,"");
  // pasus koji savetuje cuvanje analize u beleske / za slucaj brisanja
  var delovi=s.split(/\n[ \t]*\n/);
  delovi=delovi.filter(function(pas){
    var l=pas.toLowerCase();
    var cuvanje=/sa[c\u010d]uva/.test(l);
    var razlog=/bele[s\u0161]ke|bele[z\u017e]nic|izbri[s\u0161]|obri[s\u0161]|nestane/.test(l);
    return !(cuvanje&&razlog);
  });
  s=delovi.join("\n\n");
  return s.replace(/\n{3,}/g,"\n\n").trim();
}

// PONUDA "12 MESECI" NA KRAJU MEJLA SA ANALIZOM (Markov tekst, odobren 25.8;
// "preko Messengera" zamenjeno sa "preko mejla" jer tekst ide u mejl).
// Ubacuje se SAMO kod obicne analize - ne kod downsell-a (to VEC JESTE taj
// proizvod) ni kod dodatnih pitanja. Ide PRE zavrsne zahvalnice ako je ima,
// da mejl tece prirodno: analiza -> ponuda -> hvala -> potpis.
export var PONUDA_12M="Moram jo\u0161 da Vam ka\u017eem, po\u0161to ste ve\u0107 poru\u010dili analizu kod mene i imam va\u0161u natalnu kartu pa mogu sve da vidim, postoji jo\u0161 jedna stvar koju ve\u0107ina klijenata uzme uz svoju godi\u0161nju analizu, a to su ta\u010dni periodi u narednih 12 meseci kada Vam se de\u0161avaju klju\u010dne promene i da li \u0107e se realizovati ono \u0161to ste naumili.\n\n"
 +"Dobijate precizno izdvojene periode kada je najbolje da ne\u0161to pokrenete, kada da sa\u010dekate, kada da iskoristite svoju energiju na maksimum i kada je va\u017eno da izbegnete pogre\u0161ne poteze, konflikte ili lo\u0161e odluke. Tako\u0111e, kroz tranzite da li \u0107e se realizovati ne\u0161to \u0161to ste naumili.\n\n"
 +"Mogu Vam izdvojiti najva\u017enije datume i periode za narednih 12 meseci, uz konkretna uputstva \u0161ta da radite u tim momentima, kako biste sve \u0161to dolazi iskoristili na najbolji na\u010din. Uz to dobijate i pravo da postavite 5 dodatnih pitanja.\n\n"
 +"Cena ovog dodatka je 1.000 dinara sa popustom, jer ste ve\u0107 poru\u010dili analizu kod mene, a sve Vam \u0161aljem ovde u pisanom obliku preko mejla, tako da uvek mo\u017eete da sa\u010duvate i pro\u010ditate kada Vam zatreba.\n\n"
 +"Javite mi kada da vam po\u0161aljem.";

var HVALA_RED="Hvala ti puno na poverenju i \u017eelim ti \u017eivot ispunjen mirom, rado\u0161\u0107u i sre\u0107om.";

export function ubaciPonudu12m(t){
  var s=String(t==null?"":t).trim();
  if(!s)return s;
  var delovi=s.split(/\n[ \t]*\n/);
  var i=delovi.length-1;
  // Analiza se obicno vec zavrsava zahvalnicom ("Hvala ti puno na poverenju...")
  // - ponuda ide PRE nje. Ako je nema, dodajemo ponudu pa Markovu zahvalnicu.
  if(i>=0&&/hvala/i.test(delovi[i])&&/poverenju/i.test(delovi[i])){
    delovi.splice(i,0,PONUDA_12M);
    return delovi.join("\n\n");
  }
  return s+"\n\n"+PONUDA_12M+"\n\n"+HVALA_RED;
}
// ==================== DATUM MORA POSTOJATI U TEKSTU ====================
// Marko 1.9: "prica o nekoj deci a taj klijent uopste nema decu niti je ostavio datume".
// Nadjeno u bazi (Dragana, 01.09. 13:24): radnica je nalepila poruku klijentkinje
//   "...Ja rodjena u 21.i20 u Sremskoj Mitrovici"
// gde je "21.i20" VREME rodjenja (21:20). AI-parser je od toga napravio DATUM
// 21.01.1921 i osobu koja ne postoji, a analiza je taj izmisljeni znak (Vodolija)
// pripisala klijentkinjinoj cerki. Pravi datum cerke (31.01.1986) nije ni prepoznat.
//
// Pravilo: datum osobe MORA da se pojavljuje u tekstu koji je radnica upisala.
// Ako ga nema - osoba je izmisljena i izbacuje se. Ovo je deterministicko i ne
// zavisi od toga koliko je AI-parser tog trenutka pouzdan.
export function dateAppearsInText(rawText, iso){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||""));
  if(!m)return false;
  var raw=String(rawText||"");
  if(raw.indexOf(iso)>=0)return true;                    // vec u ISO obliku
  var g=m[1], mm=parseInt(m[2],10), d=parseInt(m[3],10);
  var d2=("0"+d).slice(-2), m2=("0"+mm).slice(-2), g2=g.slice(2);
  var dani=[String(d),d2], meseci=[String(mm),m2], godine=[g,g2];
  var sep="[.,/\\-\\s]{1,3}";
  for(var i=0;i<dani.length;i++)for(var j=0;j<meseci.length;j++)for(var k=0;k<godine.length;k++){
    var re=new RegExp("(^|[^0-9])"+dani[i]+sep+meseci[j]+sep+godine[k]+"([^0-9]|$)");
    if(re.test(raw))return true;
  }
  return false;
}
// Izbaci osobe cijeg datuma nema u tekstu. Vraca {osobe, izbacene}.
export function dropInventedPersons(rawText, persons){
  var arr=Array.isArray(persons)?persons:[];
  var raw=String(rawText||"");
  if(!raw.trim())return {osobe:arr, izbacene:[]};
  var ok=[], out=[];
  arr.forEach(function(p){
    if(p&&p.datum&&!dateAppearsInText(raw,p.datum))out.push(p);
    else ok.push(p);
  });
  return {osobe:ok, izbacene:out};
}

// ==================== PARTNER OZNAČEN SAMO SA "ON"/"ONA" ====================
// Suzana 4.9: "Ne upiše partnera. Unosim ručno." Klijentkinja je napisala:
//   4.2.1988 on
//   u 05:30casova
//   1.da li cu popraviti odnos sa starijim sinom?
// AI-parser je partnera ostavio u pitanjima, a postojeca mreza ga nije pokupila jer
// izricito preskace zamenice "on"/"ona" (preceste su - "on voli", "ona je rekla").
// Ali obrazac DATUM + samostalno "on"/"ona" U ISTOM REDU je vrlo specifican i tako
// klijenti stvarno pisu partnera. Zato gledamo samo taj uzak slucaj.
var PZ_FAM = /(^|[^a-zčćžšđ])(sin|sina|sinu|sine|sinom|[ćc]erk|k[ćc]i|brat|sestr|tat[aeu]|otac|oca|ocu|mam[aeu]|majk|bab[aeu]|ded[aeu]|dete|deca|dec[uoi]|unuk|tetk|stric|ujak|prijatelj|koleg)/i;
var PZ_ZAMENICA = /(^|[^a-zčćžšđA-ZČĆŽŠĐ])(on|ona)(?![a-zčćžšđA-ZČĆŽŠĐ])/gi;
var PZ_DATUM = /(^|[^\d])(\d{1,2})[.\/\-\s](\d{1,2})[.\/\-\s](\d{2,4})(?!\d)/;
function pzIso(d, m, g){
  var gg = g.length === 2 ? (parseInt(g, 10) <= 30 ? "20" + g : "19" + g) : g;
  return gg + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2);
}
function pzVreme(red){
  var m = /(^|[^\d])(\d{1,2})[:.\s]?(\d{2})\s*(?:h|sati|casova|časova)?(?![\d])/.exec(String(red || ""));
  if (!m) return "";
  var sat = parseInt(m[2], 10), min = parseInt(m[3], 10);
  if (sat > 23 || min > 59) return "";
  return ("0" + sat).slice(-2) + ":" + ("0" + min).slice(-2);
}
// Vraca {datum, vreme} ako je partner nedvosmisleno oznacen zamenicom uz datum,
// inace null. Namerno vraca null kad ima VISE kandidata - bolje nista nego pogresno.
export function nadjiPartneraPoZamenici(tekst, klijentDatum){
  var linije = String(tekst || "").split(/\n/);
  var kandidati = [];
  for (var i = 0; i < linije.length; i++){
    var red = linije[i];
    var dm = PZ_DATUM.exec(red);
    if (!dm) continue;
    // Zamenica mora biti BLIZU datuma (do 25 znakova) - tako klijenti pisu partnera
    // ("4.2.1988 on", "On ,30.12.1979"). Time se izbegava recenica u kojoj se "on"
    // pojavljuje slucajno, daleko od datuma.
    var dPos = dm.index + dm[1].length;
    var blizu = false, zm;
    PZ_ZAMENICA.lastIndex = 0;
    while ((zm = PZ_ZAMENICA.exec(red))) {
      var zPos = zm.index + zm[1].length;
      if (Math.abs(zPos - dPos) <= 25) { blizu = true; break; }
    }
    if (!blizu) continue;
    // Rodbina u istom ili susednom redu - to nije partner (npr. "moj sin 4.2.1988, on...")
    if (PZ_FAM.test(red)) continue;
    if (i > 0 && PZ_FAM.test(linije[i - 1])) continue;
    if (i + 1 < linije.length && PZ_FAM.test(linije[i + 1])) continue;
    var iso = pzIso(dm[2], dm[3], dm[4]);
    if (klijentDatum && iso === klijentDatum) continue;   // to je sam klijent
    var g = parseInt(iso.slice(0, 4), 10);
    if (g < 1900 || g > new Date().getFullYear()) continue;
    // Vreme: iz istog reda, a ako ga tu nema - iz sledeceg reda koji NEMA svoj datum
    var vreme = pzVreme(red.replace(dm[0], " "));
    if (!vreme && i + 1 < linije.length && !PZ_DATUM.test(linije[i + 1])) vreme = pzVreme(linije[i + 1]);
    kandidati.push({ datum: iso, vreme: vreme || "" });
  }
  if (kandidati.length !== 1) return null;
  return kandidati[0];
}

// ==================== OSOBE U ANALIZI (Marko 4.9. tura 2) ====================
// Radnica pre klika na Generisi vidi ko je ko sa kojim datumom (sta je AI izvukao iz
// pitanja) i moze da ispravi, obrise ili doda osobu. Generisanje koristi ISKLJUCIVO tu
// listu - to je najjaci lek za "mesa datume": greska ne moze ni da udje u analizu.
// Samo osobe sa ispravnim datumom rodjenja (1900..danas) ulaze u analizu.
export function osobeValidne(lista){
  if(!Array.isArray(lista))return [];
  var maxIso=new Date().toISOString().slice(0,10);
  return lista.filter(function(p){
    if(!p||!p.datum||!/^\d{4}-\d{2}-\d{2}$/.test(p.datum))return false;
    var y=parseInt(p.datum.slice(0,4),10);
    return y>=1900&&p.datum<=maxIso;
  }).map(function(p){
    return {ime:String(p.ime||"").trim(),odnos:String(p.odnos||"").trim(),datum:p.datum,vreme:String(p.vreme||"").trim(),mesto:String(p.mesto||"").trim()};
  });
}
// Blok za prompt. Backend po ovom markeru NE dodaje osobe regexom iz pitanja (radnica
// je listu vec potvrdila, mozda i obrisala pogresnu osobu). Format linija je isti kao
// u ostalim blokovima da ga zaglavlje i cuvar datuma umeju da procitaju.
export function osobeMarkerBlok(lista){
  var v=osobeValidne(lista);
  var linije=v.map(function(p){
    return "- "+(p.ime||"Osoba")+(p.odnos?" ("+p.odnos+")":"")+", rodjen/a "+p.datum.split("-").reverse().join(".")+(p.vreme?" u "+p.vreme:"")+(p.mesto?", "+p.mesto:"");
  });
  return "\n\n*** OSOBE IZ PITANJA (POTVRDILA RADNICA) ***\n"+
    (linije.length?linije.join("\n"):"(nema osoba sa datumom rodjenja u pitanjima)")+
    "\nOvo je KONACNA lista osoba iz pitanja sa datumima. Nijedna druga osoba iz pitanja NEMA datum rodjenja - za nju ne navodi datum, uzrast ni znak.\n";
}
