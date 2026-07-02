import React from 'react'
import { useState, useEffect, useRef } from "react";
import * as Sentry from '@sentry/react';
import { prettifyPitanja, fetchWithRetry, fetchSafe, conventionalSunSign, findNamePos, bindDatesToNames } from './lib/util.js';
import * as AstroEngine from 'astronomy-engine';

// Safe read za activeJobs iz localStorage. Ako je JSON pokvaren (npr. browser
// extension prepisao ili async write upola prekinut), brisemo kljuc i vracamo {}.
// Bez ovog wrappera, JSON.parse u setInterval iteraciji baca exception → polling
// se nikad ne zavrsi → radnica vidi "Generisem..." zauvek.
function safeActiveJobs(){
  try{return JSON.parse(localStorage.getItem("activeJobs")||"{}");}
  catch(e){try{localStorage.removeItem("activeJobs");}catch(_){}return {};}
}

// APSOLUTNI hard limit za job - 18 min. Backend worst-case ~11 min, +safety.
// KLJUCNA RAZLIKA od starog MAX_POLLS countera (per-poller): ovaj je nezavisan
// od restart-a polling-a. Suzana 11.6. prijava (777e363f): spinner 21:05 min jer
// je tab-switch resetovao pollCount svaki put. Sad citamo startedAt iz
// localStorage i poredimo sa Date.now() - restart polling-a NE pomaze da
// zaobidje limit.
var JOB_HARD_LIMIT_MS=18*60*1000;
function jobExpired(entry){
  if(!entry||!entry.startedAt)return false;
  return (Date.now()-entry.startedAt)>JOB_HARD_LIMIT_MS;
}

// ASTRO ENGINE -------------------------------------------------------------
const SIGNS=["Ovan","Bik","Blizanci","Rak","Lav","Devica","Vaga","Skorpija","Strelac","Jarac","Vodolija","Ribe"];
function r2d(r){return r*180/Math.PI;}
function d2r(d){return d*Math.PI/180;}
function norm(d){return((d%360)+360)%360;}
function jd(y,m,d,h){if(m<=2){y--;m+=12;}var A=Math.floor(y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+h/24+B-1524.5;}
// Geocentricna ekliptika longituda (equinox of date) preko astronomy-engine.
// Stari rucni plLon je racunao HELIOCENTRICNU longitudu (poziciju planete u njenoj
// orbiti oko Sunca, bez konverzije u pogled sa Zemlje) - Merkur je gresio i do 140°,
// Venera do 67°, Mars do 47°, tj. pogresan znak skoro uvek. Sunce/Mesec su bili OK.
// astronomy-engine se poklapa sa Swiss Ephemeris na <0.01° (provereno na 3 datuma).
function jdToDate(J){return new Date(Math.round((J-2440587.5)*86400000));}
function geoLon(J,body){
  var vec=AstroEngine.GeoVector(AstroEngine.Body[body],AstroEngine.MakeTime(jdToDate(J)),true);
  return norm(AstroEngine.Ecliptic(vec).elon);
}
function sunLon(J){
  try{return geoLon(J,"Sun");}catch(e){}
  var T=(J-2451545)/36525,M=d2r(norm(357.52911+35999.05029*T)),L0=280.46646+36000.76983*T,C=(1.914602-0.004817*T)*Math.sin(M)+(0.019993-0.000101*T)*Math.sin(2*M)+0.000289*Math.sin(3*M);return norm(L0+C);
}
function moonLon(J){
  try{return geoLon(J,"Moon");}catch(e){}
  var T=(J-2451545)/36525,L=218.3164477+481267.88123421*T,D=d2r(norm(297.8501921+445267.1114034*T)),M=d2r(norm(357.5291092+35999.0502909*T)),Mp=d2r(norm(134.9633964+477198.8675055*T)),F=d2r(norm(93.2720950+483202.0175233*T));return norm(L+6.288774*Math.sin(Mp)+1.274027*Math.sin(2*D-Mp)+0.658314*Math.sin(2*D)+0.213618*Math.sin(2*Mp)-0.185116*Math.sin(M)-0.114332*Math.sin(2*F)+0.058793*Math.sin(2*D-2*Mp)+0.057066*Math.sin(2*D-M-Mp)+0.053322*Math.sin(2*D+Mp)+0.045758*Math.sin(2*D-M));
}
function plLon(J,pl){
  try{return geoLon(J,pl);}catch(e){console.warn("geoLon failed for "+pl+":",e&&e.message);return 0;}
}
// Da li je planeta retrogradna na dan J (longituda opada u naredna 2 dana).
function isRetrograde(J,pl){
  try{
    var l1=geoLon(J,pl),l2=geoLon(J+2,pl);
    var d=l2-l1;if(d>180)d-=360;if(d<-180)d+=360;
    return d<0;
  }catch(e){return false;}
}
function ascLon(J,lat,lon){var T=(J-2451545)/36525,RAMC=norm(280.46061837+360.98564736629*(J-2451545)+lon),eps=23.439291111-0.013004167*T,r=d2r(RAMC),e=d2r(eps),la=d2r(lat);return norm(r2d(Math.atan2(Math.cos(r),-(Math.sin(r)*Math.cos(e)+Math.tan(la)*Math.sin(e)))));}
function mcLon(J,lon){var T=(J-2451545)/36525,RAMC=norm(280.46061837+360.98564736629*(J-2451545)+lon),eps=23.439291111-0.013004167*T;return norm(r2d(Math.atan2(Math.sin(d2r(RAMC)),Math.cos(d2r(RAMC))*Math.cos(d2r(eps)))));}
function getHouses(asc,mc,lat){
  if(typeof mc==="undefined")return getHousesEqual(asc);
  var h=[];h[0]=asc;h[9]=mc;h[6]=norm(asc+180);h[3]=norm(mc+180);
  var eps=23.4393,e=d2r(eps),la=d2r(lat);
  function placCusp(f){
    var ramc=d2r(norm(r2d(Math.atan2(Math.sin(d2r(mc))*Math.cos(e),Math.cos(d2r(mc))))));
    var off=[0,0,0,0,0,0,0,0,0,0,0,0];off[10]=30;off[11]=60;off[1]=120;off[2]=150;
    var ra=norm(r2d(ramc)+off[f]);
    var rr=d2r(ra);
    var D=1+2*Math.tan(la)*Math.tan(e)*Math.cos(rr);
    if(Math.abs(D)<0.001)return norm(asc+((f-1+12)%12)*30);
    var tanL=Math.sin(rr)/(Math.cos(rr)*Math.cos(e)-Math.sin(e)*Math.tan(la)*((f===11||f===2)?1/3:(f===10||f===1)?2/3:1));
    return norm(r2d(Math.atan(tanL))+(Math.cos(rr)<0?180:0));
  }
  [10,11,1,2].forEach(function(i){h[i]=placCusp(i);});
  h[4]=norm(h[10]+180);h[5]=norm(h[11]+180);h[7]=norm(h[1]+180);h[8]=norm(h[2]+180);
  return h;
}
function getHousesEqual(a){var h=[];for(var i=0;i<12;i++)h.push(norm(a+i*30));return h;}
function inHouse(deg,cusps){for(var i=0;i<12;i++){var s=cusps[i],e=cusps[(i+1)%12];if(s<=e){if(deg>=s&&deg<e)return i+1;}else if(deg>=s||deg<e)return i+1;}return 1;}
function signOf(deg){return SIGNS[Math.floor(norm(deg)/30)];}
function degIn(deg){return(norm(deg)%30).toFixed(1);}
function tzOffsetHours(y,m,d,h,mn,tzName){
  if(!tzName)return null;
  try{
    function offAt(utcMs){
      var dtf=new Intl.DateTimeFormat('en-US',{timeZone:tzName,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
      var parts=dtf.formatToParts(new Date(utcMs)),mp={};
      for(var i=0;i<parts.length;i++)mp[parts[i].type]=parts[i].value;
      var hh=parseInt(mp.hour,10);if(hh===24)hh=0;
      var pl=Date.UTC(parseInt(mp.year,10),parseInt(mp.month,10)-1,parseInt(mp.day,10),hh,parseInt(mp.minute,10));
      return(pl-utcMs)/3600000;
    }
    var localAsUtc=Date.UTC(y,m-1,d,h,mn);
    var off1=offAt(localAsUtc);
    return offAt(localAsUtc-off1*3600000);
  }catch(e){return null;}
}
// conventionalSunSign je sad u src/lib/util.js (testabilno + jedan izvor istine).

function calcChart(dateStr,timeStr,lat,lon,tz){
  var parts=dateStr.split("-"),y=parseInt(parts[0]),m=parseInt(parts[1]),d=parseInt(parts[2]);
  var tparts=(timeStr||"12:00").split(":"),h=parseInt(tparts[0]),mn=parseInt(tparts[1]);
  var off=tzOffsetHours(y,m,d,h,mn,tz||"Europe/Belgrade");
  var ut=off!=null?(h+mn/60-off):(h+mn/60-lon/15);
  var J=jd(y,m,d,ut);
  var pos={Sunce:sunLon(J),Mesec:moonLon(J),Merkur:plLon(J,"Mercury"),Venera:plLon(J,"Venus"),Mars:plLon(J,"Mars"),Jupiter:plLon(J,"Jupiter"),Saturn:plLon(J,"Saturn"),Uran:plLon(J,"Uranus"),Neptun:plLon(J,"Neptune"),Pluton:plLon(J,"Pluto")};
  var ad=timeStr?ascLon(J,lat,lon):null,mc=timeStr?mcLon(J,lon):null,hs=ad!=null?getHouses(ad,mc,lat):null;
  var planets=[];
  var pnames=Object.keys(pos);
  for(var i=0;i<pnames.length;i++){var n=pnames[i],deg=pos[n];planets.push({name:n,sign:signOf(deg),degInSign:degIn(deg),house:hs?inHouse(deg,hs):null});}
  var ATYPES=[{n:"Konjunkcija",a:0,o:10},{n:"Opozicija",a:180,o:10},{n:"Trigon",a:120,o:8},{n:"Kvadrat",a:90,o:8},{n:"Sekstil",a:60,o:6},{n:"Kvinkunks",a:150,o:3}];
  var LUM=["Sunce","Mesec"],aspects=[];
  var keys=Object.keys(pos);
  for(var i=0;i<keys.length;i++){for(var j=i+1;j<keys.length;j++){var p1=keys[i],p2=keys[j],raw=norm(pos[p1]-pos[p2]),df=raw>180?360-raw:raw;for(var k=0;k<ATYPES.length;k++){var t=ATYPES[k],mo=t.o+(LUM.indexOf(p1)>=0||LUM.indexOf(p2)>=0?2:0),ob=Math.abs(df-t.a);if(ob<=mo)aspects.push({p1:p1,p2:p2,aspect:t.n,orb:ob.toFixed(2)});}}}
  aspects.sort(function(a,b){return parseFloat(a.orb)-parseFloat(b.orb);});
  var houses=[];
  if(hs){for(var i=0;i<12;i++){houses.push({num:i+1,sign:signOf(hs[i]),deg:degIn(hs[i])});}}
  // Kad korisnik NEMA pravo vreme rodjenja, koristimo astronomski znak (calcChart sa default
  // podne) sto je losse za cusp datume. Tipican slucaj: partner 23.8 - astronomski je Lav za
  // neku godinu jer Sunce prelazi u Devicu posle podne, ali korisnik ocekuje Devicu (newspaper
  // konvencija). Konvencionalni znak je tacan defaultni odgovor kad ne znamo vreme.
  var sunSignFinal=signOf(pos.Sunce);
  var hasUserTime=timeStr&&timeStr.trim().length>0;
  if(!hasUserTime){
    var conv=conventionalSunSign(dateStr);
    if(conv)sunSignFinal=conv;
  }
  return{sunSign:sunSignFinal,moonSign:signOf(pos.Mesec),ascSign:ad?signOf(ad):"Nepoznato",ascDeg:ad?degIn(ad):"0",planets:planets,aspects:aspects,houses:houses,source:"local-astronomy-engine"};
}
// Trenutne (tranzitne) pozicije sporih planeta za DANAS, izracunato lokalno.
// Garantovani fallback kad /api/astro/transits ne odgovori (Render spava) — bez ovoga
// prompt nema NIKAKVE podatke o trenutnom nebu pa AI izmisli pozicije iz training data
// (otud "2024/2025" i pogresni znakovi u prognozama).
function localTransitPositions(){
  try{
    var now=new Date();
    var J=jd(now.getUTCFullYear(),now.getUTCMonth()+1,now.getUTCDate(),now.getUTCHours()+now.getUTCMinutes()/60);
    var names=[["Mars","Mars"],["Jupiter","Jupiter"],["Saturn","Saturn"],["Uranus","Uran"],["Neptune","Neptun"],["Pluto","Pluton"]];
    var out=[];
    for(var i=0;i<names.length;i++){
      var deg=geoLon(J,names[i][0]);
      out.push({planet:"T."+names[i][1],sign:signOf(deg),deg:degIn(deg),retrograde:isRetrograde(J,names[i][0])});
    }
    return out;
  }catch(e){console.warn("localTransitPositions failed:",e&&e.message);return [];}
}
var CITIES={beograd:[44.8176,20.4633],"novi sad":[45.2671,19.8335],nis:[43.3209,21.8954],sarajevo:[43.8476,18.3564],zagreb:[45.8150,15.9819],split:[43.5081,16.4402],rijeka:[45.3271,14.4422],osijek:[45.5550,18.6955],doboj:[44.7333,18.0833],tuzla:[44.5384,18.6734],"banja luka":[44.7722,17.1910],podgorica:[42.4411,19.2636],skopje:[41.9981,21.4254],london:[51.5074,-0.1278],berlin:[52.5200,13.4050],wien:[48.2082,16.3738],paris:[48.8566,2.3522],"new york":[40.7128,-74.0060],dubai:[25.2048,55.2708],munich:[48.1351,11.5820],stuttgart:[48.7758,9.1829],frankfurt:[50.1109,8.6821],hamburg:[53.5753,10.0153]};
function getCoords(city){if(!city)return[44.8176,20.4633];var k=city.toLowerCase().trim();var keys=Object.keys(CITIES);for(var i=0;i<keys.length;i++){if(k.indexOf(keys[i])>=0||keys[i].indexOf(k)>=0)return CITIES[keys[i]];}return[44.8176,20.4633];}

// TEXT UTILS ---------------------------------------------------------------
// Normalizuj string za pretragu: lowercase + ukloni dijakritike (š→s, č→c, ž→z, ć→c, đ→d).
// Tako "sasa" pronalazi "Saša", "djordje" → "Đorđe", itd.
function normSearch(s){
  if(!s)return "";
  var t=s.toLowerCase()
    .replace(/đ/g,"d").replace(/ž/g,"z").replace(/č/g,"c").replace(/ć/g,"c").replace(/š/g,"s")
    .replace(/dj/g,"d"); // korisnik kuca "djordje" za "Đorđe"
  try{return t.normalize("NFD").replace(/[̀-ͯ]/g,"");}catch(e){return t;}
}
function fmtText(text){
  if(!text)return text;
  // Replace Cyrillic characters with Latin equivalents
  var cyrMap={"а":"a","б":"b","в":"v","г":"g","д":"d","ђ":"dj","е":"e","ж":"z","з":"z","и":"i","й":"j","к":"k","л":"l","љ":"lj","м":"m","н":"n","њ":"nj","о":"o","п":"p","р":"r","с":"s","т":"t","ћ":"c","у":"u","ф":"f","х":"h","ц":"c","ч":"c","џ":"dz","ш":"s","А":"A","Б":"B","В":"V","Г":"G","Д":"D","Ђ":"Dj","Е":"E","Ж":"Z","З":"Z","И":"I","Й":"J","К":"K","Л":"L","Љ":"Lj","М":"M","Н":"N","Њ":"Nj","О":"O","П":"P","Р":"R","С":"S","Т":"T","Ћ":"C","У":"U","Ф":"F","Х":"H","Ц":"C","Ч":"C","Џ":"Dz","Ш":"S","ј":"j","Ј":"J"};
  var t=text.replace(/[а-яА-ЯђћџљњјЂЋЏЉЊЈ]/g,function(c){return cyrMap[c]||c;});
  // Privremeno sacuvaj heart emoji (smije ostati uz "Astrolog Suzana")
  t=t.replace(/❤️|❤|♥/g,"___HEART___");
  // Ukloni AI-tell simbole (checkmarks, X marks, arrows, decorative bullets, emoji)
  t=t.replace(/[✀-➿]/g,""); // dingbats: ✅✓✔✗✘❌➡❤
  t=t.replace(/[←-⇿]/g,""); // arrows: →←↑↓⇒⇐
  t=t.replace(/[■-◿]/g,""); // geometric: ▪▫■□◆◇●○
  t=t.replace(/[☀-⛿]/g,""); // misc symbols: ★☆☑☒♥♦
  t=t.replace(/[\u{1F300}-\u{1FAFF}]/gu,""); // emoji ranges: 📌📝💡🎯🌟✨🔮 etc
  t=t.replace(/[\u{1F000}-\u{1F2FF}]/gu,""); // additional emoji ranges
  // Vrati heart emoji
  t=t.replace(/___HEART___/g,"❤️");
  // Ukloni astrolosku tehnicku notaciju ("T.Saturn" -> "Saturn", "T. Jupiter" -> "Jupiter", "Tranzitni Pluton" -> "Pluton")
  t=t.replace(/\bT\.\s*(?=(Sunce|Mesec|Merkur|Venera|Mars|Jupiter|Saturn|Uran|Neptun|Pluton|Sun|Moon|Mercury|Venus|Jupiter|Saturn|Uranus|Neptune|Pluto)\b)/gi,"");
  t=t.replace(/\b(Tr|Trans|Transit|Tranzit|Tranzitni|Tranzitna|Tranzitno|Tranzitne|Tranzitnog|Tranzitnoj)\.?\s+(?=(Sunce|Mesec|Merkur|Venera|Mars|Jupiter|Saturn|Uran|Neptun|Pluton)\b)/gi,"");
  // Ukloni AI beleske/kalkulacije u zagradama ('(podaci: ...)', '(napomena: ...)', '(pretpostavka: ...)', '(verovatno ...)')
  t=t.replace(/\s*\(podaci:[^)]*\)/gi,"");
  t=t.replace(/\s*\(napomena:[^)]*\)/gi,"");
  t=t.replace(/\s*\(pretpostavka:[^)]*\)/gi,"");
  t=t.replace(/\s*\(verovatno[^)]*\)/gi,"");
  t=t.replace(/\s*\(moguce[^)]*\)/gi,"");
  t=t.replace(/\s*\(moguće[^)]*\)/gi,"");
  // Ukloni AI disclaimer-recenice koje pominju sta AI ne moze / sta nedostaje
  t=t.replace(/\bZa dublju analizu[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bZa precizniju analizu[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bNemam podatke[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bBez tacnog vremena rodjenja[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bBez tačnog vremena rođenja[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bIdealno bi bilo[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bBila bi potrebna[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bbilo bi potrebno[^.!?]*(karta|podataka|vreme|vremena)[^.!?]*[.!?]\s*/gi,"");
  t=t.replace(/\bNe mogu (da|bez)[^.!?]*(vidim|odredim|precizno|videti)[^.!?]*[.!?]\s*/gi,"");
  // Zameni engleske reci koje su nekad ostale u srpskom prevodu
  t=t.replace(/\bFORECAST\b/g,"PROGNOZA");
  t=t.replace(/\bForecast\b/g,"Prognoza");
  t=t.replace(/\bforecast\b/g,"prognoza");
  t=t.replace(/\bANALYSIS\b/g,"ANALIZA");
  t=t.replace(/\bAnalysis\b/g,"Analiza");
  t=t.replace(/\banalysis\b/g,"analiza");
  t=t.replace(/\bREPORT\b/g,"IZVESTAJ");
  t=t.replace(/\bOVERVIEW\b/g,"PREGLED");
  t=t.replace(/\bSUMMARY\b/g,"REZIME");
  t=t.replace(/\bCONCLUSION\b/g,"ZAKLJUCAK");
  t=t.replace(/\bINSIGHTS\b/g,"UVIDI");
  t=t.replace(/\bIMPORTANT\b/g,"VAZNO");
  t=t.replace(/\bWARNING\b/g,"UPOZORENJE");
  t=t.replace(/\bNOTE\b/g,"NAPOMENA");
  t=t.replace(/\bJanuary\b/g,"januar").replace(/\bFebruary\b/g,"februar").replace(/\bMarch\b/g,"mart").replace(/\bApril\b/g,"april").replace(/\bMay\b/g,"maj").replace(/\bJune\b/g,"jun").replace(/\bJuly\b/g,"jul").replace(/\bAugust\b/g,"avgust").replace(/\bSeptember\b/g,"septembar").replace(/\bOctober\b/g,"oktobar").replace(/\bNovember\b/g,"novembar").replace(/\bDecember\b/g,"decembar");
  // Ukloni AI "razmisljanje naglas" fraze ("Ne bas, ali otprilike", "Zapravo,", "(ako pretpostavimo)", "(vec u aspektu)")
  t=t.replace(/\s*\(ako pretpostavimo\)/gi,"");
  t=t.replace(/\s*\(vec u aspektu\)/gi,"");
  t=t.replace(/\s*\(već u aspektu\)/gi,"");
  t=t.replace(/\s*u zavisnosti od aspekta\.?/gi,"");
  // Ukloni AI "iskrenost preambule" - pravi astrolog nikad ne najavljuje iskrenost, samo je iskren
  // Konzervativno: strip samo cele standalone filler-recenice koje nemaju substancu posle
  t=t.replace(/(^|[.!?]\s+|\n\s*)Bi[cć]u (potpuno |sad |sada )?iskren[ao](\s+s[ae]?\s+tobom)?(\s*,\s*bez (uvijanja|okoli[sš]anja))?\s*\.\s*/gi,"$1");
  t=t.replace(/(^|[.!?]\s+|\n\s*)Da budem (potpuno |sad |sada )?iskren[ao](\s+s[ae]?\s+tobom)?(\s*,\s*bez (uvijanja|okoli[sš]anja))?\s*\.\s*/gi,"$1");
  // Inline "bez uvijanja/okolisanja" - skidaj samo komentar, zadrzi okolnu recenicu
  t=t.replace(/,\s*bez uvijanja\b/gi,"");
  t=t.replace(/,\s*bez okoli[sš]anja\b/gi,"");
  // Ukloni "verovatno"/"mozda"/"negde" speculaciju o tudjim Mesec/Ascendent/kucama
  t=t.replace(/(^|[.!?]\s+|\n\s*)[^.!?\n]{0,80}(Mesec|Ascendent|Mjesec|asc(?:endent)?)[^.!?\n]{0,80}(verovatno|vjerovatno|mozda|možda|negde|negdje|priblizno|pretpostavljam)[^.!?\n]{0,80}[.!?]\s*/gi,"$1");
  t=t.replace(/(^|[.!?]\s+|\n\s*)[^.!?\n]{0,80}(verovatno|vjerovatno|mozda|možda|negde|negdje|priblizno|pretpostavljam)[^.!?\n]{0,80}(Mesec|Ascendent|Mjesec|asc(?:endent)?)[^.!?\n]{0,80}[.!?]\s*/gi,"$1");
  // Vokativ + prva recenica MORAJU biti na istoj liniji - ukloni newline-ove odmah posle prvog vokativa
  t=t.replace(/^([^,\n]{1,30},)\s*\n+\s*([A-ZČĆĐŠŽ])/,function(m,p1,p2){return p1+" "+p2.toLowerCase();});
  // Ukloni uvodni preamble posle vokativa (safety net ako AI ipak ubaci)
  t=t.replace(/^([^,\n]{1,30},\s+)(evo tvoje[^.]{5,200}\.\s*|evo ti detaljn[^.]{5,200}\.\s*|na osnovu (tvoje|vasih|vaših)[^.]{5,200}(videcemo|videćemo|videces|videćeš|ceka|čeka|cekaju|čekaju)[^.]{0,200}\.\s*|videcemo (sta|šta|da) [^.]{5,200}\.\s*|videćemo (sta|šta|da) [^.]{5,200}\.\s*|donosim ti [^.]{5,200}\.\s*|krecemo sa [^.]{5,200}\.\s*|krećemo sa [^.]{5,200}\.\s*)/i,"$1");
  return t.replace(/^#{1,6}\s*/gm,"").replace(/^\s*---+\s*$/gm,"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1").replace(/^[-–—*•]\s*/gm,"").replace(/__/g,"").replace(/ [-–—] /g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function getChunks(text,max){
  if(!max)max=2900;
  var ch=[],pos=0;
  function isUpper(c){return !!c&&"ABCDEFGHIJKLMNOPQRSTUVWXYZČĆĐŠŽ".indexOf(c)>=0;}
  function isSentEnd(i){
    var c=text[i];
    if(c!=="."&&c!=="!"&&c!=="?")return false;
    var n1=text[i+1];
    if(!n1)return true;
    if(n1==="\n"||n1==="\r")return true;
    if(n1===" "||n1==="\t"){
      var j=i+2;
      while(j<text.length&&(text[j]===" "||text[j]==="\t"))j++;
      var nn=text[j];
      if(!nn||nn==="\n"||nn==="\r")return true;
      return isUpper(nn);
    }
    return false;
  }
  while(pos<text.length){
    if(pos+max>=text.length){ch.push(text.slice(pos).trim());break;}
    var end=-1;
    for(var i=pos+max;i>pos;i--){if(isSentEnd(i)){end=i+1;break;}}
    if(end<0){
      for(var k=pos+max;k>pos;k--){if(text[k]==="\n"){end=k;break;}}
    }
    if(end<0){
      for(var s=pos+max;s>pos;s--){
        if(text[s]===" "){
          var prev=text[s-1];
          if(prev==="."&&/\d/.test(text[s+1]||""))continue;
          end=s;break;
        }
      }
    }
    if(end<0)end=pos+max;
    ch.push(text.slice(pos,end).trim());
    pos=end;
    while(pos<text.length&&(text[pos]===" "||text[pos]==="\t"||text[pos]==="\n"||text[pos]==="\r"))pos++;
  }
  return ch.filter(function(x){return x.length>0;});
}
// Analiza chunks + promo poruka kao zaseban poslednji chunk (samo SR, samo realna analiza).
function getAnalizaChunks(text,country){
  var ch=getChunks(text);
  if(!text||country!=="sr")return ch;
  var t=text.trim();
  if(t.length<=200)return ch;
  if(/^(Greska|Generisem)/i.test(t))return ch;
  ch.push(PROMO_DOWNSELL_SR);
  return ch;
}
function cpText(t){var el=document.createElement("textarea");el.value=t;el.style.cssText="position:fixed;left:-9999px;top:0;opacity:0;";document.body.appendChild(el);el.focus();el.select();el.setSelectionRange(0,99999);document.execCommand("copy");document.body.removeChild(el);}
// fmtDMY: returns a date as DD.MM.YYYY (zero-padded, Europe/Belgrade timezone). Standard format across UI.
function fmtDMY(d){var p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Belgrade",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);var dd="",mm="",yy="";for(var i=0;i<p.length;i++){if(p[i].type==="day")dd=p[i].value;else if(p[i].type==="month")mm=p[i].value;else if(p[i].type==="year")yy=p[i].value;}return dd+"."+mm+"."+yy;}
// fmtDMYFromISO: takes a YYYY-MM-DD string from DB and returns DD.MM.YYYY. Returns input as-is if not ISO.
function fmtDMYFromISO(iso){if(!iso||typeof iso!=="string")return iso||"";var m=iso.match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return iso;return m[3]+"."+m[2]+"."+m[1];}
function belgradeDate(d){return fmtDMY(d);}
function belgradeTime(d){return d.toLocaleTimeString("sr-RS",{timeZone:"Europe/Belgrade",hour:"2-digit",minute:"2-digit"});}
function belgradeDateTime(d){return belgradeDate(d)+", "+belgradeTime(d);}
function belgradeRawDate(d){var fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Belgrade",year:"numeric",month:"2-digit",day:"2-digit"});return fmt.format(d);}

// PlaceStatus - status row ispod Mesto/Zemlja polja: ✅ ok | ⏳ pending | dropdown za ambiguous | ❌ not_found | ⚠️ error
function PlaceStatus(props){
  var person=props.person||{};
  var st=person.placeStatus||"";
  var opts=person.placeOptions||[];
  if(!st)return null;
  if(st==="pending")return React.createElement("div",{style:{fontSize:"11px",color:"var(--mt)",padding:"4px 0"}},"⏳ Trazim mesto...");
  if(st==="ok"&&person.lat!=null){
    return React.createElement("div",{style:{fontSize:"11px",color:"#3a8a3a",padding:"4px 0"}},
      "✅ ",person.mesto,(person.zemlja?", "+person.zemlja:""),
      React.createElement("span",{style:{color:"var(--mt)",marginLeft:"6px"}},"("+person.lat.toFixed(2)+", "+person.lon.toFixed(2)+", "+(person.timezone||"")+")")
    );
  }
  if(st==="ambiguous"&&opts.length>0){
    return React.createElement("div",{style:{padding:"4px 0"}},
      React.createElement("div",{style:{fontSize:"11px",color:"#b87010",marginBottom:"4px"}},"⚠ Vise rezultata - izaberi:"),
      React.createElement("select",{style:{width:"100%",padding:"6px",fontSize:"12px",borderRadius:"4px"},onChange:function(e){var i=parseInt(e.target.value);if(!isNaN(i)&&opts[i])props.onPick(opts[i]);},defaultValue:""},
        React.createElement("option",{value:"",disabled:true},"-- izaberi mesto --"),
        opts.map(function(o,i){return React.createElement("option",{key:i,value:i},o.displayName);})
      )
    );
  }
  if(st==="not_found")return React.createElement("div",{style:{fontSize:"11px",color:"var(--red)",padding:"4px 0"}},"❌ Mesto nije pronadjeno - proveri ime grada i zemlje");
  if(st==="error")return React.createElement("div",{style:{fontSize:"11px",color:"var(--red)",padding:"4px 0"}},"⚠ Geocoding nije dostupan - koristice se Beograd fallback");
  return null;
}

// DateInput3 - 3 odvojena polja za dan/mesec/godinu. Interno drzi DD/MM/GGGG lokalno, onChange dobija YYYY-MM-DD samo kad su sva 3 popunjena.
function DateInput3(props){
  var initParts=(props.value||"").split("-");
  var initY=initParts[0]||"",initM=(initParts[1]||"").replace(/^0/,""),initD=(initParts[2]||"").replace(/^0/,"");
  var ddState=React.useState(initD),dd=ddState[0],setDD=ddState[1];
  var mmState=React.useState(initM),mm=mmState[0],setMM=mmState[1];
  var yyState=React.useState(initY),yy=yyState[0],setYY=yyState[1];
  var lastSyncRef=React.useRef(props.value||"");
  React.useEffect(function(){
    // Sinhronizuj interno state sa props.value kad se spolja promeni (npr. Nova analiza clear)
    var v=props.value||"";
    if(v===lastSyncRef.current)return;
    lastSyncRef.current=v;
    if(!v){setDD("");setMM("");setYY("");return;}
    var p=v.split("-");
    if(p.length===3){
      setYY(p[0]||"");
      setMM((p[1]||"").replace(/^0/,""));
      setDD((p[2]||"").replace(/^0/,""));
    }
  },[props.value]);
  function emit(nd,nm,ny){
    var cd=(nd||"").replace(/\D/g,"").slice(0,2);
    var cm=(nm||"").replace(/\D/g,"").slice(0,2);
    var cy=(ny||"").replace(/\D/g,"").slice(0,4);
    if(cd&&cm&&cy.length===4){
      var padD=cd.padStart(2,"0"),padM=cm.padStart(2,"0");
      var out=cy+"-"+padM+"-"+padD;
      lastSyncRef.current=out;
      props.onChange(out);
    }else{
      // nepotpuno — ako je props.value imao nesto, pozovi onChange("") tako da clientId reset radi
      if(props.value){lastSyncRef.current="";props.onChange("");}
    }
  }
  var inputStyle={background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"6px",padding:"8px",color:"var(--tx)",fontFamily:"'Jost',sans-serif",fontSize:"14px",textAlign:"center",width:"100%"};
  return React.createElement("div",{style:{display:"flex",gap:"6px",alignItems:"center"}},
    React.createElement("input",{type:"text",placeholder:"DD",value:dd,onChange:function(e){var v=e.target.value.replace(/\D/g,"").slice(0,2);setDD(v);emit(v,mm,yy);},style:Object.assign({},inputStyle,{flex:"0 0 60px"}),inputMode:"numeric",maxLength:2}),
    React.createElement("span",{style:{color:"var(--mt)"}},"."),
    React.createElement("input",{type:"text",placeholder:"MM",value:mm,onChange:function(e){var v=e.target.value.replace(/\D/g,"").slice(0,2);setMM(v);emit(dd,v,yy);},style:Object.assign({},inputStyle,{flex:"0 0 60px"}),inputMode:"numeric",maxLength:2}),
    React.createElement("span",{style:{color:"var(--mt)"}},"."),
    React.createElement("input",{type:"text",placeholder:"GGGG",value:yy,onChange:function(e){var v=e.target.value.replace(/\D/g,"").slice(0,4);setYY(v);emit(dd,mm,v);},style:Object.assign({},inputStyle,{flex:"1"}),inputMode:"numeric",maxLength:4})
  );
}

// PROMPTS ------------------------------------------------------------------
var PR_SR_MAIN="Ja sam Astrolog Suzana. Na osnovu podataka napisi jednu detaljnu i opsirnu astrološku analizu. Ti si vrhunski zenski astrolog sa 30 godina iskustva. Analiza obuhvata ljubav i posao u narednih 12 meseci. Na pitanja odgovaraj jasno bez mozda, koristi bice i ce. Gledaj 7. kucu za partnerstvo, orbe aspekata. Pises kao zena, koristi zenski rod (napisala sam, videla sam). Pocni imenom u vokativu sa zarezom, ODMAH bez uvoda. Bez emojija u telu, bez crtica, bez ## --- **. Budi brutalno iskren/a. Na kraju: Hvala ti puno na poverenju i zelim ti zivot ispunjen mirom, radoscu i srecom.\nAstrolog Suzana";
var PR_SR_DS="Na osnovu analize napisi TACNE PERIODE u narednih 12 meseci. Fokus: konkretni datumi promena, kada pokrenuti, kada cekati, periodi energije, rizicni periodi, da li ce se planovi realizovati. Pisi na srpskom ekavicom, sa ti, zenski rod, brutalno iskren/a. Bez emojija, bez ## --- **, bez crtica. Konkretni datumi od - do. NIKAD se ne izvinjavaj za prethodnu analizu i ne pisi 'preuzimam odgovornost', 'promasila sam', 'moja prethodna analiza je pogresno prikazala'. Ne ponavljaj klijentove zalbe ('kazes mi da', 'cujem te', 'razumem te', 'slusam te'). Astrolog se NIKAD ne pravda i NIKAD ne potvrdjuje empaticki - daje samo konkretne periode i datume bez ikakvog introa ili validacije.";
var PR_HR_MAIN="Ja sam Astrolog Marija. Poslat cu ti podatke o osobi. Na temelju toga napisi jednu detaljnu i opsirnu astrološku analizu, jer si ti vrhunski astrolog s vise od 30 godina iskustva. Analiza treba obuhvatiti ljubav i posao u narednih 12 mjeseci. Na sva izravna pitanja odgovori jasno bez mozda, koristi bit ce i ce. Gledaj aspekte i kuce, posebno 7. kucu. Gledaj orb aspekata. Analizom zapocni imenom osobe. Obracaj se izravno sa ti. Bez emojija, bez crtica, bez ## --- **. Budi brutalno iskren. Pisi na hrvatskom jeziku. Gramaticki ispravno. Na kraju: Hvala ti puno na povjerenju i zelim ti zivot ispunjen mirom, radoscu i srecom.\nAstrolog Marija";
var PR_HR_DS="Na osnovu analize napisi TOCNE PERIODE u narednih 12 mjeseci. Fokus: konkretni datumi promjena, kada pokrenuti, kada cekati, periodi energije, rizicni periodi, da li ce se planovi ostvariti. Pisi na hrvatskom jeziku, sa ti, brutalno iskren/a. Bez emojija, bez ## --- **, bez crtica. Konkretni datumi od - do. NIKAD se ne ispricavaj za prethodnu analizu i ne pisi 'preuzimam odgovornost', 'pogrijesila sam', 'moja prethodna analiza je krivo prikazala'. Ne ponavljaj klijentove zalbe ('kazes mi da', 'cujem te', 'razumijem te', 'slusam te'). Astrolog se NIKAD ne pravda i NIKAD ne potvrdjuje empaticki - daje samo konkretne periode i datume bez ikakvog uvoda ili validacije.";
var PROMO_DOWNSELL_SR="Moram još da Vam kažem, pošto ste već poručili analizu kod mene i imam vašu natalnu kartu pa mogu sve da vidim, postoji još jedna stvar koju većina klijenata uzme uz svoju godišnju analizu, a to su tačni periodi u narednih 12 meseci kada Vam se dešavaju ključne promene i da li će se realizovati ono što ste naumili.\n\nDobijate precizno izdvojene periode kada je najbolje da nešto pokrenete, kada da sačekate, kada da iskoristite svoju energiju na maksimum i kada je važno da izbegnete pogrešne poteze, konflikte ili loše odluke. Takođe, kroz tranzite da li će se realizovati nešto što ste naumili.\n\nMogu Vam izdvojiti najvažnije datume i periode za narednih 12 meseci, uz konkretna uputstva šta da radite u tim momentima, kako biste sve što dolazi iskoristili na najbolji način. Uz to dobijate i pravo da postavite 5 dodatnih pitanja.\n\nCena ovog dodatka je 1.000 dinara sa popustom, jer ste već poručili analizu kod mene, a sve Vam šaljem ovde u pisanom obliku preko Messengera, tako da uvek možete da sačuvate i pročitate kada Vam zatreba.\n\nJavite mi kada da vam pošaljem.";

// API ----------------------------------------------------------------------
// Ukloni iz teksta sve tokene osobe (ime, datum u svim formatima, vreme, mesto).
// Koristi se da se iz raw Messenger poruke "skinu" podaci koji su vec parsirani u
// klijent/partner polja, da ostane samo pitanje/komentar tekst za pitanja polje.
function stripDataFromText(text,person){
  if(!person||!text)return text;
  var t=text;
  function esc(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
  if(person.ime){
    t=t.replace(new RegExp("\\b"+esc(person.ime)+"\\b","gi"),"");
  }
  if(person.datum&&/^\d{4}-\d{2}-\d{2}$/.test(person.datum)){
    var p=person.datum.split("-");
    var y=p[0],m=p[1],d=p[2];
    var mU=String(parseInt(m,10)),dU=String(parseInt(d,10));
    var ySh=y.slice(2);
    // Pokrij DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, DD MM YYYY (sa i bez vodece nule), DDMMYYYY, YYYY-MM-DD, DD.MM.YY
    var pats=[];
    [d,dU].forEach(function(dd){
      [m,mU].forEach(function(mm){
        [y,ySh].forEach(function(yy){
          pats.push(dd+"\\s*[\\.\\-\\/]\\s*"+mm+"\\s*[\\.\\-\\/]\\s*"+yy+"\\.?");
          pats.push(dd+"\\s+"+mm+"\\s+"+yy);
        });
      });
    });
    pats.push(d+m+y); // DDMMYYYY
    pats.push(y+"\\s*[\\-\\.]\\s*"+m+"\\s*[\\-\\.]\\s*"+d); // YYYY-MM-DD
    t=t.replace(new RegExp("\\b("+pats.join("|")+")\\b","g"),"");
  }
  if(person.vreme&&/^\d{2}:\d{2}$/.test(person.vreme)){
    var v=person.vreme.split(":");
    var h=v[0],mn=v[1];
    var hU=String(parseInt(h,10)),mnU=String(parseInt(mn,10));
    var tp=[];
    [h,hU].forEach(function(hh){
      [mn,mnU].forEach(function(mm){
        tp.push(hh+"\\s*[:\\.\\-h]\\s*"+mm);
      });
    });
    tp.push(h+mn); // 1040
    t=t.replace(new RegExp("\\b("+tp.join("|")+")\\b","g"),"");
  }
  if(person.mesto){
    t=t.replace(new RegExp("\\b"+esc(person.mesto)+"\\b","gi"),"");
  }
  return t;
}
// Ekstrahuj sva HH:MM vremena iz sirovog teksta (paste). Tretira AM/PM i srpske oznake.
// Paste je izvor istine — vraca tacno ono sto je korisnik nalepio, bez LLM interpretacije.
function extractTimesFromPaste(rawText){
  if(!rawText)return [];
  var times=[];
  // markerGrp: AM/PM oznaka u srpskom/EN - posle vremena moze stajati "popodne", "u noci",
  // "posle ponoci" (dodato 8.6.2026. Suzana prijava: klijent rekao "01,00 posle ponoći" -
  // parser ga je ignorisao i koristio staro vreme iz prethodnog klijenta).
  var markerGrp="(?:\\s*(a\\.?m\\.?|p\\.?m\\.?|popodne|po\\s+podne|uvece|nave[čc]e|ujutru|ujutro|no[ćc]u|u\\s+no[ćc]i|pre\\s+podne|posle\\s+pono[ćc]i|po\\s+pono[ćc]i|pre\\s+pono[ćc]i))?";
  function applyMarker(h,marker){
    marker=(marker||"").toLowerCase().replace(/\s+/g," ");
    var pm=/^p\.?m\.?$/.test(marker)||/^(popodne|po podne|uvece|nave[čc]e|navece|pre pono[ćc]i)$/.test(marker);
    var am=/^a\.?m\.?$/.test(marker)||/ujutru|ujutro|no[ćc]u|u no[ćc]i|pre podne|posle pono[ćc]i|po pono[ćc]i/.test(marker);
    // PM logika: 1-11 PM → 13-23. 12 PM ostaje 12. 13+ je vec 24h notacija - ne diraj
    // (stari bug: "20,30 navece" je davao 32:30 jer "if(h!==12)h+=12").
    if(pm){if(h>=1&&h<=11)h+=12;}
    else if(am){if(h===12)h=0;}
    return h;
  }
  // 1) HH:MM (dvotacka)
  var re=new RegExp("(\\d{1,2}):(\\d{2})(?:\\s*[hH]\\b)?"+markerGrp,"gi");
  var m;
  while((m=re.exec(rawText))!==null){
    var h=parseInt(m[1],10),mn=parseInt(m[2],10);
    if(h>23||mn>59)continue;
    h=applyMarker(h,m[3]);
    times.push(String(h).padStart(2,"0")+":"+String(mn).padStart(2,"0"));
  }
  // 2) HH.MM (tacka) — npr "18.30", "20.40". Tacka je i separator datuma, pa
  // odbacujemo kandidata kome odmah sledi separator+cifra (deo datuma 17.10.1970 ili 20.08 1970).
  var reDot=new RegExp("\\b(\\d{1,2})\\.(\\d{2})(?!\\d)(?![.\\/ ]\\d)(?:\\s*[hH]\\b)?"+markerGrp,"gi");
  var md;
  while((md=reDot.exec(rawText))!==null){
    var hd=parseInt(md[1],10),mnd=parseInt(md[2],10);
    if(hd>23||mnd>59)continue;
    hd=applyMarker(hd,md[3]);
    times.push(String(hd).padStart(2,"0")+":"+String(mnd).padStart(2,"0"));
  }
  // 3) HH,MM (zarez kao decimal separator - cest u srpskoj/balkanskoj notaciji).
  // Suzana 8.6.2026.: klijent "U 01,00 posle ponoći" - format koji raniji regex
  // nije hvatao pa je ostajalo staro vreme od prethodnog klijenta.
  var reComma=new RegExp("\\b(\\d{1,2}),(\\d{2})(?!\\d)(?:\\s*[hH]\\b)?"+markerGrp,"gi");
  var mcz;
  while((mcz=reComma.exec(rawText))!==null){
    var hcz=parseInt(mcz[1],10),mncz=parseInt(mcz[2],10);
    if(hcz>23||mncz>59)continue;
    hcz=applyMarker(hcz,mcz[3]);
    times.push(String(hcz).padStart(2,"0")+":"+String(mncz).padStart(2,"0"));
  }
  // 4) "HH i MM" / "HH i MM h" - srpski razgovorni format ("6 i 10 h" = 06:10).
  // Suzana 9.6.2026. Branka prijava: klijent "u 06 i 10 h" - parser je gledao
  // samo "10 h" iz fallback-a i vratio 10:00 umesto 06:10.
  var reIM=new RegExp("\\b(\\d{1,2})\\s+i\\s+(\\d{1,2})(?:\\s*[hH]\\b)?(?:\\s*(?:sat[ai]?|sati|časov[a-z]+|casov[a-z]+|časa|casa|min(?:ut[a-z]*)?)\\b)?"+markerGrp,"gi");
  var mim;
  while((mim=reIM.exec(rawText))!==null){
    var him=parseInt(mim[1],10),mnim=parseInt(mim[2],10);
    if(him>23||mnim>59)continue;
    him=applyMarker(him,mim[3]);
    times.push(String(him).padStart(2,"0")+":"+String(mnim).padStart(2,"0"));
  }
  if(times.length===0&&/u\s+pono[ćc]/i.test(rawText))times.push("00:00");
  // Fallback: "5 ujutru", "7 popodne", "u 3 nocu" - sat bez minuta + srpska/EN oznaka
  if(times.length===0){
    var re2=/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.|popodne|po\s+podne|uvece|nave[čc]e|ujutru|ujutro|no[ćc]u|sati\s+ujutru|sati\s+popodne|sati\s+uvece|sati\s+no[ćc]u)\b/gi;
    var m2;
    while((m2=re2.exec(rawText))!==null){
      var h2=parseInt(m2[1],10);
      if(h2>23)continue;
      var mk=(m2[2]||"").toLowerCase().replace(/\s+/g," ");
      var pm2=/^pm$|^p\.m\.$|popodne|po podne|uvece|nave/.test(mk);
      var am2=/^am$|^a\.m\.$|ujutru|ujutro|no[ćc]u/.test(mk);
      if(pm2){if(h2!==12)h2+=12;}
      else if(am2){if(h2===12)h2=0;}
      times.push(String(h2).padStart(2,"0")+":00");
      if(times.length>=2)break;
    }
  }
  // Fallback 2: "12h", "5 h", "12 sati", "5 časova" - sat sa h-suffix bez minuta i bez AM/PM
  if(times.length===0){
    var re3=/\b(\d{1,2})\s*(?:h\b|sati\b|sata\b|časova\b|casova\b|časa\b|casa\b|sat\b)/i;
    var m3=rawText.match(re3);
    if(m3){
      var h3=parseInt(m3[1],10);
      if(h3>=0&&h3<=23)times.push(String(h3).padStart(2,"0")+":00");
    }
  }
  return times;
}
// prettifyPitanja je sada u src/lib/util.js (testabilno + jedan izvor istine).

async function parseMsg(text,provider){
  var systemPrompt=`Izvuci podatke o osobama iz poruke i vrati SAMO JSON bez ikakvog teksta oko njega.\n\n*** NAJVAZNIJE - PROCITAJ PRE SVEGA OSTALOG ***\nPolje "pitanja" u JSON-u je NAJKRITICNIJI izlaz ovog zadatka. Astrolog na osnovu ovog polja zna sta da odgovori klijentu. Ako ovde izostavis ili skratis bilo sta, klijent NECE dobiti odgovor na svoje pitanje i sve pada u vodu.\n\nSVAKO pitanje, briga, tema, osoba, emocija ili zahtev koji klijent pomene MORA da se nadje u polju "pitanja", sa punim detaljima.\n\n*** CATCH-ALL PRAVILO ZA "pitanja" ***\nSve sto u poruci NIJE cisti podatak (ime klijenta, datum rodjenja, vreme rodjenja, mesto rodjenja) OBAVEZNO ide u polje "pitanja". Ovo ukljucuje:\n- Svaku recenicu teksta koju klijent napise\n- Sva pitanja ("da li", "kada", "hoce li", "sta")\n- Sve brige, emocije, strahove, nadanja\n- Pominjanje drugih osoba (deca, muz, roditelji, prijatelji) i sta klijent zeli da zna o njima\n- Sva podrucja zivota (posao, ljubav, zdravlje, novac, putovanja, selidba, sud, skola)\n- Napomene, dodatne informacije, kontekst koji klijent daje\n\nKada izvlacis podatke: prvo izvuci ime/datum/vreme/mesto u odgovarajuca polja, zatim SVE preostalo sto ima ikakvog smisla ide u "pitanja" polje.\n\nPolje "pitanja" sme biti prazno SAMO u jednom slucaju: cela poruka je striktno samo "Ime Datum Vreme Mesto" bez bilo kakvog drugog teksta. Ako postoji IJEDNA slobodna recenica — OBAVEZNO u "pitanja".\n\nKada si u dilemi "da li ovo ide u pitanja ili ne" — UVEK stavi u pitanja. Bolje je imati vise nego premalo.\n\n*** IMENA - KOPIRAJ KARAKTER PO KARAKTER ***\nSva imena (klijenta, partnera, trecih osoba) KOPIRAJ TACNO ONAKO kako su napisana u ulaznoj poruci, karakter po karakter. NIKAD ne zamenjuj slicna ali razlicita imena:\n- Milka ≠ Milica (to su DVA RAZLICITA imena). Ako je u poruci 'Milka', napisi 'Milka' u JSON-u, NIKADA 'Milica'.\n- Maja ≠ Marija. Ako je u poruci 'Maja', napisi 'Maja', ne 'Marija'.\n- Vanja ≠ Vanesa. Ana ≠ Anja ≠ Anica. Nada ≠ Nadica. Mira ≠ Mirjana.\nKLjUCNO: pre vracanja JSON, ponovo procitaj originalno ime iz poruke i proveri da si ga zapisao SLOVO ZA SLOVO. Ne "pametno ispravljaj" imena koja ti deluju neobicno - klijenti bolje znaju svoje ime od tebe.\n\nFormat odgovora:\n{"klijent":{"ime":"","datum":"YYYY-MM-DD","vreme":"HH:MM","mesto":"","zemlja":""},"partner":{"ime":"","datum":"YYYY-MM-DD","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\n*** OBAVEZNO - polje "zemlja" mora postojati u SVIM JSON objektima (klijent i partner), cak i u primerima nize gde nije eksplicitno prikazano. Ako ne mozes da odredis zemlju, vrati prazan string "".\n\nKLJUCNA PRAVILA:\n1. Prva osoba u poruci = KLIJENT\n2. *** PARTNER polje je ISKLJUCIVO za ROMANTICNOG partnera ***\n   - PARTNER = muz, zena, suprug, supruga, decko, devojka, verenik, verenica, partner, partnerka, momak, dragi, draga, bivsi, bivsa (romanticni kontekst)\n   - Postavi imaPartnera=true i popuni partner objekat SAMO ako je druga osoba eksplicitno romanticni partner\n   - NIKAD partner polje ne popunjavaj za: sin, cerka, kcerka, kci, beba, dete, deca, brat, sestra, tata, otac, mama, majka, baba, deda, unuk, unuka, tetka, ujak, stric, ujna, strina, rodjak, rodjaka, prijatelj, prijateljica, kolega, koleginica, sef, komsija, komsinica\n3. Ako u poruci postoji OSOBA KOJA NIJE ROMANTICNI PARTNER (npr. sin, cerka, brat, prijatelj itd.) - NJEN datum/ime/mesto NE ide u partner polje, nego u "pitanja" polje kao kontekst za klijenta: "Klijent pita za [sin/cerka/brat] [ime] rodjen/a [datum] u [mesto]". Tako astrolog zna o kome klijent pita.\n4. Ako druga osoba nema oznaku odnosa (samo ime + datum, npr. "Marko 24.04.1987\\nJelena 27.05.2006") - PRETPOSTAVI da je romanticni partner i postavi imaPartnera=true.\n5. datum MORA biti YYYY-MM-DD u izlazu (1987-04-24)\n6. vreme MORA biti HH:MM u izlazu (10:40)\n7. mesto - samo grad bez drzave (npr. "Subotica", NIKADA "Subotica, Srbija")\n8. zemlja - puno ime drzave na srpskom: Srbija, Hrvatska, Bosna i Hercegovina, Crna Gora, Severna Makedonija, Slovenija, Madjarska, Austrija, Nemacka, Italija, Bugarska, Rumunija, Grcka, Turska, Albanija, Kosovo, itd. Pravila kako odrediti zemlju:\n   - Ako poruka eksplicitno pominje drzavu ("Subotica, Srbija") → koristi tu drzavu.\n   - Ako grad jednoznacno pripada jednoj drzavi (Beograd→Srbija, Zagreb→Hrvatska, Sarajevo→Bosna i Hercegovina, Podgorica→Crna Gora, Skopje→Severna Makedonija, Ljubljana→Slovenija, Banja Luka→Bosna i Hercegovina, Mostar→Bosna i Hercegovina, Novi Sad→Srbija, Nis→Srbija, Split→Hrvatska, Rijeka→Hrvatska, Pristina→Kosovo) → odredi po gradu.\n   - Ako je grad ambivalentan ili ne mozes odrediti → ostavi prazan string "".\n   - NIKAD ne pisi skracenice (BiH→Bosna i Hercegovina, CG→Crna Gora, MK→Severna Makedonija).\n9. Ako cela poruka pocinje sa "Moja cerka", "Moj sin", "Moj brat" itd. - analiza JE za tu osobu, pa klijent ime=cerka Ana / sin Marko itd. (ukljuci rec odnosa u ime). imaPartnera=false.\n10. REDOSLED POLJA NIJE VAZAN - ime/datum/vreme/mesto/zemlja mogu doci bilo kojim redom\n\nTOLERANTNI FORMATI ZA DATUM (sve ovo prepoznaj kao datum i konvertuj u YYYY-MM-DD):\n- 24.04.1987 ili 24/04/1987 ili 24-04-1987 → 1987-04-24\n- 4.1.2000 ili 4/1/2000 → 2000-01-04\n- 24 04 1987 (razmaci umesto tacaka) → 1987-04-24\n- 4 1 95 ili 4.1.95 (2-cifrena godina) → za godine 00-30 dodaj 2000 (95→1995, 05→2005), za 31-99 dodaj 1900 (95→1995, 87→1987)\n- 24041987 (bez separatora, DDMMYYYY, 8 cifara) → 1987-04-24\n- 4011987 (bez separatora, DMMYYYY, 7 cifara) → 1987-01-04\n- 2752006 (bez separatora, 7 cifara, DMYYYY) → 2006-05-27 (27 dan, 5 mesec, 2006 godina)\n- 321995 ili 3021995 (D.M.YYYY bez separatora) → 1995-02-03\n- 1987-04-24 (vec ispravan) → 1987-04-24\n- BITNO: ako je broj 6 cifara → pokusa D M YYYY (1.2.1995 = 121995), ako je 7 → DD M YYYY ili D MM YYYY, ako je 8 → DD MM YYYY\n\nTOLERANTNI FORMATI ZA VREME (sve ovo prepoznaj kao vreme i konvertuj u HH:MM):\n- 10:40 → 10:40\n- 10.40 (tacka umesto dvotacke) → 10:40\n- 10 40 (razmak) → 10:40\n- 10h40 ili 10-40 → 10:40\n- 5:40 ili 5.40 ili 5 40 (jedna cifra sat) → 05:40\n- 540 (bez separatora, 3 cifre) → 05:40\n- 1040 (bez separatora, 4 cifre) → 10:40\n- 12h ili 12 h (samo sat sa 'h', BEZ minuta) → 12:00\n- 5h ili 5 h (jedna cifra sa h) → 05:00\n- 12 sati ili 12 časova → 12:00\n- 5 sati ili 5 časova → 05:00\n- u 12h ili u 5 sati (sa predlogom 'u') → 12:00 / 05:00\n- VAZNO: ako klijent napise samo sat sa 'h' ili 'sati'/'časova', minuti se UVEK pretpostavljaju kao 00. NIKAD ne haluciniraj random minute (12h ne sme postati 12:20 ili 12:45).\n- 00:10 ili 0:10 (ponoc + 10 min) → 00:10 NIKAD 12:10\n- 00:30 ili 0:30 (ponoc + 30 min) → 00:30 NIKAD 12:30\n- 12:10 (podne + 10 min, bez AM/PM oznake) → 12:10\n- 12:10 AM ili 12:10 a.m. → 00:10 (ponoc + 10 min, NE 12:10!)\n- 12:00 AM → 00:00 (ponoc)\n- 12:30 AM → 00:30\n- 1:00 AM ili 1 AM → 01:00\n- 6:30 AM → 06:30\n- 11:59 AM → 11:59\n- 12:00 PM → 12:00 (podne)\n- 12:10 PM → 12:10\n- 1:00 PM → 13:00\n- 5:30 PM → 17:30\n- 11:30 PM → 23:30\n\n*** OBAVEZNO PRAVILO ZA AM/PM (engleski 12-casovni format) ***\nAko u poruci nadjes broj sa 'AM'/'PM'/'a.m.'/'p.m.' (bilo kojim slovima):\n- AM: ako je sat 12 → 00, inace zadrzi sat (sa zero-padding ako je 1 cifra)\n- PM: ako je sat 12 → 12, inace dodaj 12 na sat\nKRITICNO: 12:10 AM = 00:10 (ponoc), NIKAD 12:10. Ovo je najcesca greska.\nKRITICNO: 12:10 PM = 12:10 (podne).\n\n*** SRPSKE OZNAKE VREMENA (isto kao AM/PM) ***\n- 'ujutru' / 'ujutro' / 'pre podne' → AM (sati 1-11 ostaju, 12 postaje 00)\n- 'popodne' / 'po podne' → PM (sati 1-11 dodaju 12, 12 ostaje 12)\n- 'uvece' / 'naveče' / 'navece' → PM (skoro uvek 18-23)\n- 'nocu' / 'noću' / 'u noci' / 'u noći' → AM (1-4 ostaju, 12 postaje 00)\n- 'u ponoc' / 'u ponoć' → 00:00\n- 'u podne' / 'oko podneva' → 12:00\nPRIMERI: '5:30 popodne' → 17:30; '5 ujutru' → 05:00; '11:30 uvece' → 23:30; '2:15 nocu' → 02:15; '12 u ponoc' → 00:00; '12 u podne' → 12:00.\n\n*** KRITICNO - PONOC NIJE PODNE ***\nVreme 00:00, 00:10, 0:30 itd. JE PONOC (sredina noci). NIKAD ne konvertuj 00:XX u 12:XX. Sistem koristi 24-casovni format: 00 = ponoc, 12 = podne. Ako klijent napise 'rodjena u ponoc' → 00:00. Ako napise 'rodjena u podne' → 12:00.\n\nPREPOZNAJ po formatu:\n- Broj vezan sa tackama/crticama/razmacima koji izgleda kao datum = DATUM\n- 6-8 cifara u nizu koje mogu da formiraju datum = DATUM (konvertuj)\n- Brojevi 0-23 za sate i 0-59 za minute odvojeni separatorom = VREME\n- 3-4 cifre u nizu koje mogu biti HHMM = VREME\n- Reci sa velikim pocetnim slovom koje su imena (Marko, Ana, Suzana, Jovana, Jelena) = IME\n- Gradovi (Beograd, Nis, Doboj, Novi Sad, Sarajevo, Zagreb, Banja Luka, Bijeljina, Tuzla, Mostar itd) = MESTO\n\nPRIMERI:\n\nUnos: "Marko 24.04.1987 10:40 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 24.04.1987 10.40 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 24 04 1987 10 40 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 24041987 1040 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 4.1.2000 5.40 Doboj"\nIzlaz: {"klijent":{"ime":"Marko","datum":"2000-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "4 1 95 5 40 Doboj Marko"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1995-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "4 1 95 5 40 Doboj Marko\\n2752006 Jelena"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1995-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"Jelena","datum":"2006-05-27","vreme":"","mesto":""},"imaPartnera":true,"pitanja":""}\n\nUnos: "Ana 321995 1420 Nis"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-02-03","vreme":"14:20","mesto":"Nis"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "4.1.2000 Marko 5.40 Doboj\\n27.5.2006 Jelena"\nIzlaz: {"klijent":{"ime":"Marko","datum":"2000-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"Jelena","datum":"2006-05-27","vreme":"","mesto":""},"imaPartnera":true,"pitanja":""}\n\nUnos: "Ana, 15.07.1995, Nis\\nMarko, 20.03.1990, Beograd"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-07-15","vreme":"","mesto":"Nis"},"partner":{"ime":"Marko","datum":"1990-03-20","vreme":"","mesto":"Beograd"},"imaPartnera":true,"pitanja":""}\n\nUnos: "Ja sam Ana 15.07.1995 Nis, moj muz je Marko 20.03.1990 Beograd"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-07-15","vreme":"","mesto":"Nis"},"partner":{"ime":"Marko","datum":"1990-03-20","vreme":"","mesto":"Beograd"},"imaPartnera":true,"pitanja":""}\n\nUnos: "Moja cerka Ana, 15.07.1995 u 14:20 u Nisu"\nIzlaz: {"klijent":{"ime":"cerka Ana","datum":"1995-07-15","vreme":"14:20","mesto":"Nis"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Karolina 24.04.1987 Beograd, moj sin Marko 5.6.2010"\nIzlaz: {"klijent":{"ime":"Karolina","datum":"1987-04-24","vreme":"","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za sina Marka rodjenog 05.06.2010."}\n\nUnos: "Ana 15.07.1995 Nis, moja cerka Milica 12.03.2018"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-07-15","vreme":"","mesto":"Nis"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za cerku Milicu rodjenu 12.03.2018."}\n\nUnos: "Ja sam Jovana 20.11.1988, pita me brat Petar 5.3.1985 za posao"\nIzlaz: {"klijent":{"ime":"Jovana","datum":"1988-11-20","vreme":"","mesto":""},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za brata Petra rodjenog 05.03.1985, interesuje ga posao."}\n\nUnos: "Marina 3.5.1990 Novi Sad, tata Milan 8.8.1960"\nIzlaz: {"klijent":{"ime":"Marina","datum":"1990-05-03","vreme":"","mesto":"Novi Sad"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za tatu Milana rodjenog 08.08.1960."}\n\nUnos: "Irena 17.3.1976 00:10 Cacak"\nIzlaz: {"klijent":{"ime":"Irena","datum":"1976-03-17","vreme":"00:10","mesto":"Cacak","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 5.5.1990 Beograd, rodjen u 0:30 ujutru"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1990-05-05","vreme":"00:30","mesto":"Beograd","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Irena 17.3.1976 12:10 AM Cacak"\nIzlaz: {"klijent":{"ime":"Irena","datum":"1976-03-17","vreme":"00:10","mesto":"Cacak","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 5.5.1990 5:30 PM Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1990-05-05","vreme":"17:30","mesto":"Beograd","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Ana 1.1.2000 5:30 popodne Nis"\nIzlaz: {"klijent":{"ime":"Ana","datum":"2000-01-01","vreme":"17:30","mesto":"Nis","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 26.9.1985 12h Loznica"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1985-09-26","vreme":"12:00","mesto":"Loznica","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Ana 5.5.1990 u 5h ujutru Beograd"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1990-05-05","vreme":"05:00","mesto":"Beograd","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Petar 15.5.1980 12 sati Nis"\nIzlaz: {"klijent":{"ime":"Petar","datum":"1980-05-15","vreme":"12:00","mesto":"Nis","zemlja":"Srbija"},"partner":{"ime":"","datum":"","vreme":"","mesto":"","zemlja":""},"imaPartnera":false,"pitanja":""}\n\n*** KRITICNO - POLJE "pitanja" MORA BITI KOMPLETNO ***\nPolje "pitanja" u JSON-u je OD NAJVECE VAZNOSTI. Astrolog na osnovu ovog polja zna na sta da odgovori. Ako ovde nesto izostavis ili skratis, klijent NECE dobiti odgovor na svoje pitanje.\n\nOBAVEZNA PRAVILA za "pitanja":\n1. Ekstrahuj SVAKO pitanje, brigu, zahtev ili temu koju klijent pominje. NIKADA ne preskaci pitanje jer izgleda slicno prethodnom.\n2. Zadrzi SVE konkretne detalje: imena drugih osoba, datumi rodjenja, specificne brige (zdravlje, brak, posao, deca, novac, penzija, selidba, sud itd).\n3. Za SVAKU osobu koju klijent pominje (dete, muz, brat, tata, prijatelj, sestra), zapisi u zasebnoj recenici sa PUNIM KONTEKSTOM (ime, datum rodjenja ako je dostupan, sta klijent zeli da zna o toj osobi).\n4. Ako klijent spominje zabrinutost, emociju ili strah, prenesi to ('zabrinuta je za', 'plasi se da', 'zeli da zna da li', 'interesuje je').\n5. Ako klijent trazi savet ili odluku ('da li da', 'kada da', 'hoce li'), prenesi to kao direktno pitanje.\n6. Kombinuj samo ako je vise pitanja o ISTOJ osobi/temi; razdvoj ako su o razlicitim osobama ili temama.\n7. Koristi srpski ekavicu, jasne recenice. Bez dvotacki, bez listi sa crticama. Svaka tema jedna recenica, razdvojene razmakom.\n\nPRIMERI DETALJNE EKSTRAKCIJE:\n\nUnos (deo poruke): "Imam sina Marka 05.07.2018, zanima me kako mu je u skoli i da li ce imati problema sa ponasanjem. Takodje brine me zdravlje mog muza, ima probleme sa srcem zadnjih godina. I da li cu uspeti da dobijem invalidsku penziju na koju sam aplicirala u martu?"\n\nIspravna ekstrakcija za polje "pitanja":\n"Klijent pita za sina Marka rodjenog 05.07.2018, interesuje je kako mu je u skoli i da li ce imati problema sa ponasanjem. Klijent brine za zdravlje muza koji ima problema sa srcem zadnjih godina. Klijent pita da li ce uspeti da dobije invalidsku penziju na koju je aplicirala u martu."\n\nLOSA ekstrakcija (NE RADITI OVAKO): "Klijent pita za sina i muza i penziju." (PREVISE KRATKO, izgubljeni svi detalji!)\n\nDrugi primer:\nUnos: "Pita me cerka Milica 10.05.1993 hoce li imati dece i kada, i da li ce se udati za sadasnjeg momka. I sestra Dragica 14.12.1975 ima neki sud oko nasledstva pa je zanima hoce li dobiti parnicu."\n\nIspravna ekstrakcija:\n"Klijent pita za cerku Milicu rodjenu 10.05.1993, zanima je hoce li imati dece i kada, i da li ce se udati za sadasnjeg momka. Klijent pita za sestru Dragicu rodjenu 14.12.1975 koja ima sudski spor oko nasledstva, interesuje je hoce li dobiti parnicu."\n\nAko ne razumes neki deo poruke, PRENESI GA KAKO JESTE umesto da skratis ili izbacis. Bolje je da astrolog dobije malo nejasan detalj nego da ne zna uopste da postoji.\n\n*** KRITICNO - SELF-CHECK PRE VRACANJA JSON ***\nPre nego sto vratis JSON, OBAVEZNO izvedi sledece korake:\n1. Ponovo procitaj kompletnu klijentovu poruku od pocetka do kraja.\n2. Izbroj koliko distinkcnih TEMA (osoba, briga, pitanja, emocija, zahteva) je klijent pomenuo.\n3. Broj recenica/tema u tvom "pitanja" polju treba da odgovara broju tema iz poruke.\n4. Za svaku pomenutu osobu (dete, muz, roditelj, prijatelj, bivsi partner) — proveri da li je zabelezena sa imenom, datumom i konkretnim pitanjem klijenta.\n5. Za svako pomenuto podrucje zivota (posao, ljubav, zdravlje, novac, penzija, selidba, sud, deca) — proveri da li je u polju "pitanja".\n6. Ako bilo sta nedostaje, DOPUNI polje "pitanja" pre vracanja JSON.\n\nPrimer self-check-a: klijentova poruka pominje SINA, MUZA i PENZIJU (3 teme). Tvoj "pitanja" mora da ima 3 distinkcne recenice — po jednu za svaku temu.\n\nAko si posle self-check-a video da nesto nedostaje a vec pises JSON — STANI, popravi polje "pitanja", tek onda vrati JSON.\n\nVAZNO: Vrati iskljucivo JSON, bez komentara, bez markdown formatiranja. Ako neki podatak nedostaje ostavi prazan string. Nikad ne ostavljaj sve polja prazna ako ima informacija.`;
  // Retry: 2 attempts (max ~65s worst case sa fetchSafe 30s timeout + 2s backoff
  // izmedju). Suzana 8.6. 11:24 prijava: "Ne ocitava" - parser je trajao 104s
  // (4 attempts × 30s + backoff). Skracenje na 2 da Suzana ne ceka 2 minuta.
  var d=null,lastError=null;
  var MAX_RETRIES=2;
  for(var attempt=0;attempt<MAX_RETRIES;attempt++){
    try{
      // fetchSafe 95s timeout (bilo 60s) - parse sa punim promptom na deepseek-v4-flash
      // REALNO traje ~45s (reasoning tokeni), a backend per-attempt cap je 75s. Sa 60s
      // ovde je frontend sekao pozive koji bi USPELI za jos par sekundi pa je radnica
      // videla "Nece da ocita" (Suzana 2.7. prijava #76, ranije 11.6. 36f5cf6a).
      var r=await fetchSafe("https://astrobalkan-backend.onrender.com/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({max_tokens:4096,system:systemPrompt,messages:[{role:"user",content:"Izvuci podatke iz sledece poruke:\n\n"+text}],provider:provider||undefined})},95000);
      d=await r.json();
      if(d.content&&d.content[0]&&d.content[0].text)break;
      var errLow=(d.error&&(d.error.message||"")).toLowerCase();
      if(d.error&&(d.error.type==="overloaded_error"||d.error.type==="rate_limit_error"||d.error._overload===true||errLow.indexOf("overload")>=0||errLow.indexOf("too busy")>=0||errLow.indexOf("try again")>=0)){
        lastError=d.error;
        var wait=2000+attempt*2000; // 2s, 4s, 6s, 8s
        console.warn("parseMsg attempt "+(attempt+1)+" overloaded, retry in "+wait+"ms");
        await new Promise(function(res){setTimeout(res,wait);});
        continue;
      }
      lastError=d.error;
      break;
    }catch(e){
      // "signal is aborted without reason" je cryptic Web standard error iz
      // AbortController-a - prevedi u nesto sto Suzana razume umesto sirovog teksta.
      var ms=e.message||"";
      if(ms.indexOf("abort")>=0||ms.indexOf("Abort")>=0){
        ms="AI je trajao preko 95s i otkazan je.";
      }else if(ms.indexOf("Failed to fetch")>=0||ms.indexOf("NetworkError")>=0){
        ms="Server trenutno nije dostupan (verovatno se budi).";
      }
      lastError={message:ms};
      console.error("parseMsg network error attempt "+(attempt+1)+":",e.message);
      await new Promise(function(res){setTimeout(res,2000);});
    }
  }
  if(!d||d.error||d.type==="error"||!(d.content&&d.content[0]&&d.content[0].text)){
    console.error("parseMsg final Anthropic error:",JSON.stringify(lastError||d||{}).slice(0,500));
    var errObj=(d&&d.error)||lastError||{};
    var errMsg=errObj.message||"Nepoznata";
    var lowMsg=(errMsg||"").toLowerCase();
    var isOverload=!!errObj._overload||lowMsg.indexOf("overload")>=0||lowMsg.indexOf("too busy")>=0||lowMsg.indexOf("try again")>=0||lowMsg.indexOf("rate limit")>=0||lowMsg.indexOf("nije dostupan")>=0;
    if(isOverload){
      errMsg="DeepSeek trenutno nije dostupan.";
    }
    return {__error:errMsg,__overload:isOverload,__geminiAvailable:!!errObj._gemini_available};
  }
  var t=(d.content&&d.content[0]&&d.content[0].text)||"";
  if(!t){
    console.error("parseMsg empty response from Claude:",JSON.stringify(d).slice(0,500));
    return {__error:"Prazan odgovor od AI - proveri Anthropic API kljuc"};
  }
  try{
    var parsed=JSON.parse(t.replace(/```json|```/g,"").trim());
    // Sanity check za godinu rodjenja: 1900-2026 je razumno. Suzana 17.6. prijava
    // 5985cc9f "Mesa datume": klijent napisao "78" u Messenger poruci, AI parser
    // vratio "1878-08-14" umesto "1978-08-14", Astro API racunao kartu za osobu
    // od 148 godina, analiza "pomesa sve". Ako 4-cifrena godina < 1900, dodaj 100.
    function fixYear(y){var n=parseInt(y,10);if(n<1900&&n>=1800)return n+100;if(n>2030&&n<=2130)return n-100;return n;}
    var yearWasFixed=false;
    var dateWasCleared=false;
    // Fix date format if AI returned DD.MM.YYYY instead of YYYY-MM-DD.
    // Toleriše i ne-paddovan ISO (1878-8-14), separatore -,/,razmak i 2-cifrenu godinu.
    // Ako godina posle popravke i dalje nije u 1900..tekuca godina, datum se BRIŠE
    // (radnica unosi rucno) umesto da se tiho propusti karta za osobu od 148 godina.
    function fixDate(d){
      if(!d)return"";
      d=String(d).trim();
      var out="";
      // 1) Godina-prvo formati: 1993-05-10 (i .,/,razmak separatori, trailing "T00:00" ok).
      // MORA pre DMY grane - inace bi DMY regex iz "1990.08.15" izvukao "90.08.15" i
      // napravio 2015-08-90 (pogresna godina + nemoguc dan).
      var mIso=d.match(/^(\d{4})[.\/\- ](\d{1,2})[.\/\- ](\d{1,2})(?!\d)/);
      if(mIso){
        var fy=fixYear(mIso[1]);
        if(fy!==parseInt(mIso[1],10))yearWasFixed=true;
        out=fy+"-"+mIso[2].padStart(2,"0")+"-"+mIso[3].padStart(2,"0");
      }else{
        // 2) DD.MM.YYYY / DD-MM-YYYY / DD MM YY... - \b granice kao u ostalim date regexima
        var m=d.match(/\b(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{2,4})\b/);
        if(m){
          var yRaw=m[3];
          var yN=yRaw.length===2?(parseInt(yRaw,10)<=30?2000+parseInt(yRaw,10):1900+parseInt(yRaw,10)):parseInt(yRaw,10);
          var fy2=fixYear(yN);
          if(fy2!==yN||yRaw.length===2)yearWasFixed=true;
          out=fy2+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
        }
      }
      if(!out)return d;
      // Sanity: godina 1900..danas, mesec 1-12, dan 1-31 - sve ostalo se BRISE (radnica
      // unosi rucno) umesto da tiho prodje nemoguca "2015-08-90" karta.
      var oy=parseInt(out.slice(0,4),10),om=parseInt(out.slice(5,7),10),od=parseInt(out.slice(8,10),10);
      var maxY=new Date().getFullYear();
      if(oy<1900||oy>maxY||om<1||om>12||od<1||od>31){dateWasCleared=true;return"";}
      return out;
    }
    var pasteTimes=extractTimesFromPaste(text);
    // Vreme se VEZE ZA OSOBU preko njenog datuma, ne po poziciji u tekstu.
    // Razlog: ako paste nije redom (partner pre klijenta), pozicijsko dodeljivanje
    // (pasteTimes[0]->klijent, [1]->partner) zameni vremena -> pogresan znak/podznak.
    // Nadji red u sirovom tekstu koji sadrzi datum osobe, pa uzmi vreme iz tog reda.
    function findTimeForPerson(raw,iso){
      if(!raw||!iso)return"";
      var dm=iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!dm)return"";
      var y=parseInt(dm[1],10),mo=parseInt(dm[2],10),d=parseInt(dm[3],10);
      var lines=String(raw).split(/\r?\n/);
      for(var i=0;i<lines.length;i++){
        var ln=lines[i],matched=false;
        // ISO datum u liniji (YYYY-MM-DD)
        var isoRe=/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,im;
        while((im=isoRe.exec(ln))!==null){
          if(parseInt(im[1],10)===y&&parseInt(im[2],10)===mo&&parseInt(im[3],10)===d){matched=true;break;}
        }
        // D.M.YYYY / D.M.YY (tolerantni separatori . / - razmak)
        if(!matched){
          var dRe=/\b(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{2,4})\b/g,mm;
          while((mm=dRe.exec(ln))!==null){
            var ld=parseInt(mm[1],10),lmo=parseInt(mm[2],10),ly=mm[3];
            var lyN=ly.length===2?(parseInt(ly,10)<=30?2000+parseInt(ly,10):1900+parseInt(ly,10)):parseInt(ly,10);
            if(ld===d&&lmo===mo&&lyN===y){matched=true;break;}
          }
        }
        if(matched){
          var ts=extractTimesFromPaste(ln);
          if(ts.length>0)return ts[0];
        }
      }
      return"";
    }
    if(parsed.klijent){
      parsed.klijent.datum=fixDate(parsed.klijent.datum);
      var kTime=findTimeForPerson(text,parsed.klijent.datum);
      if(kTime)parsed.klijent.vreme=kTime;
      else if(pasteTimes.length===1&&pasteTimes[0])parsed.klijent.vreme=pasteTimes[0];
      else {
        // STROZA POLITIKA: ako regex nije nasao vreme za klijentov datum, NE veruj LLM-u.
        // Marko 9.6.: "Ne upise vreme kako treba" se ponavlja svaki dan jer LLM hallucinira
        // ako paste ima neki novi format. Bolje forsiraj prazno - radnica vidi i unese rucno.
        // LLM-ovo "vreme" prihvatamo SAMO ako je u standardnoj HH:MM formi.
        var llmTime=(parsed.klijent.vreme||"").trim();
        if(!/^\d{2}:\d{2}$/.test(llmTime)) parsed.klijent.vreme="";
      }
      if(/ne\s+znam\s+(taqcno\s+)?vreme|nemam\s+vreme|nepoznato\s+vreme/i.test(text)&&!kTime){
        if(/(moji|moj)\s+podaci[^.]*ne\s+znam/i.test(text)) parsed.klijent.vreme="";
      }
      parsed.klijent.zemlja=parsed.klijent.zemlja||"";
    }
    if(parsed.partner){
      parsed.partner.datum=fixDate(parsed.partner.datum);
      var pTime=findTimeForPerson(text,parsed.partner.datum);
      if(pTime)parsed.partner.vreme=pTime;
      // ako nije pronadjeno - zadrzi vreme koje je LLM vec izvukao
      parsed.partner.zemlja=parsed.partner.zemlja||"";
    }
    console.log("[parseMsg] paste times extracted:",pasteTimes,"klijent.vreme:",parsed.klijent&&parsed.klijent.vreme,"partner.vreme:",parsed.partner&&parsed.partner.vreme);
    // Detect empty result
    var k=parsed.klijent||{};
    if(!k.ime&&!k.datum&&!k.vreme&&!k.mesto){
      console.warn("parseMsg empty fields, raw response:",t.slice(0,300));
      return {__error:"AI nije prepoznao podatke - probaj jasniji format"};
    }
    // FALLBACK za pitanja: skinj iz raw poruke vec parsirane podatke klijenta i
    // partnera (ime, datum, vreme, mesto) pa tek onda probaj raw kao pitanja.
    // Razlog: izbegava se duplikacija (datum se vec nalazi u polju klijenta).
    var pitanjaTxt=(parsed.pitanja||"").trim();
    var rawMsg=(text||"").trim();
    var cleaned=rawMsg;
    cleaned=stripDataFromText(cleaned,parsed.klijent);
    if(parsed.imaPartnera||(parsed.partner&&parsed.partner.datum)){
      cleaned=stripDataFromText(cleaned,parsed.partner);
    }
    // Cleanup: zarezi/tackazarezi-niz, vise razmaka, prazne linije, leading separatori.
    // VAZNO: cuvamo \n granice (ne saljemo sve u jedan red), jer su radnice prijavile
    // da se "sve nalepi u jedan paragraf pa se mesa cije je sta".
    cleaned=cleaned.replace(/[,;]\s*[,;]+/g,",").replace(/[ \t]+/g," ");
    cleaned=cleaned.split(/\n+/).map(function(l){return l.trim().replace(/^[,;:\s]+|[,;:\s]+$/g,"");}).filter(function(l){return l.length>2;}).join("\n").trim();
    cleaned=cleaned.replace(/^[,;:\s]+|[,;:\s]+$/g,"").trim();
    var hasQ=cleaned.indexOf("?")>=0;
    var hasNL=rawMsg.indexOf("\n")>=0;
    // Trigger ako (a) cleaned ima >20 chars supstancnog teksta, ili (b) klijent je pitanjem zavrsio recenicu, ili (c) bilo je vise linija pa cleaned ima nesto
    if(cleaned.length>20 || hasQ || (hasNL&&cleaned.length>5)){
      console.log("parseMsg: pitanja set to cleaned msg. cleaned="+cleaned.length+" raw="+rawMsg.length+" ai="+pitanjaTxt.length+" hasQ="+hasQ+" hasNL="+hasNL);
      parsed.pitanja=prettifyPitanja(cleaned);
    }else if(pitanjaTxt.length===0&&cleaned.length===0){
      // Cisto samo podaci - ostavi pitanja prazno
      parsed.pitanja="";
    }else{
      // AI je dao pitanja, raw nije imao supstance - lepo formatiraj AI verziju
      parsed.pitanja=prettifyPitanja(pitanjaTxt);
    }
    console.log("parseMsg result:",JSON.stringify(parsed).slice(0,300));
    if(yearWasFixed)parsed.__yearFixed=true; // signal radnici da je godina auto-popravljena
    if(dateWasCleared)parsed.__dateCleared=true; // godina van 1900..danas - datum obrisan, unesi rucno
    return parsed;
  }catch(e){console.error("parseMsg JSON error:",e,t.slice(0,200));return {__error:"AI odgovor nije valjan JSON: "+t.slice(0,100)};}
}
// Deterministicko vezivanje: svako ime se veze za datum koji mu je NAJBLIZI u
// sirovom tekstu (prednost datumu odmah posle imena). Ispravlja slucaj kada LLM
// zameni koji datum ide uz koju osobu. Tekst je izvor istine.
// Ako vise osoba dobije isti datum a u tekstu ima dovoljno DISTINKTIH datuma,
// radi preraspodelu (greedy bipartite match) da svaka osoba dobije svoj datum.
// Nadji poziciju imena u tekstu, TOLERANTNO na srpske padeze.
// LLM vraca nominativ ("Marko"), a tekst cesto ima akuzativ/genitiv ("sina Marka",
// "cerku Milicu"). Exact indexOf bi promasio i datum se ne bi vezao za osobu.
// Strategija: prvo exact, pa koren imena (bez zavrsnog samoglasnika) + do 2 sufiksna slova.
// findNamePos i bindDatesToNames su sada u src/lib/util.js (testabilno + jedan izvor istine).
// Iz teksta "Pitanja klijenta" izvuce listu osoba koje imaju bar datum rodjenja.
// Vraca [] ako nema nikoga, ili [{ime, odnos, datum, vreme, mesto}, ...].
async function parsePersonsFromPitanja(text){
  if(!text||text.trim().length<10)return [];
  var systemPrompt=`Iz poruke izvuci listu svih osoba koje su pomenute SA BAREM DATUMOM RODJENJA. Vrati SAMO JSON niz, bez ikakvog teksta oko njega.\n\nFormat: [{"ime":"","odnos":"","datum":"YYYY-MM-DD","vreme":"HH:MM","mesto":""}, ...]\n\nPRAVILA:\n1. "ime" je ime osobe (Marko, Milica, Ana...).\n2. "odnos" je tip odnosa: 'sin', 'cerka', 'brat', 'sestra', 'tata', 'mama', 'muz', 'zena', 'partner', 'bivsi partner', 'prijatelj', 'tetka', 'ujak', 'kolega', 'unuk', 'unuka' itd. Ako odnos nije jasan iz teksta, ostavi prazan string "".\n3. "datum" mora biti YYYY-MM-DD format. Ako u tekstu pise "12.05.2018" konvertuj u "2018-05-12".\n4. "vreme" je opcionalno. Ako je u tekstu pomenuto vreme rodjenja (npr. "u 14:30", "10.40", "u podne") konvertuj u HH:MM. Ako nije pomenuto, ostavi prazan string "". KRITICNO AM/PM PRAVILO: '12:XX AM' = 00:XX (ponoc), '12:XX PM' = 12:XX (podne), 'X:XX PM' (X=1-11) → dodaj 12 na sat (5:30 PM = 17:30), 'X:XX AM' (X=1-11) ostaje uz zero-padding (5:30 AM = 05:30). Srpske oznake: 'popodne'/'uvece' = PM, 'ujutru'/'nocu' = AM, 'u ponoc' = 00:00, 'u podne' = 12:00. NIKAD 00:XX ne pretvaraj u 12:XX.\n5. "mesto" je opcionalno. Ako je u tekstu pomenut grad rodjenja (npr. "Beograd", "Novi Sad"), zapisi ga. Ako nije pomenuto, ostavi prazan string "".\n6. UKLJUCI svakoga sa datumom rodjenja, BEZ obzira na odnos.\n7. NE UKLJUCUJ osobe koje nemaju datum rodjenja u tekstu (npr. "muz mi je bolestan" bez datuma — preskoci).\n8. Ako nema nikoga sa datumom, vrati prazan niz [].\n\n*** KRITICNO - NE MESAJ IMENA I DATUME ***\nSvako ime MORA da ostane vezano za datum koji se u tekstu pojavljuje NAJBLIZE tom imenu (skoro uvek odmah posle imena). Ako tekst kaze "Katarina 2.1.2010 ... Milena 4.5.2010", onda je Katarina=2010-01-02 i Milena=2010-05-04 — NIKADA obrnuto. POGRESNO bi bilo vratiti Katarinu sa 2010-05-04. Pre nego sto vratis JSON, proveri za svako ime da je dobilo datum koji mu je u tekstu najblizi.\n\nPRIMERI:\n\nUnos: "Imam sina Marka 12.05.2018 14:30 Beograd, kakav je?"\nIzlaz: [{"ime":"Marko","odnos":"sin","datum":"2018-05-12","vreme":"14:30","mesto":"Beograd"}]\n\nUnos: "Cerka Milica 10.05.1993, sestra Dragica 14.12.1975"\nIzlaz: [{"ime":"Milica","odnos":"cerka","datum":"1993-05-10","vreme":"","mesto":""},{"ime":"Dragica","odnos":"sestra","datum":"1975-12-14","vreme":"","mesto":""}]\n\nUnos: "Marko 12.05.2018 14:30 Beograd\\nMilica 03.09.2020 09:15 Novi Sad"\nIzlaz: [{"ime":"Marko","odnos":"","datum":"2018-05-12","vreme":"14:30","mesto":"Beograd"},{"ime":"Milica","odnos":"","datum":"2020-09-03","vreme":"09:15","mesto":"Novi Sad"}]\n\nUnos: "muza mi se nesto desilo, brine me kako mu je"\nIzlaz: []\n\nUnos: "Imam dvoje dece, sina Marka 5.7.2018 i cerku Anu 3.9.2020 oboje rodjeni u Beogradu"\nIzlaz: [{"ime":"Marko","odnos":"sin","datum":"2018-07-05","vreme":"","mesto":"Beograd"},{"ime":"Ana","odnos":"cerka","datum":"2020-09-03","vreme":"","mesto":"Beograd"}]\n\nVAZNO: Vrati SAMO JSON niz, bez markdown formatiranja, bez komentara. Ako nema nikoga vrati [].`;
  try{
    var resp=await fetchWithRetry(API+"/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system:systemPrompt,messages:[{role:"user",content:text}],max_tokens:2000})});
    var j=await resp.json();
    var t=(j&&j.content&&j.content[0]&&j.content[0].text)||"";
    t=t.replace(/```json|```/g,"").trim();
    // Find first [ to last ]
    var first=t.indexOf("[");var last=t.lastIndexOf("]");
    if(first<0||last<first)return [];
    var arr=JSON.parse(t.slice(first,last+1));
    if(!Array.isArray(arr))return [];
    // Filter out persons without proper datum
    arr=arr.filter(function(p){return p&&p.datum&&/^\d{4}-\d{2}-\d{2}$/.test(p.datum);});
    // Prvo deterministicko vezivanje (moze da ISPRAVI LLM-ovu buducu/nemogucu godinu
    // na pravi datum iz teksta), pa TEK ONDA odbacivanje preostalih nemogucih datuma.
    // Redosled je bitan: bind posle filtera ne moze da uvede buduci datum jer
    // bindDatesToNames sada sam izbacuje buduce/pre-1900 datume iz pool-a.
    arr=bindDatesToNames(text,arr);
    // Godina mora biti 1900..danas i datum ne sme biti u buducnosti — "od 5.6.2027"
    // (period iz pitanja) ili halucinirana 1878 nisu datumi rodjenja.
    var maxPY=new Date().getFullYear();
    arr=arr.filter(function(p){
      var y=parseInt(p.datum.slice(0,4),10);
      if(y<1900||y>maxPY||p.datum>new Date().toISOString().slice(0,10)){
        console.warn("parsePersonsFromPitanja: odbacen nemoguc datum rodjenja",p.ime,p.datum);
        return false;
      }
      return true;
    });
    // Notify ops ako su jos uvek duplikati datuma (defenzivna mreza nije uspela)
    if(arr.length>=2){
      var dseen={},dups=[];
      arr.forEach(function(p){if(p&&p.datum){if(dseen[p.datum]&&dups.indexOf(p.datum)<0)dups.push(p.datum);dseen[p.datum]=true;}});
      if(dups.length>0){
        notifyOps("date_duplicate","Vise osoba ima isti datum posle bind-a: "+dups.join(", "),{persons:arr.map(function(p){return {ime:p.ime,datum:p.datum};}),textSnippet:String(text).slice(0,250)});
      }
    }
    console.log("parsePersonsFromPitanja: found "+arr.length+" person(s)");
    return arr;
  }catch(e){console.warn("parsePersonsFromPitanja error:",e.message);return [];}
}
// Deterministicki suncev znak iz datuma (izracunato u podne, mesto nebitno za Sunce).
// Daleko pouzdanije nego da LLM racuna znak u glavi.
function sunSignForDate(iso){
  // Koristimo konvencionalni datumski znak (newspaper-style: 23.8 = Devica, 22.8 = Lav)
  // jer ovu funkciju zovemo SAMO za slucajeve gde nemamo tacno vreme rodjenja (osobe iz
  // pitanja, partner bez vremena). Ranije smo zvali calcChart sa podne sto je davalo
  // astronomski tacan ali korisniku neocekivan rezultat na cusp datumima.
  return conventionalSunSign(iso);
}
// Sastavi blok TACNIH astroloskih podataka (suncev znak po osobi) za Downsell/Pitanja
// i sad i za Main Analizu (Jelena prijava 30.5: AI je za partnera 23.8 napisao Lav umesto
// Devica iako je u podacima bila Devica - na cusp datumima AI cesto halucinira po opstoj
// "Leo do 22.8, Devica od 23.8" definiciji ignorisuci stvarni datum/vreme rodjenja).
async function buildPersonSignFacts(questionsText,clientName,clientBirthDate,partner){
  var lines=[];
  var cn=(clientName||"").trim();
  var seen={};
  if(clientBirthDate&&/^\d{4}-\d{2}-\d{2}$/.test(clientBirthDate)){
    var cs=sunSignForDate(clientBirthDate);
    if(cs){lines.push("- Klijent"+(cn?" ("+cn+")":"")+", rodjen/a "+fmtDMYFromISO(clientBirthDate)+": Sunce u "+cs);seen[clientBirthDate]=true;}
  }
  if(partner&&partner.datum&&/^\d{4}-\d{2}-\d{2}$/.test(partner.datum)&&!seen[partner.datum]){
    var ps=sunSignForDate(partner.datum);
    if(ps){
      var pName=(partner.ime||"").trim();
      lines.push("- Partner"+(pName?" ("+pName+")":"")+", rodjen/a "+fmtDMYFromISO(partner.datum)+": Sunce u "+ps);
      seen[partner.datum]=true;
    }
  }
  try{
    var persons=await parsePersonsFromPitanja(questionsText||"");
    persons.forEach(function(p){
      if(!p||!p.datum||seen[p.datum])return;
      var s=sunSignForDate(p.datum);
      if(s){lines.push("- "+(p.ime||"Osoba")+(p.odnos?" ("+p.odnos+")":"")+", rodjen/a "+fmtDMYFromISO(p.datum)+": Sunce u "+s);seen[p.datum]=true;}
    });
  }catch(e){console.warn("buildPersonSignFacts:",e.message);}
  if(lines.length===0)return "";
  return "\n\n*** TACNI ASTROLOSKI PODACI (izracunato precizno — koristi ISKLJUCIVO ove znakove) ***\nZa svaku osobu ispod naveden je TACAN suncev znak. Kada pominjes znak neke od ovih osoba, koristi TACNO ovaj znak. NIKADA ne racunaj znak sam i ne pogadjaj po opstoj definiciji granica zodijaka (npr. nemoj pretpostaviti da je 22.8 Lav ili 23.8 Devica - cesto na granicama Sunce prelazi u sledeci znak u razlicito vreme u zavisnosti od godine). Pazi koji datum pripada kojoj osobi — ne mesaj ih.\n"+lines.join("\n")+"\n";
}
async function stoSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
async function stoGet(k,def){try{var r=localStorage.getItem(k);return r?JSON.parse(r):def;}catch(e){return def;}}

var API="https://astrobalkan-backend.onrender.com";

// fetchWithRetry je sada u src/lib/util.js (testabilno + jedan izvor istine).

// Ops alerting: kad god defenzivna mreza okine u browseru (preskoceno pitanje,
// partner propusten, duplikat datuma) — javi backendu, on preusmerava na Discord.
// Nikad ne sme da pukne — wrap u try; .catch na fetch.
function notifyOps(category,message,context){
  try{
    fetchSafe(API+"/api/alert-ops",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({category:String(category||"generic").slice(0,50),message:String(message||"").slice(0,500),context:context||undefined})
    }).catch(function(e){console.warn("notifyOps fetch failed:",e&&e.message);});
  }catch(e){console.warn("notifyOps internal:",e&&e.message);}
}

// LOGO ---------------------------------------------------------------------
function Logo(props){
  var sz=props.size||44;
  var w=sz*2.5;
  var uid="lg"+Math.random().toString(36).slice(2,6);
  return (
    React.createElement("svg",{width:w,height:sz,viewBox:"0 0 140 50",fill:"none"},
      React.createElement("defs",null,
        React.createElement("linearGradient",{id:uid+"t",x1:"0%",y1:"0%",x2:"0%",y2:"100%"},
          React.createElement("stop",{offset:"0%",stopColor:"#7FEFFF"}),
          React.createElement("stop",{offset:"100%",stopColor:"#00AAEE"})
        ),
        React.createElement("linearGradient",{id:uid+"s",x1:"0%",y1:"0%",x2:"100%",y2:"0%"},
          React.createElement("stop",{offset:"0%",stopColor:"#00AAEE",stopOpacity:".2"}),
          React.createElement("stop",{offset:"40%",stopColor:"#00BFFF"}),
          React.createElement("stop",{offset:"100%",stopColor:"#7FEFFF"})
        ),
        React.createElement("filter",{id:uid+"g"},
          React.createElement("feGaussianBlur",{stdDeviation:"1.5",result:"b"}),
          React.createElement("feMerge",null,React.createElement("feMergeNode",{in:"b"}),React.createElement("feMergeNode",{in:"SourceGraphic"}))
        ),
        React.createElement("filter",{id:uid+"g2"},
          React.createElement("feGaussianBlur",{stdDeviation:"3",result:"b"}),
          React.createElement("feMerge",null,React.createElement("feMergeNode",{in:"b"}),React.createElement("feMergeNode",{in:"SourceGraphic"}))
        )
      ),
      // Main text
      React.createElement("text",{x:"52",y:"27",textAnchor:"middle",fontFamily:"'Arial Rounded MT Bold','Nunito',Arial,sans-serif",fontSize:"28",fontWeight:"bold",fill:"url(#"+uid+"t)"},"astro"),
      // Swoosh curve - thicker and more dramatic
      React.createElement("path",{d:"M12 38 Q30 32 55 37 Q78 42 105 34 Q112 31 118 28",stroke:"url(#"+uid+"s)",strokeWidth:"2.5",fill:"none",strokeLinecap:"round"}),
      // Second thin swoosh line for depth
      React.createElement("path",{d:"M15 40 Q32 35 55 39 Q78 44 108 34",stroke:"url(#"+uid+"s)",strokeWidth:"1",fill:"none",strokeLinecap:"round",opacity:".4"}),
      // Main glowing star - bigger and brighter
      React.createElement("path",{d:"M120 26 L121 20 L122 26 L128 27 L122 28 L121 34 L120 28 L114 27 Z",fill:"#fff",filter:"url(#"+uid+"g2)"}),
      // Star glow background
      React.createElement("circle",{cx:121,cy:27,r:4,fill:"#7FEFFF",opacity:".3",filter:"url(#"+uid+"g2)"}),
      // Sparkle dots around the swoosh
      React.createElement("circle",{cx:108,cy:36,r:1.2,fill:"#7FEFFF",filter:"url(#"+uid+"g)",opacity:".8"}),
      React.createElement("circle",{cx:100,cy:39,r:.8,fill:"#00BFFF",filter:"url(#"+uid+"g)",opacity:".6"}),
      React.createElement("circle",{cx:92,cy:41,r:.6,fill:"#7FEFFF",opacity:".5"}),
      React.createElement("circle",{cx:18,cy:36,r:.7,fill:"#00BFFF",opacity:".4"}),
      React.createElement("circle",{cx:25,cy:34,r:.5,fill:"#7FEFFF",opacity:".5"}),
      React.createElement("circle",{cx:115,cy:32,r:.5,fill:"#fff",opacity:".6"}),
      // Small decorative stars
      React.createElement("path",{d:"M112 38 L112.3 36.5 L112.6 38 L114 38.3 L112.6 38.6 L112.3 40 L112 38.6 L110.5 38.3 Z",fill:"#7FEFFF",opacity:".6",filter:"url(#"+uid+"g)"}),
      React.createElement("path",{d:"M14 35 L14.2 34 L14.4 35 L15.5 35.2 L14.4 35.4 L14.2 36.5 L14 35.4 L13 35.2 Z",fill:"#00BFFF",opacity:".4"})
    )
  );
}

// Prikaz tokom generisanja - resava Suzana prijavu 1.6 "Samo ocitava i ne radi nista".
// Pre: statican tekst "Generisem u pozadini..." koji deluje zamrznuto.
// Sad: spinner + protekli minut:sekund + trenutni korak (Generisem/Prevodim) + napomena o trajanju.
// Plus dva safety-valve dugmeta posle 90s:
//   - "Proveri da li je gotovo" - manuelni recheck (radnica nije trap-ovana ako polling zakaca)
//   - "Otkazi prikaz" - reset UI; backend posao i dalje radi, kad zavrsi analiza je u Bazi
// Mali inline progres za "AI cita..." dugme - elapsed time pored teksta
// Suzana 6.6. 10:31 prijava "Nece da prepozna" - parser je radio normalno
// (do 2 min na sporom serveru), ali Suzana je odustala posle ~20s bez feedback-a.
function ParsingProgress(props){
  var [now,setNow]=useState(Date.now());
  useEffect(function(){
    var iv=setInterval(function(){setNow(Date.now());},1000);
    return function(){clearInterval(iv);};
  },[]);
  var started=props.startedAt||now;
  var elapsedSec=Math.max(0,Math.floor((now-started)/1000));
  return React.createElement(React.Fragment,null,
    React.createElement("span",{className:"spin"}),
    " AI cita... (",elapsedSec,"s)"
  );
}

function GeneratingProgress(props){
  var [now,setNow]=useState(Date.now());
  useEffect(function(){
    var iv=setInterval(function(){setNow(Date.now());},1000);
    return function(){clearInterval(iv);};
  },[]);
  var started=props.startedAt||now;
  var elapsedSec=Math.max(0,Math.floor((now-started)/1000));
  var mm=Math.floor(elapsedSec/60);
  var ss=elapsedSec%60;
  var elapsedStr=mm+":"+(ss<10?"0":"")+ss;
  // UI HARD LIMIT: ako timer ide preko 10 min (normalan job 4-9 min), polling
  // logika negde nije obrisala spinner. Suzana 25.6. prijava 689dbd19: spinner
  // 23:28 sa moje #66 stuck UI ali svejedno cekala 23 min - 18 min je predugo.
  // Sad 10 min trigger + 2 sec auto-reset.
  var isStuck=elapsedSec>=600; // 10 min
  useEffect(function(){
    if(isStuck&&props.onCancel){
      var t=setTimeout(function(){try{props.onCancel(true);}catch(_){}},2000);
      return function(){clearTimeout(t);};
    }
  },[isStuck]);
  if(isStuck){
    return React.createElement("div",{className:"aout",style:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"180px",padding:"28px 20px",textAlign:"center",gap:"10px"}},
      React.createElement("div",{style:{fontSize:"32px"}},"⚠"),
      React.createElement("div",{style:{fontFamily:"'Marcellus',serif",fontSize:"16px",color:"#ff9b9b",fontWeight:600}},"AI analiza nije uspela ("+elapsedStr+")"),
      React.createElement("p",{style:{fontSize:"12px",color:"var(--mt)",lineHeight:"1.6",maxWidth:"360px"}},"Verovatno je u Bazi - pogledaj. Resetujem za 2 sek."),
      React.createElement("button",{className:"btn brd bsm",onClick:function(){if(props.onCancel)props.onCancel(true);},type:"button"},"Resetuj odmah")
    );
  }
  var step=props.statusText||"Generišem analizu...";
  // Safety valve dugmici se pokazuju tek posle 90s (pre toga normalno generise).
  var showRecovery=elapsedSec>=90 && (props.onForceCheck||props.onCancel);
  return React.createElement("div",{className:"aout",style:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"180px",padding:"28px 20px",textAlign:"center",gap:"14px"}},
    React.createElement("div",{style:{width:"44px",height:"44px",border:"3px solid rgba(201,168,76,.25)",borderTopColor:"var(--gd)",borderRadius:"50%",animation:"sp 1s linear infinite"}}),
    React.createElement("div",{style:{fontFamily:"'Marcellus',serif",fontSize:"16px",color:"var(--gd2)",letterSpacing:".5px"}},step),
    React.createElement("div",{style:{fontFamily:"'Marcellus',serif",fontSize:"24px",color:"var(--tx)",fontVariantNumeric:"tabular-nums"}},elapsedStr),
    React.createElement("div",{style:{fontSize:"11px",color:"var(--mt)",lineHeight:1.5,maxWidth:"320px"}},
      step.indexOf("Prevodim")>=0
        ? "Prevod na srpski obicno traje 2-5 min. Ukupno generisanje 5-9 min. Sve OK - sacekaj jos malo."
        : "Generisanje obicno traje 4-9 minuta. Mozes mirno da nastavis sa drugim radom — kad bude gotovo, tekst ce se sam pojaviti."),
    showRecovery&&React.createElement("div",{style:{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"center",marginTop:"4px"}},
      props.onForceCheck&&React.createElement("button",{className:"btn bol bsm",onClick:props.onForceCheck,type:"button"},"🔄 Proveri da li je gotovo"),
      props.onCancel&&React.createElement("button",{className:"btn brd bsm",onClick:props.onCancel,type:"button"},"✖ Otkazi prikaz")
    )
  );
}

function emptySlot(){return{mode:"messenger",paste:"",rawPaste:"",parsed:null,client:{ime:"",datum:"",vreme:"",mesto:"",zemlja:"",lat:null,lon:null,timezone:null,placeOptions:[],placeStatus:"",napomena:"",pitanja:""},partner:{ime:"",datum:"",vreme:"",mesto:"",zemlja:"",lat:null,lon:null,timezone:null,placeOptions:[],placeStatus:""},hasPart:false,ch:null,pch:null,chStale:false,transits:null,types:["analiza"],status:"idle",analysis:"",copyIdx:0,jobId:null};}

// CSS ----------------------------------------------------------------------
var CSS="@import url('https://fonts.googleapis.com/css2?family=Marcellus&family=Jost:wght@300;400;500&display=swap');\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}\n:root{--bg:#02000d;--sf:rgba(15,10,28,.9);--sf2:rgba(22,15,38,.92);--bd:rgba(180,140,60,.18);--bd2:rgba(180,140,60,.35);--gd:#c9a84c;--gd2:#e8c96d;--tx:#ede5ff;--mt:#9080b0;--ac:#9b6fd4;--ac2:#7c4fc0;--red:#c06060;--grn:#60b060;}\nbody{font-family:'Jost',sans-serif;color:var(--tx);min-height:100vh;background:var(--bg);overflow-x:hidden;padding-bottom:180px;}\nbody::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 15% 25%,rgba(100,30,180,.5) 0%,transparent 50%),radial-gradient(ellipse at 85% 15%,rgba(40,15,100,.6) 0%,transparent 45%),linear-gradient(170deg,#05010f 0%,#090320 35%,#0d0525 65%,#060115 100%);}\nbody::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(1.5px 1.5px at 8% 5%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 20% 10%,rgba(255,255,220,.9) 0%,transparent 100%),radial-gradient(2px 2px at 33% 4%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 47% 8%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 60% 3%,rgba(255,240,200,.9) 0%,transparent 100%),radial-gradient(2px 2px at 75% 7%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(2.5px 2.5px at 22% 40%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 48% 44%,rgba(255,255,255,.8) 0%,transparent 100%),radial-gradient(2px 2px at 46% 60%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 25% 75%,rgba(255,255,255,.9) 0%,transparent 100%),radial-gradient(2px 2px at 70% 78%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 50% 87%,rgba(255,255,255,.9) 0%,transparent 100%);animation:tw 7s ease-in-out infinite alternate;}\n@keyframes tw{0%{opacity:.5}50%{opacity:1}100%{opacity:.6}}\n.app{position:relative;z-index:1;max-width:720px;margin:0 auto;padding-bottom:190px;}\n.lwrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 18px;position:relative;z-index:1;}\n.lcard{width:100%;max-width:420px;background:linear-gradient(145deg,rgba(18,10,36,.97),rgba(10,5,24,.99));border:1px solid var(--bd2);border-radius:22px;padding:36px 26px;box-shadow:0 0 80px rgba(100,50,200,.2);}\n.llogo{text-align:center;margin-bottom:22px;}\n.llogo h1{font-family:'Marcellus',serif;font-size:34px;font-weight:400;color:var(--gd2);letter-spacing:3px;text-shadow:0 0 30px rgba(201,168,76,.5);}\n.llogo p{font-size:10px;color:var(--mt);letter-spacing:3px;text-transform:uppercase;margin-top:4px;}\n.ldiv{height:1px;background:linear-gradient(90deg,transparent,var(--bd2),transparent);margin:18px 0;}\n.lfld{margin-bottom:13px;}\n.lfld label{display:block;font-size:11px;color:var(--mt);letter-spacing:.5px;margin-bottom:5px;}\n.lfld input{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--bd);border-radius:8px;padding:11px 14px;color:var(--tx);font-family:'Jost',sans-serif;font-size:14px;outline:none;transition:border-color .2s;}\n.lfld input:focus{border-color:var(--gd);}\n.lbtn{width:100%;padding:13px;background:linear-gradient(135deg,#b8922a,#c9a84c,#e8c96d);color:#1a0e00;font-family:'Marcellus',serif;font-size:17px;font-weight:600;letter-spacing:1.5px;border:none;border-radius:9px;cursor:pointer;transition:all .2s;box-shadow:0 4px 20px rgba(201,168,76,.3);margin-top:4px;}\n.lbtn:hover{transform:translateY(-1px);}\n.lerr{color:#e07070;font-size:12px;text-align:center;margin:10px 0 0;}\n.lsuc{color:#70e070;font-size:12px;text-align:center;margin:10px 0 0;}\n.ltabs{display:flex;gap:6px;margin-bottom:18px;}\n.ltab{flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--bd);background:transparent;color:var(--mt);font-family:'Jost',sans-serif;font-size:12px;cursor:pointer;transition:all .2s;}\n.ltab.on{border-color:var(--gd);background:rgba(201,168,76,.1);color:var(--gd2);}\n.llink{display:block;margin:12px auto 0;background:none;border:none;color:var(--mt);font-size:12px;cursor:pointer;font-family:'Jost',sans-serif;text-decoration:underline;}\n.csel{display:flex;gap:10px;margin-bottom:18px;}\n.cbtn{flex:1;padding:14px 8px;border-radius:12px;border:2px solid var(--bd);background:transparent;cursor:pointer;transition:all .2s;text-align:center;}\n.cbtn:hover,.cbtn.on{border-color:var(--gd);background:rgba(201,168,76,.1);}\n.cflag{font-size:28px;display:block;margin-bottom:5px;}\n.cname{font-family:'Marcellus',serif;font-size:15px;color:var(--gd2);font-weight:600;}\n.csub{font-size:10px;color:var(--mt);margin-top:2px;}\n.vcode{font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:var(--gd2);font-family:'Marcellus',serif;background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.3);border-radius:10px;padding:16px;margin:14px 0;}\n.hdr{padding:0;background:linear-gradient(180deg,rgba(12,6,28,.98) 0%,rgba(8,4,20,.85) 100%);backdrop-filter:blur(20px);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:100;}\n.hdr-top{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;}\n.hbrand{display:flex;align-items:center;gap:11px;}\n.hname{font-family:'Marcellus',serif;font-size:21px;font-weight:600;color:var(--gd2);letter-spacing:2.5px;}\n.hsub{font-size:9px;color:var(--mt);letter-spacing:2px;text-transform:uppercase;margin-top:1px;}\n.huser{display:flex;align-items:center;gap:7px;}\n.huser span{font-size:11px;color:var(--mt);}\n.hlout{background:transparent;border:1px solid var(--bd);color:var(--mt);font-size:10px;padding:4px 10px;border-radius:12px;cursor:pointer;font-family:'Jost',sans-serif;transition:all .2s;}\n.hlout:hover{border-color:var(--red);color:var(--red);}\n.abadge{background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.35);color:var(--gd);font-size:9px;padding:2px 8px;border-radius:10px;}\n.bnav{display:flex;flex-wrap:wrap;background:linear-gradient(0deg,rgba(8,4,20,.99) 0%,rgba(12,6,28,.95) 100%);border-top:1px solid var(--bd);padding:6px 2px;padding-bottom:max(10px,env(safe-area-inset-bottom,10px));position:fixed;bottom:0;left:0;right:0;z-index:200;max-width:720px;margin:0 auto;}\n.bnav-btn{flex:1 0 25%;max-width:25%;display:flex;flex-direction:column;align-items:center;gap:2px;background:none;border:none;color:var(--mt);font-family:'Jost',sans-serif;cursor:pointer;padding:4px 2px;transition:all .2s;border-radius:8px;position:relative;}\n.bnav-btn.on{color:var(--gd2);background:linear-gradient(180deg,rgba(201,168,76,.22) 0%,rgba(201,168,76,.08) 100%);box-shadow:inset 0 2px 0 var(--gd),0 0 20px rgba(201,168,76,.35);transform:translateY(-2px) scale(1.04);}\n.bnav-btn.on .bnav-ico{text-shadow:0 0 18px rgba(232,201,109,.9);font-size:24px;}\n.bnav-btn.on .bnav-lbl{font-weight:700;color:var(--gd2);text-shadow:0 0 10px rgba(232,201,109,.5);}\n.bnav-ico{font-size:20px;line-height:1;position:relative;}\n.bnav-lbl{font-size:8px;font-weight:500;letter-spacing:.2px;}\n.ndot{position:absolute;top:-2px;right:-6px;width:7px;height:7px;background:var(--ac);border-radius:50%;}\n.ndot-run{position:absolute;top:-2px;right:-6px;width:8px;height:8px;background:#e04040;border-radius:50%;box-shadow:0 0 6px rgba(224,64,64,.8);animation:dotPulse 1.2s ease-in-out infinite;}\n.ndot-done{position:absolute;top:-2px;right:-6px;width:8px;height:8px;background:#50c070;border-radius:50%;box-shadow:0 0 6px rgba(80,192,112,.7);}\n@keyframes dotPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.6}}\n.sec{padding:16px 14px;}\n.stitle{font-family:'Marcellus',serif;font-size:19px;color:var(--gd2);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:9px;}\n.card{background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px;}\n.card-hi{border-color:rgba(201,168,76,.3);background:linear-gradient(145deg,rgba(20,14,35,.95),rgba(15,10,28,.98));}\n.ct{font-size:10px;font-weight:500;color:var(--gd);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:9px;}\n.fld{margin-bottom:8px;}\n.fld label{display:block;font-size:10.5px;color:var(--mt);margin-bottom:3px;}\n.fld input,.fld textarea{width:100%;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:8px 11px;color:var(--tx);font-family:'Jost',sans-serif;font-size:13px;outline:none;transition:border-color .2s;}\n.fld input:focus,.fld textarea:focus{border-color:var(--gd);}\n.fld input[type=date],.fld input[type=time]{-webkit-appearance:none;appearance:none;color-scheme:dark;}\n.fld textarea{resize:vertical;min-height:72px;}\n.r2{display:grid;grid-template-columns:1fr 1fr;gap:7px;}\n.div1{height:1px;background:var(--bd);margin:9px 0;}\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:9px 16px;border-radius:7px;font-family:'Jost',sans-serif;font-size:12.5px;font-weight:500;cursor:pointer;border:none;transition:all .2s;}\n.bgd{background:linear-gradient(135deg,#b8922a,#c9a84c);color:#1a0e00;font-weight:600;box-shadow:0 2px 12px rgba(201,168,76,.25);}\n.bgd:hover{opacity:.9;transform:translateY(-1px);}\n.bpu{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;}\n.bpu:hover{opacity:.9;transform:translateY(-1px);}\n.bol{background:transparent;border:1px solid var(--bd);color:var(--mt);}\n.bol:hover{border-color:var(--gd);color:var(--tx);}\n.brd{background:transparent;border:1px solid var(--red);color:var(--red);}\n.bsm{padding:5px 10px;font-size:11px;}\n.bfull{width:100%;}\n.btn:disabled{opacity:.4;cursor:not-allowed;}\n.tabs{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:11px;}\n.tab{padding:5px 12px;border-radius:16px;font-size:11px;border:1px solid var(--bd);background:transparent;color:var(--mt);cursor:pointer;font-family:'Jost',sans-serif;transition:all .2s;}\n.tab.on{background:var(--ac2);border-color:var(--ac);color:#fff;}\n.tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px;}\n.tbtn{padding:11px 5px;border-radius:8px;border:1px solid var(--bd);background:var(--sf2);color:var(--mt);cursor:pointer;text-align:center;font-family:'Jost',sans-serif;font-size:10.5px;transition:all .2s;position:relative;}\n.tbtn.on{border-color:var(--gd);background:rgba(201,168,76,.1);color:var(--gd2);}\n.tico{font-size:18px;display:block;margin-bottom:4px;line-height:1;}\n.srow{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--sf2);border-radius:5px;font-size:11px;margin-bottom:7px;}\n.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}\n.dot-w{background:var(--gd);}\n.slhdr{display:flex;align-items:center;gap:7px;margin-bottom:9px;}\n.slbadge{background:linear-gradient(135deg,rgba(201,168,76,.2),rgba(201,168,76,.08));color:var(--gd2);border:1px solid rgba(201,168,76,.28);border-radius:5px;padding:2px 9px;font-size:10px;font-weight:600;font-family:'Marcellus',serif;}\n.slst{font-size:10px;padding:2px 8px;border-radius:10px;margin-left:auto;}\n.stidl{background:rgba(138,122,170,.12);color:var(--mt);}\n.strun{background:rgba(155,111,212,.2);color:var(--ac);}\n.stdone{background:rgba(96,176,96,.18);color:var(--grn);}\n.aout{background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:15px;font-size:13px;line-height:2.05;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;color:var(--tx);min-height:160px;max-height:55vh;overflow-y:auto;font-family:'Jost',sans-serif;}\n.aout::-webkit-scrollbar{width:3px;}\n.aout::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px;}\n.cur::after{content:'|';animation:bl 1s infinite;color:var(--gd);}\n@keyframes bl{0%,100%{opacity:1}50%{opacity:0}}\n.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:3px;}\n.prow{display:flex;justify-content:space-between;padding:4px 8px;background:var(--sf2);border-radius:4px;font-size:11px;}\n.pn{color:var(--mt)}.pv{color:var(--gd2);font-weight:500;}\n.sgnrow{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;}\n.sgni{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:6px 10px;text-align:center;}\n.sgnl{font-size:9px;color:var(--mt);margin-bottom:2px;}\n.sgnv{font-size:14px;color:var(--gd2);font-family:'Marcellus',serif;font-weight:600;}\n.asplist{font-size:10.5px;color:var(--mt);line-height:1.9;}\n.ac0{color:#e8c96d}.ao{color:#c06060}.at{color:#60a090}.aq{color:#c07840}.as{color:#7090d0}.ax{color:#8a7aaa}\n.ctrack{background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.2);border-radius:8px;padding:10px 12px;margin-bottom:9px;}\n.cdots{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;}\n.cdot{width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:600;cursor:pointer;transition:all .15s;}\n.abar{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;}\n.urow{display:flex;align-items:center;gap:9px;padding:10px 13px;background:var(--sf);border:1px solid var(--bd);border-radius:8px;margin-bottom:7px;}\n.uav{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--ac2),var(--gd));display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0;}\n.acard{background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:border-color .2s;}\n.acard:hover{border-color:var(--gd);}\n.acard-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}\n.acard-name{font-size:13.5px;font-weight:500;font-family:'Marcellus',serif;color:var(--gd2);}\n.acard-date{font-size:10px;color:var(--mt);}\n.acard-prev{font-size:11.5px;color:var(--mt);line-height:1.5;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}\n.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:flex;align-items:flex-end;}\n.modal{background:var(--sf);border:1px solid var(--bd);border-radius:16px 16px 0 0;padding:20px 16px;width:100%;max-height:88vh;overflow-y:auto;}\n.modal-title{font-family:'Marcellus',serif;font-size:18px;color:var(--gd2);margin-bottom:14px;}\n.toast{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(20,12,38,.97);border:1px solid var(--gd);color:var(--tx);padding:10px 20px;border-radius:14px;font-size:12px;z-index:999;max-width:88vw;white-space:normal;text-align:center;line-height:1.4;box-shadow:0 4px 20px rgba(0,0,0,.4);animation:tIn .3s ease;}\n@keyframes tIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}\n.spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:var(--gd);border-radius:50%;animation:sp .7s linear infinite;display:inline-block;}\n@keyframes sp{to{transform:rotate(360deg)}}\n.empty{text-align:center;padding:36px 20px;color:var(--mt);}\n.empty .ico{font-size:30px;margin-bottom:10px;opacity:.4;}\n.sel-input{width:100%;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:8px 11px;color:var(--tx);font-family:'Jost',sans-serif;font-size:13px;outline:none;}\n.splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#02000d;overflow:hidden;animation:splashFade .8s ease 3.2s forwards;}\n.splash::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(80,20,160,.4) 0%,transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(20,10,80,.5) 0%,transparent 50%),radial-gradient(ellipse at 50% 50%,rgba(10,5,40,.3) 0%,transparent 70%);}\n.splash::after{content:'';position:absolute;inset:0;background-image:radial-gradient(1px 1px at 10% 15%,rgba(255,255,255,.9) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 25% 8%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 40% 22%,rgba(255,240,200,.8) 0%,transparent 100%),radial-gradient(2px 2px at 55% 5%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 70% 18%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 85% 12%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 15% 35%,rgba(255,255,220,.9) 0%,transparent 100%),radial-gradient(2px 2px at 35% 45%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 50% 38%,rgba(255,255,255,.8) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 65% 42%,rgba(255,240,200,.9) 0%,transparent 100%),radial-gradient(1px 1px at 80% 35%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(2px 2px at 20% 55%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 45% 62%,rgba(255,255,255,.9) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 60% 58%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 75% 65%,rgba(255,240,200,.8) 0%,transparent 100%),radial-gradient(2px 2px at 90% 52%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 8% 72%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 30% 78%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(2px 2px at 55% 85%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 72% 88%,rgba(255,255,220,.9) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 88% 75%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 42% 92%,rgba(255,255,255,.8) 0%,transparent 100%);animation:tw 5s ease-in-out infinite alternate;}\n.splash-content{position:relative;z-index:1;text-align:center;}\n.splash-title{font-family:'Marcellus',serif;font-size:38px;font-weight:400;color:var(--gd2);letter-spacing:4px;text-shadow:0 0 40px rgba(201,168,76,.6);margin-top:20px;opacity:0;animation:splashIn .8s ease .3s forwards;}\n.splash-text{font-family:'Marcellus',serif;font-size:15px;color:#c9a84c;letter-spacing:1px;margin-top:14px;overflow:hidden;white-space:nowrap;width:0;border-right:2px solid rgba(201,168,76,.7);animation:typing 2s steps(36) .8s forwards,blinkCaret .6s step-end infinite;}\n@keyframes splashIn{from{opacity:0;transform:translateY(15px)}to{opacity:1;transform:translateY(0)}}\n@keyframes splashFade{to{opacity:0;pointer-events:none}}\n@keyframes typing{from{width:0}to{width:100%}}\n@keyframes blinkCaret{0%,100%{border-color:rgba(201,168,76,.7)}50%{border-color:transparent}}\n";

// MAIN APP -----------------------------------------------------------------
export default function App(){
  var [siteAccess,setSiteAccess]=useState(function(){try{return localStorage.getItem("site_access")==="true";}catch(e){return false;}});
  var [sitePw,setSitePw]=useState("");
  var [sitePwErr,setSitePwErr]=useState("");
  var [showSplash,setShowSplash]=useState(true);
  var [user,setUser]=useState(null);
  var [adminUsers,setAdminUsers]=useState([]);
  var [lm,setLm]=useState("login");
  var [lEmail,setLEmail]=useState(""); var [lPw,setLPw]=useState("");
  var [rName,setRName]=useState(""); var [rEmail,setREmail]=useState(""); var [rPw,setRPw]=useState(""); var [rPw2,setRPw2]=useState("");
  var [entCode,setEntCode]=useState(""); var [pendUser,setPendUser]=useState(null);
  var [fEmail,setFEmail]=useState(""); var [fCode,setFCode]=useState(""); var [fNewPw,setFNewPw]=useState(""); var [fStep,setFStep]=useState(1);
  var [lerr,setLerr]=useState(""); var [lsuc,setLsuc]=useState("");
  var [showCtr,setShowCtr]=useState(false);
  var [tab,setTab]=useState("a1");
  // Prijava problema (radnice)
  var [repDesc,setRepDesc]=useState("");
  var [repImg,setRepImg]=useState(null);
  var [repScreens,setRepScreens]=useState([]);
  var [repSending,setRepSending]=useState(false);
  var [repList,setRepList]=useState([]);
  // Persist slots to localStorage tako da ne nestanu kad korisnik zatvori app
  function loadSlots(key,fallback){try{var raw=localStorage.getItem(key);if(!raw)return fallback;var parsed=JSON.parse(raw);if(Array.isArray(parsed)&&parsed.length===fallback.length)return parsed;return fallback;}catch(e){return fallback;}}
  // Ocisti persistovane ERROR tekstove koji su ranije zavrsavali u analysis polju sa
  // status "done" (izgledali kao gotova analiza sa Kopiraj dugmetom - prijava #71
  // "cetvrti put radim istu osobu"). Novi kod ih vise ne upisuje, ovo cisti zaostale.
  var ERR_ANALYSIS_RE=/^(Server se trenutno restartuje|Generisanje je (zaglavljeno|predugo|trajalo)|Gre[sš]ka|Veza je predugo)/i;
  function scrubErrorSlots(arr,txtKey,stKey){
    if(!Array.isArray(arr))return arr;
    return arr.map(function(s){
      if(s&&s[stKey]==="done"&&ERR_ANALYSIS_RE.test(String(s[txtKey]||"").trim())){
        var c=Object.assign({},s);c[txtKey]="";c[stKey]="idle";c.jobId=null;c.genStartedAt=null;return c;
      }
      return s;
    });
  }
  var emptyDs={paste:"",pitanja:"",clientName:"",clientBirthDate:"",clientId:null,an:"",st:"idle",ci:0,jobId:null};
  var emptyPq={prev:"",quest:"",clientName:"",clientBirthDate:"",clientId:null,an:"",st:"idle",ci:0,jobId:null};
  var [slots,setSlots]=useState(function(){return scrubErrorSlots(loadSlots("ab_slots",[emptySlot(),emptySlot(),emptySlot()]),"analysis","status");});
  var [custPr,setCustPr]=useState({sr:{main:"",ds:"",pitanja:""},hr:{main:"",ds:"",pitanja:""}});
  var [analyses,setAnalyses]=useState([]);
  var [totalAnalyses,setTotalAnalyses]=useState(0);
  var [bazaErr,setBazaErr]=useState(false); // true ako /api/analyses fetch padne - razlika od stvarno prazne baze
  var [bazaLoading,setBazaLoading]=useState(true); // true dok prvi fetch ne zavrsi (sprecava lazno "Nema analiza")
  var [trashItems,setTrashItems]=useState([]);
  var [bazaView,setBazaView]=useState("active"); // "active" | "trash"
  var [toast,setToast]=useState("");
  var [dsSlots,setDsSlots]=useState(function(){return scrubErrorSlots(loadSlots("ab_dsSlots",[emptyDs,emptyDs,emptyDs]),"an","st");});
  function upDs(idx,fn){setDsSlots(function(prev){var nv=prev.slice();nv[idx]=fn(nv[idx]);return nv;});}
  var [pqSlots,setPqSlots]=useState(function(){return scrubErrorSlots(loadSlots("ab_pqSlots",[emptyPq,emptyPq,emptyPq]),"an","st");});
  function upPq(idx,fn){setPqSlots(function(prev){var nv=prev.slice();nv[idx]=fn(nv[idx]);return nv;});}
  // Sinhroni re-entrancy guard za Generisi dugmad. State (status/jobId) se update-uje
  // asinhrono pa brzi dupli klik prodje kroz oba poziva i napravi 2 job-a (Zorica 4.6,
  // Suzana 6.6). Ref se postavlja sinhrono - drugi klik u istom tick-u vidi true.
  var genBusyRef=useRef({});
  useEffect(function(){try{localStorage.setItem("ab_slots",JSON.stringify(slots));}catch(e){}},[slots]);
  useEffect(function(){try{localStorage.setItem("ab_dsSlots",JSON.stringify(dsSlots));}catch(e){}},[dsSlots]);
  useEffect(function(){try{localStorage.setItem("ab_pqSlots",JSON.stringify(pqSlots));}catch(e){}},[pqSlots]);
  // Resume polling ako neki slot jos uvek ima status "generating" posle restart-a app-a.
  // KRITICNO: ne jednokratni fetch nego KONTINUIRANA petlja — ako je posao jos u obradi,
  // petlja nastavlja da proverava dok ne dobije done/error. Gornja granica (MAX) sprecava
  // vecno visenje "Generisem u pozadini..." kad je backend posao osirotio (server restart).
  useEffect(function(){
    var MAX_RESUME_POLLS=440; // ~22 min na 3s interval
    // startedAt: genStartedAt slota (persistovan) - i resume petlja postuje 18-min
    // apsolutni limit. Ranije resumeLoop NIJE imao jobExpired proveru pa je spinner
    // posle refresh-a mogao da raste neograniceno (Suzana 23.6. prijava: 40:03).
    function resumeLoop(jobId,startedAt,onDone,onError,label){
      var n=0;
      var t0=startedAt||Date.now();
      var iv=setInterval(async function(){
        n++;
        if(n>MAX_RESUME_POLLS||(Date.now()-t0)>JOB_HARD_LIMIT_MS){
          clearInterval(iv);
          onError("Generisanje je predugo trajalo. Proveri Bazu — verovatno je gotovo tamo. Ako nije, klikni Generiši ponovo.");
          return;
        }
        try{
          var resp=await fetchSafe(API+"/api/generate/"+jobId);
          if(!resp.ok)return;
          var job=await resp.json();
          if(job.status==="done"){clearInterval(iv);onDone(fmtText(job.serbian_text||""));}
          else if(job.status==="error"){clearInterval(iv);onError(job.serbian_text||"Greska pri generisanju.");}
        }catch(e){console.warn("Resume "+label+" poll error:",e.message);}
      },3000);
    }
    slots.forEach(function(s,idx){
      if(s&&s.status==="generating"&&s.jobId){
        resumeLoop(s.jobId,s.genStartedAt,
          function(t){upSlot(idx,function(cur){return Object.assign({},cur,{status:"done",analysis:t,jobId:null});});},
          // Greska: toast + idle sa ocuvanim podacima, ne lazna "gotova analiza"
          function(t){upSlot(idx,function(cur){return Object.assign({},cur,{status:"idle",analysis:"",jobId:null,genStartedAt:null});});toast2(t);},
          "A"+(idx+1));
      }
    });
    dsSlots.forEach(function(s,idx){
      if(s&&s.st==="generating"&&s.jobId){
        resumeLoop(s.jobId,s.genStartedAt,
          function(t){upDs(idx,function(cur){return Object.assign({},cur,{an:t,st:"done",jobId:null});});},
          function(t){upDs(idx,function(cur){return Object.assign({},cur,{an:"",st:"idle",jobId:null,genStartedAt:null});});toast2(t);},
          "DS"+(idx+1));
      }
    });
    pqSlots.forEach(function(s,idx){
      if(s&&s.st==="generating"&&s.jobId){
        resumeLoop(s.jobId,s.genStartedAt,
          function(t){upPq(idx,function(cur){return Object.assign({},cur,{an:t,st:"done",jobId:null});});},
          function(t){upPq(idx,function(cur){return Object.assign({},cur,{an:"",st:"idle",jobId:null,genStartedAt:null});});toast2(t);},
          "Pq"+(idx+1));
      }
    });
  },[]);
  var [clientsCache,setClientsCache]=useState([]);
  var [clientsLoadedAt,setClientsLoadedAt]=useState(0);
  async function loadClients(force){
    // Refresh ako je proteklo > 30 sek od poslednjeg ucitavanja (ili force)
    var age=Date.now()-clientsLoadedAt;
    if(!force&&clientsLoadedAt>0&&age<30000)return;
    try{
      var r=await fetchSafe(API+"/api/clients");
      var d=await r.json();
      setClientsCache(d.clients||[]);
      setClientsLoadedAt(Date.now());
    }catch(e){console.warn("loadClients failed:",e.message);}
  }
  var [editPr,setEditPr]=useState("main");
  var [viewAn,setViewAn]=useState(null);
  // Overload modal: kad DeepSeek padne, prikazuje pop-up sa Gemini dugmetom
  var [overloadPrompt,setOverloadPrompt]=useState(null); // {payload, retryFn, geminiAvailable}
  var [bazaSearch,setBazaSearch]=useState("");
  var [bazaDateFilter,setBazaDateFilter]=useState("");
  var [bazaUserFilter,setBazaUserFilter]=useState(""); // filter po korisniku (ownerName ili owner email)
  var [nuData,setNuData]=useState({name:"",email:"",pw:"",country:"sr"});
  var [activeJobs,setActiveJobs]=useState({});

  useEffect(function(){
    stoGet("custPr",{sr:{main:"",ds:"",pitanja:""},hr:{main:"",ds:"",pitanja:""}}).then(function(local){
      setCustPr(local);
      // Load from backend (overrides local)
      fetchSafe(API+"/api/prompts").then(function(r){return r.json();}).then(function(d){
        if(d.prompts&&Object.keys(d.prompts).length>0){
          var merged={sr:Object.assign({main:"",ds:"",pitanja:""},local.sr||{},d.prompts.sr||{}),hr:Object.assign({main:"",ds:"",pitanja:""},local.hr||{},d.prompts.hr||{})};
          setCustPr(merged);stoSet("custPr",merged);
        }
      }).catch(function(){});
    });
    stoGet("session",null).then(function(u){if(u){setUser(u);if(!u.country)setShowCtr(true);}});
    // Inicijalno ucitaj kesirane analize (brz prikaz dok server fetch radi)
    stoGet("analyses",[]).then(function(arr){if(arr&&arr.length>0)setAnalyses(arr);});
    // Load shared analyses from backend - all users see all
    // Suzana 11.6. 8:22 prijava (bb8e3bb1): "u bazi nema nista" iako u DB-u
    // ima 1477 analiza. fetchSafe (30s timeout, NO retry) je padao kad Render
    // cold start traje 30s+. Sa fetchWithRetry (4 attempts, ~95s cover) Render
    // budjenje je pokriveno. bazaErr=true ako svi 4 attempts padnu - UI prikazuje
    // jasnu poruku umesto laznog "Nema analiza".
    fetchWithRetry(API+"/api/analyses?limit=2000",{}, {attempts:4}).then(function(r){return r.json();}).then(function(d){
      setBazaErr(false);
      setBazaLoading(false);
      if(d.analyses&&d.analyses.length>0){
        setAnalyses(d.analyses);
        // Cache invalidate: snimi top 50 svezih u localStorage, da sledeci mount
        // ne ucita STARE analize (npr. one koje je admin obrisao u medjuvremenu).
        // Marko 15.6.: Jelena vidi obrisane jer joj localStorage cache jos ima
        // analize obrisane sa drugog uredjaja.
        try{stoSet("analyses",d.analyses.slice(0,50));}catch(e){}
      }
      if(typeof d.total==="number")setTotalAnalyses(d.total);
    }).catch(function(e){
      console.warn("Could not load shared analyses:",e.message);
      setBazaErr(true);
      setBazaLoading(false);
      try{Sentry.captureMessage("Baza fetch failed: "+e.message,{level:"warning",tags:{source:"baza_load"}});}catch(_){}
    });
  },[]);

  // Refresh analyses from backend periodically while on Baza tab
  useEffect(function(){
    if(tab!=="baza")return;
    var failCount=0;
    var refresh=function(){
      fetchSafe(API+"/api/analyses?limit=2000").then(function(r){return r.json();}).then(function(d){
        failCount=0;
        setBazaErr(false);
        if(d.analyses){
          setAnalyses(d.analyses);
          // Ažuriraj cache svakim polling-om (15s) da localStorage ne sadrzi
          // obrisane analize iz drugog uredjaja (admin obrisao -> radnica
          // mora da pri sledecem mount-u ucita iz cache-a bez te analize).
          try{stoSet("analyses",d.analyses.slice(0,50));}catch(e){}
        }
        if(typeof d.total==="number")setTotalAnalyses(d.total);
      }).catch(function(){
        failCount++;
        // 3 uzastopna fail-a tokom polling-a → server je verovatno mrtav, pokaži warning.
        if(failCount>=3)setBazaErr(true);
      });
    };
    refresh();
    var interval=setInterval(refresh,15000); // refresh every 15 sec
    return function(){clearInterval(interval);};
  },[tab]);

  // Ucitaj korpu kad korisnik prebaci na "trash" view
  function loadTrash(){
    if(!user||!user.id)return;
    fetchSafe(API+"/api/analyses/trash",{headers:{"x-user-id":user.id||"","x-user-role":user.role||""}})
      .then(function(r){return r.json();})
      .then(function(d){if(d&&d.items)setTrashItems(d.items);})
      .catch(function(e){console.warn("loadTrash failed:",e.message);});
  }
  useEffect(function(){
    if(tab==="baza"&&bazaView==="trash")loadTrash();
  },[tab,bazaView]);

  useEffect(function(){
    var t=setTimeout(function(){setShowSplash(false);},4000);
    return function(){clearTimeout(t);};
  },[]);

  useEffect(function(){
    if(tab==="prijava"&&user&&user.role==="admin") loadReports();
  },[tab]);

  useEffect(function(){
    if(tab==="admin"&&user&&user.role==="admin") loadAdminUsers();
    if(tab&&(tab.indexOf("downsell")===0||tab.indexOf("pitanja")===0)) loadClients();
  },[tab]);

  function toast2(m){setToast(m);setTimeout(function(){setToast("");},3000);}
  // Prijava problema: smanji sliku (max 1280px, JPEG ~0.8) pre slanja — telefonske slike su velike
  function handleRepImage(file){
    if(!file)return;
    // Telefonske slike znaju biti 30MB+. Reader/canvas mogu da puknu (OOM) ili
    // base64 body postane > backend limit (8MB). Odbij rano sa jasnim toast-om.
    if(file.size>30*1024*1024){toast2("Slika je prevelika (>30MB). Probaj manju ili screenshot.");return;}
    var reader=new FileReader();
    reader.onload=function(ev){
      var img=new Image();
      img.onload=function(){
        var max=1280,w=img.width,h=img.height;
        if(w>max||h>max){if(w>=h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;}}
        try{
          var cv=document.createElement("canvas");cv.width=w;cv.height=h;
          cv.getContext("2d").drawImage(img,0,0,w,h);
          setRepImg(cv.toDataURL("image/jpeg",0.8));
        }catch(e){setRepImg(ev.target.result);} // fallback: original
      };
      img.onerror=function(){setRepImg(ev.target.result);};
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  async function submitReport(){
    if(!repDesc.trim()){toast2("Napiši kratko šta je problem.");return;}
    setRepSending(true);
    try{
      var body={description:repDesc.trim(),reporter_email:(user&&user.email)||"",reporter_name:(user&&user.name)||"",screen:repScreens.join(", "),image:repImg||null};
      var r=await fetchSafe(API+"/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      var d=await r.json();
      if(!r.ok||!d.ok)throw new Error((d&&d.error)||"Greška pri slanju");
      setRepDesc("");setRepImg(null);setRepScreens([]);
      toast2("✓ Prijava poslata! Javiću se čim rešim.");
      if(user&&user.role==="admin")loadReports();
    }catch(e){toast2("Greška: "+(e.message||"pokušaj ponovo"));}
    setRepSending(false);
  }
  async function loadReports(){
    try{var r=await fetchSafe(API+"/api/reports");var d=await r.json();setRepList(d.reports||[]);}catch(e){console.warn("loadReports:",e.message);}
  }
  async function markReport(id,status){
    try{
      await fetchSafe(API+"/api/reports/"+id+"/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:status})});
      setRepList(function(prev){return prev.map(function(x){return x.id===id?Object.assign({},x,{status:status}):x;});});
    }catch(e){toast2("Greška: "+e.message);}
  }
  function upSlot(i,fn){setSlots(function(p){return p.map(function(s,j){return j===i?fn(s):s;});});}
  var country=(user&&user.country)||"sr";
  function getPr(type){var cp=custPr[country];return(cp&&cp[type])||(country==="hr"?(type==="main"?PR_HR_MAIN:PR_HR_DS):(type==="main"?PR_SR_MAIN:PR_SR_DS));}
  var astroName=country==="hr"?"Marija":"Suzana";

  // AUTH
  async function doLogin(){
    setLerr("");
    try{
      var r=await fetchSafe(API+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:lEmail.trim().toLowerCase(),password:lPw})});
      var d=await r.json();
      if(!r.ok)return setLerr(d.error||"Pogresna lozinka ili email.");
      if(!d.user.verified)return setLerr("Email nije verifikovan.");
      setUser(d.user);stoSet("session",d.user);setLerr("");
      if(!d.user.country)setShowCtr(true);
    }catch(e){setLerr("Greska. Provjeri konekciju.");}
  }
  async function doRegister(){
    if(!rName.trim())return setLerr("Unesite ime.");
    if(!rEmail.includes("@"))return setLerr("Unesite validan email.");
    if(rPw.length<6)return setLerr("Lozinka mora imati min. 6 znakova.");
    if(rPw!==rPw2)return setLerr("Lozinke se ne podudaraju.");
    setLerr("");
    try{
      var r=await fetchSafe(API+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:rEmail.trim().toLowerCase(),password:rPw,name:rName.trim(),country:"sr"})});
      var d=await r.json();
      if(!r.ok)return setLerr(d.error||"Greska pri registraciji.");
      setLm("login");setLerr("");setLsuc("Registracija uspesna! Mozes se prijaviti.");
      setLEmail(rEmail.trim().toLowerCase());
    }catch(e){setLerr("Greska. Provjeri konekciju.");}
  }
  async function doVerify(){
    if(!entCode)return setLerr("Unesite kod.");
    setLerr("");
    try{
      var r=await fetchSafe(API+"/api/auth/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:pendUser.email,code:entCode})});
      var d=await r.json();
      if(!r.ok)return setLerr(d.error||"Pogresan kod.");
      setLm("login");setLerr("");setLsuc("Email verifikovan! Prijavi se.");
    }catch(e){setLerr("Greska. Provjeri konekciju.");}
  }
  async function doForgot1(){
    if(!fEmail.includes("@"))return setLerr("Unesite email.");
    setLerr("");
    try{
      var r=await fetchSafe(API+"/api/auth/forgot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:fEmail.trim().toLowerCase()})});
      var d=await r.json();
      if(!r.ok)return setLerr(d.error||"Korisnik ne postoji.");
      setFStep(2);setLerr("");
      toast2("Reset kod je poslan na email!");
    }catch(e){setLerr("Greska. Provjeri konekciju.");}
  }
  async function doForgot2(){
    if(!fCode)return setLerr("Unesite kod.");
    if(fNewPw.length<6)return setLerr("Lozinka mora imati min. 6 znakova.");
    setLerr("");
    try{
      var r=await fetchSafe(API+"/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:fEmail.trim().toLowerCase(),code:fCode,newPassword:fNewPw})});
      var d=await r.json();
      if(!r.ok)return setLerr(d.error||"Pogresan kod.");
      setLm("login");setFStep(1);setLerr("");setLsuc("Lozinka promijenjena! Prijavi se.");
    }catch(e){setLerr("Greska. Provjeri konekciju.");}
  }
  function doLogout(){setUser(null);stoSet("session",null);}
  function selectCtr(c){
    var upd=Object.assign({},user,{country:c});
    setUser(upd);stoSet("session",upd);
    setShowCtr(false);
  }

  // ADMIN
  async function loadAdminUsers(){
    try{
      var r=await fetchSafe(API+"/api/admin/users",{headers:{"x-user-id":user.id}});
      var d=await r.json();
      if(d.users)setAdminUsers(d.users);
    }catch(e){}
  }
  async function deleteAdminUser(id){
    try{
      await fetchSafe(API+"/api/admin/users/"+id,{method:"DELETE",headers:{"x-user-id":user.id}});
      loadAdminUsers();
      toast2("Korisnik uklonjen.");
    }catch(e){toast2("Greska.");}
  }
  async function addAdminUser(){
    if(!nuData.name||!nuData.email||!nuData.pw)return toast2("Popuni sva polja.");
    try{
      var r=await fetchSafe(API+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json","x-admin-override":"true","x-user-id":(user&&user.id)||""},body:JSON.stringify({email:nuData.email.toLowerCase(),password:nuData.pw,name:nuData.name,country:nuData.country})});
      var d=await r.json();
      if(!r.ok)return toast2(d.error||"Greska.");
      setNuData({name:"",email:"",pw:"",country:"sr"});
      toast2(d.message&&d.message.indexOf("updated")>=0?"Lozinka korisnika azurirana!":"Korisnik dodat!");
      loadAdminUsers();
    }catch(e){toast2("Greska.");}
  }

  // GEOCODE: zove backend /api/geocode i vraca obogacen person objekat
  async function geocodePerson(person){
    if(!person||!person.mesto||!person.mesto.trim()){
      return Object.assign({},person||{},{lat:null,lon:null,timezone:null,placeOptions:[],placeStatus:""});
    }
    try{
      // TIMEOUT 15s: geocode je brz lookup, ne sme visiti.
      // 15s timeout - geocode je brz lookup
      var r=await fetchSafe(API+"/api/geocode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grad:person.mesto,zemlja:person.zemlja||""})},15000);
      var data=await r.json();
      var opts=(data&&data.results)||[];
      if(opts.length===1){
        return Object.assign({},person,{lat:opts[0].lat,lon:opts[0].lon,timezone:opts[0].timezone,zemlja:opts[0].country||person.zemlja||"",placeOptions:[],placeStatus:"ok"});
      }else if(opts.length>1){
        return Object.assign({},person,{placeOptions:opts,placeStatus:"ambiguous"});
      }else{
        return Object.assign({},person,{lat:null,lon:null,timezone:null,placeOptions:[],placeStatus:"not_found"});
      }
    }catch(e){
      console.warn("geocodePerson failed:",e.message);
      return Object.assign({},person,{lat:null,lon:null,timezone:null,placeOptions:[],placeStatus:"error"});
    }
  }

  // PARSE
  async function doParse(idx,provider){
    var s=slots[idx];if(!s.paste.trim()&&!s.rawPaste)return;
    var pasteText=s.paste.trim()||s.rawPaste||"";
    upSlot(idx,function(s){return Object.assign({},s,{status:"parsing",parseOverload:null,parseStartedAt:Date.now()});});
    // Vidljiv feedback - Suzana 6.6. 10:31 prijava "Nece da prepozna" - parser
    // je radio normalno ali Suzana nije znala koliko da ceka.
    toast2("AI cita poruku... (obicno 5-30 sekundi, do 2 min na sporom internetu)");
    try{
      var p=await parseMsg(pasteText,provider);
      if(p&&p.__error){
        if(p.__overload){
          // Sacuvaj paste tako da Gemini retry moze ponovo da ga koristi
          upSlot(idx,function(s){return Object.assign({},s,{status:"idle",parseOverload:{message:p.__error,geminiAvailable:p.__geminiAvailable},rawPaste:s.paste||s.rawPaste});});
        }else{
          upSlot(idx,function(s){return Object.assign({},s,{status:"idle"});});
          toast2(p.__error+" Pokušaj sa kraćim paste-om ili klikni 'Ručno' i unesi podatke direktno.");
        }
      }else if(p){
        // Upozorenje radnici da je godina auto-popravljena (npr. 1878 → 1978).
        // Suzana 17.6. prijava 5985cc9f: AI vratio nemoguć datum - bez ovog
        // upozorenja, radnica ne vidi grešku dok ne stigne analiza za 1878 god.
        if(p.__yearFixed)toast2("⚠ Godina rodjenja auto-popravljena (verovatno tipkaća greška u poruci). Proveri datum pre generisanja!");
        if(p.__dateCleared)toast2("⚠ AI je vratio nemoguću godinu rodjenja (van 1900-danas). Datum je obrisan — unesi ga ručno pre generisanja!");
        // Detektuj sve datume sa pozicijom u sirovom paste-u (za auto-partner ekstrakciju)
        // Tolerantni separatori: . / - razmak — isto kao parser, da ne propustimo paste sa razmacima
        var dateRe=/\b(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{2,4})\b/g;
        var dateMatches=[],dm;
        while((dm=dateRe.exec(s.paste))!==null){
          dateMatches.push({pos:dm.index,full:dm[0],day:dm[1],month:dm[2],year:dm[3]});
        }
        // Defenzivni signal: paste ima vise linija ili pominje partner-keyword,
        // a parser je vratio samo jednu osobu - vrlo verovatno bag
        var newlineCount=(s.paste.match(/\n/g)||[]).length;
        var probablyMultiPerson=newlineCount>=1&&s.paste.trim().length>20;
        var explicitPartnerWord=/\b(muz|muža|muza|žena|zena|supruga|suprug|partner|partnera|partnerka|decko|dečko|devojka|verenik|verenica|bivši|bivsi|bivša|bivsa|dragi|draga)\b/i.test(s.paste);
        if(!p.imaPartnera&&dateMatches.length<2&&(probablyMultiPerson||explicitPartnerWord)){
          var why=explicitPartnerWord?"pominje partnera":"ima vise linija";
          toast2("⚠ Paste "+why+" ali parser je vratio samo jednu osobu. Proveri rucno i dodaj partnera ako treba.");
          notifyOps("partner_missing","Parser vratio jednu osobu, paste "+why,{pasteSnippet:String(s.paste).slice(0,250),dateMatchCount:dateMatches.length,klijent:p.klijent&&p.klijent.ime});
        }
        // Partner datum fali ako ima 2+ datuma a parser nije popunio partner.datum
        // (bez obzira na imaPartnera — AI ponekad postavi imaPartnera=true ali ostavi datum prazan).
        var partnerMissing=dateMatches.length>=2&&(!p.partner||!p.partner.datum);
        if(partnerMissing){
          // Pokušaj automatske ekstrakcije: 2. datum + ime/mesto u kontekstu
          var second=dateMatches[1];
          // Provera: da li kontekst sadrži familijske reči (sin/cerka/brat itd) - ako da, NE auto-popunjavaj kao partnera
          var ctxAround=s.paste.slice(Math.max(0,second.pos-80),second.pos+80);
          var isFamily=/\b(sin|sina|sinu|cerka|kcerka|kci|cerku|cerki|brat|brata|sestra|sestre|sestri|tata|otac|oca|ocu|mama|majka|majke|baba|deda|dete|deca|unuk|unuka|tetka|ujak|stric|prijatelj|prijateljica|kolega|koleginica)\b/i.test(ctxAround);
          var PARTNER_W=/\b(partner|partnera|partnerka|muz|muža|muza|žena|zena|suprug|supruga|decko|dečko|devojka|verenik|verenica|momak|dragi|draga|bivši|bivsi|bivša|bivsa)\b/i;
          if(isFamily){
            toast2("⚠ Detektovana 2+ osobe ali izgleda da su porodica - proveri ručno.");
          }else{
            // Ime: pronadji veliko-pisanu rec u 60 chars pre 2. datuma (preskoci stop-reci kao "Moj"/"Ja"/"Prvi")
            var STOP=/^(moj|moja|moje|moji|mojom|mojim|mojem|ja|mi|on|ona|sa|za|sad|sada|prvi|drugi|treci|treći|prva|druga|treca|treća|ako|moze|može|sam|mene|meni|imam|uporedi|uporedni|uporedno|uporednu|poredi|poredjenje|poređenje)$/i;
            // ctxBefore: ograniceno na tekuci red (da ne pokupi ime klijenta iz prethodnog reda)
            var bLineStart=s.paste.lastIndexOf("\n",second.pos-1)+1;
            var ctxBefore=s.paste.slice(Math.max(bLineStart,second.pos-60),second.pos);
            var ctxAfter=s.paste.slice(second.pos+second.full.length,second.pos+second.full.length+40);
            // Ako je rec "partner"/"muz"/itd. NEPOSREDNO ispred datuma, partner je oznacen ULOGOM
            // (npr. "prvi partner 27.07.1978") — datum je validan, ime ostaje prazno.
            // U tom slucaju NE gledamo posle datuma (tamo je obicno glagol: "Uporedi...").
            var partnerWordBefore=PARTNER_W.test(ctxBefore);
            // Ime ISPRED datuma uvek probamo (rec "muz"/"partner" je mala slova pa se ne hvata kao ime;
            // "muz Marko 20.03.1990" -> ime "Marko"; "prvi partner 27.07.1978" -> nema imena -> "").
            var nameMatches=(ctxBefore.match(/\b([A-ZČĆĐŠŽ][a-zčćđšž]+)\b/g)||[]).filter(function(n){return !STOP.test(n);});
            var partnerIme=nameMatches.length?nameMatches[nameMatches.length-1]:"";
            // Ime POSLE datuma ("27.5.2006 Jelena") trazimo SAMO kad uloga NIJE oznacena ispred datuma —
            // jer posle "prvi partner DATUM" obicno sledi glagol ("Uporedi..."), ne ime.
            if(!partnerIme&&!partnerWordBefore){
              var afterMatches=(ctxAfter.match(/\b([A-ZČĆĐŠŽ][a-zčćđšž]+)\b/g)||[]).filter(function(n){return !STOP.test(n);});
              if(afterMatches.length)partnerIme=afterMatches[0];
            }
            var partnerWordNear=partnerWordBefore||PARTNER_W.test(ctxAfter);
            // Popuni partnera ako imamo ime ILI je u blizini eksplicitna rec "partner"/"muz"/itd.
            // (slucaj "prvi partner 27.07.1978" — datum bez imena je i dalje validan partner)
            if(partnerIme||partnerWordNear){
              // Datum normalizacija
              var yr=second.year.length===2?(parseInt(second.year)<=30?"20"+second.year:"19"+second.year):second.year;
              var mm=second.month.length===1?"0"+second.month:second.month;
              var dd=second.day.length===1?"0"+second.day:second.day;
              var partnerDatum=yr+"-"+mm+"-"+dd;
              // Vreme partnera: uzmi iz istog reda gde je 2. datum (ne po poziciji)
              var lnStart=s.paste.lastIndexOf("\n",second.pos)+1;
              var lnEnd=s.paste.indexOf("\n",second.pos);if(lnEnd<0)lnEnd=s.paste.length;
              var partnerLine=s.paste.slice(lnStart,lnEnd);
              var partnerVreme=(extractTimesFromPaste(partnerLine)[0])||"";
              p.imaPartnera=true;
              // Postojeci partner objekat (ako ga je AI vratio) ima prednost za ime/mesto, ali datum FORSIRAMO
              p.partner=Object.assign({ime:partnerIme,vreme:partnerVreme,mesto:"",zemlja:""},p.partner||{},{datum:partnerDatum});
              if(!p.partner.ime)p.partner.ime=partnerIme;
              if(!p.partner.vreme&&partnerVreme)p.partner.vreme=partnerVreme;
              toast2("✓ Partner"+(p.partner.ime?" "+p.partner.ime:"")+" automatski dodat (datum "+dd+"."+mm+"."+yr+")");
            }else{
              toast2("⚠ Detektovana 2+ osobe - parser je vratio samo jednu. Proveri ručno.");
            }
          }
        }
        // Ako je datum partnera prepoznat ali parser nije podigao imaPartnera
        // (npr. "prvi partner / drugi partner" zbune AI), tretiraj kao da partner
        // postoji — inace bi se podaci o partneru ispod tiho odbacili.
        if(!p.imaPartnera&&p.partner&&p.partner.datum)p.imaPartnera=true;
        // Fallback: ako pitanja sadrze romantic indicator + datum, AI je verovatno
        // propustio partnera. Pokriva Suzana prijavu 3.6 10:47:
        //   pitanja="On ,30.12.1979\nUporedi horoskop sa njim\n..."
        // AI je stavio "On" + datum u pitanja (jer "On" je samo zamenica, ne ime
        // partnera), a partner sekciju ostavio praznu. Astrologu to izgleda kao
        // "ne upisuje datum partnera" i ne moze da uporedi karte.
        if((!p.partner||!p.partner.datum) && p.pitanja){
          // Romantic indicator: izricito pominjanje partnera ILI "uporedi"/"sinastrija"
          // ILI "horoskop sa njim/njom" (komparativni). Mala 'on'/'ona' su preceste
          // zamenice (false positive na "on voli", "ona je rekla"), pa se ne uzimaju.
          var ROMANTIC_PITANJA=/\b(uporedi|uporedni|uporedno|sinastrija|sinastriju|horoskop sa nj|sa njim|sa njom|moj (muz|muža|muza|suprug|decko|dečko|momak|verenik|dragi|bivši|bivsi|partner)|moja (žena|zena|supruga|devojka|verenica|draga|bivša|bivsa|partnerka))\b/i;
          if(ROMANTIC_PITANJA.test(p.pitanja)){
            var pitDateMatch=/\b(\d{1,2})[.\/\- ](\d{1,2})[.\/\- ](\d{2,4})\b/.exec(p.pitanja);
            if(pitDateMatch){
              var pyr2=pitDateMatch[3].length===2?(parseInt(pitDateMatch[3])<=30?"20"+pitDateMatch[3]:"19"+pitDateMatch[3]):pitDateMatch[3];
              var pmm2=pitDateMatch[2].length===1?"0"+pitDateMatch[2]:pitDateMatch[2];
              var pdd2=pitDateMatch[1].length===1?"0"+pitDateMatch[1]:pitDateMatch[1];
              var partnerDatumPit=pyr2+"-"+pmm2+"-"+pdd2;
              p.imaPartnera=true;
              p.partner=Object.assign({ime:"",vreme:"",mesto:"",zemlja:""}, p.partner||{}, {datum:partnerDatumPit});
              toast2("✓ Partner automatski dodat iz pitanja (datum "+pdd2+"."+pmm2+"."+pyr2+")");
            }
          }
        }
        // Detektuj vreme u sirovom paste-u ali parser nije izvukao
        var pasteHasTime=/\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(am|pm|h\b|sati|časova|casova|popodne|ujutru|uvece|nocu|noću)\b/i.test(s.paste);
        if(pasteHasTime&&p.klijent&&!p.klijent.vreme){
          toast2("⚠ U poruci postoji vreme ali parser ga nije prepoznao - proveri rucno.");
        }
        var newClient=Object.assign({},s.client,p.klijent||{},{pitanja:p.pitanja||""});
        var newPartner=p.imaPartnera?Object.assign({},s.partner,p.partner||{}):s.partner;
        // Auto geocode (paralelno, ne ceka analizu)
        var geoClientP=geocodePerson(newClient);
        var geoPartnerP=p.imaPartnera?geocodePerson(newPartner):Promise.resolve(newPartner);
        upSlot(idx,function(s){return Object.assign({},s,{status:"idle",parsed:p,paste:"",rawPaste:s.paste,
          client:newClient,partner:newPartner,
          hasPart:p.imaPartnera||s.hasPart,
          types:p.imaPartnera?["sinastrija"]:s.types
        });});
        toast2("Podaci prepoznati!");
        Promise.all([geoClientP,geoPartnerP]).then(function(geo){
          upSlot(idx,function(s){return Object.assign({},s,{client:Object.assign({},s.client,geo[0]),partner:p.imaPartnera?Object.assign({},s.partner,geo[1]):s.partner});});
        }).catch(function(geoErr){console.warn("geocode failed (ignorisem, ne sme da blokira analizu):",geoErr&&geoErr.message);});
      }else{upSlot(idx,function(s){return Object.assign({},s,{status:"idle"});});toast2("Nije prepoznato.");}
    }catch(e){upSlot(idx,function(s){return Object.assign({},s,{status:"idle"});});toast2("Greska: "+(e.message||"nepoznata"));}
  }

  // ASTROLOGY API v3 - Swiss Ephemeris (nasa.gov preciznost)
  var ASTRO_KEY=""; // handled by backend
  var PMAP={sun:"Sunce",moon:"Mesec",mercury:"Merkur",venus:"Venera",mars:"Mars",jupiter:"Jupiter",saturn:"Saturn",uranus:"Uran",neptune:"Neptun",pluto:"Pluton",north_node:"Sev.Cvor",south_node:"Juz.Cvor",lilith:"Lilit",chiron:"Hiron",pars_fortunae:"Tocka Srece","part_of_fortune":"Tocka Srece",mean_node:"Sev.Cvor",true_node:"Sev.Cvor"};
  var SMAP={Aries:"Ovan",Taurus:"Bik",Gemini:"Blizanci",Cancer:"Rak",Leo:"Lav",Virgo:"Devica",Libra:"Vaga",Scorpio:"Skorpija",Sagittarius:"Strelac",Capricorn:"Jarac",Aquarius:"Vodolija",Pisces:"Ribe",Ari:"Ovan",Tau:"Bik",Gem:"Blizanci",Can:"Rak",Leo:"Lav",Vir:"Devica",Lib:"Vaga",Sco:"Skorpija",Sag:"Strelac",Cap:"Jarac",Aqu:"Vodolija",Pis:"Ribe"};
  var AMAP={Conjunction:"Konjunkcija",Opposition:"Opozicija",Trine:"Trigon",Square:"Kvadrat",Sextile:"Sekstil",Quincunx:"Kvinkunks","Semi-sextile":"Polusekstil","Semi-square":"Polukvadratura",Sesquiquadrate:"Seskvikvadratura",conjunction:"Konjunkcija",opposition:"Opozicija",trine:"Trigon",square:"Kvadrat",sextile:"Sekstil",quincunx:"Kvinkunks","semi-sextile":"Polusekstil","semi-square":"Polukvadratura",sesquiquadrate:"Seskvikvadratura",sesquisquare:"Seskvikvadratura"};

  var TZ_MAP={london:"Europe/London",paris:"Europe/Paris","new york":"America/New_York",dubai:"Asia/Dubai"};
  function getTimezone(cityName){if(!cityName)return"Europe/Belgrade";var k=cityName.toLowerCase().trim();var tzKeys=Object.keys(TZ_MAP);for(var i=0;i<tzKeys.length;i++){if(k.indexOf(tzKeys[i])>=0||tzKeys[i].indexOf(k)>=0)return TZ_MAP[tzKeys[i]];}return"Europe/Belgrade";}

  // ULTRA-DEFANZIVAN normalizator: bilo koji ulazni timeStr → cisti HH:MM 24h format
  function normalizeTime(timeStr){
    if(!timeStr)return"";
    var s=String(timeStr).trim().toLowerCase();
    // Pokupi prvi H:MM (sa opcionalnim AM/PM ili srpskom oznakom)
    var m=s.match(/(\d{1,2}):(\d{2})(?:\s*[h])?(?:\s*(a\.?m\.?|p\.?m\.?|popodne|po\s+podne|uvece|nave[čc]e|ujutru|ujutro|no[ćc]u|u\s+no[ćc]i|pre\s+podne))?/i);
    if(!m)return"";
    var h=parseInt(m[1],10),mn=parseInt(m[2],10);
    if(isNaN(h)||isNaN(mn)||h>23||mn>59)return"";
    var marker=(m[3]||"").toLowerCase().replace(/\s+/g," ");
    var pm=/^p\.?m\.?$/.test(marker)||/^(popodne|po podne|uvece|nave[čc]e|navece)$/.test(marker);
    var am=/^a\.?m\.?$/.test(marker)||/ujutru|ujutro|no[ćc]u|u no[ćc]i|pre podne/.test(marker);
    if(pm){if(h!==12)h+=12;}
    else if(am){if(h===12)h=0;}
    return String(h).padStart(2,"0")+":"+String(mn).padStart(2,"0");
  }
  function makeBirthData(dateStr,timeStr,cityName,lat,lon,tz){
    var p=dateStr.split("-");
    var clean=normalizeTime(timeStr)||"12:00";
    var dt=clean.split(":");
    var hasGeo=(lat!=null&&lon!=null);
    var coords=hasGeo?[lat,lon]:getCoords(cityName);
    var bd={year:parseInt(p[0]),month:parseInt(p[1]),day:parseInt(p[2]),hour:parseInt(dt[0]),minute:parseInt(dt[1]),latitude:coords[0],longitude:coords[1],timezone:tz||getTimezone(cityName)};
    console.log("[makeBirthData] input timeStr=",JSON.stringify(timeStr),"normalized=",clean,"→ hour:",bd.hour,"minute:",bd.minute);
    return bd;
  }

  async function astroPost(endpoint,body){
    // TIMEOUT 30s: bez ovog Promise.allSettled u callAstroAPI fallback-u moze visiti
    // zauvek ako astrology-api.io backend nije responsive. Suzana 6.6. 09:25 prijava:
    // 30s timeout
    try{
      var resp=await fetchSafe("https://astrobalkan-backend.onrender.com/api/astro"+endpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      if(!resp.ok){console.warn("AstroAPI "+endpoint+" => HTTP "+resp.status);return null;}
      return await resp.json();
    }catch(e){
      console.warn("astroPost "+endpoint+" exception:",e.message);
      return null;
    }
  }

  function parsePositions(data){
    if(!data)return null;
    var raw=data.data||data;
    var src=raw.positions||raw.planets||{};
    var planets=[];
    // Handle array format: [{name:"Sun",sign:"Sag",degree:25.3,house:4,is_retrograde:false}, ...]
    if(Array.isArray(src)){
      src.forEach(function(pd){
        if(!pd)return;
        var nm=PMAP[(pd.name||"").toLowerCase()]||pd.name||"";
        var sg=SMAP[pd.sign||""]||pd.sign||"";
        var deg=parseFloat(pd.degree_in_sign||pd.degree||0).toFixed(1);
        var absDeg=parseFloat(pd.absolute_degree||pd.longitude||0);
        var hs=pd.house||null;
        planets.push({name:nm,sign:sg,degInSign:deg,absDeg:absDeg,house:hs,retrograde:pd.is_retrograde||pd.retrograde||false});
      });
    } else {
      // Handle object format: {sun:{sign,degree_in_sign,house,retrograde}, ...}
      Object.keys(src).forEach(function(k){
        var pd=src[k];
        if(!pd)return;
        var nm=PMAP[k.toLowerCase()]||k;
        var sg=SMAP[pd.sign||""]||pd.sign||"";
        var deg=parseFloat(pd.degree_in_sign||pd.degree||0).toFixed(1);
        var absDeg=parseFloat(pd.absolute_degree||pd.longitude||0);
        var hs=pd.house||null;
        planets.push({name:nm,sign:sg,degInSign:deg,absDeg:absDeg,house:hs,retrograde:pd.is_retrograde||pd.retrograde||false});
      });
    }
    // Ascendant: try raw.ascendant, or first house
    var asc=raw.ascendant||data.ascendant||raw.rising||null;
    var ascSign="Nepoznato",ascDeg="0";
    if(asc&&typeof asc==="object"){ascSign=SMAP[asc.sign||""]||asc.sign||"Nepoznato";ascDeg=parseFloat(asc.degree_in_sign||asc.degree||0).toFixed(1);}
    // Parse houses
    var houses=[];
    var hs=raw.houses||data.houses||raw.cusps||{};
    if(Array.isArray(hs)){hs.forEach(function(h,i){houses.push({num:h.number||i+1,sign:SMAP[h.sign||""]||h.sign||"",deg:parseFloat(h.degree_in_sign||h.degree||0).toFixed(1)});});}
    else if(typeof hs==="object"&&Object.keys(hs).length>0){Object.keys(hs).forEach(function(k){var h=hs[k];var num=parseInt(k.replace(/\D/g,""))||houses.length+1;houses.push({num:num,sign:SMAP[h.sign||""]||h.sign||"",deg:parseFloat(h.degree_in_sign||h.degree||0).toFixed(1)});});}
    houses.sort(function(a,b){return a.num-b.num;});
    // Fallback: ascendant from first house
    if(ascSign==="Nepoznato"&&houses.length>0){ascSign=houses[0].sign;ascDeg=houses[0].deg;}
    var sunPl=planets.find(function(p){return p.name==="Sunce";});
    var moonPl=planets.find(function(p){return p.name==="Mesec";});
    return{sunSign:sunPl?sunPl.sign:"",moonSign:moonPl?moonPl.sign:"",ascSign:ascSign,ascDeg:ascDeg,planets:planets,houses:houses};
  }

  function parseAspects(data){
    if(!data)return[];
    var raw=data.data||data;
    var asp=raw.aspects||data.aspects||[];
    var result=[];
    if(Array.isArray(asp)){
      asp.forEach(function(a){
        var p1=PMAP[(a.point1||a.planet1||a.body1||"").toLowerCase()]||(a.point1||a.planet1||"");
        var p2=PMAP[(a.point2||a.planet2||a.body2||"").toLowerCase()]||(a.point2||a.planet2||"");
        var type=AMAP[a.aspect_type||a.type||a.aspect||""]||(a.aspect_type||a.type||"");
        var orb=parseFloat(a.orb||0).toFixed(2);
        if(p1&&p2&&type)result.push({p1:p1,p2:p2,aspect:type,orb:orb});
      });
    }
    return result.sort(function(a,b){return parseFloat(a.orb)-parseFloat(b.orb);});
  }

  async function callAstroAPI(dateStr,timeStr,cityName,lat,lon,tz){
    try{
      var bd=makeBirthData(dateStr,timeStr,cityName,lat,lon,tz);

      // PRIMARY: Use backend Swiss Ephemeris (NASA-level precision)
      try{
        // 45s timeout - chart calc moze biti spor na cold start-u
        var chartResp=await fetchSafe(API+"/api/chart",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bd)},45000);
        if(chartResp.ok){
          var chartData=await chartResp.json();
          console.log("SWISSEPH response:",chartData.source,chartData.positions?chartData.positions.length+" planets":"no positions");
          if(chartData.positions&&chartData.positions.length>0){
            var chart={planets:[],aspects:[],houses:[],sunSign:"",moonSign:"",ascSign:"Nepoznato",ascDeg:"0"};
            // Parse planets
            chartData.positions.forEach(function(p){
              chart.planets.push({name:PMAP[(p.name||"").toLowerCase()]||p.name,sign:SMAP[p.sign||""]||p.sign||"",degInSign:parseFloat(p.degree||0).toFixed(1),absDeg:p.absolute_degree||0,house:p.house||null,retrograde:p.is_retrograde||false});
            });
            // Parse aspects
            if(chartData.aspects){chartData.aspects.forEach(function(a){
              var p1=PMAP[(a.point1||"").toLowerCase()]||a.point1||"";
              var p2=PMAP[(a.point2||"").toLowerCase()]||a.point2||"";
              var type=AMAP[a.aspect_type||""]||(a.aspect_type||"");
              if(p1&&p2&&type)chart.aspects.push({p1:p1,p2:p2,aspect:type,orb:parseFloat(a.orb||0).toFixed(2)});
            });}
            // Parse houses
            if(chartData.houses){chart.houses=chartData.houses.map(function(h){return{num:h.number,sign:SMAP[h.sign||""]||h.sign||"",deg:parseFloat(h.degree||0).toFixed(1)};});}
            // Ascendant
            if(chartData.ascendant){chart.ascSign=SMAP[chartData.ascendant.sign||""]||chartData.ascendant.sign||"";chart.ascDeg=parseFloat(chartData.ascendant.degree||0).toFixed(1);}
            // Sun/Moon signs
            var sunP=chart.planets.find(function(p){return p.name==="Sunce";});
            var moonP=chart.planets.find(function(p){return p.name==="Mesec";});
            chart.sunSign=sunP?sunP.sign:"";chart.moonSign=moonP?moonP.sign:"";
            chart.source="swisseph";
            // If no birth time provided, null out ascendant and houses (they require exact time)
            if(!timeStr){
              chart.ascSign="Nepoznato";
              chart.ascDeg="0";
              chart.houses=[];
              chart.planets.forEach(function(p){p.house=null;});
            }
            console.log("SwissEph OK:",chart.planets.length,"planets,",chart.aspects.length,"aspects,",chart.houses.length,"houses, asc="+chart.ascSign+" "+chart.ascDeg+"°");
            // Fetch transits data from astrology-api in background (non-blocking)
            chart.solarReturn=null;
            return chart;
          }
        }
      }catch(e){console.warn("SwissEph backend failed:",e.message);}

      // FALLBACK: Use astrology-api.io
      console.log("Falling back to astrology-api.io");
      var body={subject:{name:"Client",birth_data:bd},options:{house_system:"P",active_points:["Sun","Moon","Mercury","Venus","Mars","Jupiter","Saturn","Uranus","Neptune","Pluto"]}};
      var results=await Promise.allSettled([
        astroPost("/api/v3/data/positions/enhanced",body),
        astroPost("/api/v3/data/aspects/enhanced",body)
      ]);
      results=results.map(function(r){return r.status==="fulfilled"?r.value:null;});
      var posData=results[0],aspData=results[1];
      var chart=parsePositions(posData);
      if(!chart||chart.planets.length===0){console.warn("AstroAPI also failed, using local");return null;}
      chart.aspects=parseAspects(aspData||posData);
      // Local houses as last resort
      var coords=(lat!=null&&lon!=null)?[lat,lon]:getCoords(cityName);
      var dp=dateStr.split("-"),tp=(timeStr||"12:00").split(":");
      var ofy=parseInt(dp[0]),ofm=parseInt(dp[1]),ofd=parseInt(dp[2]),ofh=parseInt(tp[0]),ofmn=parseInt(tp[1]);
      var ofTz=tz||getTimezone(cityName);
      var ofOff=tzOffsetHours(ofy,ofm,ofd,ofh,ofmn,ofTz);
      var ofUt=ofOff!=null?(ofh+ofmn/60-ofOff):(ofh+ofmn/60-coords[1]/15);
      var J=jd(ofy,ofm,ofd,ofUt);
      if(timeStr){var ad=ascLon(J,coords[0],coords[1]);var mc=mcLon(J,coords[1]);chart.ascSign=signOf(ad);chart.ascDeg=degIn(ad);var hs=getHouses(ad,mc,coords[0]);chart.houses=hs.map(function(h,i){return{num:i+1,sign:signOf(h),deg:degIn(h)};});}
      chart.solarReturn=null;
      chart.source="astrology-api-v3-fallback";
      return chart;
    }catch(e){console.warn("callAstroAPI failed:",e.message);return null;}
  }

  // Synastry via API (za sinastiju)
  async function callSynastryAPI(dateStr1,timeStr1,city1,dateStr2,timeStr2,city2,lat1,lon1,tz1,lat2,lon2,tz2){
    try{
      var bd1=makeBirthData(dateStr1,timeStr1,city1,lat1,lon1,tz1);
      var bd2=makeBirthData(dateStr2,timeStr2,city2,lat2,lon2,tz2);
      var body={
        person1:{name:"Klijent",birth_data:bd1},
        person2:{name:"Partner",birth_data:bd2},
        options:{house_system:"P",active_points:["Sun","Moon","Mercury","Venus","Mars","Jupiter","Saturn","Uranus","Neptune","Pluto"]}
      };
      var data=await astroPost("/api/v3/analysis/synastry-report",body);
      return data;
    }catch(e){console.warn("Synastry API failed:",e.message);return null;}
  }

  async function doCalc(idx){
    var sl=slots[idx];if(!sl.client.datum)return;
    upSlot(idx,function(s){return Object.assign({},s,{status:"computing"});});
    try{
      // NAPOMENA: vreme je vec extracted u parseMsg pri unosu paste-a (extractTimesFromPaste).
      // Ovde NE override-ujemo time iz rawPaste-a — to bi anuliralo rucne ispravke korisnika
      // (npr. kad korisnik ručno zameni vreme između klijenta i partnera).
      console.log("[doCalc] client.vreme="+sl.client.vreme+" partner.vreme="+(sl.partner&&sl.partner.vreme));
      var fixedClient=sl.client, fixedPartner=sl.partner;
      // LAZY GEOCODE: ako klijent ima mesto ali nema koordinate (stari klijent iz Baze ili import),
      // pozovi geocoding pre racunanja natalke da bi koristili tacne lat/lon/tz.
      var clientForCalc=fixedClient, partnerForCalc=fixedPartner;
      if(fixedClient.mesto&&fixedClient.lat==null&&fixedClient.placeStatus!=="not_found"&&fixedClient.placeStatus!=="error"){
        var geoC=await geocodePerson(fixedClient);
        clientForCalc=Object.assign({},fixedClient,geoC);
        upSlot(idx,function(s){return Object.assign({},s,{client:Object.assign({},s.client,{vreme:fixedClient.vreme},geoC)});});
      }
      if(sl.hasPart&&fixedPartner.mesto&&fixedPartner.lat==null&&fixedPartner.placeStatus!=="not_found"&&fixedPartner.placeStatus!=="error"){
        var geoP=await geocodePerson(fixedPartner);
        partnerForCalc=Object.assign({},fixedPartner,geoP);
        upSlot(idx,function(s){return Object.assign({},s,{partner:Object.assign({},s.partner,{vreme:fixedPartner.vreme},geoP)});});
      }
      console.log("doCalc START for:",clientForCalc.ime,clientForCalc.datum,clientForCalc.vreme,clientForCalc.mesto,"geo:",clientForCalc.lat,clientForCalc.lon);
      // Try astrology-api.io first (Swiss Ephemeris precision)
      var c=null;
      try{c=await callAstroAPI(clientForCalc.datum,clientForCalc.vreme,clientForCalc.mesto,clientForCalc.lat,clientForCalc.lon,clientForCalc.timezone);}catch(e){console.error("callAstroAPI crashed:",e);}
      if(!c){
        // Fallback to local calculation
        console.log("Using local fallback calculation");
        var coords=(clientForCalc.lat!=null&&clientForCalc.lon!=null)?[clientForCalc.lat,clientForCalc.lon]:getCoords(clientForCalc.mesto);
        c=calcChart(clientForCalc.datum,clientForCalc.vreme,coords[0],coords[1],clientForCalc.timezone||getTimezone(clientForCalc.mesto));
        console.log("Local calc result:",c?c.planets.length+" planets":"null");
      }
      var pc=null;
      if(sl.hasPart&&partnerForCalc.datum){
        try{pc=await callAstroAPI(partnerForCalc.datum,partnerForCalc.vreme,partnerForCalc.mesto,partnerForCalc.lat,partnerForCalc.lon,partnerForCalc.timezone);}catch(e){console.error("Partner callAstroAPI crashed:",e);}
        if(!pc){var pc2=(partnerForCalc.lat!=null&&partnerForCalc.lon!=null)?[partnerForCalc.lat,partnerForCalc.lon]:getCoords(partnerForCalc.mesto);pc=calcChart(partnerForCalc.datum,partnerForCalc.vreme,pc2[0],pc2[1],partnerForCalc.timezone||getTimezone(partnerForCalc.mesto));}
        // Konvencionalni override za partnera bez vremena rodjenja (Jelena/Marko prijava 30.5
        // o "23.8 je devica a softver pise lav"). Backend callAstroAPI vraca astronomski znak
        // koristeci default podne sto je problem na cusp datumima. Kad nema vremena, koristimo
        // konvencionalni newspaper znak koji ocekuju astrolozi i klijenti.
        if(pc&&(!partnerForCalc.vreme||!partnerForCalc.vreme.trim())){
          var convP=conventionalSunSign(partnerForCalc.datum);
          if(convP&&convP!==pc.sunSign){
            console.log("[partner] override sunSign astronomski="+pc.sunSign+" -> konvencionalni="+convP+" (nema vremena rodjenja)");
            pc.sunSign=convP;
          }
        }
      }
      // Isti override i za klijenta bez vremena rodjenja - konzistentno ponasanje.
      if(c&&(!clientForCalc.vreme||!clientForCalc.vreme.trim())){
        var convC=conventionalSunSign(clientForCalc.datum);
        if(convC&&convC!==c.sunSign){
          console.log("[client] override sunSign astronomski="+c.sunSign+" -> konvencionalni="+convC+" (nema vremena rodjenja)");
          c.sunSign=convC;
        }
      }
      console.log("doCalc DONE, planets:",c?c.planets.length:0,"aspects:",c?c.aspects.length:0);
      upSlot(idx,function(s){return Object.assign({},s,{ch:c,pch:pc,chStale:false,status:"idle"});});
      // Fetch transits in background
      fetchTransits(idx,clientForCalc.datum,clientForCalc.vreme,clientForCalc.mesto,clientForCalc.lat,clientForCalc.lon,clientForCalc.timezone);
    }catch(e){
      console.error("doCalc FATAL error:",e);
      upSlot(idx,function(s){return Object.assign({},s,{status:"idle"});});
    }
  }

  async function fetchTransits(idx,dateStr,timeStr,cityName,lat,lon,tz){
    try{
      var bd=makeBirthData(dateStr,timeStr,cityName,lat,lon,tz);
      console.log("TRANSITS calling:",API+"/api/astro/transits","body:",JSON.stringify({birth_data:bd}).slice(0,200));
      var resp=await fetchSafe(API+"/api/astro/transits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({birth_data:bd})});
      console.log("TRANSITS status:",resp.status);
      if(!resp.ok){var errText=await resp.text();console.error("TRANSITS error response:",errText.slice(0,300));return;}
      var data=await resp.json();
      console.log("TRANSITS full response:",JSON.stringify(data).slice(0,800));
      var transits=parseTransits(data);
      console.log("TRANSITS parsed:",transits.length,"items",transits.length>0?JSON.stringify(transits[0]):"(empty)");
      if(transits&&transits.length>0){
        upSlot(idx,function(s){return Object.assign({},s,{transits:transits,transitsAt:Date.now()});});
      }
    }catch(e){console.error("TRANSITS fetch error:",e.message,e);}
  }

  function parseTransits(data){
    if(!data)return[];
    var raw=data.data||data;
    var SLOW=["saturn","jupiter","uranus","neptune","pluto","mars"];
    var events=raw.events||raw.aspects||raw.transit_aspects||[];
    var result=[];
    if(Array.isArray(events)&&events.length>0){
      events.forEach(function(e){
        var tpRaw=e.transiting_planet||e.transit_planet||e.point1||"";
        if(SLOW.indexOf(tpRaw.toLowerCase())<0)return;
        var tp=PMAP[tpRaw.toLowerCase()]||tpRaw;
        var npRaw=e.stationed_planet||e.natal_planet||e.point2||"";
        var np=PMAP[npRaw.toLowerCase()]||npRaw;
        var type=AMAP[e.aspect_type||e.type||""]||(e.aspect_type||e.type||"");
        var orb=Math.abs(parseFloat(e.orb||0));
        result.push({planet:"T."+tp,natalPlanet:np,aspect:type,orb:orb.toFixed(2),orbNum:orb,house:e.natal_house||e.house||null,interpretation:e.interpretation||""});
      });
      // Deduplicate: keep smallest orb per planet+natal+aspect combo
      var seen={};
      result.forEach(function(t){
        var key=t.planet+"|"+t.natalPlanet+"|"+t.aspect;
        if(!seen[key]||t.orbNum<seen[key].orbNum)seen[key]=t;
      });
      result=Object.keys(seen).map(function(k){return seen[k];});
      // Sort by orb ascending, limit to 20
      result.sort(function(a,b){return a.orbNum-b.orbNum;});
      return result.slice(0,20);
    }
    // Fallback: transit positions
    if(data.fallback&&data.transit_positions){
      var tRaw=(data.transit_positions.data||data.transit_positions);
      var tPos=tRaw.positions||[];
      if(Array.isArray(tPos)){
        tPos.forEach(function(p){
          if(SLOW.indexOf((p.name||"").toLowerCase())<0)return;
          var nm=PMAP[(p.name||"").toLowerCase()]||p.name||"";
          var sg=SMAP[p.sign||""]||p.sign||"";
          var deg=parseFloat(p.degree_in_sign||p.degree||0).toFixed(1);
          result.push({planet:"T."+nm,sign:sg,deg:deg,retrograde:p.is_retrograde||false});
        });
      }
    }
    return result;
  }

  // GENERATE
  async function doGen(idx){
    var sl=slots[idx];if(!sl)return;
    // GUARD: dupli klik na "Generiši" zna da pokrene 2 job-a u 20s razmaku (Zorica 4.6.).
    // disabled:busy na dugmetu nije dovoljno - busy se update-uje async pa kratki dvostruki
    // klik prodje kroz oba. Cuvamo status u referenci pre setState-a.
    if(genBusyRef.current["a"+idx]||sl.status==="generating"){
      console.warn("doGen: already generating, ignoring duplicate click");
      // Vidljiv feedback radnici - Suzana 6.6. 10:25 zaglavila 2 Milovan-a paralelno
      // jer je nestrpljivo klikala Generiši, a samo `console.warn` ne pomaze njoj.
      toast2("Vec se generisi analiza - sacekaj rezultat (3-7 min) umesto da klikces ponovo.");
      return;
    }
    if(sl.jobId){
      // Zaostali jobId od ranije greske (status NIJE generating). Ranije je ovo trajno
      // blokiralo dugme Generisi na tom slotu ("Ne radi" prijava #70) - sad se cisti.
      console.warn("doGen: clearing stale jobId",sl.jobId);
      upSlot(idx,function(s){return Object.assign({},s,{jobId:null});});
    }
    var hasClientChart=!!sl.ch;
    var hasPitanjaText=sl.client.pitanja&&sl.client.pitanja.trim().length>10;
    if(!hasClientChart&&!hasPitanjaText){
      console.warn("doGen: no client chart and no pitanja text — nothing to do");
      return;
    }
    genBusyRef.current["a"+idx]=true;
    // Upozorenje na duplikat: isti klijent (ime+datum) vec ima analize u Bazi.
    // Suzana 1.7. prijava #71: "Cetvrti put radim jednu istu osobu" - niko je nije
    // upozorio da klijent vec postoji. Best-effort provera, ne blokira ako server spava.
    // Preskace se za namerni regenerate (slot je "done" - radnica svesno ponavlja).
    if(sl.client.ime&&sl.client.datum&&sl.status!=="done"){
      try{
        var rDup=await fetchSafe(API+"/api/clients",null,6000);
        if(rDup.ok){
          var dDup=await rDup.json();
          var dupCl=(dDup.clients||[]).find(function(c){
            return (c.birth_date||"").slice(0,10)===sl.client.datum&&normSearch(c.name||c.ime||"")===normSearch(sl.client.ime);
          });
          var dupCount=dupCl&&(dupCl.total_count||dupCl.analyses_count||0);
          if(dupCount>0&&!window.confirm("PAZNJA: "+sl.client.ime+" ("+fmtDMYFromISO(sl.client.datum)+") vec ima "+dupCount+" analiza u Bazi. Pogledaj Bazu pre ponovnog generisanja.\n\nSigurno zelis JOS JEDNU analizu za istog klijenta?")){
            genBusyRef.current["a"+idx]=false;
            return;
          }
        }
      }catch(eDup){/* server spava - ne blokiraj generisanje */}
    }
    upSlot(idx,function(s){return Object.assign({},s,{status:"generating",analysis:"",copyIdx:0,qaWarn:null,genStartedAt:Date.now()});});
    // HARD SAFETY VALVE: ako doGen NE STIGNE da postavi jobId u 8 minuta, sigurno je
    // negde zaglavio (sub-fetch bez timeout-a koji mi nismo pokrili). Forsiraj UI da
    // se vrati u idle i prikazi grešku. Suzana 6.6. 09:25: 3 analize "rade po pola sata",
    // ni jedan job u DB-u - doGen je visio.
    var doGenSafetyTimer=setTimeout(function(){
      setSlots(function(prev){
        var cur=prev[idx];
        if(cur&&cur.status==="generating"&&!cur.jobId){
          console.error("doGen safety valve: nije stigao do POST u 8 min, forsiram error");
          try{Sentry.captureMessage("doGen safety valve fired (no jobId after 8min)",{level:"error",tags:{source:"doGen_safety"}});}catch(_){}
          toast2("Generisanje je zaglavljeno (spora mreža ili backend). Klikni Generiši ponovo.");
          genBusyRef.current["a"+idx]=false;
          var nv=prev.slice();
          // idle + prazno, NE lazna "gotova analiza" (prijava #71 pattern)
          nv[idx]=Object.assign({},cur,{status:"idle",analysis:"",jobId:null,genStartedAt:null});
          return nv;
        }
        return prev;
      });
    },8*60*1000);
    try {
    // Auto-extract additional persons from pitanja and compute their charts
    var extraPersons=[];
    var extraCharts=[];
    if(hasPitanjaText){
      try{
        extraPersons=await parsePersonsFromPitanja(sl.client.pitanja);
        for(var ipi=0;ipi<extraPersons.length;ipi++){
          var pp=extraPersons[ipi];
          // Skip if this person is the same as the client (avoid duplicate)
          if(sl.client.datum&&pp.datum===sl.client.datum&&(pp.ime||"").toLowerCase().trim()===(sl.client.ime||"").toLowerCase().trim())continue;
          // Skip if this person is the partner (already in pTxt)
          if(sl.partner&&sl.partner.datum&&pp.datum===sl.partner.datum)continue;
          try{
            var pCh=await callAstroAPI(pp.datum,pp.vreme||"",pp.mesto||sl.client.mesto||"Beograd");
            if(pCh)extraCharts.push({person:pp,chart:pCh,hasTime:!!pp.vreme,hasPlace:!!pp.mesto});
          }catch(eX){console.warn("Extra chart failed for "+(pp.ime||"?")+":",eX.message);}
        }
        console.log("doGen: extra persons computed:",extraCharts.length);
      }catch(ePP){console.warn("parsePersonsFromPitanja failed:",ePP.message);}
    }
    if(!hasClientChart&&extraCharts.length===0){
      console.warn("doGen: no client chart and no extra persons extracted — abort");
      upSlot(idx,function(s){return Object.assign({},s,{status:"idle",analysis:"",genStartedAt:null});});
      toast2("Nema podataka za analizu. Unesi datum klijenta ili podatke osoba u Pitanja.");
      return;
    }
    var isDecaMode=!hasClientChart&&extraCharts.length>0;
    var today=new Date(),todayStr=fmtDMY(today);
    var MONTH_EN=["January","February","March","April","May","June","July","August","September","October","November","December"];
    var curYear=today.getFullYear(),curMonth=today.getMonth(),curMonthName=MONTH_EN[curMonth];
    var dateAwareness="\n\n*** CRITICAL - DATE AWARENESS ***\nTODAY: "+todayStr+"\nCURRENT YEAR: "+curYear+"\nCURRENT MONTH: "+curMonthName+" "+curYear+"\n\nSTRICT DATE RULES:\n1. Every date you write in forecasts MUST be AFTER today ("+todayStr+").\n2. Verify each month you mention — if that month has already passed this year, either use the SAME month of "+(curYear+1)+" or skip to a future month.\n   - Example: if today is "+curMonthName+" "+curYear+" and you want 'u martu', March "+curYear+" is past — use 'u martu "+(curYear+1)+"'.\n   - Example: if today is May "+curYear+" and you want 'u januaru', that's past — use 'u januaru "+(curYear+1)+"'.\n3. NEVER write "+(curYear-1)+" or earlier as the current or future year. Current year is "+curYear+".\n4. All forecasts span "+todayStr+" to end of "+(curYear+1)+".\n5. Before writing each date, pause and verify: 'Is this date after "+todayStr+"? Yes → write it. No → shift to "+(curYear+1)+" or skip.'\n6. If the client mentions a FIXED future event (due date, wedding, surgery on specific date), respect that exact date. Do NOT write predictions that contradict or undermine it.\n7. DATE FORMAT — NUMERIC ONLY: every date MUST be written as digits in DD.MM.YYYY format. CORRECT: '20.10.2026.', 'od 5.8. do 15.9.2027.', '15.3.2027.'. FORBIDDEN: spelling out numbers ('dvadesetog oktobra', 'dve hiljade dvadeset šeste'), descriptive phrases without digits ('u petom mesecu', 'krajem drugog meseca'). Day and month as numerals, year as 4 digits. When giving a period, use 'od DD.MM. do DD.MM.YYYY.' or 'DD.MM. — DD.MM.YYYY.'. Descriptive phrases like 'pocetkom maja' or 'sredinom juna' are OK when no specific date is needed — but any number MUST be a digit.\n";
    var personContext="\n*** CRITICAL - PERSON CONTEXT SEPARATION ***\nThe main client is: "+(sl.client.ime||"client")+".\n- ALL forecasts, predictions, love/work/health statements refer to THIS CLIENT unless text explicitly says otherwise.\n- If the context mentions OTHER people (child, partner, parent, sibling, friend, ex), keep their contexts strictly SEPARATED.\n- NEVER attribute the client's situation to another person.\n- NEVER attribute another person's situation (pregnancy, illness, marriage, new job) to the client.\n- If an event is about the client's daughter, write it AS ABOUT THE DAUGHTER, not as about the client.\n- When in doubt whose life an event belongs to, re-read the context carefully before writing.\n- Each additional person has EXACTLY their own birth date and their own chart, listed in the 'VEZIVANJE OSOBA IZ PITANJA' table. NEVER recompute, swap, or guess dates between people — use that table verbatim to know which date and chart belongs to which name.\n";
    var ptxt=hasClientChart?sl.ch.planets.map(function(p){return p.name+": "+p.sign+" "+p.degInSign+"°"+(p.house?" ("+p.house+". kuca)":"");}).join("\n"):"";
    var atxt=hasClientChart?sl.ch.aspects.map(function(a){return a.p1+" "+a.aspect+" "+a.p2+" (orb: "+a.orb+"°)";}).join("\n"):"";
    var pTxt="";
    if(sl.pch&&sl.partner&&sl.partner.datum){
      var pp=sl.pch.planets.map(function(p){return p.name+": "+p.sign+(p.house?" ("+p.house+". kuca)":"");}).join("\n");
      var pa=sl.pch.aspects.map(function(a){return a.p1+" "+a.aspect+" "+a.p2+" (orb: "+a.orb+"°)";}).join("\n");
      var pHasTime=sl.partner.vreme&&sl.partner.vreme.trim().length>0;
      var pAscInfo=pHasTime&&sl.pch.ascSign&&sl.pch.ascSign!=="Nepoznato"?", Asc: "+sl.pch.ascSign:"";
      pTxt="\n\nPARTNER: "+(sl.partner.ime||"Partner")+", "+sl.partner.datum+(sl.partner.vreme?", "+sl.partner.vreme:"")+(sl.partner.mesto?", "+sl.partner.mesto:"")+"\nSunce: "+sl.pch.sunSign+", Mesec: "+sl.pch.moonSign+pAscInfo+"\nPlanete:\n"+pp+"\nAspekti:\n"+pa;
    }
    var tMap={ljubav:"ljubav i partnerstvo",posao:"posao i karijeru",godisnja:"godišnju prognozu",sinastija:"sinastriju",tranziti:"tranzite"};
    var typeLbl=sl.types.map(function(t){return tMap[t]||t;}).join(", ");
    var isHR=country==="hr";
    var aName=isHR?"Marija":"Suzana";
    var lang=isHR?"hrvatskom":"srpskom ekavicom";
    var closing=isHR?"Hvala ti puno na povjerenju i zelim ti zivot ispunjen mirom, radoscu i srecom.\nAstrolog Marija":"Hvala ti puno na poverenju i zelim ti zivot ispunjen mirom, radoscu i srecom.\nAstrolog Suzana";
    // Automatska sinastria detekcija na osnovu partner podataka
    var isSinastrija=sl.pch&&sl.partner&&sl.partner.datum;
    var partnerName=isSinastrija?(sl.partner.ime||"partnera"):"";
    var hasPitanja=sl.client.pitanja&&sl.client.pitanja.trim().length>0;
    var hasNapomena=sl.client.napomena&&sl.client.napomena.trim().length>0;
    // Jednostavan sistem prompt - admin prompt (mainPr) nosi glavna pravila strukture
    var identityLock="=== CLIENT IDENTITY LOCK (read before anything else) ===\nThe CLIENT for this specific analysis is:\n  NAME: '"+(sl.client.ime||"klijent")+"'\n  BIRTH DATE: '"+(sl.client.datum||"")+"'\n  BIRTH PLACE: '"+(sl.client.mesto||"")+"'\n\nRULES:\n1. The ONLY valid name for the client is '"+(sl.client.ime||"klijent")+"'. NEVER use any other name.\n2. If you see names like 'Milica', 'Dragana', 'Ana', 'Marko' further down in the prompt, those are GRAMMAR EXAMPLES for vocative rules — they are NOT the client. Ignore them as identities.\n3. Before writing the opening vocative, re-read this block and confirm you are using '"+(sl.client.ime||"klijent")+"'.\n4. If you feel tempted to write a name you saw in vocative examples, STOP and use '"+(sl.client.ime||"klijent")+"'.\n=========================================================\n\n";
    var sys=identityLock+"WRITE IN ENGLISH. Text will be translated to Serbian later."+dateAwareness+personContext+"\n\nYou are "+aName+", a top FEMALE astrologer with 30 years of experience. You write everything in FEMININE voice.\n\n*** CRITICAL - FEMININE VOICE (ALWAYS, NO EXCEPTIONS) ***\nEvery self-reference, every past-tense verb about yourself, every adjective agreeing with you must be FEMININE. The translation into Serbian must preserve feminine grammatical forms. Examples of CORRECT feminine forms in Serbian that the translator will produce:\n- 'videla sam' (NOT 'video sam')\n- 'pogledala sam' (NOT 'pogledao sam')\n- 'napisala sam' (NOT 'napisao sam')\n- 'primetila sam' (NOT 'primetio sam')\n- 'zakljucila sam' (NOT 'zakljucio sam')\n- 'rekla bih' (NOT 'rekao bih')\n- 'iskrena sam' (NOT 'iskren sam')\n- 'sigurna sam' (NOT 'siguran sam')\n- 'bila sam' (NOT 'bio sam')\nWhen writing in English, always use 'I saw', 'I noticed', 'I wrote', 'I concluded', 'I would say', 'I am certain', etc., and add the English note '(feminine voice - translate to Serbian feminine form)' in your output IF the word can be ambiguous. The translator is instructed to always use feminine Serbian forms for the astrologer's voice.\n\n*** CRITICAL - HEALTH DISCLAIMER (INSERT VERBATIM IN SERBIAN — DO NOT TRANSLATE) ***\nIf the analysis mentions health, illness, body, pregnancy, medical conditions, therapy, medication, diet, anxiety, depression, sleep, or any physical/mental wellness topic — you MUST end that section (or the analysis) by inserting the following Serbian sentence VERBATIM, character-for-character, exactly as written below. DO NOT translate it to English. DO NOT paraphrase. DO NOT write an English version of it. Copy it letter-for-letter into your output, embedded among your English text — the translator will leave it as-is:\n>>> Molim te da ovo ne uzimaš kao medicinski savet. Ja sam astrolog, nisam lekar. Obavezno se konsultuj sa lekarom i slušaj njegove/njene savete. Astrologija ukazuje na energetske sklonosti, ali samo lekar može da ti da stvarnu dijagnozu i terapiju. <<<\nFORBIDDEN: writing 'Please do not take this as medical advice...' or any English version. The disclaimer MUST appear in Serbian only.\n";
    if(isSinastrija){
      sys+="\n\nTASK: SYNASTRY analysis comparing TWO natal charts - about the RELATIONSHIP DYNAMIC between "+(sl.client.ime||"client")+" and "+partnerName+". This is about the COUPLE.";
    }else{
      sys+="\n\nTHIRD PERSON RULE: If Name contains family relation (daughter, son, brother, sister, husband, wife, mom, dad, friend, aunt, uncle) - analysis is about that person, speak TO client ABOUT them in third person. Otherwise address directly using 'ti'.";
    }
    sys+="\n\nTONE: Start the analysis by addressing the client ('"+(sl.client.ime||"klijent")+"') directly with their name in vocative followed by a comma, then IMMEDIATELY dive into the SUBSTANCE of the analysis on the SAME LINE. First sentence after the vocative must describe the client's nature, character, or a concrete insight from the chart.\n\n*** CRITICAL - VOCATIVE AND FIRST SENTENCE ON SAME LINE ***\nThe vocative (name + comma) and the first sentence MUST be on the SAME LINE, separated only by comma + space + lowercase next word.\nCORRECT: 'Majo, odmah da ti kazem da izmedju vas dvoje postoji veoma jaka veza...'\nCORRECT: 'Marko, tvoja karta otkriva coveka izmedju stabilnosti i nemira...'\nFORBIDDEN (NEVER do this):\n- 'Maja,\\n\\nOdmah da ti kazem...' (newline + blank line — WRONG)\n- 'Maja,\\nOdmah da ti kazem...' (single newline — WRONG)\n- 'Maja,\\n' followed by separate paragraph — WRONG\nThe word right after 'Name, ' must be LOWERCASE because it continues the same sentence.\n\n*** CRITICAL - NO INTRO PREAMBLE ***\nAfter the opening vocative, NEVER write a preamble/introduction sentence describing what the analysis will cover. The client already knows they are reading an analysis — do NOT announce it.\n\nFORBIDDEN intro phrases (never use these or variations):\n- 'evo tvoje detaljne analize'\n- 'evo tvoje astroloske analize'\n- 'na osnovu podataka/tvoje karte/vasih natalnih karata'\n- 'videces sta te ceka'\n- 'videcemo sta vas ceka u ljubavi, poslu, zivotu'\n- 'prognoze za narednih 12 meseci' (as intro — can appear as substance later)\n- 'krecemo sa analizom'\n- 'donosim ti analizu'\n- 'pogledala sam tvoju kartu i...'\n- Any sentence that merely ANNOUNCES what the analysis will cover instead of delivering insight\n\nCORRECT opening examples (straight into substance):\n- 'Milice, tvoj Sunce u Ribama pokazuje duboku emotivnu prirodu...'\n- 'Jovana, vidim osobu koja je dugo nosila tugu...'\n- 'Marko, tvoja karta otkriva coveka izmedju stabilnosti i nemira...'\n\nWRONG openings (preamble):\n- 'Gordana, evo tvoje detaljne analize za narednih 12 meseci...' (banned: preamble)\n- 'Ana, na osnovu tvoje karte videcemo sta te ceka...' (banned: preamble)\n\n*** CRITICAL - CORRECT SERBIAN VOCATIVE FOR NAMES ***\nThe ONLY valid client name is: '"+(sl.client.ime||"klijent")+"' (confirmed in CLIENT IDENTITY LOCK at top).\nThe names listed below are GRAMMAR EXAMPLES — they are NOT the client. Do NOT use them as the client's name, only as a pattern reference for applying vocative endings to '"+(sl.client.ime||"klijent")+"'. If '"+(sl.client.ime||"klijent")+"' fits one of these patterns, apply it; if uncertain, use '"+(sl.client.ime||"klijent")+"' in nominative.\n\nFEMALE NAMES (examples only, not the client):\n- Names ending in -ica: Milica→Milice, Zorica→Zorice, Dragica→Dragice, Radica→Radice, Ljubica→Ljubice\n- Names ending in -ana/-ina/-ena/-ela/-ija: KEEP AS IS — Dragana→Dragana, Jovana→Jovana, Karolina→Karolina, Jelena→Jelena, Svetlana→Svetlana, Gordana→Gordana, Milena→Milena, Daniela→Daniela, Marina→Marina, Jasmina→Jasmina, Marija→Marija, Natalija→Natalija, Sofija→Sofija, Mirjana→Mirjana\n- Names ending in -a (NOT on -ica/-ana/-ina/-ena/-ela/-ija): ADD -o — Maja→Majo, Sanja→Sanjo, Tanja→Tanjo, Vanja→Vanjo, Anja→Anjo, Sonja→Sonjo, Dunja→Dunjo, Mira→Miro, Nada→Nado, Milka→Milko, Magda→Magdo, Ljilja→Ljiljo, Saska→Sasko, Jaca→Jaco\n- EXCEPTIONS (short 3-letter names KEEP): Ana→Ana, Iva→Iva (NEVER Ano, NEVER Ivo since Ivo is masculine)\n\n*** KRITICNO - SLICNA A RAZLICITA IMENA ***\nNIKADA ne mesaj slicna ali RAZLICITA imena:\n- Milka ≠ Milica. Milka u vokativu Milko (-ka → -ko). Milica postaje Milice.\n- Maja ≠ Marija. Maja postaje Majo. Marija ostaje Marija.\n- Vanja ≠ Vanesa. Vanja postaje Vanjo.\n- Nada ≠ Nadica. Nada postaje Nado. Nadica postaje Nadice.\nUvek koristi TACNO ime iz CLIENT IDENTITY LOCK. Ne zamenjuj ga slicnim imenom!\n\nMALE NAMES:\n- Consonant ending: Ivan→Ivane, Dragan→Dragane, Stefan→Stefane, Milan→Milane\n- Names ending in -o: KEEP AS IS — Marko→Marko, Darko→Darko, Zdravko→Zdravko\n- Names ending in -a masculine: KEEP AS IS — Nikola→Nikola, Luka→Luka, Sava→Sava\n\nABSOLUTE RULES:\n- NEVER 'Dragana' → 'Dragano' or 'Dragane' (zavrsava na -ana, ostaje Dragana)\n- NEVER 'Jovana' → 'Jovano' (ostaje Jovana)\n- NEVER 'Karolina' → 'Karolino' (ostaje Karolina)\n- NEVER 'Marina' → 'Marino' (ostaje Marina)\n- NEVER 'Marija' → 'Marijo' (ostaje Marija)\n- NEVER 'Ana' → 'Ano' (ostaje Ana, kratko ime)\n- NEVER 'Iva' → 'Ivo' (ostaje Iva, Ivo je musko)\n- NEVER add '-o' ending to female -ana/-ina/-ena/-ija names\n- Wrong vocative sounds uneducated and offends the client\n\n*** CRITICAL - CLIENT NAME USAGE: ONLY IN OPENING VOCATIVE ***\nThe CLIENT's name ('"+(sl.client.ime||"klijent")+"') appears ONLY ONCE — in the vocative at the very beginning of the analysis (first sentence, followed by comma).\nAfter that opening, you MUST address the client using 'ti' (and its forms: tebi, tebe, tvoj, tvoja, tvoje) throughout the ENTIRE text — NEVER write the client's name again anywhere in the body, in section headers, in transitions, or at the end.\nFORBIDDEN:\n- Repeating the client's name in paragraph starts (e.g., 'A sad, Milice...')\n- Using the client's name in section titles\n- Ending the analysis with the client's name (e.g., 'Srecno, Ana')\n- ANY occurrence of the client's name after the first sentence\nThe closing is always 'Hvala ti puno...' — WITHOUT the name.\nThis rule eliminates all vocative errors: the name appears exactly 1x, so there is no chance to mis-conjugate it repeatedly.\n\nWarm, direct 'ti' address.\n\n*** CRITICAL - NEVER 100% GUARANTEES FOR FUTURE EVENTS ***\nAstrology shows TENDENCIES and POSSIBILITIES, not certain future events. Differentiate tone:\n\nCHARACTER descriptions / patterns / general insights — speak with CERTAINTY:\n- 'Tvoja priroda je...' (OK)\n- 'Tvoj Mesec pokazuje...' (OK)\n- 'Karta donosi...' (OK)\n- 'Imas tendenciju da...' (OK)\n- 'Ti si osoba koja...' (OK)\n\nSPECIFIC FUTURE EVENTS with dates — NEVER guarantee, use probability language:\n\nFORBIDDEN (100% garancije za buduce dogadjaje):\n- 'U martu 2027. ces se udati.' (WRONG - 100% garancija)\n- 'Desice se trudnoca u junu 2026.' (WRONG)\n- 'Dobices posao 15.09.2026.' (WRONG)\n- 'Rodice se dete u septembru 2026.' (WRONG)\n- 'Ce se desiti brak' sa datumom (WRONG)\n\nCORRECT (verovatnoca, ne garancija):\n- 'U martu 2027. postoji velika mogucnost za brak.' (OK)\n- 'Jun 2026. donosi snaznu energiju za trudnocu.' (OK)\n- 'Sredinom septembra 2026. otvara se sansa za novi posao.' (OK)\n- 'Septembar 2026. nosi potencijal za rodjenje deteta.' (OK)\n- 'Ovo vreme pogoduje braku.' (OK)\n\nCoristi fraze: 'postoji velika mogucnost', 'snazna sansa', 'otvara se prilika', 'donosi energiju za', 'potencijal', 'pogoduje', 'vreme je povoljno za', 'mogucnost', 'ukazuje na'. Izbegavaj 'ce se desiti', 'sigurno', '100%', 'garantujem', 'obavezno' za konkretne buduce dogadjaje sa datumom. I DALJE ZABRANjeno slabo hedging 'mozda', 'moglo bi', 'verovatno' — to nije relativizovanje, to je AI kukavicluk.\n\n*** CRITICAL - NEVER WRITE WHAT YOU CAN'T DO ***\nYou have full chart data for the client. NEVER write disclaimers about limitations or missing data. The client MUST NEVER feel the service is incomplete. If partner/child has no birth time, quietly work with what you have (Sun sign from date) without mentioning limitations.\n\nFORBIDDEN (ruse kredibilitet usluge):\n- 'Za dublju analizu bilo bi potrebno izracunati tacnu kartu...'\n- 'Nemam podatke za Mesec/Ascendent deteta...'\n- 'Ne mogu da vidim Ascendent bez tacnog vremena...'\n- 'Bez tacnog vremena rodjenja ne mogu precizno...'\n- 'Idealno bi bilo da imamo...'\n- 'Bila bi potrebna dodatna informacija...'\n- 'Za preciznu prognozu treba mi...'\n- Bilo koja recenica koja pominje sta AI NE MOZE ili sta NEDOSTAJE.\n\nAstrolog sa 30 godina iskustva nikad ne najavljuje svoje granice klijentu. Radi sa onim sto imas. Ako je partner samo datum rodjenja — opisuj Sun sign i ne pominji da nedostaje Mesec/Ascendent.\n\n*** CRITICAL - NO HEDGING ABOUT OTHER PEOPLE'S CHARTS ***\nIf you DON'T have exact birth time for someone (partner, child, sibling, parent, friend), do NOT speculate about their Moon, Ascendant, or houses. Mention ONLY their Sun sign — derived from their birth date, which is 100%% accurate.\nFORBIDDEN (these phrases destroy credibility):\n- 'Njegov Mesec je verovatno u nekom od vazdusnih znakova' (WRONG — speculation)\n- 'Verovatno joj je Ascendent u Devici' (WRONG)\n- 'Mozda joj je Mesec u Skorpiji' (WRONG)\n- 'Mesec mu je negde u Strelcu' (WRONG)\n- 'Vjerovatno mu je Ascendent...' (WRONG)\n- 'Pretpostavljam da joj je Mesec...' (WRONG)\nCORRECT alternatives:\n- Just describe their Sun sign concretely: 'On je Lav, sto znaci da je ponosan i topao...'\n- Or skip chart references entirely and focus on relationship dynamic with the client.\nIf you have ONLY a birth date and no time/place — Sun sign is your only chart input. Use it confidently. Never guess Moon/Ascendant; never hedge them; just don't mention them. Silence is better than speculation.\n\n*** CRITICAL - USE ADDITIONAL PERSONS' CHARTS CONCRETELY ***\nIf the user prompt contains a section titled 'DODATNE OSOBE U ANALIZI', that means we have COMPUTED astrological charts for those people (children, partner, sibling, parent, etc.). USE THOSE CHARTS CONCRETELY when discussing those people:\n- Reference Sun, Moon, Ascendant, planets, and houses BY NAME of the person.\n- Example: 'Markov Mesec u Ribama govori o duboko osetljivom decaku' — concrete and confident.\n- Example: 'Milicin Ascendent u Vagi privlaci ljude diplomatskoj prirodi' — concrete.\nNIKAD 'verovatno joj je Mesec...', 'mozda mu je Ascendent...' — ti IMAS njihove karte u DODATNE OSOBE sekciji.\nIf a person's chart says NAPOMENA: vreme rodjenja nije dato (no time), then for THAT person you can use Sun and Moon and planets BUT NOT Ascendant or houses (those need exact time). Don't mention Asc/houses for that person, but Sun/Moon/planets are still 100%% confident.\n\n*** CRITICAL - DECA MODE / ANALIZA ZA DECU ***\nIf the user prompt does NOT contain 'PODACI O KLIJENTU' (i.e., client has no chart) but DOES contain 'DODATNE OSOBE U ANALIZI', this is DECA MODE — the analysis is FOR the parent/guardian (whose name is given) ABOUT their children/relatives.\nIn this case:\n- DO NOT analyze the parent's chart (you don't have it).\n- Open with the parent's name in vocative ('Maja, ...'), then immediately a sentence about the children.\n- Create a SEPARATE SECTION FOR EACH CHILD from DODATNE OSOBE, using their concrete charts.\n- Each section: child's nature (Sun/Moon/Asc/planets), strengths, challenges, advice to the parent on how to approach this child, 12-month forecast for the child (school, health, friends, key phases).\n- Address the parent as 'ti' ('tvoj sin Marko', 'tvoja cerka Milica').\n- End with brief advice to the parent: how to navigate the different natures of their children, what to keep in mind for next 12 months.\n- Length still 2000+ words across all children combined.\n\n*** CRITICAL - EXACT CHART DATA ***\nThe PODACI O KLIJENTU section contains EXACT astrological data calculated by NASA-grade Swiss Ephemeris: Sunce, Mesec, Ascendent, planetary positions, houses, and aspects are 100% ACCURATE based on the provided birth date, time, and place. You MUST use these EXACT values. NEVER hedge with words like 'verovatno', 'mozda', 'zavisno od vremena', 'priblizno', 'oko' when discussing the chart. If the data says 'Sunce: Pisces, Ascendent: Taurus' - write confidently that Sun is in Pisces and Ascendant is in Taurus. NEVER guess, NEVER add uncertainty phrases. The data you received IS the correct chart - trust it absolutely.\n\nFORBIDDEN:\n- NEVER planet names, houses, degrees, astrological terms in text - write what it MEANS concretely\n- NEVER physical metaphors ('sedi nasuprot mene', 'sit across from me', 'imagine sitting')\n- NEVER dashes (-) - use commas instead\n- NEVER markdown: # ## ### **bold** *italic* --- __underline__\n- NEVER bullets or lists with dots, dashes, asterisks or any decorative symbol\n- NEVER checkmarks (✅ ✓ ✔ ☑) or X marks (❌ ✗ ×) or arrows (→ ➡ ⇒)\n- NEVER 'Evo', 'Hajde da pogledamo', 'Analiziramo' - sounds like AI\n- NEVER 'Kljucno je da', 'Vazno je istaci', 'Treba napomenuti' - AI cliches\n- NEVER AI 'honesty preamble' phrases: 'Bicu potpuno iskrena sa tobom', 'Bicu iskrena', 'Iskreno cu ti reci', 'Da budem iskrena', 'Necu da te lazem', 'bez uvijanja', 'bez okolisanja'. A real astrologer with 30 years of experience NEVER announces honesty — she just IS honest. Such preambles are the strongest 'AI smell' signal. Skip the announcement; deliver the insight directly.\n- NEVER 'T.' or 'Tr.' or 'Transit' prefix before planets. Write 'Saturn', 'Jupiter', NOT 'T.Saturn', 'Tr.Jupiter'. The client does not know what 'T.' means.\n- NEVER 'Tranzitni' or 'Tranzitna' prefix before planet names. Write 'Saturn donosi', NOT 'Tranzitni Saturn donosi'. Klijent ne razume termin 'tranzitni'.\n- NEVER parenthetical 'data notes' or 'reasoning' in the text like '(podaci: Pluton u Vagi, verovatno 7. kuca)', '(napomena: ...)', '(pretpostavka: ...)', '(jer ...)'. The analysis must be CLEAN PROSE. Never show your calculation/data reasoning to the client.\n- NEVER mention 'kuca' / 'house' / '7. kuca' / '10. kuca' — the client does not care about astrological houses. Just describe what the life area means (love, work, home).\n- NEVER self-questioning or thinking aloud in the text: 'T.Jupiter ulazi u Vagu?' is WRONG (AI asking itself). 'Zapravo,...' as self-correction is WRONG. '(ako pretpostavimo)' is WRONG. '(vec u aspektu)' is WRONG. 'u zavisnosti od aspekta' is WRONG. Be definitive. If unsure — leave it out entirely.\n- NEVER degree symbols like '3° Riba', '15° Lav' — client doesn't care about technical degrees.\n- WRITE LIKE A HUMAN: natural paragraphs, no symbols, no decoration. Indistinguishable from real person typing.\n- NEVER emojis in body (only Astrolog "+aName+" \u2764\uFE0F at very end)\n- NEVER skip any client question\n- NEVER hedge the chart data ('verovatno', 'mozda', 'zavisno od tacnog vremena', 'priblizno')\n\nMANDATORY SECTIONS (ALL must be present, REGARDLESS of admin prompt):";
    if(isSinastrija){
      sys+="\n1. Intro about the couple - immediate impression of their bond\n2. Emotional compatibility - how they feel each other\n3. Love and attraction - chemistry, passion, intimacy\n4. Communication dynamics - how they talk and understand\n5. Challenges and karma - what each must learn\n6. POSITIVE AND NEGATIVE TRAITS - list 4-5 positive and 4-5 negative traits FOR EACH PERSON separately, with advice what they should improve\n7. POSAO I NOVAC ZA "+(sl.client.ime||"KLIJENTA").toUpperCase()+" - career and money forecast for "+(sl.client.ime||"the client")+" INDIVIDUALLY (NOT about couple's business) - career direction, business opportunities, financial forecast next 12 months, best periods for work/investment (MUST be detailed, focused ONLY on "+(sl.client.ime||"the client")+")\n8. 12-MONTH FORECAST FOR THE RELATIONSHIP - divide by periods (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) with CONCRETE events in each period\n9. Honest conclusion about long-term potential";
    }else{
      sys+="\n1. Emotional intro - who is this person\n2. Inner world - character, psychology\n3. LJUBAV - major section - who is partner, what will happen in next 12 months CONCRETELY, romantic periods, warnings (MUST be detailed)\n4. POSAO I NOVAC - major section - career direction, business opportunities, financial forecast 12 months, best periods for investment/work (MUST be detailed)\n5. 12-MONTH FORECAST - divided by periods (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) with CONCRETE events in each period\n6. POSITIVE AND NEGATIVE TRAITS - list 4-5 positive and 4-5 negative traits, advice what to improve\n7. Health (brief) - end with disclaimer 'ovo nije medicinski savet, obavezno se obrati lekaru za sve zdravstvene probleme'\n8. Honest conclusion";
    }
    if(hasPitanja){
      sys+="\n\n*** CLIENT HAS ASKED SPECIFIC QUESTIONS ***\nYou MUST answer EVERY question from the client directly, clearly, and with certainty. Create a dedicated section titled 'Odgovori na tvoja pitanja' where you address each question one by one. Use 'bice' or 'ce se desiti' - never 'mozda' or 'moglo bi'. THIS IS MANDATORY - do not skip any question.\n\n*** CRITICAL - Q&A FORMAT - QUESTION ON OWN LINE, ANSWER BELOW ***\nIn the 'Odgovori na tvoja pitanja' section, the format MUST be:\n1. Question rephrased to 'ti' form, ending with '?', on its OWN LINE\n2. Answer paragraph on next line below\n3. Empty line between Q+A pairs\n\nCORRECT example:\n\nDa li ćete se razići?\nKarta pokazuje period preispitivanja ali ne i kraj veze. Tvoj Mesec u Raku govori... [paragraph 8-10 sentences]\n\nDa li on ima osećanja prema tebi?\nDa, on ima osećanja, ali ih ne pokazuje otvoreno... [paragraph]\n\nWRONG (DO NOT DO):\n- 'Zanima te da li ćete se razici i da li on ima osecanja, karta pokazuje...' (questions hidden in prose, merged, no '?')\n- 'Pitas se da li ces se razici.' (lead-in 'Pitas se' + period instead of just question with '?')\n\nRULES: NO lead-in prefixes ('Pitas se...', 'Zanima te...', 'Rekao si da...') before the question. Just write the question itself rephrased to 'ti' form, ending with '?'. Question on own line. Answer below. Empty line between Q+A blocks. Multiple questions = multiple separate blocks, never merge.\n\n*** CRITICAL - REFRAME EVERY QUESTION IN SECOND PERSON ***\nWhen rephrasing the client's question, NEVER copy verbatim in first person. Swap 'ja/me/mene/moj' → 'ti/te/tebe/tvoj'; swap 'cu/sam' → 'ces/si'. Keep ALL specific details (names, dates, context). Examples:\n- Client wrote 'Da li cu se udati?' → 'Da li ćeš se udati?' (own line) + answer below\n- Client wrote 'Kada cu dobiti posao?' → 'Kada ćeš dobiti posao?' (own line) + answer below\n- Client wrote 'Da li me on voli?' → 'Da li te on voli?' (own line) + answer below\n- Client wrote 'Hocu li biti zdrav?' → 'Hoćeš li biti zdrav?' (own line) + answer below\n\n*** CRITICAL - EXPAND QUESTIONS, NEVER COMPRESS ***\nThe client wrote DETAILED questions with names, dates, emotions, contexts, life areas. When you reframe each question, you MUST preserve EVERY detail and use AT LEAST as many words as the client used — ideally more. EXPAND the question by restating ALL specific information (names of people mentioned, their birth dates, life areas like skola/posao/brak/zdravlje, worries, hopes, time references) before answering.\nFORBIDDEN compression patterns:\n- Client wrote 200+ characters about son's school behavior AND husband's heart problems AND pension application → reframed as 'Pitas za sina, muza i penziju.' (TOO SHORT — discards every detail)\n- Client mentioned 5 separate concerns → merged into 1 generic 'Zanima te ljubav, posao i zdravlje.'\n- Client wrote 'Imam cerku Milicu rodjenu 10.05.1993, hoce li imati dece i kada, i da li ce se udati za sadasnjeg momka' → reframed as 'Pitas za cerku.' (LOST: ime Milica, datum 10.05.1993, deca, brak, sadasnji momak)\nCORRECT: EVERY name, date, situation, emotion, life area mentioned by client must appear in the reframed question OR answer paragraph. The client's full context must be visible.\nRULE: count words in client's original. Your Q+A block must reflect ALL details. If question alone is too long for one '?' line, put the core question on the line and details in the answer paragraph.\nThe astrologer reads to verify you understood the FULL question. Compressed reframe = answer cannot be trusted.";
    }
    if(hasNapomena){
      sys+="\n\n*** ASTROLOGER'S NOTE (HIGHEST PRIORITY) ***\nThe astrologer has provided specific instructions in NAPOMENA. These instructions OVERRIDE any structure conflicts and MUST be followed strictly. Read NAPOMENA carefully and adjust the analysis accordingly.";
    }
    sys+="\n\nGRAMMAR: Serbian ekavica, Latin alphabet only. Perfect grammar. Titles end with ':' + newline. Questions end with '?' + newline. Never use '?:' together.\n\n*** MANDATORY LENGTH — minimum 2000 words. This is NOT optional. ***\n- Count your output as you write. If you near the end with less than 2000 words, CONTINUE — add more depth: more concrete events, more specific dates, more sub-topics within each life area.\n- Each mandatory section (love, work, 12-month forecast, traits, questions) must be at least 250 words on its own.\n- A short analysis (under 2000 words) is a FAILURE. Better verbose than concise.\n- Do NOT write the closing 'Hvala ti puno...' until you have produced at least 2000 words of analysis.\n- If the client has questions, those MUST be answered thoroughly, adding to the word count.\n\nAT THE END write exactly:\n"+(isSinastrija?"Hvala ti puno na poverenju i zelim ti odnos ispunjen ljubavlju, razumevanjem i radoscu.":"Hvala ti puno na poverenju i zelim ti zivot ispunjen mirom, radoscu i srecom.")+"\n\nAstrolog "+aName+" \u2764\uFE0F\n\nToday is: "+todayStr;
    var mainPr=getPr("main");
    // Build transit text. Tranziti iz API-ja se koriste samo ako su SVEZI (<48h) —
    // stari tranziti iz localStorage su se ranije relabelovali kao "ZA DANAS" iako su
    // fetchovani pre vise dana. Ako API tranzita nema (Render spavao), koristi lokalno
    // izracunate DANASNJE pozicije (astronomy-engine, tacnost ~Swiss Ephemeris) da AI
    // nikad ne ostane bez podataka o trenutnom nebu.
    var trTxt="";
    var trFresh=sl.transits&&sl.transits.length>0&&sl.transitsAt&&(Date.now()-sl.transitsAt)<48*3600*1000;
    if(trFresh&&sl.transits[0].natalPlanet){trTxt="\n\nTRANZITI ZA DANAS ("+todayStr+"):\n"+sl.transits.map(function(t){return t.planet+" "+t.aspect+" "+t.natalPlanet+(t.house?" ("+t.house+". kuca)":"")+" (orb "+t.orb+"°)"+(t.interpretation?" - "+t.interpretation:"");}).join("\n");}
    else if(trFresh){trTxt="\n\nTRANZITNE POZICIJE DANAS ("+todayStr+"):\n"+sl.transits.map(function(t){return t.planet+": "+t.sign+" "+t.deg+"°"+(t.retrograde?" R":"");}).join("\n");}
    else{
      var localTr=localTransitPositions();
      if(localTr.length>0){trTxt="\n\nTRANZITNE POZICIJE DANAS ("+todayStr+", tacno izracunato):\n"+localTr.map(function(t){return t.planet+": "+t.sign+" "+t.deg+"°"+(t.retrograde?" R":"");}).join("\n")+"\nKoristi ISKLJUCIVO ove pozicije za trenutno nebo. NIKAD ne navodi trenutnu poziciju planete koje nema u ovoj listi.";}
    }
    var srTxt="";
    if(hasClientChart&&sl.ch.solarReturn&&sl.ch.solarReturn.planets.length>0){
      srTxt="\n\nSOLARNA REVOLUCIJA (karta za "+sl.ch.solarReturn.year+". godinu):\n"+sl.ch.solarReturn.planets.map(function(p){return p.name+": "+p.sign+" "+p.deg+"°"+(p.house?" ("+p.house+". kuca)":"");}).join("\n");
    }
    // Build extra charts text (DODATNE OSOBE block) - always available for AI to use concretely
    var extraChartsText="";
    if(extraCharts.length>0){
      extraChartsText="\n\nDODATNE OSOBE U ANALIZI (njihove karte - koristi KONKRETNO, bez 'verovatno'):\n";
      extraCharts.forEach(function(ec,ix){
        var ep=ec.person, ech=ec.chart;
        var dmy=ep.datum.split("-").reverse().join(".");
        var eAsc=ec.hasTime&&ech.ascSign&&ech.ascSign!=="Nepoznato"?", Ascendent: "+ech.ascSign+(ech.ascDeg?" "+ech.ascDeg+"°":""):"";
        var ePlanets=ech.planets.map(function(pl){return pl.name+": "+pl.sign+" "+pl.degInSign+"°"+(pl.house?" ("+pl.house+". kuca)":"");}).join("\n");
        var eAspects=ech.aspects.slice(0,15).map(function(a){return a.p1+" "+a.aspect+" "+a.p2+" (orb "+a.orb+"°)";}).join("\n");
        var notes=[];
        if(!ec.hasTime)notes.push("vreme rodjenja nije dato — Ascendent i kuce nisu dostupni za ovu osobu");
        if(!ec.hasPlace)notes.push("mesto rodjenja nije dato (default: Beograd)");
        var noteStr=notes.length>0?"\nNAPOMENA: "+notes.join("; ")+".":"";
        extraChartsText+="\n["+(ix+1)+"] "+(ep.ime||"Osoba")+(ep.odnos?" ("+ep.odnos+")":"")+", rodjen/a "+dmy+(ep.vreme?" u "+ep.vreme:"")+(ep.mesto?", "+ep.mesto:"")+noteStr+"\nSunce: "+ech.sunSign+", Mesec: "+ech.moonSign+eAsc+"\nPlanete:\n"+ePlanets+(eAspects?"\nAspekti:\n"+eAspects:"")+"\n";
      });
    }
    // Deterministicka tabela vezivanja ime -> indeks karte. AI ne sme sam da korelira
    // sirov tekst pitanja sa kartama (tu se datumi mesaju).
    var bindingText="";
    if(extraCharts.length>0){
      bindingText="\n\nVEZIVANJE OSOBA IZ PITANJA (OBAVEZNO koristi ovu tabelu, NE preracunavaj datume sam):\n";
      extraCharts.forEach(function(ec,ix){
        var bdmy=ec.person.datum.split("-").reverse().join(".");
        bindingText+="- Kada klijent u pitanjima pomene \""+(ec.person.ime||"Osoba")+"\" → to je OSOBA ["+(ix+1)+"] iz DODATNE OSOBE, rodjena "+bdmy+", Sunce: "+ec.chart.sunSign+". Koristi ISKLJUCIVO kartu ["+(ix+1)+"] za tu osobu.\n";
      });
      bindingText+="NIKADA ne mesaj datume ni karte izmedju ovih osoba. Svaka osoba ima TACNO svoj datum i svoju kartu.\n";
    }
    var treceOsobe=["cerka","kcerka","ćerka","kćerka","sin","brat","sestra","zet","snaha","muz","muž","supruga","mama","tata","majka","otac","prijatelj","prijateljica","komsija","komšija","komsinca","komšinica","tetka","stric","ujak"];
    var imeLow=(sl.client.ime||"").toLowerCase().trim();
    var isTrece=treceOsobe.some(function(r){return imeLow.indexOf(r)>=0;});
    var trecePrefix=isTrece?"NAJVAZNIJE PRAVILO - TRECE LICE:\nOva analiza NIJE za klijenta koji ti se obraca nego za njegovu/njenu "+sl.client.ime+". Ti pricas sa klijentom O toj osobi.\nPISI UVEK OVAKO: 'Tvoja "+sl.client.ime+" je osoba koja...', 'Ona nosi u sebi...', 'Njen zivot je...', 'Vidim da je ona...'\nNIKAD NE PISI OVAKO: 'Ti si osoba koja...', 'Gledam tvoju kartu...', 'Vidim da si ti...'\nObraces se klijentu i pricas mu o njegovoj/njenoj "+sl.client.ime+" u trecem licu (ona/on). Klijent cita ovu analizu da razume svoju "+sl.client.ime+", ne sebe.\n\n":"";
    var hasTime=sl.client.vreme&&sl.client.vreme.trim().length>0;
    var ascInfo=hasClientChart&&hasTime&&sl.ch.ascSign&&sl.ch.ascSign!=="Nepoznato"?", Ascendent: "+sl.ch.ascSign+(sl.ch.ascDeg?" "+sl.ch.ascDeg+"°":""):"";
    var decaPrefix=isDecaMode?"NAJVAZNIJE PRAVILO - DECA MODE / ANALIZA ZA DECU:\nKlijent (mama/staratelj/roditelj) '"+(sl.client.ime||"klijent")+"' nije pruzila svoje natalne podatke. Ova analiza NIJE za nju nego za njenu/njegovu decu/blizne (osobe iz DODATNE OSOBE U ANALIZI sekcije).\n\nSTRUKTURA:\n- Pocni vokativom mame ('"+(sl.client.ime||"")+"') sa zarezom i prvom recenicom o njenoj deci na ISTOJ liniji.\n- Za SVAKO dete iz DODATNE OSOBE sekcije, posebna SEKCIJA sa naslovom (ime deteta) i sadrzajem: priroda deteta na osnovu Sunca/Meseca/Asc/planeta, snage, izazovi, savet mami kako da pristupi tom detetu, prognoza za narednih 12 meseci za to dete (skola, zdravlje, prijatelji, vaznije faze).\n- Koristi KONKRETNE podatke iz njihovih karata (Sunce, Mesec, Asc, planete) — NIKAD 'verovatno', 'mozda', 'negde u'.\n- Obracaj se mami sa 'ti' ('tvoj sin Marko', 'tvoja cerka Milica').\n- Ne pisi sopstvene podatke za mamu (nema ih) — fokus iskljucivo na decu.\n- Na kraju kratak savet majci: kako da pristupi razlicitim prirodama svoje dece i sta da ima na umu narednih 12 meseci.\n\n":"";
    var usr;
    if(isDecaMode){
      usr=decaPrefix+mainPr+"\n\n---\n\nKLIJENT (mama/roditelj):\nIme: "+(sl.client.ime||"klijent")+"\n(Klijent nije dao svoje podatke. Analiza je za decu/blizne dole.)"+extraChartsText;
    }else{
      usr=trecePrefix+mainPr+"\n\n---\n\nPODACI O KLIJENTU:\nIme: "+(sl.client.ime||"")+"\nDatum rodjenja: "+sl.client.datum+", Vreme: "+(sl.client.vreme||"nije dostavljeno")+", Mesto: "+(sl.client.mesto||"nepoznato")+"\nSunce: "+sl.ch.sunSign+", Mesec: "+sl.ch.moonSign+ascInfo+"\n\nPLANETE:\n"+ptxt+"\n\nASPEKTI:\n"+atxt+pTxt+extraChartsText+trTxt+srTxt;
    }
    if(sl.client.napomena&&sl.client.napomena.trim()){
      usr+="\n\nNAPOMENA ASTROLOGA (OBAVEZNO POSTOVATI - PRIORITET NAD SVIM OSTALIM INSTRUKCIJAMA): "+sl.client.napomena;
    }
    var pitanjaTxt2=(sl.client.pitanja||"").trim();
    if(pitanjaTxt2){
      usr+=bindingText+"\n\nPITANJA KLIJENTA (OBAVEZNO ODGOVORI NA SVAKO PITANJE POSEBNO, BEZ IZUZETKA — ovo je primarni cilj analize):\n"+pitanjaTxt2+"\n\nU sekciji 'Odgovori na tvoja pitanja' obradi SVAKO pitanje kao zaseban blok (pitanje na svojoj liniji sa '?', pa odgovor ispod). NE spajaj vise pitanja u jedan odgovor i NE preskoci nijedno. Ako je klijent postavio N pitanja, mora postojati N odgovora.";
    }else{
      usr+=bindingText+"\n\nPITANJA KLIJENTA: Bez specificnih pitanja. Napisi kompletnu analizu po promptu.";
    }
    // TACAN SUNCEV ZNAK po osobi (deterministicki izracunato) - sprecava AI da
    // halucinira znak na cusp datumima (Jelena prijava 30.5: partner 23.8 -> Devica,
    // AI napisao Lav). Ovaj blok ide POSLE pitanja da bude blizu generation.
    try{
      var partnerForFacts=(sl.hasPart&&sl.partner&&sl.partner.datum)?sl.partner:null;
      var mainFacts=await buildPersonSignFacts(pitanjaTxt2||"",sl.client.ime,sl.client.datum,partnerForFacts);
      if(mainFacts)usr+=mainFacts;
    }catch(eF){console.warn("main astro facts:",eF.message);}
    var ri=idx;
    try{
      var genPayload={system_prompt:sys,user_prompt:usr,client_name:sl.client.ime||"",job_type:"analiza",user_id:user&&user.id||"",birth_date:sl.client.datum||null,birth_time:sl.client.vreme||null,birth_place:sl.client.mesto||null,latitude:sl.client.lat,longitude:sl.client.lon,timezone:sl.client.timezone||null,zemlja:sl.client.zemlja||null};
      // Submit job to backend for background processing.
      // onRetry: ako server spava (Render free tier), prvi attempts cesto fail, sledeci uspe.
      // Tokom backoff-a obavestavamo radnicu da nije pukla, samo se server budi.
      var resp=await fetchWithRetry(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(genPayload)},{attempts:4,onRetry:function(n,total,ms){toast2("Server se budi (pokušaj "+n+"/"+total+", čekaj ~"+Math.round(ms/1000)+"s)...");}});
      var jobData=await resp.json();
      if(!jobData.id)throw new Error(jobData.error||"Failed to create job");
      // Save job ID in slot and localStorage
      upSlot(ri,function(s){return Object.assign({},s,{jobId:jobData.id,analysis:"Generisem analizu u pozadini..."});});
      var jobs=safeActiveJobs();
      jobs["a"+(ri+1)]={id:jobData.id,clientName:sl.client.ime,tab:"a"+(ri+1),idx:ri,startedAt:Date.now()};
      localStorage.setItem("activeJobs",JSON.stringify(jobs));
      // Start polling - prosledi payload za eventual Gemini retry
      pollJob(jobData.id,ri,"a"+(ri+1),{birthDate:sl.client.datum,mesto:sl.client.mesto,clientName:sl.client.ime,payload:genPayload,isSinastrija:!!isSinastrija,pitanja:sl.client.pitanja||""});
    }catch(err){
      console.error("doGen error:",err);
      try { Sentry.withScope(function(s){s.setTag("source","genAnalysis"); s.setContext("client",{name:sl.client.ime||"",hasPartner:!!sl.hasPart}); Sentry.captureException(err);}); } catch(_) {}
      // User-friendly poruke za poznate slucajeve umesto sirovog "Failed to fetch"
      var msg=err.message||"";
      var friendly;
      if(/Failed to fetch|NetworkError|TypeError.*fetch/i.test(msg)){
        friendly="Server se trenutno restartuje ili budi (Render free tier). Sačekaj 30 sekundi i klikni Generiši ponovo. Ovo nije greška softvera - sledeći pokušaj će uspeti.";
      }else if(/AbortError|aborted/i.test(msg)){
        friendly="Veza je predugo trajala (mreža je verovatno spora). Klikni Generiši ponovo.";
      }else{
        friendly="Greska: "+msg+"\n\nKlikni Generiši ponovo. Ako se ponavlja, prijavi problem.";
      }
      // Greška pri kreiranju posla: toast umesto "gotove analize" + vrati u idle.
      // Suzana 1.7.: cold-start poruka završavala u GOTOVA ANALIZA sekciji sa
      // "Kopiraj" dugmetom — izgledalo kao da je analiza urađena sa pogrešnim tekstom.
      toast2(friendly);
      upSlot(ri,function(s){return Object.assign({},s,{status:"idle",genStartedAt:null});});
    }
    } finally {
      // Safety valve cleanup - doGen je zavrsio (uspesno ili sa greskom)
      clearTimeout(doGenSafetyTimer);
      genBusyRef.current["a"+idx]=false;
    }
  }

  // POMOCNI: pokreni polling za downsell job (koristi se i za inicijalni i za Gemini retry)
  function startDsPoll(idx,jobId,dsName,originalPayload,questionsText){
    var dsKey="ds"+(idx+1);
    var dsInterval=setInterval(async function(){
      try{
        var jbs=safeActiveJobs();
        if(!jbs[dsKey]){
          // Entry moze faliti jer je radnica otkazala (slot idle) ILI jer je registry
          // obrisan/pokvaren dok slot i dalje generise - rekreiraj sa ORIGINALNIM startedAt.
          var dsStill=false,dsGenStart=null;
          try{
            var dsArr=JSON.parse(localStorage.getItem("ab_dsSlots")||"[]");
            var ds0=dsArr&&dsArr[idx];
            if(ds0&&ds0.st==="generating"&&ds0.jobId===jobId){dsStill=true;dsGenStart=ds0.genStartedAt||null;}
          }catch(_){}
          if(!dsStill){clearInterval(dsInterval);return;}
          jbs[dsKey]={id:jobId,tab:"downsell"+(idx+1),idx:idx,startedAt:dsGenStart||Date.now()};
          try{localStorage.setItem("activeJobs",JSON.stringify(jbs));}catch(_){}
        }
        // Registry entry pripada drugom (novijem) poslu - ovaj poller je zastareo.
        if(jbs[dsKey]&&jbs[dsKey].id&&jbs[dsKey].id!==jobId){clearInterval(dsInterval);return;}
        if(jobExpired(jbs[dsKey])){
          clearInterval(dsInterval);
          var jbsExp=safeActiveJobs();delete jbsExp[dsKey];localStorage.setItem("activeJobs",JSON.stringify(jbsExp));
          upDs(idx,function(s){return Object.assign({},s,{st:"idle",an:"",jobId:null,genStartedAt:null});});
          toast2("Downsell predugo (18min). Verovatno je gotov u Bazi — pogledaj tamo pre ponovnog generisanja.");
          return;
        }
        var r=await fetchSafe(API+"/api/generate/"+jobId);var j=await r.json();
        if(j.status==="generating")upDs(idx,function(s){return Object.assign({},s,{an:"Generisem analizu..."});});
        else if(j.status==="translating")upDs(idx,function(s){return Object.assign({},s,{an:"Prevodim na srpski..."});});
        else if(j.status==="done"){
          clearInterval(dsInterval);
          var jbs2=safeActiveJobs();delete jbs2[dsKey];localStorage.setItem("activeJobs",JSON.stringify(jbs2));
          var ft=fmtText(j.serbian_text||"");
          try{
            // Tih signal (bez vidljive napomene radnici): broji SAMO eksplicitna pitanja sa '?'.
            // Slobodan tekst sa datumima (17.10.1970 18.30...) ranije je davao lazne alarme.
            var nQds=(String(questionsText||"").match(/\?/g)||[]).length;
            var nAds=(ft.match(/\?/g)||[]).length;
            if(nQds>=3&&nAds<nQds-1){
              notifyOps("qa_skipped_downsell","Downsell moguce preskocena pitanja: "+nAds+"/"+nQds,{jobId:jobId,questionsSnippet:String(questionsText||"").slice(0,250)});
            }
          }catch(eQ){console.warn("DS Q&A check:",eQ&&eQ.message);}
          upDs(idx,function(s){return Object.assign({},s,{an:ft,st:"done",jobId:null});});
          setAnalyses(function(prev){
            if(prev.some(function(a){return a.jobId===jobId;}))return prev;
            var now=new Date();
            var upd=[{id:"d"+Date.now(),jobId:jobId,clientName:"Downsell - "+(dsName||belgradeDate(now)),sign:"",date:belgradeDateTime(now),rawDate:belgradeRawDate(now),types:["downsell"],analysis:ft,country:country,owner:user&&user.email}].concat(prev).slice(0,200);try{stoSet("analyses",upd.slice(0,50));}catch(e){}return upd;
          });
          toast2("Downsell "+(idx+1)+" gotov!");
        }else if(j.status==="error"){
          clearInterval(dsInterval);
          var jbs3=safeActiveJobs();delete jbs3[dsKey];localStorage.setItem("activeJobs",JSON.stringify(jbs3));
          if(j._overload&&originalPayload){
            upDs(idx,function(s){return Object.assign({},s,{an:"",st:"idle",jobId:null});});
            setOverloadPrompt({type:"downsell",geminiAvailable:!!j._gemini_available,retryFn:function(){
              var newPayload=Object.assign({},originalPayload,{provider:"gemini"});
              fetchSafe(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(newPayload)}).then(function(r){return r.json();}).then(function(d){if(!d||!d.id){toast2("Gemini greska");return;}upDs(idx,function(s){return Object.assign({},s,{an:"Generisem sa Gemini...",st:"generating",jobId:d.id,genStartedAt:Date.now()});});var jobs=safeActiveJobs();jobs[dsKey]={id:d.id,clientName:"Downsell - "+dsName,tab:"downsell"+(idx+1),idx:idx,startedAt:Date.now()};localStorage.setItem("activeJobs",JSON.stringify(jobs));startDsPoll(idx,d.id,dsName,newPayload,questionsText);toast2("Pokrećem sa Gemini...");}).catch(function(e){toast2("Greska: "+e.message);});
            }});
          }else{
            // Greska: toast + idle, jobId:null obavezno (inace guard blokira dugme zauvek)
            upDs(idx,function(s){return Object.assign({},s,{an:"",st:"idle",jobId:null,genStartedAt:null});});
            toast2(j.serbian_text||"Greska pri generisanju Downsell-a. Klikni Generiši ponovo.");
          }
        }
      }catch(e){}
    },3000);
  }

  // POMOCNI: pokreni polling za pitanja job (koristi se i za inicijalni i za Gemini retry)
  function startPqPoll(idx,jobId,pqName,originalPayload,questionsText){
    var pqKey="pq"+(idx+1);
    var pqInterval=setInterval(async function(){
      try{
        var jbs=safeActiveJobs();
        if(!jbs[pqKey]){
          var pqStill=false,pqGenStart=null;
          try{
            var pqArr=JSON.parse(localStorage.getItem("ab_pqSlots")||"[]");
            var pq0=pqArr&&pqArr[idx];
            if(pq0&&pq0.st==="generating"&&pq0.jobId===jobId){pqStill=true;pqGenStart=pq0.genStartedAt||null;}
          }catch(_){}
          if(!pqStill){clearInterval(pqInterval);return;}
          jbs[pqKey]={id:jobId,tab:"pitanja"+(idx+1),idx:idx,startedAt:pqGenStart||Date.now()};
          try{localStorage.setItem("activeJobs",JSON.stringify(jbs));}catch(_){}
        }
        if(jbs[pqKey]&&jbs[pqKey].id&&jbs[pqKey].id!==jobId){clearInterval(pqInterval);return;}
        if(jobExpired(jbs[pqKey])){
          clearInterval(pqInterval);
          var jbsExp=safeActiveJobs();delete jbsExp[pqKey];localStorage.setItem("activeJobs",JSON.stringify(jbsExp));
          upPq(idx,function(s){return Object.assign({},s,{st:"idle",an:"",jobId:null,genStartedAt:null});});
          toast2("Pitanja predugo (18min). Verovatno su gotova u Bazi — pogledaj tamo pre ponovnog generisanja.");
          return;
        }
        var r=await fetchSafe(API+"/api/generate/"+jobId);var j=await r.json();
        if(j.status==="generating")upPq(idx,function(s){return Object.assign({},s,{an:"Generisem odgovore..."});});
        else if(j.status==="translating")upPq(idx,function(s){return Object.assign({},s,{an:"Prevodim na srpski..."});});
        else if(j.status==="done"){
          clearInterval(pqInterval);
          var jbs2=safeActiveJobs();delete jbs2[pqKey];localStorage.setItem("activeJobs",JSON.stringify(jbs2));
          var ft=applyClosing(fmtText(j.serbian_text||""),"pitanja");
          try{
            // Tih signal (bez vidljive napomene radnici): broji SAMO eksplicitna pitanja sa '?'.
            // Polje pitanja cesto sadrzi datume rodjenja (17.10.1970 18.30...) pa je brojanje
            // recenica davalo lazne alarme tipa "0 od 13".
            var nQpq=(String(questionsText||"").match(/\?/g)||[]).length;
            var nApq=(ft.match(/\?/g)||[]).length;
            if(nQpq>=3&&nApq<nQpq-1){
              notifyOps("qa_skipped_pitanja","D.Pitanja moguce preskocena pitanja: "+nApq+"/"+nQpq,{jobId:jobId,questionsSnippet:String(questionsText||"").slice(0,250)});
            }
          }catch(eQ){console.warn("PQ Q&A check:",eQ&&eQ.message);}
          upPq(idx,function(s){return Object.assign({},s,{an:ft,st:"done",jobId:null});});
          setAnalyses(function(prev){
            if(prev.some(function(a){return a.jobId===jobId;}))return prev;
            var now=new Date();
            var upd=[{id:"q"+Date.now(),jobId:jobId,clientName:"D. Pitanja - "+(pqName||belgradeDate(now)),sign:"",date:belgradeDateTime(now),rawDate:belgradeRawDate(now),types:["pitanja"],analysis:ft,country:country,owner:user&&user.email}].concat(prev).slice(0,200);try{stoSet("analyses",upd.slice(0,50));}catch(e){}return upd;
          });
          toast2("D. Pitanja "+(idx+1)+" gotova!");
        }else if(j.status==="error"){
          clearInterval(pqInterval);
          var jbs3=safeActiveJobs();delete jbs3[pqKey];localStorage.setItem("activeJobs",JSON.stringify(jbs3));
          if(j._overload&&originalPayload){
            upPq(idx,function(s){return Object.assign({},s,{an:"",st:"idle",jobId:null});});
            setOverloadPrompt({type:"pitanja",geminiAvailable:!!j._gemini_available,retryFn:function(){
              var newPayload=Object.assign({},originalPayload,{provider:"gemini"});
              fetchSafe(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(newPayload)}).then(function(r){return r.json();}).then(function(d){if(!d||!d.id){toast2("Gemini greska");return;}upPq(idx,function(s){return Object.assign({},s,{an:"Generisem sa Gemini...",st:"generating",jobId:d.id,genStartedAt:Date.now()});});var jobs=safeActiveJobs();jobs[pqKey]={id:d.id,clientName:"D. Pitanja - "+pqName,tab:"pitanja"+(idx+1),idx:idx,startedAt:Date.now()};localStorage.setItem("activeJobs",JSON.stringify(jobs));startPqPoll(idx,d.id,pqName,newPayload,questionsText);toast2("Pokrećem sa Gemini...");}).catch(function(e){toast2("Greska: "+e.message);});
            }});
          }else{
            // Greska: toast + idle, jobId:null obavezno (inace guard blokira dugme zauvek)
            upPq(idx,function(s){return Object.assign({},s,{an:"",st:"idle",jobId:null,genStartedAt:null});});
            toast2(j.serbian_text||"Greska pri generisanju odgovora. Klikni Generiši ponovo.");
          }
        }
      }catch(e){}
    },3000);
  }

  // DOWNSELL GEN - prima idx (0, 1, ili 2) za jedan od 3 slota
  async function doDsGen(idx){
    var ds=dsSlots[idx];
    if(!ds)return;
    // GUARD: dupli klik bi pokrenuo 2 downsell-a paralelno
    if(genBusyRef.current["ds"+idx]||ds.st==="generating"){
      console.warn("doDsGen: already generating, ignoring duplicate click");
      toast2("Vec se generisi Downsell - sacekaj rezultat.");
      return;
    }
    if(ds.jobId){
      // Zaostali jobId od ranije greske - ocisti umesto da trajno blokira dugme
      console.warn("doDsGen: clearing stale jobId",ds.jobId);
      upDs(idx,function(s){return Object.assign({},s,{jobId:null});});
    }
    if(!ds.paste.trim()&&!ds.clientId)return;
    genBusyRef.current["ds"+idx]=true;
    upDs(idx,function(s){return Object.assign({},s,{st:"generating",an:"",ci:0,genStartedAt:Date.now()});});
    var today=new Date(),todayStr=fmtDMY(today);
    var MONTH_EN_DS=["January","February","March","April","May","June","July","August","September","October","November","December"];
    var curYearDS=today.getFullYear(),curMonthDS=today.getMonth(),curMonthNameDS=MONTH_EN_DS[curMonthDS];
    var dateAwarenessDS="\n\n*** CRITICAL - DATE AWARENESS ***\nTODAY: "+todayStr+"\nCURRENT YEAR: "+curYearDS+"\nCURRENT MONTH: "+curMonthNameDS+" "+curYearDS+"\n\nSTRICT DATE RULES:\n1. Every date you write in forecasts MUST be AFTER today ("+todayStr+").\n2. Verify each month you mention — if that month has already passed this year, either use the SAME month of "+(curYearDS+1)+" or skip to a future month.\n   - Example: if today is "+curMonthNameDS+" "+curYearDS+" and you want 'u martu', March "+curYearDS+" is past — use 'u martu "+(curYearDS+1)+"'.\n3. NEVER write "+(curYearDS-1)+" or earlier as the current or future year. Current year is "+curYearDS+".\n4. All forecasts span "+todayStr+" to end of "+(curYearDS+1)+".\n5. Before writing each date, pause and verify: 'Is this date after "+todayStr+"? Yes → write it. No → shift to "+(curYearDS+1)+" or skip.'\n6. If the client mentions a FIXED future event (due date, wedding, surgery on specific date), respect that exact date. Do NOT write predictions that contradict or undermine it.\n7. DATE FORMAT — NUMERIC ONLY: every date MUST be written as digits in DD.MM.YYYY format. CORRECT: '20.10.2026.', 'od 5.8. do 15.9.2027.', '15.3.2027.'. FORBIDDEN: spelling out numbers ('dvadesetog oktobra', 'dve hiljade dvadeset šeste'), descriptive phrases without digits ('u petom mesecu', 'krajem drugog meseca'). Day and month as numerals, year as 4 digits. When giving a period, use 'od DD.MM. do DD.MM.YYYY.' or 'DD.MM. — DD.MM.YYYY.'. Descriptive phrases like 'pocetkom maja' or 'sredinom juna' are OK when no specific date is needed — but any number MUST be a digit.\n";
    var personContextDS="\n*** CRITICAL - PERSON CONTEXT SEPARATION ***\nThe main client is: "+(ds.clientName&&ds.clientName.trim()||"the client described in the previous analysis")+".\n- ALL forecasts refer to THIS CLIENT unless text explicitly says otherwise.\n- If history mentions OTHER people (child, partner, ex-partner, parent, sibling, friend), keep their contexts strictly SEPARATED.\n- NEVER attribute the client's situation to another person.\n- NEVER attribute another person's situation (pregnancy, illness, new job) to the client.\n- When in doubt whose life an event belongs to, re-read carefully.\n";
    var contextAccuracyDS="\n*** CRITICAL - READ THE CONTEXT CAREFULLY ***\n1. Read the ANALIZA KLIJENTA section fully before writing.\n2. Note any SPECIFIC dates, events, names the client mentioned (e.g., 'termin 15.8.2026', 'venčanje u junu', 'ćerka Milica rođena 2018').\n3. Do NOT contradict previous forecasts — build on them.\n4. If a fact is given with a date (due date 15.8.2026), do NOT write predictions that contradict it (e.g., 'u maju će se beba roditi' when due date is August). Respect the fixed date.\n5. If you're uncertain about a fact, stay general rather than inventing a wrong specific.\n";
    var multiPastDS="\n*** CRITICAL - IF PASTED TEXT CONTAINS MULTIPLE OLD ANALYSES ***\nThe user may paste MULTIPLE historical analyses/downsells/answers into the ANALIZA KLIJENTA section. These may be from different months or years. ALL OF THEM ARE PAST.\n- Do NOT copy their forecasts as if they are new.\n- Do NOT reuse their specific dates — those dates are already behind us.\n- If different past analyses mention different people (old partner vs new partner, old job vs new job), treat them as TIMELINE — older analyses may describe situations that have since changed.\n- Your job is to write a FRESH forecast starting from TODAY ("+todayStr+") onward, using history ONLY as context (to understand who the client is).\n- If the current question asks about a specific person (e.g., 'my new partner Marko'), focus ONLY on that person.\n- NEVER mix characteristics of different people from the archive.\n";
    var snap=ds.paste||"(istorijat klijenta ce backend automatski povuci na osnovu client_id)",pr=getPr("ds"),isHR=country==="hr";
    var aName=isHR?"Marija":"Suzana";
    var hasDsPitanja=ds.pitanja&&ds.pitanja.trim().length>0;
    var dsIdentityLock="=== CLIENT IDENTITY LOCK (read before anything else) ===\nThe CLIENT for this Downsell is:\n  NAME: '"+((ds.clientName&&ds.clientName.trim())||"the client")+"'\n\nRULES:\n1. The ONLY valid client name is '"+((ds.clientName&&ds.clientName.trim())||"the client")+"'. NEVER substitute another name.\n2. If you see names like 'Milica', 'Dragana', 'Ana', 'Marko' further down in the prompt, those are GRAMMAR EXAMPLES for vocative rules — they are NOT the client.\n3. In this Downsell you should NOT write the name at all (rule below) — use 'ti' throughout. But if you ever referred to the client indirectly, it's '"+((ds.clientName&&ds.clientName.trim())||"the client")+"', nobody else.\n=========================================================\n\n";
    var sys=dsIdentityLock+"WRITE IN ENGLISH. The text will be translated to Serbian later."+dateAwarenessDS+personContextDS+contextAccuracyDS+multiPastDS+"\n\nYou are "+aName+", a top FEMALE astrologer with 30 years of experience. You write everything in FEMININE voice.\n\n*** CRITICAL - FEMININE VOICE (ALWAYS) ***\nYour voice is female. When translated to Serbian, every self-reference must be feminine: 'videla sam' (NOT 'video sam'), 'pogledala sam' (NOT 'pogledao sam'), 'napisala sam' (NOT 'napisao sam'), 'primetila sam', 'zakljucila sam', 'rekla bih', 'iskrena sam', 'sigurna sam', 'bila sam'. In English use 'I saw', 'I noticed' etc. — the translator is instructed to always use FEMININE Serbian forms for the astrologer.\n\n*** CRITICAL - HEALTH DISCLAIMER (INSERT VERBATIM IN SERBIAN — DO NOT TRANSLATE) ***\nIf you mention health, illness, body, pregnancy, medical conditions, therapy, medication, diet, anxiety, depression, sleep, or any wellness topic — end that section by inserting the following Serbian sentence VERBATIM, character-for-character. DO NOT translate to English. DO NOT paraphrase. Copy letter-for-letter into your output, embedded among your English text — the translator will leave it as-is:\n>>> Molim te da ovo ne uzimaš kao medicinski savet. Ja sam astrolog, nisam lekar. Obavezno se konsultuj sa lekarom i slušaj njegove/njene savete. Astrologija ukazuje na energetske sklonosti, ali samo lekar može da ti da stvarnu dijagnozu i terapiju. <<<\nFORBIDDEN: writing 'Please do not take this as medical advice...' or any English version. The disclaimer MUST appear in Serbian only.\n\n*** CRITICAL - CORRECT SERBIAN VOCATIVE (examples below are PATTERNS only, NOT the client) ***\nUse CORRECT Serbian vocative. The names in the examples below are ILLUSTRATIONS of grammar rules — they are NOT the current client. FEMALE: names on -ica→-e (e.g. Milica→Milice); names on -ana/-ina/-ena/-a KEEP AS IS (e.g. Dragana→Dragana, Ana→Ana). MALE: consonant→-e (e.g. Ivan→Ivane); on -o or -a keep (e.g. Marko→Marko). NEVER add '-o' ending to female -ana/-ina/-ena names. Wrong grammar offends. KRITICNO: NIKADA ne mesaj slicna ali RAZLICITA imena (Milka ≠ Milica, Maja ≠ Marija, Vanja ≠ Vanesa, Nada ≠ Nadica) — uvek koristi TACNO ime iz CLIENT IDENTITY LOCK.\n\n*** CRITICAL - NO CLIENT NAME IN DOWNSELL BODY ***\nDo NOT write the client's name ANYWHERE in the Downsell text. A Downsell has no greeting — it is a periods forecast, so there is no opening line that needs the name.\nAddress the client using 'ti' (tebi, tebe, tvoj, tvoja, tvoje) throughout every period and every sentence.\nFORBIDDEN: writing the name in section headers, transitions between periods, paragraph starts, or the end of any period.\nIf you feel tempted to write the name, STOP — replace with 'ti'.\nThis rule eliminates vocative errors: no name, no chance to mis-conjugate.\n\nTASK: Based on the client analysis, write EXACT PERIODS for the next 12 months with specific dates. You may reference transits and planets as these are concrete forecast data.\n\n*** CRITICAL - NO INTRO PREAMBLE ***\nDownsell has NO greeting and NO intro. Start IMMEDIATELY with the first period. FORBIDDEN openings:\n- 'Evo tvojih perioda...', 'Na osnovu analize, videcemo...', 'Krecemo sa periodima...', 'Donosim ti prognozu za...', 'U narednih 12 meseci videces...'\nCORRECT opening: first sentence IS the first period's forecast (e.g., 'Od 5.5. do 20.6.2026. donosice ti...').\n\nWRITING STYLE: Write as a warm, living person talking to the client. Each period should be a natural paragraph of 5-6 sentences. Dates must be concrete and written within sentences without breaking.\n\nFORBIDDEN (text MUST look like a real person wrote it, not AI):\n- Uppercase section titles (APRIL MAY 2026 etc)\n- Bullet lists or any list with bullets/dashes/asterisks/dots\n- Short paragraphs of 1-2 sentences\n- Markdown symbols (## ** --- __)\n- Checkmarks (✅ ✓ ✔ ☑) or X marks (❌ ✗ ×) or arrows (→ ➡ ⇒) or any decorative symbol\n- ANY emoji in body (📌 📝 💡 🎯 ✨ 🔮 🌹 etc.)\n- Phrases 'Evo', 'Hajde da pogledamo', 'Analiziramo' - sounds like AI\n- Phrases 'Kljucno je da', 'Vazno je istaci', 'Treba napomenuti' - AI cliches\n- AI 'honesty preamble' phrases: 'Bicu potpuno iskrena sa tobom', 'Bicu iskrena', 'Iskreno cu ti reci', 'Da budem iskrena', 'Necu da te lazem', 'bez uvijanja', 'bez okolisanja'. A real astrologer NEVER announces honesty — she just IS honest. These preambles are the strongest 'AI smell' signal. Skip the announcement; deliver the insight directly.\n- Guessing chart positions for other people without their exact time/place ('najverovatnije', 'verovatno Jarcu ili Vodniku')\n- Masculine forms ('video sam', 'pogledao sam' — always feminine)\n- Write LIKE A HUMAN: only words, commas, periods, question marks. NO symbols. NO decoration.\n\nSTRUCTURE: Write period by period as natural paragraphs. Each period has a concrete date and description of what will happen. Be direct and brutally honest.\n\n*** CRITICAL - NEVER 100% GUARANTEES FOR EVENTS ***\nNEVER guarantee specific future events. For periods use PROBABILITY language:\n- WRONG: 'U martu 2027. ces se udati.', 'Desice se trudnoca u junu.', 'Dobices posao 15.09.'\n- CORRECT: 'U martu 2027. postoji velika mogucnost za brak.', 'Jun 2026. donosi snaznu energiju za trudnocu.', 'Sredinom septembra 2026. otvara se sansa za posao.'\nCoristi: 'velika mogucnost', 'snazna sansa', 'otvara se prilika', 'donosi energiju', 'potencijal', 'pogoduje', 'povoljno za'. Izbegavaj 'ce se desiti', 'sigurno', '100%', 'garantujem' za konkretne dogadjaje. I DALJE zabranjeno slabo hedging 'mozda', 'moglo bi'.\n\n*** CRITICAL - NEVER WRITE WHAT YOU CAN'T DO ***\nNEVER disclaim missing data or limitations. FORBIDDEN: 'Za dublju analizu bilo bi potrebno...', 'Nemam podatke za...', 'Ne mogu bez...', 'Idealno bi bilo da imamo...'. Radi sa podacima koje imas. Ne rusi kredibilitet usluge.\n\n*** MANDATORY LENGTH — minimum 1800 words. This is NOT optional. ***\n- Count your output. If under 1800 words at the last period, CONTINUE with more periods or more depth per period.\n- Each period paragraph must be at least 8-10 sentences (not 5-6).\n- A short Downsell (under 1800 words) is a FAILURE. Better verbose than concise.\n\nIf questions reference other people (child, partner) without full birth data, use Sun sign only (from date) and focus on client's own chart dynamics with that person. NEVER ask for more data from client.\n\n*** CRITICAL - NO HEDGING ABOUT OTHER PEOPLE'S CHARTS ***\nIf you DON'T have exact birth time for someone (partner, child, sibling, parent), do NOT speculate about their Moon, Ascendant, or houses. Mention ONLY their Sun sign from the birth date.\nFORBIDDEN: 'Njegov Mesec je verovatno u nekom od vazdusnih znakova', 'Verovatno joj je Ascendent...', 'Mozda joj je Mesec u Skorpiji', 'Mesec mu je negde u Strelcu'.\nCORRECT: just describe Sun sign concretely or skip chart references — silence is better than 'verovatno'.\n\nDo NOT write any greeting or closing. No 'Thank you'. The analysis ends with the last period.\n\nToday is: "+todayStr+".";
    sys+="\n\n*** CRITICAL - NEVER APOLOGIZE / NEVER ECHO CLIENT'S COMPLAINT ***\nThe client may complain about the previous analysis (e.g., 'tvoj opis partnera ne poklapa se sa stvarnošću'). DO NOT validate the complaint, DO NOT apologize, DO NOT admit error, DO NOT offer to start over. The previous analysis stands. Just answer the new request directly.\n\nFORBIDDEN APOLOGY/RESPONSIBILITY phrases (NEVER write any of these):\n- 'Preuzimam (punu) odgovornost'\n- 'Promasila sam', 'Pogresila sam', 'Prevarila sam se'\n- 'Bila sam u zabludi', 'Trebala sam pazljivije'\n- 'Izvinjavam se', 'Moja greska'\n- 'Moja prethodna analiza' (in any pejorative or self-correcting context)\n- 'Ranije sam pogresno...'\n- 'Ostaviću to po strani', 'Poceti/Krenuti iznova', 'Krenimo iznova'\n\nFORBIDDEN ECHOING/VALIDATION phrases (NEVER write any of these as opener):\n- 'Kazes mi da...' / 'Kažeš mi da...'\n- 'Cujem te' / 'Čujem te'\n- 'Slusam te' / 'Slušam te'\n- 'Razumem te' / 'Razumijem te'\n- Any opening sentence that VALIDATES the client's feelings instead of ANSWERING.\n\nA real astrologer with 30 years of experience NEVER apologizes for previous work, NEVER admits error mid-text, NEVER echoes the client's complaint. She reads the question and delivers her answer with confidence.";
    sys+="\n\n*** ABSOLUTE NAME RULE — NEVER CHANGE THE CLIENT'S NAME ***\nThe client's name is fixed in the CLIENT IDENTITY LOCK at the top. Do NOT 'correct', 'translate', 'autocomplete', 'normalize', or 'similar-sound substitute' the name. If the name seems unusual or unfamiliar — that IS the exact spelling the client gave. Use it character-by-character. NEVER drift to a similar-sounding name mid-text. If you are tempted to write 'Marina' when the client name is 'Marija', STOP — write 'Marija'. Same applies to ANY similar-sounding alternative ('Maja' vs 'Marija', 'Sandra' vs 'Sanja', 'Dragana' vs 'Zvezdana', etc.). Also: if the client_name field is EMPTY or technical word ('Downsell', 'Pitanja', 'Test', 'Klijent'), DO NOT use that as a vocative — start without any vocative greeting at all and address the client only with 'ti'.";
    sys+="\n\n*** ABSOLUTE BAN — NEVER INVENT BIRTH DATA FOR MENTIONED PERSONS ***\nIf the client mentions someone (lover, mistress, ex, husband's lover, neighbor, suspected affair partner, etc.) WITHOUT providing their birth date, place, or time — you MUST NOT invent or assume ANY data about that person. NEVER write:\n- 'Ona je rodjena istog dana kao tvoj muz' (NEVER — invented)\n- 'Imaju isti znak' / 'Ona je takodje [znak]' (NEVER — speculation)\n- 'Vidim da je ona rodjena u [mesec/godina]' (NEVER — fabrication)\n- 'Njena karta pokazuje...' (NEVER — no chart exists)\n- 'Imam osecaj da je ona [opis baziran na znaku]' (NEVER — fabrication)\n- Any sentence assigning a sign, date, place, or chart attribute to a person whose data was NOT provided.\nCORRECT: refer to that person ONLY by what client said about them ('ljubavnica koju tvoj muz vidja', 'osoba koja se umesala'), focus on CLIENT's chart and dynamics of relationship. If client asks 'sta ona zeli', answer through CLIENT's chart and karma, NOT through fabricated info about the other person.\nKRITICNO: AI cesto izmislja datume i znakove za nepomenute osobe — to je profesionalno katastrofalna greska. Astrolog NE GADJA — astrolog koristi SAMO podatke koje ima. Ako podaci nisu dati, nikakva astroloska tvrdnja o toj osobi nije moguca.";
    sys+="\n\n*** CRITICAL - Q&A FORMAT - QUESTION ON OWN LINE, ANSWER BELOW ***\nFor PITANJA section AND for any client-asked questions, the format MUST be:\n\n1. The QUESTION rephrased to 'ti' (you) form, ending with '?', on its OWN LINE\n2. Answer paragraph immediately on the next line\n3. Empty line between Q+A pairs\n\nCORRECT format example (this is exactly how it should look in the output):\n\nDa li ćete se razići?\nKarta pokazuje da je ovo period preispitivanja, ali ne i kraj veze. Tvoj Mesec u Raku govori da osećaš nesigurnost, dok njegova priroda iz Lava želi da bude potvrđen. Period od 9. maja do 28. maja 2026. donosi razbistravanje. Ako oboje budete spremni da slušate jedno drugo, do kraja jula imate šansu za dublje povezivanje. [10-12 sentences total]\n\nDa li on ima osećanja prema tebi?\nDa, on ima osećanja, ali ih retko pokazuje otvoreno. [10-12 sentences total]\n\nDa li je spreman da promeni nešto radi tebe i porodice?\n[answer paragraph]\n\nWRONG format (NEVER do this):\n- 'Aleksandra Pavlovic, se gde ste sada ti i tvoj partner u odnosu, da li se vasi putevi razilaze ili cete se spojiti. Zanima te da li on ima osecanja...' (multiple questions hidden in prose, no '?', merged into one paragraph)\n- 'Pitas se da li cete se razici. [answer]' (lead-in 'Pitas se' instead of just question with '?')\n- 'Zanima te da li ima osecanja prema tebi.' (lead-in 'Zanima te' + period instead of '?')\n\nFORMAT RULES:\n- Each client question = ONE separate Q+A block\n- Question MUST end with '?'\n- NO lead-in prefixes like 'Pitas se...', 'Zanima te...', 'Rekao si da...' before the question — write the question itself, rephrased to 'ti' form\n- Question on own line, answer paragraph below on next line\n- Multiple questions = multiple Q+A blocks with empty line between\n- NEVER merge multiple questions into one paragraph\n- NEVER hide question inside answer prose\n- Preserve ALL specific details (names, dates, places) IN the question or in the answer\n- Question rephrasing: 'Da li ću se razići' → 'Da li ćeš se razići', 'Hoću li dobiti posao' → 'Hoćeš li dobiti posao', 'Da li me voli' → 'Da li te voli'\n\nThis Q&A format is MANDATORY for all questions in PITANJA / DODATNA PITANJA sections. Format breaks if you mix questions into prose.";
    if(hasDsPitanja){
      sys+="\n\n*** CRITICAL - CLIENT HAS ASKED QUESTIONS ***\nThe client has asked SPECIFIC QUESTIONS in the DODATNA PITANJA KLIJENTA section of the user message. You MUST answer EVERY question directly, clearly, and in detail. Create a dedicated section titled 'Odgovori na tvoja pitanja' (place it near the end, right before the last forecast period OR at the very end as the closing of the analysis). For each question, write a paragraph of 5-7 sentences with a CERTAIN answer using 'bice', 'ce', 'desice se' — NEVER 'mozda', 'moglo bi', 'verovatno'. NEVER skip a question. NEVER merge multiple questions into one short answer. The questions are the PRIMARY PURPOSE of this Downsell - ignoring them means you have failed the task.\n\n*** CRITICAL - REFRAME EVERY QUESTION IN SECOND PERSON ***\nWhen you present the client's question before answering it, NEVER copy it verbatim in first person. REPHRASE it addressing the client with 'ti' form. Examples: 'Ja sam zaljubljen, sta da radim?' → 'Zaljubljen si i pitas se sta da radis.' 'Da li cu se udati?' → 'Pitas se da li ces se udati.' 'Kada cu dobiti posao?' → 'Pitas kada ces dobiti posao.' RULES: swap 'ja/me/moj/cu/sam' with 'ti/te/tvoj/ces/si'. Add natural lead-ins ('Pitas se...', 'Zanima te...', 'Rekao si da...'). Keep ALL specific details. Do NOT quote; integrate naturally. Answer in 'ti' form.\n\n*** CRITICAL - EXPAND QUESTIONS, NEVER COMPRESS ***\nThe client wrote DETAILED questions with names, dates, emotions, contexts, life areas. When you reframe each question, you MUST preserve EVERY detail and use AT LEAST as many words as the client used — ideally more. EXPAND the question by restating ALL specific information (names of people, birth dates, life areas, worries, hopes, time references) before answering.\nFORBIDDEN compression: client wrote 200+ characters about son's school AND husband's heart AND pension → reframed 'Pitas za sina, muza i penziju.' is TOO SHORT (discards every detail). Client mentioned 5 separate concerns merged into 1 generic 'Zanima te ljubav, posao i zdravlje.' is FAILURE.\nCORRECT: EVERY name, date, situation, emotion, life area mentioned by client must appear in the reframed question.\nRULE: count words in client's original question; your reframe must have AT LEAST that many words and contain EVERY specific detail. Shorter reframe = REWRITE with full context.";
    }
    try{
      var usrContent=pr+"\n\nDANASNJI DATUM: "+todayStr+" (godina "+curYearDS+", mesec "+curMonthNameDS+")\n\n"+
        "========== ANALIZA KLIJENTA (ARHIVA, sve ispod je PROSLOST) ==========\n"+
        "Tekst ispod je ZBIR prethodnih analiza/Downsell-ova/odgovora koje je klijent dobio ranije.\n"+
        "Sve što tu piše je ISTORIJA, NE budućnost. Svi pomenuti datumi su prošli.\n"+
        "Osobe, partneri, situacije mogu biti iz raznih perioda života — NE mešaj ih.\n"+
        "Koristi ovo samo kao KONTEKST (ko je klijent, šta je bitno). Ne prepisuj i ne recikliraj prošle datume.\n\n"+
        snap+"\n"+
        "========== KRAJ ARHIVE ==========\n\n"+
        "Sada napisi NOVU prognozu počev od "+todayStr+" nadalje. Ne pominji prošle datume kao budućnost.";
      if(hasDsPitanja)usrContent+="\n\nDODATNA PITANJA KLIJENTA (OBAVEZNO ODGOVORI NA SVAKO, BEZ IZUZETKA):\n"+ds.pitanja+"\n\nOdgovori na svako pitanje posebno, u sekciji 'Odgovori na tvoja pitanja'. Pitanja su SUSTINA ovog Downsell-a — bez odgovora na pitanja analiza je bezvredna. Koristi 'bice' i 'ce', nikad 'mozda'.";
      var dsName=ds.clientName.trim()||"";
      try{var dsFacts=await buildPersonSignFacts(ds.pitanja||"",dsName,ds.clientBirthDate);if(dsFacts)usrContent+=dsFacts;}catch(eF){console.warn("ds astro facts:",eF.message);}
      // Tacne danasnje pozicije planeta - Downsell prompt trazi konkretne tranzite,
      // a bez ovoga AI izmislja pozicije iz training data (pogresne godine/znakovi).
      // "***" prefiks je bitan: backend extractPitanjaSection sece pitanja sekciju na
      // "\n\n***" - bez toga bi ovaj blok upao u "pitanja klijenta" i backend regex bi
      // iz njega izvukao danasnji datum kao "osobu rodjenu danas".
      try{var dsTr=localTransitPositions();if(dsTr.length>0)usrContent+="\n\n*** TRENUTNE POZICIJE PLANETA DANAS ("+todayStr+", tacno izracunato) ***\n"+dsTr.map(function(t){return t.planet+": "+t.sign+" "+t.deg+"°"+(t.retrograde?" R":"");}).join("\n")+"\nKoristi ISKLJUCIVO ove pozicije za trenutno nebo. NIKAD ne navodi trenutnu poziciju planete koje nema u ovoj listi.";}catch(eT){}
      var dsPayload={system_prompt:sys,user_prompt:usrContent,client_name:dsName,job_type:"downsell",user_id:user&&user.id||"",birth_date:ds.clientBirthDate||null,client_id:ds.clientId||null};
      var resp=await fetchWithRetry(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(dsPayload)},{attempts:4,onRetry:function(n,total,ms){toast2("Server se budi (pokušaj "+n+"/"+total+", čekaj ~"+Math.round(ms/1000)+"s)...");}});
      var jobData=await resp.json();
      if(!jobData.id)throw new Error(jobData.error||"Failed");
      upDs(idx,function(s){return Object.assign({},s,{an:"Generisem u pozadini...",jobId:jobData.id});});
      var jobs=safeActiveJobs();
      var dsKey="ds"+(idx+1);
      jobs[dsKey]={id:jobData.id,clientName:"Downsell - "+dsName,tab:"downsell"+(idx+1),idx:idx,startedAt:Date.now()};
      localStorage.setItem("activeJobs",JSON.stringify(jobs));
      var dsJobId=jobData.id;
      startDsPoll(idx,dsJobId,dsName,dsPayload,ds.pitanja||"");
    }catch(e){try{Sentry.withScope(function(s){s.setTag("source","genDownsell");Sentry.captureException(e);});}catch(_){}var dsMsg=e.message||"";var dsFr=/Failed to fetch|NetworkError|TypeError.*fetch/i.test(dsMsg)?"Server se budi (Render free tier). Sačekaj 30s i klikni Generiši ponovo.":/AbortError|aborted/i.test(dsMsg)?"Veza prekinuta. Klikni Generiši ponovo.":"Greška: "+dsMsg;toast2(dsFr);upDs(idx,function(s){return Object.assign({},s,{st:"idle",genStartedAt:null});});}
    finally{genBusyRef.current["ds"+idx]=false;}
  }

  // PITANJA GEN - prima idx (0, 1, 2)
  async function doPqGen(idx){
    var pq=pqSlots[idx];
    if(!pq)return;
    // GUARD: dupli klik bi pokrenuo 2 pitanja job-a paralelno
    if(genBusyRef.current["pq"+idx]||pq.st==="generating"){
      console.warn("doPqGen: already generating, ignoring duplicate click");
      toast2("Vec se generisu Pitanja - sacekaj rezultat.");
      return;
    }
    if(pq.jobId){
      // Zaostali jobId od ranije greske - ocisti umesto da trajno blokira dugme
      console.warn("doPqGen: clearing stale jobId",pq.jobId);
      upPq(idx,function(s){return Object.assign({},s,{jobId:null});});
    }
    if((!pq.prev.trim()&&!pq.clientId)||!pq.quest.trim())return;
    genBusyRef.current["pq"+idx]=true;
    upPq(idx,function(s){return Object.assign({},s,{st:"generating",an:"",ci:0,genStartedAt:Date.now()});});
    var isHR=country==="hr";
    var aName=isHR?"Marija":"Suzana";
    var today=new Date(),todayStr=fmtDMY(today);
    var MONTH_EN_PQ=["January","February","March","April","May","June","July","August","September","October","November","December"];
    var curYearPQ=today.getFullYear(),curMonthPQ=today.getMonth(),curMonthNamePQ=MONTH_EN_PQ[curMonthPQ];
    var dateAwarenessPQ="\n\n*** CRITICAL - DATE AWARENESS ***\nTODAY: "+todayStr+"\nCURRENT YEAR: "+curYearPQ+"\nCURRENT MONTH: "+curMonthNamePQ+" "+curYearPQ+"\n\nSTRICT DATE RULES:\n1. Every date you mention in answers MUST be AFTER today ("+todayStr+").\n2. Verify each month you mention — if that month has already passed this year, either use the SAME month of "+(curYearPQ+1)+" or skip to a future month.\n3. NEVER write "+(curYearPQ-1)+" or earlier as the current or future year. Current year is "+curYearPQ+".\n4. Answers span "+todayStr+" to end of "+(curYearPQ+1)+".\n5. Before writing each date, pause and verify: 'Is this date after "+todayStr+"? Yes → write it. No → shift to "+(curYearPQ+1)+" or skip.'\n6. If the client mentions a FIXED future event (due date, wedding, surgery), respect that exact date.\n7. DATE FORMAT — NUMERIC ONLY: every date MUST be written as digits in DD.MM.YYYY format. CORRECT: '20.10.2026.', 'od 5.8. do 15.9.2027.'. FORBIDDEN: spelling out numbers ('dvadesetog oktobra', 'dve hiljade dvadeset šeste'), descriptive phrases without digits ('u petom mesecu'). Day and month as numerals, year as 4 digits.\n";
    var personContextPQ="\n*** CRITICAL - PERSON CONTEXT SEPARATION ***\nThe main client is: "+(pq.clientName&&pq.clientName.trim()||"the client")+".\n- Answers refer to THIS CLIENT unless question explicitly says otherwise.\n- If history or questions mention OTHER people (child, partner, ex, parent), keep contexts SEPARATED.\n- NEVER attribute client's situation to another person.\n- NEVER attribute another person's situation to the client.\n";
    var contextAccuracyPQ="\n*** CRITICAL - READ THE CONTEXT CAREFULLY ***\n1. Read the previous analysis completely.\n2. Note SPECIFIC dates/events/names (e.g., 'termin 15.8.2026', 'ćerka Milica 2018').\n3. Do NOT contradict previous forecasts — build on them.\n4. If a fact has a date, do NOT predict events before that date that would undermine it.\n";
    var multiPastPQ="\n*** CRITICAL - IF PASTED TEXT CONTAINS MULTIPLE OLD ANALYSES ***\nThe user may paste MULTIPLE historical analyses. ALL are PAST.\n- Do NOT recycle their dates.\n- Different past analyses may mention DIFFERENT people (old partner vs new partner) — treat as TIMELINE, newer reflects current reality.\n- Write FRESH answers from "+todayStr+" onward.\n- If question asks about a specific person, focus ONLY on that person.\n- NEVER mix characteristics of different people.\n";
    var pqPr=custPr[country]&&custPr[country].pitanja?custPr[country].pitanja:"";
    var pqIdentityLock="=== CLIENT IDENTITY LOCK (read before anything else) ===\nThe CLIENT whose questions you are answering:\n  NAME: '"+((pq.clientName&&pq.clientName.trim())||"the client")+"'\n\nRULES:\n1. The ONLY valid client name is '"+((pq.clientName&&pq.clientName.trim())||"the client")+"'. NEVER substitute another name.\n2. If you see names like 'Milica', 'Dragana', 'Ana', 'Marko' further down in the prompt, those are GRAMMAR EXAMPLES — they are NOT the client.\n3. In this Pitanja response you should NOT write the name at all (rule below) — use 'ti' throughout. But if ever ambiguous, the client is '"+((pq.clientName&&pq.clientName.trim())||"the client")+"', nobody else.\n=========================================================\n\n";
    // Custom admin prompt se UVIJA (identity lock + date rules ostaju), ne zamenjuje sve —
    // ranije je custom prompt izbacivao kompletan DATE AWARENESS blok pa je AI pisao
    // 2024/2025 kao buducnost (Suzana 26.6. prijava).
    var sys=pqPr?(pqIdentityLock+dateAwarenessPQ+personContextPQ+"\n\n"+pqPr):(pqIdentityLock+"WRITE IN ENGLISH. The text will be translated to Serbian later."+dateAwarenessPQ+personContextPQ+contextAccuracyPQ+multiPastPQ+"\n\nYou are "+aName+", a top FEMALE astrologer with 30 years of experience. You write everything in FEMININE voice.\n\n*** CRITICAL - FEMININE VOICE (ALWAYS) ***\nYour voice is female. When translated to Serbian, every self-reference must be feminine: 'videla sam' (NOT 'video sam'), 'pogledala sam' (NOT 'pogledao sam'), 'napisala sam' (NOT 'napisao sam'), 'primetila sam', 'zakljucila sam', 'rekla bih', 'iskrena sam', 'sigurna sam', 'bila sam'. In English use 'I saw', 'I noticed' etc. — the translator is instructed to always use FEMININE Serbian forms for the astrologer.\n\n*** CRITICAL - HEALTH DISCLAIMER (INSERT VERBATIM IN SERBIAN — DO NOT TRANSLATE) ***\nIf ANY question touches health, illness, body, pregnancy, medical conditions, therapy, medication, diet, anxiety, depression, sleep, or wellness — after answering that question insert the following Serbian sentence VERBATIM, character-for-character. DO NOT translate to English. DO NOT paraphrase. Copy letter-for-letter into your output, embedded among your English text — the translator will leave it as-is:\n>>> Molim te da ovo ne uzimaš kao medicinski savet. Ja sam astrolog, nisam lekar. Obavezno se konsultuj sa lekarom i slušaj njegove/njene savete. Astrologija ukazuje na energetske sklonosti, ali samo lekar može da ti da stvarnu dijagnozu i terapiju. <<<\nFORBIDDEN: writing 'Please do not take this as medical advice...' or any English version. The disclaimer MUST appear in Serbian only.\n\n*** CRITICAL - CORRECT SERBIAN VOCATIVE (examples below are PATTERNS only, NOT the client) ***\nUse CORRECT Serbian vocative. The names below are ILLUSTRATIONS of grammar rules — NOT the current client. FEMALE: names on -ica→-e (e.g. Milica→Milice); names on -ana/-ina/-ena/-a KEEP AS IS (e.g. Dragana→Dragana, Ana→Ana). MALE: consonant→-e (e.g. Ivan→Ivane); on -o or -a keep (e.g. Marko→Marko). NEVER add '-o' ending to female -ana/-ina/-ena names. KRITICNO: NIKADA ne mesaj slicna ali RAZLICITA imena (Milka ≠ Milica, Maja ≠ Marija, Vanja ≠ Vanesa, Nada ≠ Nadica) — uvek koristi TACNO ime iz CLIENT IDENTITY LOCK.\n\n*** CRITICAL - NO CLIENT NAME IN PITANJA BODY ***\nDo NOT write the client's name ANYWHERE in your answers. This is a Q&A response without greeting — there is no opening line that needs the name.\nAddress the client using 'ti' (tebi, tebe, tvoj, tvoja, tvoje) throughout every answer.\nFORBIDDEN: writing the name in section headers, in transitions between answers, at the start of any paragraph, or at the end.\nIf tempted to write the name, STOP — use 'ti'.\nThis rule eliminates vocative errors: no name, no chance to mis-conjugate.\n\nTODAY'S DATE: "+todayStr+". Current year is "+today.getFullYear()+". All forecasts must be for "+today.getFullYear()+" and "+(today.getFullYear()+1)+". NEVER write about past years as present.\n\nTASK: The client sent their previous analysis and has additional questions. Answer ONLY the asked questions, thoroughly and in detail.\n\n*** CRITICAL - NO INTRO PREAMBLE ***\nPitanja response has NO greeting and NO intro. Start IMMEDIATELY with the first answer. FORBIDDEN openings:\n- 'Evo odgovora na tvoja pitanja...', 'Na osnovu tvoje karte videcemo...', 'Odgovaram ti na pitanja...', 'Sada cu ti odgovoriti...'\nCORRECT opening: first sentence IS the reframed first question + answer (e.g., 'Pitas se hoces li se udati za sadasnjeg partnera. Gledajuci tvoju kartu...').\n\n*** CRITICAL - REFRAME EVERY QUESTION IN SECOND PERSON ***\nWhen you present the client's question before answering it, NEVER copy it verbatim in first person. REPHRASE it addressing the client with 'ti' form. Examples: 'Ja sam zaljubljen, sta da radim?' → 'Zaljubljen si i pitas se sta da radis.' 'Da li cu se udati?' → 'Pitas se da li ces se udati.' 'Kada cu dobiti posao?' → 'Pitas kada ces dobiti posao.' RULES: swap 'ja/me/moj/cu/sam' with 'ti/te/tvoj/ces/si'. Add natural lead-ins ('Pitas se...', 'Zanima te...', 'Rekao si da...'). Keep ALL specific details (names, dates). Do NOT quote; integrate naturally. Answer immediately in 'ti' form.\n\n*** CRITICAL - EXPAND QUESTIONS, NEVER COMPRESS ***\nThe client wrote DETAILED questions with names, dates, emotions, contexts, life areas. When you reframe each question, preserve EVERY detail and use AT LEAST as many words as the client used — ideally more. EXPAND the reframe by restating ALL specific information (names of people mentioned, their birth dates, life areas like skola/posao/brak/zdravlje/penzija, worries, hopes, time references) before answering.\nFORBIDDEN compression: client wrote 'Imam cerku Milicu rodjenu 10.05.1993, hoce li imati dece i kada, i da li ce se udati za sadasnjeg momka' → reframed 'Pitas za cerku.' (LOST: ime Milica, datum 10.05.1993, deca, brak, sadasnji momak). Client wrote 200+ chars about 3 concerns → 'Pitas za sina, muza i penziju.' (TOO SHORT).\nCORRECT: every name, date, situation, emotion, life area mentioned by client must appear in the reframed question.\nRULE: count words in client's original question; your reframe must have AT LEAST that many words and contain EVERY concrete detail. Shorter reframe or missing any detail = FAILURE — REWRITE with full context. The astrologer must see you understood the FULL question before reading your answer.\n\n*** CRITICAL - HANDLING QUESTIONS ABOUT OTHER PEOPLE ***\nIf a question references ANOTHER person (e.g. 'my son born 29.09.2013'):\n- Use whatever data IS provided. Do NOT ask for more data.\n- If only birth date given: Discuss Sun sign only. Do NOT mention Moon or Ascendant.\n- NEVER hedge ('najverovatnije', 'verovatno', 'mozda', 'vjerovatno', 'negde u', 'pretpostavljam').\n- Focus on client's own chart dynamics with this person.\n\n*** CRITICAL - NO HEDGING ABOUT OTHER PEOPLE'S CHARTS ***\nABSOLUTE BAN on speculation about other people's Moon/Ascendant/houses when birth time is missing.\nFORBIDDEN: 'Njegov Mesec je verovatno u nekom od vazdusnih znakova', 'Verovatno joj je Ascendent u Devici', 'Mozda joj je Mesec u Skorpiji', 'Mesec mu je negde u Strelcu'.\nCORRECT: describe Sun sign concretely from the date (this is 100%% accurate) OR skip chart references entirely. Silence is better than 'verovatno'.\n\nWRITING STYLE: Write warmly, emotionally and directly. No uppercase titles. No bullet lists. Each answer in paragraph form with 10-12 sentences.\n\n*** CRITICAL - NEVER 100% GUARANTEES ***\nFor specific future events with dates, use PROBABILITY language, NEVER guarantee:\n- WRONG: 'Udaces se u martu 2027.' / 'Desice se trudnoca u junu.' / 'Dobices posao 15.09.'\n- CORRECT: 'U martu 2027. postoji velika mogucnost za brak.' / 'Jun 2026. donosi snaznu energiju za trudnocu.' / 'Sredinom septembra 2026. otvara se sansa za posao.'\nCoristi: 'velika mogucnost', 'snazna sansa', 'otvara se prilika', 'donosi energiju', 'potencijal', 'pogoduje'. Izbegavaj 'ce se desiti', 'sigurno', '100%', 'garantujem'. ALI zabranjeno i slabo hedging 'mozda', 'moglo bi', 'verovatno'.\n\n*** CRITICAL - NEVER WRITE WHAT YOU CAN'T DO ***\nNEVER mention missing data or limitations. FORBIDDEN: 'Za dublju analizu bilo bi potrebno...', 'Nemam podatke...', 'Ne mogu bez...', 'Idealno bi bilo...'. Radi sa podacima koje imas.\n\n*** MANDATORY LENGTH — minimum 1500 words. This is NOT optional. ***\n- Count your output. If under 1500 words after the last question, add more depth to each answer: more concrete events, more specific dates, more dimensions.\n- Each question's answer must be at least 200 words on its own.\n- A short Pitanja response (under 1500 words) is a FAILURE. Better verbose than concise.\n\nFORBIDDEN (text MUST look like a real person wrote it, not AI):\n- Uppercase section titles\n- Bullet lists or any list with bullets/dashes/asterisks/dots\n- Planet names/houses in text\n- Hedging\n- Asking for more data\n- Markdown symbols (## ** --- __)\n- Checkmarks (✅ ✓ ✔ ☑) or X marks (❌ ✗ ×) or arrows (→ ➡ ⇒) or any decorative symbol\n- ANY emoji in body (📌 📝 💡 🎯 ✨ 🔮 🌹 etc.)\n- Phrases 'Evo', 'Hajde da pogledamo', 'Analiziramo' - sounds like AI\n- Phrases 'Kljucno je da', 'Vazno je istaci', 'Treba napomenuti' - AI cliches\n- AI 'honesty preamble' phrases: 'Bicu potpuno iskrena sa tobom', 'Bicu iskrena', 'Iskreno cu ti reci', 'Da budem iskrena', 'Necu da te lazem', 'bez uvijanja', 'bez okolisanja'. A real astrologer NEVER announces honesty — she just IS honest. These preambles are the strongest 'AI smell' signal. Skip the announcement; deliver the insight directly.\n- 'T.' or 'Tr.' or 'Transit' or 'Tranzitni' or 'Tranzitna' prefix before planets. Write 'Saturn', 'Jupiter', NOT 'T.Saturn' ili 'Tranzitni Saturn'. Klijent ne zna ove termine.\n- Parenthetical data/reasoning notes like '(podaci: Pluton u Vagi, verovatno 7. kuca)', '(napomena: ...)', '(pretpostavka: ...)'. Analiza je CIST PROZA - nikad ne pokazuj kalkulacije ili rezonovanje.\n- Mentioning 'kuca' / '7. kuca' / 'house' - klijent ne zna sta su astroloske kuce.\n- Self-questioning or thinking aloud: 'T.Jupiter ulazi u Vagu?' (AI asking itself) is WRONG. 'Zapravo,...' (self-correction) is WRONG. '(ako pretpostavimo)' is WRONG. '(vec u aspektu)' is WRONG. 'u zavisnosti od aspekta' is WRONG. Be definitive; if unsure leave it out.\n- Degree symbols like '3° Riba', '15° Lav' — client doesn't care about technical degrees.\n- Masculine forms ('video sam', 'pogledao sam' — always feminine)\n- Write LIKE A HUMAN: only words, commas, periods, question marks. NO symbols. NO decoration.\n\nDo NOT write greeting or closing. Just answer.");
    sys+="\n\n*** CRITICAL - NEVER APOLOGIZE / NEVER ECHO CLIENT'S COMPLAINT ***\nThe client may complain about the previous analysis (e.g., 'tvoj opis partnera ne poklapa se sa stvarnošću'). DO NOT validate the complaint, DO NOT apologize, DO NOT admit error, DO NOT offer to start over. The previous analysis stands. Just answer the new questions directly.\n\nFORBIDDEN APOLOGY/RESPONSIBILITY phrases (NEVER write any of these):\n- 'Preuzimam (punu) odgovornost'\n- 'Promasila sam', 'Pogresila sam', 'Prevarila sam se'\n- 'Bila sam u zabludi', 'Trebala sam pazljivije'\n- 'Izvinjavam se', 'Moja greska'\n- 'Moja prethodna analiza' (u pejorativnom ili self-correcting kontekstu)\n- 'Ranije sam pogresno...'\n- 'Ostaviću to po strani', 'Poceti/Krenuti iznova', 'Krenimo iznova'\n\nFORBIDDEN ECHOING/VALIDATION phrases (NEVER write any of these as opener or anywhere):\n- 'Kazes mi da...' / 'Kažeš mi da...'\n- 'Cujem te' / 'Čujem te'\n- 'Slusam te' / 'Slušam te'\n- 'Razumem te' / 'Razumijem te'\n- Any sentence that VALIDATES the client's feelings instead of ANSWERING.\n\nThe FIRST sentence MUST be the rephrased first question + answer (per existing reframe rule). NEVER an empathic preamble.\n\nA real astrologer with 30 years of experience NEVER apologizes for previous work, NEVER admits error, NEVER echoes the client's complaint. She just reads the questions and delivers her answers with confidence.";
    sys+="\n\n*** ABSOLUTE NAME RULE — NEVER CHANGE THE CLIENT'S NAME ***\nThe client's name is fixed in the CLIENT IDENTITY LOCK at the top. Do NOT 'correct', 'translate', 'autocomplete', 'normalize', or 'similar-sound substitute' the name. If the name seems unusual or unfamiliar — that IS the exact spelling the client gave. Use it character-by-character. NEVER drift to a similar-sounding name mid-text. If you are tempted to write 'Marina' when the client name is 'Marija', STOP — write 'Marija'. Same applies to ANY similar-sounding alternative ('Maja' vs 'Marija', 'Sandra' vs 'Sanja', 'Dragana' vs 'Zvezdana', etc.). Also: if the client_name field is EMPTY or technical word ('Downsell', 'Pitanja', 'Test', 'Klijent'), DO NOT use that as a vocative — start without any vocative greeting at all and address the client only with 'ti'.";
    sys+="\n\n*** ABSOLUTE BAN — NEVER INVENT BIRTH DATA FOR MENTIONED PERSONS ***\nIf the client mentions someone (lover, mistress, ex, husband's lover, neighbor, suspected affair partner, etc.) WITHOUT providing their birth date, place, or time — you MUST NOT invent or assume ANY data about that person. NEVER write:\n- 'Ona je rodjena istog dana kao tvoj muz' (NEVER — invented)\n- 'Imaju isti znak' / 'Ona je takodje [znak]' (NEVER — speculation)\n- 'Vidim da je ona rodjena u [mesec/godina]' (NEVER — fabrication)\n- 'Njena karta pokazuje...' (NEVER — no chart exists)\n- 'Imam osecaj da je ona [opis baziran na znaku]' (NEVER — fabrication)\n- Any sentence assigning a sign, date, place, or chart attribute to a person whose data was NOT provided.\nCORRECT: refer to that person ONLY by what client said about them ('ljubavnica koju tvoj muz vidja', 'osoba koja se umesala'), focus on CLIENT's chart and dynamics of relationship. If client asks 'sta ona zeli', answer through CLIENT's chart and karma, NOT through fabricated info about the other person.\nKRITICNO: AI cesto izmislja datume i znakove za nepomenute osobe — to je profesionalno katastrofalna greska. Astrolog NE GADJA — astrolog koristi SAMO podatke koje ima. Ako podaci nisu dati, nikakva astroloska tvrdnja o toj osobi nije moguca.";
    sys+="\n\n*** CRITICAL - Q&A FORMAT - QUESTION ON OWN LINE, ANSWER BELOW ***\nFor PITANJA section AND for any client-asked questions, the format MUST be:\n\n1. The QUESTION rephrased to 'ti' (you) form, ending with '?', on its OWN LINE\n2. Answer paragraph immediately on the next line\n3. Empty line between Q+A pairs\n\nCORRECT format example (this is exactly how it should look in the output):\n\nDa li ćete se razići?\nKarta pokazuje da je ovo period preispitivanja, ali ne i kraj veze. Tvoj Mesec u Raku govori da osećaš nesigurnost, dok njegova priroda iz Lava želi da bude potvrđen. Period od 9. maja do 28. maja 2026. donosi razbistravanje. Ako oboje budete spremni da slušate jedno drugo, do kraja jula imate šansu za dublje povezivanje. [10-12 sentences total]\n\nDa li on ima osećanja prema tebi?\nDa, on ima osećanja, ali ih retko pokazuje otvoreno. [10-12 sentences total]\n\nDa li je spreman da promeni nešto radi tebe i porodice?\n[answer paragraph]\n\nWRONG format (NEVER do this):\n- 'Aleksandra Pavlovic, se gde ste sada ti i tvoj partner u odnosu, da li se vasi putevi razilaze ili cete se spojiti. Zanima te da li on ima osecanja...' (multiple questions hidden in prose, no '?', merged into one paragraph)\n- 'Pitas se da li cete se razici. [answer]' (lead-in 'Pitas se' instead of just question with '?')\n- 'Zanima te da li ima osecanja prema tebi.' (lead-in 'Zanima te' + period instead of '?')\n\nFORMAT RULES:\n- Each client question = ONE separate Q+A block\n- Question MUST end with '?'\n- NO lead-in prefixes like 'Pitas se...', 'Zanima te...', 'Rekao si da...' before the question — write the question itself, rephrased to 'ti' form\n- Question on own line, answer paragraph below on next line\n- Multiple questions = multiple Q+A blocks with empty line between\n- NEVER merge multiple questions into one paragraph\n- NEVER hide question inside answer prose\n- Preserve ALL specific details (names, dates, places) IN the question or in the answer\n- Question rephrasing: 'Da li ću se razići' → 'Da li ćeš se razići', 'Hoću li dobiti posao' → 'Hoćeš li dobiti posao', 'Da li me voli' → 'Da li te voli'\n\nThis Q&A format is MANDATORY for all questions in PITANJA / DODATNA PITANJA sections. Format breaks if you mix questions into prose.";
    try{
      var pqPrevText=pq.prev.trim()||"(istorijat klijenta ce backend automatski povuci na osnovu client_id)";
      var pqUsr="DANASNJI DATUM: "+todayStr+" (godina "+curYearPQ+", mesec "+curMonthNamePQ+")\n\n"+
        "========== PRETHODNE ANALIZE KLIJENTA (ARHIVA, sve ispod je PROSLOST) ==========\n"+
        "Tekst ispod je ZBIR prethodnih analiza/Downsell-ova/odgovora.\n"+
        "Sve što tu piše je ISTORIJA, NE budućnost. Svi pomenuti datumi su prošli.\n"+
        "Osobe, partneri, situacije mogu biti iz raznih perioda — NE mešaj ih.\n"+
        "Koristi samo kao KONTEKST. Ne recikliraj prošle datume ni prošle osobe.\n\n"+
        pqPrevText+"\n"+
        "========== KRAJ ARHIVE ==========\n\n"+
        "Sada odgovori na klijentova pitanja ispod, koristeci NOVE prognoze pocev od "+todayStr+" nadalje.\n\n"+
        "CLIENT QUESTIONS:\n"+pq.quest;
      var pqName=pq.clientName.trim()||"";
      try{var pqFacts=await buildPersonSignFacts(pq.quest||"",pqName,pq.clientBirthDate);if(pqFacts)pqUsr+=pqFacts;}catch(eF){console.warn("pq astro facts:",eF.message);}
      // Tacne danasnje pozicije planeta - bez ovoga AI izmislja trenutno nebo.
      // "***" prefiks: da backend extractPitanjaSection ne uvuce blok u pitanja sekciju.
      try{var pqTr=localTransitPositions();if(pqTr.length>0)pqUsr+="\n\n*** TRENUTNE POZICIJE PLANETA DANAS ("+todayStr+", tacno izracunato) ***\n"+pqTr.map(function(t){return t.planet+": "+t.sign+" "+t.deg+"°"+(t.retrograde?" R":"");}).join("\n")+"\nKoristi ISKLJUCIVO ove pozicije za trenutno nebo. NIKAD ne navodi trenutnu poziciju planete koje nema u ovoj listi.";}catch(eT){}
      var pqPayload={system_prompt:sys,user_prompt:pqUsr,client_name:pqName,job_type:"pitanja",user_id:user&&user.id||"",birth_date:pq.clientBirthDate||null,client_id:pq.clientId||null};
      var resp=await fetchWithRetry(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pqPayload)},{attempts:4,onRetry:function(n,total,ms){toast2("Server se budi (pokušaj "+n+"/"+total+", čekaj ~"+Math.round(ms/1000)+"s)...");}});
      var jobData=await resp.json();
      if(!jobData.id)throw new Error(jobData.error||"Failed");
      upPq(idx,function(s){return Object.assign({},s,{an:"Generisem u pozadini...",jobId:jobData.id});});
      var jobs=safeActiveJobs();
      var pqKey="pq"+(idx+1);
      jobs[pqKey]={id:jobData.id,clientName:"D. Pitanja - "+pqName,tab:"pitanja"+(idx+1),idx:idx,startedAt:Date.now()};
      localStorage.setItem("activeJobs",JSON.stringify(jobs));
      startPqPoll(idx,jobData.id,pqName,pqPayload,pq.quest||"");
    }catch(e){try{Sentry.withScope(function(s){s.setTag("source","genPitanja");Sentry.captureException(e);});}catch(_){}var pqMsg=e.message||"";var pqFr=/Failed to fetch|NetworkError|TypeError.*fetch/i.test(pqMsg)?"Server se budi (Render free tier). Sačekaj 30s i klikni Generiši ponovo.":/AbortError|aborted/i.test(pqMsg)?"Veza prekinuta. Klikni Generiši ponovo.":"Greška: "+pqMsg;toast2(pqFr);upPq(idx,function(s){return Object.assign({},s,{st:"idle",genStartedAt:null});});}
    finally{genBusyRef.current["pq"+idx]=false;}
  }

  // Garantovano dopisuje fiksni zavrsetak sa savet-rečenicom i email adresom na
  // kraj generisanog teksta. Deterministicki - ne zavisi od toga sta AI napise.
  // Idempotentno.
  function applyClosing(text,jobType,isSinastrija){
    var t=(text||"");
    var emailLine="E-mail: astrologsuzana@gmail.com";
    var saveAdvice="Savetujem ti još da ovu analizu sačuvaš negde u beleške ako se slučajno izbriše ovde, da imaš negde drugo sačuvano.";
    if(jobType==="pitanja"){
      if(t.indexOf("Savetujem ti")>=0)return t.replace(/\s+$/,"");
      return t.replace(/\s+$/,"")+"\n\n"+saveAdvice+"\n\nHvala ti na poverenju i svako dobro.\n\n"+emailLine;
    }
    // analiza: ukloni zaostali "Today is:" red (AI artefakt)
    t=t.replace(/\n+[ \t]*Today is:[^\n]*\s*$/i,"");
    var hasEmail=t.indexOf("astrologsuzana@gmail.com")>=0;
    var hasAdvice=t.indexOf("Savetujem ti")>=0;
    if(hasEmail&&hasAdvice)return t.replace(/\s+$/,"");
    var hvalaRe=/(\n+[ \t]*)(Hvala ti [^\n]*(?:poverenju|povjerenju)[^\n]*)/i;
    var sigRe=/\n+[ \t]*Astrolog (?:Suzana|Marija)\b[^\n]*\s*$/i;
    if(hvalaRe.test(t)&&sigRe.test(t)){
      // normalan put: ubaci savetujemski pre "Hvala ti puno" i email pre potpisa
      if(!hasAdvice)t=t.replace(hvalaRe,function(_,nl,rest){return nl+saveAdvice+"\n\n"+rest;});
      if(!hasEmail)t=t.replace(sigRe,function(match){return "\n\n\n"+emailLine+"\n"+match.replace(/^\s+/,"").replace(/\s+$/,"");});
      return t.replace(/\s+$/,"");
    }
    // fallback (potpis ili hvala fali, npr. skracen prevod): strip eventualne
    // delimicne ostatke pa dopisi ceo kanonski zavrsetak
    t=t.replace(/\n+[ \t]*Savetujem ti[\s\S]*$/i,"");
    t=t.replace(/\n+[ \t]*Hvala ti [^\n]*(?:poverenju|povjerenju)[\s\S]*$/i,"");
    t=t.replace(/\n+[ \t]*Astrolog (?:Suzana|Marija)[\s\S]*$/i,"");
    var aName=country==="hr"?"Marija":"Suzana";
    var closingSentence=isSinastrija
      ?"Hvala ti puno na poverenju i želim ti odnos ispunjen ljubavlju, razumevanjem i radošću."
      :"Hvala ti puno na poverenju i želim ti život ispunjen mirom, radošću i srećom.";
    return t.replace(/\s+$/,"")+"\n\n"+saveAdvice+"\n\n"+closingSentence+"\n\n\n"+emailLine+"\nAstrolog "+aName+" ❤️";
  }

  // TRANSLATE TO SERBIAN
  // POLL JOB STATUS
  // Q&A post-validacija: broji pitanja klijenta vs odgovore u analizi.
  // Sluzi kao defenzivna mreza kad AI preskoci neko pitanje.
  function countClientQuestions(pitanjaText){
    if(!pitanjaText)return 0;
    var t=String(pitanjaText).trim();
    // Primarno: broj '?' u tekstu klijenta
    var qMarks=(t.match(/\?/g)||[]).length;
    if(qMarks>0)return qMarks;
    // Fallback: ako nema '?', broji recenice (split po .!?\n)
    var sentences=t.split(/[.!?\n]+/).map(function(s){return s.trim();}).filter(function(s){return s.length>5;});
    return sentences.length;
  }
  function countAnswersInAnalysis(analysisText){
    if(!analysisText)return 0;
    var t=String(analysisText);
    // Nadji pocetak Q&A sekcije (varijante zaglavlja)
    var headerRe=/odgovori\s+na\s+(tvoja\s+)?pitanja/i;
    var hMatch=t.match(headerRe);
    if(!hMatch)return 0;
    var start=hMatch.index+hMatch[0].length;
    // Kraj sekcije: sledeci veliki naslov (Hvala/Zakljucak) ili kraj teksta
    var rest=t.slice(start);
    var endRe=/\n\s*(hvala\s+ti\s+puno|zakljucak|na\s+kraju|astrolog\s+(suzana|marija))/i;
    var eMatch=rest.match(endRe);
    var qaSection=eMatch?rest.slice(0,eMatch.index):rest;
    return (qaSection.match(/\?/g)||[]).length;
  }

  function pollJob(jobId,slotIdx,tabKey,meta){
    var pollCount=0;
    var MAX_POLLS=300; // ~15 min na 3s interval - hard limit (Marko 9.6.: Suzana 27 min spinner)
    var interval=setInterval(async function(){
      try{
        // Check if job already completed (prevent duplicate saves)
        var jobs=safeActiveJobs();
        if(tabKey&&!jobs[tabKey]){
          // Entry moze faliti iz 2 razloga: (a) radnica je otkazala (slot je idle) -
          // stani; (b) registry je obrisan/pokvaren (safeActiveJobs wipe) a slot i dalje
          // generise - rekreiraj entry sa ORIGINALNIM startedAt (iz slot.genStartedAt,
          // NE Date.now()) da 18-min limit nastavi da vazi.
          var slotStillRunning=false,slotGenStart=null;
          try{
            var slArr=JSON.parse(localStorage.getItem("ab_slots")||"[]");
            var sl0=(slotIdx!==null&&slArr&&slArr[slotIdx])||null;
            if(sl0&&sl0.status==="generating"&&sl0.jobId===jobId){slotStillRunning=true;slotGenStart=sl0.genStartedAt||null;}
          }catch(_){}
          if(!slotStillRunning){clearInterval(interval);return;}
          jobs[tabKey]={id:jobId,tab:tabKey,idx:slotIdx,startedAt:slotGenStart||Date.now()};
          try{localStorage.setItem("activeJobs",JSON.stringify(jobs));}catch(_){}
        }
        // Ako registry entry pripada NEKOM DRUGOM job-u (novi job je preuzeo slot),
        // ovaj poller je zastareo - stani da ne bi pregazio tudji rezultat.
        if(tabKey&&jobs[tabKey]&&jobs[tabKey].id&&jobs[tabKey].id!==jobId){clearInterval(interval);return;}
        // APSOLUTNI hard limit (Suzana 11.6. prijava 777e363f: 21min spinner -
        // tab-switch resetuje pollCount svaki put, pa per-poller counter ne pomaze).
        if(tabKey&&jobExpired(jobs[tabKey])){
          clearInterval(interval);
          var jbsExp=safeActiveJobs();delete jbsExp[tabKey];localStorage.setItem("activeJobs",JSON.stringify(jbsExp));
          // Greska ide kao toast + idle slot, NE kao lazna "gotova analiza" (istorija:
          // radnica je error tekst videla kao analizu sa Kopiraj dugmetom, pomislila da
          // mora ispocetka i radila istog klijenta 4x - prijava #71).
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{status:"idle",analysis:"",jobId:null,genStartedAt:null});});
          toast2("Generisanje predugo (18min). Analiza je verovatno gotova u Bazi — pogledaj tamo, pa tek onda generisi ponovo.");
          return;
        }
        pollCount++;
        if(pollCount>MAX_POLLS){
          clearInterval(interval);
          var jbsT=safeActiveJobs();
          if(tabKey)delete jbsT[tabKey];
          localStorage.setItem("activeJobs",JSON.stringify(jbsT));
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{status:"idle",analysis:"",jobId:null,genStartedAt:null});});
          toast2("Generisanje je predugo trajalo — proveri Bazu pa pokušaj ponovo.");
          return;
        }

        var resp=await fetchSafe(API+"/api/generate/"+jobId);
        if(!resp.ok)return;
        var job=await resp.json();
        if(job.status==="generating"){
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{analysis:"Generisem analizu..."});});
        }else if(job.status==="translating"){
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{analysis:"Prevodim na srpski..."});});
        }else if(job.status==="done"){
          clearInterval(interval);
          // Remove from active jobs FIRST to prevent duplicates
          var jbs=safeActiveJobs();
          if(tabKey)delete jbs[tabKey];
          localStorage.setItem("activeJobs",JSON.stringify(jbs));

          var finalText=fmtText(job.serbian_text||"");
          var jt=job.job_type||"analiza";
          if(jt==="analiza")finalText=applyClosing(finalText,"analiza",meta&&meta.isSinastrija);
          else if(jt==="pitanja")finalText=applyClosing(finalText,"pitanja");
          // Defenzivna mreza: ako je klijent imao pitanja a AI je preskocio neka,
          // upozorenje ide u ZASEBNO polje slota (crveni baner), NE u tekst analize.
          // Ranije je "⚠ NAPOMENA ZA ASTROLOGA..." bila deo analysis teksta pa se
          // KOPIRALA KLIJENTU preko "Kopiraj 1/N" i zavrsavala u Bazi.
          var qaWarnVal=null;
          try{
            if(meta&&meta.pitanja&&meta.pitanja.trim().length>10){
              var nQ=countClientQuestions(meta.pitanja);
              var nA=countAnswersInAnalysis(finalText);
              // Tolerancija: dozvoli 1 razliku (AI moze spojiti 2 srodna pitanja u 1 odgovor)
              if(nQ>=2&&nA<nQ-1){
                qaWarnVal=nA+"/"+nQ;
                console.warn("Q&A check: "+nA+"/"+nQ+" answered — warning flag set");
                notifyOps("qa_skipped","AI preskocio pitanja: "+nA+"/"+nQ,{clientName:meta&&meta.clientName,jobId:jobId,pitanjaSnippet:String(meta&&meta.pitanja||"").slice(0,250)});
              }else{
                console.log("Q&A check: "+nA+"/"+nQ+" answered — OK");
              }
            }
          }catch(qaErr){console.warn("Q&A validation error:",qaErr&&qaErr.message);}
          if(slotIdx!==null){
            upSlot(slotIdx,function(s){return Object.assign({},s,{status:"done",analysis:finalText,jobId:null,qaWarn:qaWarnVal});});
          }
          // Save to analyses only if not already saved
          setAnalyses(function(prev){
            if(prev.some(function(a){return a.jobId===jobId;}))return prev;
            var now=new Date();
            var na={id:"j"+Date.now(),jobId:jobId,clientName:job.client_name||"",sign:"",date:belgradeDateTime(now),rawDate:belgradeRawDate(now),birthDate:meta&&meta.birthDate||"",mesto:meta&&meta.mesto||"",types:[job.job_type||"analiza"],analysis:finalText,country:country,owner:user&&user.email};
            var upd=[na].concat(prev).slice(0,200);try{stoSet("analyses",upd.slice(0,50));}catch(e){}return upd;
          });
          toast2("Analiza za "+(job.client_name||"klijenta")+" je gotova!");
        }else if(job.status==="error"){
          clearInterval(interval);
          var jbs2=safeActiveJobs();
          if(tabKey)delete jbs2[tabKey];
          localStorage.setItem("activeJobs",JSON.stringify(jbs2));
          // OVERLOAD: DeepSeek pao - iskoci modal sa Gemini dugmetom
          if(job._overload&&meta&&meta.payload){
            if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{status:"idle",analysis:"",jobId:null,genStartedAt:null});});
            setOverloadPrompt({
              type:"analiza",
              geminiAvailable:!!job._gemini_available,
              retryFn:function(){
                var newPayload=Object.assign({},meta.payload,{provider:"gemini"});
                fetchSafe(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(newPayload)})
                  .then(function(r){return r.json();})
                  .then(function(d){
                    if(!d||!d.id){toast2("Gemini greska: "+(d&&d.error&&d.error.message||"nepoznato"));return;}
                    if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{jobId:d.id,status:"generating",analysis:"Generisem sa Gemini...",genStartedAt:Date.now()});});
                    var jobs=safeActiveJobs();
                    if(tabKey){jobs[tabKey]={id:d.id,clientName:meta&&meta.clientName||"",tab:tabKey,idx:slotIdx,startedAt:Date.now()};localStorage.setItem("activeJobs",JSON.stringify(jobs));}
                    pollJob(d.id,slotIdx,tabKey,meta);
                    toast2("Pokrećem sa Gemini backup-om...");
                  })
                  .catch(function(e){toast2("Greska: "+e.message);});
              }
            });
          }else{
            // Backend greska: toast + idle (sa ocuvanim podacima), ne lazna "gotova analiza".
            // jobId:null je OBAVEZAN - bez toga doGen guard trajno blokira dugme Generisi
            // na tom slotu ("Ne radi" prijava #70).
            if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{status:"idle",analysis:"",jobId:null,genStartedAt:null});});
            toast2(job.serbian_text||"Greska pri generisanju. Klikni Generiši ponovo.");
          }
        }
      }catch(e){console.warn("Poll error:",e.message);}
    },3000);
  }

  // Resume polling for active jobs on app load.
  // KRITICNO: kljuc u activeJobs odredjuje TIP job-a (a=analiza, ds=downsell, pq=pitanja).
  // Ako ovo ignorisemo i pozovemo pollJob za sve, downsell/pitanja rezultat zavrsi u
  // analiza slotu (Suzana prijava 4.6: "Kada radi Downsell radi ga i u polje analize" —
  // nastalo posle page refresh-a tokom downsell job-a).
  useEffect(function(){
    var jobs=safeActiveJobs();
    Object.keys(jobs).forEach(function(key){
      var j=jobs[key];
      if(!j||!j.id)return;
      console.log("Resuming poll for job:",j.id,key);
      var idx=j.idx!==undefined?j.idx:null;
      if(key.indexOf("ds")===0&&idx!==null){
        // Downsell — payload/questionsText nisu sacuvani u localStorage, pa Gemini fallback
        // nece raditi posle refresh-a; rezultat ce ipak otici u tacan slot.
        startDsPoll(idx,j.id,(j.clientName||"").replace(/^Downsell - /,""),null,"");
      }else if(key.indexOf("pq")===0&&idx!==null){
        startPqPoll(idx,j.id,(j.clientName||"").replace(/^D\. Pitanja - /,""),null,"");
      }else{
        pollJob(j.id,idx,key);
      }
    });
  },[]);

  // CRITICAL: visibility change handler. Kad se tab prebaci u background (Suzana
  // prebaci na drugi tab), browser pauzira setInterval pa polling staje. Job moze
  // da bude done u DB-u 25 min ranije, a frontend i dalje pokazuje spinner.
  // Suzana 9.6. 12:38 Branislav job: spinner 27:31 iako je job zavrsen u 12:13
  // (24 min ranije). Razlog: prebacila tab pa polling pauziran.
  // Fix: kad se tab vrati, IZBROJ sve active jobove iz localStorage i RESTARTUJ
  // polling za svaki. Prvi poll ce odmah videti done status.
  useEffect(function(){
    var onVisible=function(){
      if(document.hidden)return;
      var jobs;
      try{jobs=safeActiveJobs();}catch(e){return;}
      var count=Object.keys(jobs).length;
      if(count===0)return;
      console.log("[visibility] Tab returned, force-checking",count,"active job(s)");
      Object.keys(jobs).forEach(function(key){
        var j=jobs[key];
        if(!j||!j.id)return;
        var idx=j.idx!==undefined?j.idx:null;
        if(key.indexOf("ds")===0&&idx!==null){
          startDsPoll(idx,j.id,(j.clientName||"").replace(/^Downsell - /,""),null,"");
        }else if(key.indexOf("pq")===0&&idx!==null){
          startPqPoll(idx,j.id,(j.clientName||"").replace(/^D\. Pitanja - /,""),null,"");
        }else{
          pollJob(j.id,idx,key);
        }
      });
    };
    document.addEventListener("visibilitychange",onVisible);
    window.addEventListener("focus",onVisible);
    return function(){
      document.removeEventListener("visibilitychange",onVisible);
      window.removeEventListener("focus",onVisible);
    };
  },[]);

  // Safety valve - kad polling tiho zakaca (slot ostane u "generating" zauvek),
  // radnica klikne "Proveri da li je gotovo" pa cemo da restartujemo polling sa
  // postojecim jobId. Prvi sledeci poll ce videti done status i UI ce se osveziti.
  function forceCheckAnaliza(idx){
    var s=slots[idx];
    if(!s||!s.jobId){toast2("Nema aktivnog job-a.");return;}
    var tabKey="a"+(idx+1);
    var jbs=safeActiveJobs();
    // startedAt iz slota, NE Date.now() - inace force-check resetuje 18-min sat
    if(!jbs[tabKey])jbs[tabKey]={id:s.jobId,clientName:s.client.ime||"",tab:tabKey,idx:idx,startedAt:s.genStartedAt||Date.now()};
    localStorage.setItem("activeJobs",JSON.stringify(jbs));
    pollJob(s.jobId,idx,tabKey,{birthDate:s.client.datum,mesto:s.client.mesto,clientName:s.client.ime,isSinastrija:!!s.hasPart,pitanja:s.client.pitanja||""});
    toast2("Proveravam status...");
  }
  // Sinhrono upisi otkazano stanje slota u localStorage. React persist useEffect stize
  // tek posle render-a, a pollJob reconcile grana cita ab_slots direktno - bez ovoga
  // poll tick u tom prozoru vidi staro "generating" stanje i vaskrsne otkazani job.
  function syncCancelToStorage(key,idx,patch){
    try{
      var arr=JSON.parse(localStorage.getItem(key)||"[]");
      if(Array.isArray(arr)&&arr[idx]){arr[idx]=Object.assign({},arr[idx],patch);localStorage.setItem(key,JSON.stringify(arr));}
    }catch(_){}
  }
  // Pre auto-reseta "zaglavljenog" spinera proveri da li je posao vec ZAVRSEN.
  // Suzana 2.7. prijava #74 ("Radim vec 4 ti put"): na telefonu se u app vraca posle
  // >10 min (poll je bio zamrznut u pozadini) - auto-reset je dobijao trku sa tek
  // restartovanim pollerom i brisao prikaz, iako analiza sedi GOTOVA u bazi. Radnica
  // onda generise ispocetka (dupli posao + istorijat raste pa je svaki put sporije).
  async function fetchDoneJob(jobId){
    if(!jobId)return null;
    try{
      var r=await fetchSafe(API+"/api/generate/"+jobId,null,8000);
      if(!r.ok)return null;
      var j=await r.json();
      if(j&&j.status==="done"&&j.serbian_text)return j;
    }catch(_){}
    return null;
  }
  async function cancelStuckAnaliza(idx,skipConfirm){
    if(!skipConfirm&&!window.confirm("Otkazati prikaz? Backend mozda i dalje radi - ako se zavrsi, analiza ce biti u Bazi."))return;
    if(skipConfirm){
      var sA=slots[idx]||{};
      var doneA=await fetchDoneJob(sA.jobId);
      if(doneA){
        var ftA=applyClosing(fmtText(doneA.serbian_text||""),"analiza",!!sA.hasPart);
        upSlot(idx,function(s){return Object.assign({},s,{status:"done",analysis:ftA,jobId:null,genStartedAt:null});});
        syncCancelToStorage("ab_slots",idx,{status:"done",analysis:ftA,jobId:null,genStartedAt:null});
        var jbsDA=safeActiveJobs();delete jbsDA["a"+(idx+1)];localStorage.setItem("activeJobs",JSON.stringify(jbsDA));
        toast2("Analiza je gotova — prikazana je ispod.");
        return;
      }
    }
    upSlot(idx,function(s){return Object.assign({},s,{status:"idle",analysis:"",jobId:null,genStartedAt:null});});
    syncCancelToStorage("ab_slots",idx,{status:"idle",analysis:"",jobId:null,genStartedAt:null});
    var jbs=safeActiveJobs();delete jbs["a"+(idx+1)];localStorage.setItem("activeJobs",JSON.stringify(jbs));
    toast2(skipConfirm?"Prikaz resetovan (predugo bez odgovora). Proveri Bazu — ako analize tamo nema, klikni Generiši ponovo.":"Otkazano. Mozes pokrenuti ponovo.");
  }
  async function cancelStuckDs(idx,skipConfirm){
    if(!skipConfirm&&!window.confirm("Otkazati prikaz? Backend mozda i dalje radi - ako se zavrsi, analiza ce biti u Bazi."))return;
    if(skipConfirm){
      var sD=dsSlots[idx]||{};
      var doneD=await fetchDoneJob(sD.jobId);
      if(doneD){
        var ftD=fmtText(doneD.serbian_text||"");
        upDs(idx,function(s){return Object.assign({},s,{an:ftD,st:"done",jobId:null,genStartedAt:null});});
        syncCancelToStorage("ab_dsSlots",idx,{an:ftD,st:"done",jobId:null,genStartedAt:null});
        var jbsDD=safeActiveJobs();delete jbsDD["ds"+(idx+1)];localStorage.setItem("activeJobs",JSON.stringify(jbsDD));
        toast2("Downsell je gotov — prikazan je ispod.");
        return;
      }
    }
    upDs(idx,function(s){return Object.assign({},s,{st:"idle",an:"",jobId:null,genStartedAt:null});});
    syncCancelToStorage("ab_dsSlots",idx,{st:"idle",an:"",jobId:null,genStartedAt:null});
    var jbs=safeActiveJobs();delete jbs["ds"+(idx+1)];localStorage.setItem("activeJobs",JSON.stringify(jbs));
    toast2(skipConfirm?"Prikaz resetovan (predugo bez odgovora). Proveri Bazu — ako analize tamo nema, klikni Generiši ponovo.":"Otkazano.");
  }
  async function cancelStuckPq(idx,skipConfirm){
    if(!skipConfirm&&!window.confirm("Otkazati prikaz? Backend mozda i dalje radi - ako se zavrsi, analiza ce biti u Bazi."))return;
    if(skipConfirm){
      var sP=pqSlots[idx]||{};
      var doneP=await fetchDoneJob(sP.jobId);
      if(doneP){
        var ftP=applyClosing(fmtText(doneP.serbian_text||""),"pitanja");
        upPq(idx,function(s){return Object.assign({},s,{an:ftP,st:"done",jobId:null,genStartedAt:null});});
        syncCancelToStorage("ab_pqSlots",idx,{an:ftP,st:"done",jobId:null,genStartedAt:null});
        var jbsDP=safeActiveJobs();delete jbsDP["pq"+(idx+1)];localStorage.setItem("activeJobs",JSON.stringify(jbsDP));
        toast2("Odgovori su gotovi — prikazani su ispod.");
        return;
      }
    }
    upPq(idx,function(s){return Object.assign({},s,{st:"idle",an:"",jobId:null,genStartedAt:null});});
    syncCancelToStorage("ab_pqSlots",idx,{st:"idle",an:"",jobId:null,genStartedAt:null});
    var jbs=safeActiveJobs();delete jbs["pq"+(idx+1)];localStorage.setItem("activeJobs",JSON.stringify(jbs));
    toast2(skipConfirm?"Prikaz resetovan (predugo bez odgovora). Proveri Bazu — ako analize tamo nema, klikni Generiši ponovo.":"Otkazano.");
  }

  async function translateToSerbian(englishText){
    try{
      var resp=await fetchSafe(API+"/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({max_tokens:16000,system:"Prevedi ovaj tekst na srpski jezik, ekavica, ISKLJUCIVO latinicno pismo. Ovo NIJE doslovan prevod nego ADAPTACIJA na prirodan srpski jezik.\n\nOBAVEZNA PRAVILA:\n- Meseci na srpskom u pravilnom padezu: January=januar, February=februar, March=mart, April=april, May=maj, June=jun, July=jul, August=avgust, September=septembar, October=oktobar, November=novembar, December=decembar\n- Meseci u padezu: u januaru, od maja do jula, tokom avgusta, krajem septembra\n- NIKAD ne pisi Juli, Maj, Oktobar sa velikim slovom niti u nominativu kad treba drugi padez\n- nature=priroda NIKAD natura\n- NIKAD ne koristi crtice (-) u tekstu\n- Ne duplaj slova (ne pisi srcemm, borbaa)\n- Gramatika mora biti 100% ispravna po srpskom pravopisu\n- Zadrzi sve prazne redove i formatiranje originala\n- Zadrzi sva imena i datume\n- Vrati SAMO prevedeni tekst bez komentara",messages:[{role:"user",content:englishText}]})});
      if(!resp.ok)return englishText;
      var d=await resp.json();
      var t=(d.content&&d.content[0]&&d.content[0].text)||englishText;
      // Remove any remaining dashes at start of lines
      t=t.replace(/^[-–—]\s*/gm,"");
      return t;
    }catch(e){console.error("Translation error:",e);return englishText;}
  }

  function doCopy(text,label){cpText(text);toast2(label+" kopiran!");}
  // Svi korisnici vide sve analize iz baze (deljena baza)
  var myAnalyses=analyses;

  // CHUNK UI helper
  function ChunkTracker(props){
    var ch=props.ch,ci=props.ci,setCi=props.setCi;
    return React.createElement("div",{className:"ctrack"},
      React.createElement("div",{style:{fontSize:"11.5px",color:"var(--gd2)",fontWeight:500}},ci+"/"+ch.length+" delova poslato"),
      React.createElement("div",{className:"cdots"},
        ch.map(function(_,i){
          var bg=i<ci?"rgba(96,176,96,.28)":i===ci?"var(--gd)":"var(--sf2)";
          var col=i<ci?"var(--grn)":i===ci?"#1a0e00":"var(--mt)";
          var brd=i===ci?"none":"1px solid var(--bd)";
          return React.createElement("div",{key:i,className:"cdot",style:{background:bg,color:col,border:brd},onClick:function(){setCi(i);}},i<ci?"✓":i+1);
        })
      )
    );
  }

  // GEOCODE REFRESH za pojedinacnu osobu (klijent/partner) — koristi se onBlur
  // Suzana kuca u "Mesto" ili "Zemlja", izlazi iz polja → re-geocode.
  async function refreshGeocode(idx, who){
    var sl=slots[idx];if(!sl)return;
    var person=sl[who];if(!person||!person.mesto||!person.mesto.trim())return;
    upSlot(idx,function(s){var p=Object.assign({},s[who],{placeStatus:"pending"});var pa={};pa[who]=p;return Object.assign({},s,pa);});
    var geo=await geocodePerson(person);
    upSlot(idx,function(s){var p=Object.assign({},s[who],geo);var pa={};pa[who]=p;if(s.ch||s.pch)pa.chStale=true;return Object.assign({},s,pa);});
  }
  // Selektuje konkretnu opciju iz dropdown-a (disambiguation rezultat)
  function pickPlaceOption(idx, who, opt){
    upSlot(idx,function(s){
      var p=Object.assign({},s[who],{lat:opt.lat,lon:opt.lon,timezone:opt.timezone,zemlja:opt.country||s[who].zemlja||"",placeOptions:[],placeStatus:"ok"});
      var pa={};pa[who]=p;if(s.ch||s.pch)pa.chStale=true;return Object.assign({},s,pa);
    });
  }

  // ELEMENT & QUALITY HELPERS
  var ELEM={Ovan:"Vatra",Lav:"Vatra",Strelac:"Vatra",Bik:"Zemlja",Devica:"Zemlja",Jarac:"Zemlja",Blizanci:"Vazduh",Vaga:"Vazduh",Vodolija:"Vazduh",Rak:"Voda",Skorpija:"Voda",Ribe:"Voda"};
  var QUAL={Ovan:"Kardinalni",Rak:"Kardinalni",Vaga:"Kardinalni",Jarac:"Kardinalni",Bik:"Fiksni",Lav:"Fiksni",Skorpija:"Fiksni",Vodolija:"Fiksni",Blizanci:"Promjenljivi",Devica:"Promjenljivi",Strelac:"Promjenljivi",Ribe:"Promjenljivi"};
  var ELEM_CLR={Vatra:"#e87070",Zemlja:"#90b060",Vazduh:"#7090d0",Voda:"#60a0b0"};
  var POSITIVE_ASP=["Konjunkcija","Trigon","Sekstil","Polusekstil"];

  function calcElements(planets){
    var cnt={Vatra:0,Zemlja:0,Vazduh:0,Voda:0};
    var mainPlanets=["Sunce","Mesec","Merkur","Venera","Mars","Jupiter","Saturn","Uran","Neptun","Pluton"];
    planets.forEach(function(p){if(mainPlanets.indexOf(p.name)>=0&&ELEM[p.sign])cnt[ELEM[p.sign]]++;});
    return cnt;
  }
  function calcQualities(planets){
    var cnt={Kardinalni:0,Fiksni:0,Promjenljivi:0};
    var mainPlanets=["Sunce","Mesec","Merkur","Venera","Mars","Jupiter","Saturn","Uran","Neptun","Pluton"];
    planets.forEach(function(p){if(mainPlanets.indexOf(p.name)>=0&&QUAL[p.sign])cnt[QUAL[p.sign]]++;});
    return cnt;
  }

  // SLOT RENDERER
  function SlotView(props){
    var idx=props.idx;
    var s=slots[idx];
    // Polja koja uticu na natalnu kartu - izmena posle racunanja cini horoskop zastarelim
    var CHART_FIELDS=["datum","vreme","mesto","zemlja","lat","lon","timezone"];
    function upC(f,v){upSlot(idx,function(sl){var c=Object.assign({},sl.client);c[f]=v;var ns=Object.assign({},sl,{client:c});if((sl.ch||sl.pch)&&CHART_FIELDS.indexOf(f)>=0)ns.chStale=true;return ns;});}
    function upP(f,v){upSlot(idx,function(sl){var p=Object.assign({},sl.partner);p[f]=v;var ns=Object.assign({},sl,{partner:p});if((sl.ch||sl.pch)&&CHART_FIELDS.indexOf(f)>=0)ns.chStale=true;return ns;});}
    var busy=["generating","parsing","computing"].indexOf(s.status)>=0;
    var ch=s.analysis?getAnalizaChunks(s.analysis,country):[];
    var stL=s.status==="idle"?"Ceka":s.status==="parsing"?"AI cita...":s.status==="computing"?"Racunam...":s.status==="generating"?"Generise se...":"Gotovo";
    var stC=s.status==="generating"?"strun":s.status==="done"?"stdone":"stidl";
    var isMess=s.mode==="messenger";
    return React.createElement("div",null,
      // HEADER
      React.createElement("div",{className:"slhdr"},
        React.createElement("span",{className:"slbadge"},"A"+(idx+1)),
        React.createElement("span",{style:{fontSize:12,color:s.client.ime?"var(--tx)":"var(--mt)"}},s.client.ime||"Bez klijenta"),
        s.status!=="idle"&&React.createElement("span",{className:"slst "+stC},stL)
      ),
      // MODE TABS
      React.createElement("div",{className:"tabs"},
        React.createElement("button",{className:"tab "+(isMess?"on":""),onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{mode:"messenger",parsed:null});});}},"\u2726 Iz Messengera"),
        React.createElement("button",{className:"tab "+(!isMess?"on":""),onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{mode:"rucno"});});}},"Ru\u010dno")
      ),
      // PASTE
      isMess&&!s.parsed&&React.createElement("div",{className:"card card-hi"},
        React.createElement("div",{className:"ct"},"Nalepi Poruku Iz Messengera"),
        React.createElement("div",{className:"fld"},
          React.createElement("textarea",{value:s.paste,onChange:function(e){upSlot(idx,function(sl){return Object.assign({},sl,{paste:e.target.value});});},placeholder:"Nalepi celu poruku klijenta...",style:{minHeight:"100px"}})
        ),
        React.createElement("button",{className:"btn bpu bfull",onClick:function(){doParse(idx);},disabled:busy||!s.paste.trim()},
          s.status==="parsing"?React.createElement(ParsingProgress,{startedAt:s.parseStartedAt}):"\u2746 Prepoznaj Sve Automatski"
        ),
        // OVERLOAD UI: DeepSeek pao - dugme za Gemini fallback
        s.parseOverload&&React.createElement("div",{style:{marginTop:"10px",padding:"12px",background:"rgba(255,180,80,.1)",border:"1px solid rgba(255,180,80,.4)",borderRadius:"8px"}},
          React.createElement("div",{style:{fontSize:"12px",color:"var(--gd2)",fontWeight:600,marginBottom:"4px"}},"\u26a0 DeepSeek trenutno nije dostupan"),
          React.createElement("div",{style:{fontSize:"11px",color:"var(--mt)",marginBottom:"10px",lineHeight:"1.5"}},s.parseOverload.geminiAvailable?"Mo\u017ee\u0161 poku\u0161ati sa Gemini backup AI-em \u2014 koristi iste prompt-ove i daje isti kvalitet.":"Gemini backup nije konfigurisan na serveru. Sa\u010dekaj 1-2 minuta i poku\u0161aj DeepSeek ponovo."),
          React.createElement("div",{style:{display:"flex",gap:"6px"}},
            s.parseOverload.geminiAvailable&&React.createElement("button",{className:"btn bgd bsm",onClick:function(){upSlot(idx,function(s){return Object.assign({},s,{paste:s.paste||s.rawPaste||"",parseOverload:null});});setTimeout(function(){doParse(idx,"gemini");},50);}},"\u2728 Poku\u0161aj sa Gemini"),
            React.createElement("button",{className:"btn bol bsm",onClick:function(){upSlot(idx,function(s){return Object.assign({},s,{parseOverload:null});});}},"Otka\u017ei"),
            !s.parseOverload.geminiAvailable&&React.createElement("button",{className:"btn bgd bsm",onClick:function(){upSlot(idx,function(s){return Object.assign({},s,{parseOverload:null});});setTimeout(function(){doParse(idx);},50);}},"\u21bb Probaj DeepSeek ponovo")
          )
        )
      ),
      // PARSED OK
      isMess&&s.parsed&&React.createElement("div",{style:{display:"flex",alignItems:"center",gap:"8px",marginBottom:"9px",padding:"7px 11px",background:"rgba(96,176,96,.08)",border:"1px solid rgba(96,176,96,.25)",borderRadius:"7px"}},
        React.createElement("span",{style:{color:"var(--grn)"}},"✓"),
        React.createElement("span",{style:{fontSize:"11.5px"}},"Prepoznato. Provjeri i ispravi."),
        React.createElement("button",{className:"btn bol bsm",style:{marginLeft:"auto"},onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{parsed:null,paste:""});});}},"\u0050onovi")
      ),
      // FIELDS (show if manual or after parse)
      (!isMess||s.parsed)&&React.createElement(React.Fragment,null,
        React.createElement("div",{className:"card"},
          React.createElement("div",{className:"ct"},"Klijent"),
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Ime"),React.createElement("input",{value:s.client.ime,onChange:function(e){upC("ime",e.target.value);},placeholder:"Ime klijenta"})),
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Datum"),React.createElement(DateInput3,{value:s.client.datum,onChange:function(v){upC("datum",v);}})),
          React.createElement("div",{className:"fld",style:{maxWidth:"50%"}},React.createElement("label",null,"Vreme"),React.createElement("input",{type:"time",value:s.client.vreme,onChange:function(e){upC("vreme",e.target.value);}})),
          React.createElement("div",{style:{display:"flex",gap:"8px"}},
            React.createElement("div",{className:"fld",style:{flex:2}},React.createElement("label",null,"Mesto"),React.createElement("input",{value:s.client.mesto,onChange:function(e){upC("mesto",e.target.value);},onBlur:function(){refreshGeocode(idx,"client");},placeholder:"npr. Beograd"})),
            React.createElement("div",{className:"fld",style:{flex:1}},React.createElement("label",null,"Zemlja"),React.createElement("input",{value:s.client.zemlja||"",onChange:function(e){upC("zemlja",e.target.value);},onBlur:function(){refreshGeocode(idx,"client");},placeholder:"Srbija"}))
          ),
          React.createElement(PlaceStatus,{person:s.client,onPick:function(opt){pickPlaceOption(idx,"client",opt);}}),
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Napomena (opciono)"),React.createElement("textarea",{value:s.client.napomena||"",onChange:function(e){upC("napomena",e.target.value);},placeholder:"Ukoliko osoba ne zeli analizu za posao ili ljubav, napomeni da ne radim za posao ili ljubav",style:{minHeight:"60px"}})),
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Pitanja klijenta (opciono)"),React.createElement("textarea",{value:s.client.pitanja,onChange:function(e){upC("pitanja",e.target.value);},placeholder:"Npr: Da li cu se udati za trenutnog partnera?"}))
        ),
        React.createElement("div",{className:"card"},
          React.createElement("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:s.hasPart?"9px":"0"}},
            React.createElement("div",{className:"ct",style:{marginBottom:0}},"Partner"),
            React.createElement("button",{className:"btn bsm "+(s.hasPart?"bol":"bpu"),onClick:function(){upSlot(idx,function(sl){var nv=!sl.hasPart;var types=nv?["sinastrija"]:["analiza"];return Object.assign({},sl,{hasPart:nv,types:types});});}},s.hasPart?"Ukloni":"+ Partner")
          ),
          s.hasPart&&React.createElement(React.Fragment,null,
            React.createElement("div",{className:"div1"}),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Ime (opciono)"),React.createElement("input",{value:s.partner.ime,onChange:function(e){upP("ime",e.target.value);},placeholder:"Ime partnera"})),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Datum"),React.createElement(DateInput3,{value:s.partner.datum,onChange:function(v){upP("datum",v);}})),
            React.createElement("div",{className:"fld",style:{maxWidth:"50%"}},React.createElement("label",null,"Vreme"),React.createElement("input",{type:"time",value:s.partner.vreme,onChange:function(e){upP("vreme",e.target.value);}})),
            React.createElement("div",{style:{display:"flex",gap:"8px"}},
              React.createElement("div",{className:"fld",style:{flex:2}},React.createElement("label",null,"Mesto"),React.createElement("input",{value:s.partner.mesto,onChange:function(e){upP("mesto",e.target.value);},onBlur:function(){refreshGeocode(idx,"partner");},placeholder:"Mesto partnera"})),
              React.createElement("div",{className:"fld",style:{flex:1}},React.createElement("label",null,"Zemlja"),React.createElement("input",{value:s.partner.zemlja||"",onChange:function(e){upP("zemlja",e.target.value);},onBlur:function(){refreshGeocode(idx,"partner");},placeholder:"Srbija"}))
            ),
            React.createElement(PlaceStatus,{person:s.partner,onPick:function(opt){pickPlaceOption(idx,"partner",opt);}}),
            !s.partner.datum&&React.createElement("div",{className:"srow"},React.createElement("div",{className:"dot dot-w"}),React.createElement("span",null,"Nepotpuni podaci"))
          )
        )
      ),
      // CALC or GENERATE
      !s.ch
        ?(!s.client.datum&&s.client.pitanja&&s.client.pitanja.trim().length>10
            ?React.createElement(React.Fragment,null,
              React.createElement("div",{style:{fontSize:"11px",color:"var(--mt)",marginBottom:"6px",textAlign:"center"}},"Mama nema podatke — analiza ce biti za osobe iz Pitanja"),
              React.createElement("button",{className:"btn bgd bfull",onClick:function(){doGen(idx);},disabled:busy},
                s.status==="generating"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Generisem za decu..."):"Generiši Analizu za Decu"))
            :React.createElement("button",{className:"btn bgd bfull",onClick:function(){doCalc(idx);},disabled:!s.client.datum||busy},
              s.status==="computing"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Racunam..."):"Izracunaj Horoskop"))
        :React.createElement(React.Fragment,null,
          React.createElement("div",{className:"card"},
            React.createElement("div",{className:"ct"},"Horoskop: "+s.client.ime),
            // Upozorenje: podaci izmenjeni posle racunanja - znak/podznak su zastareli
            s.chStale&&React.createElement("div",{style:{display:"flex",alignItems:"center",gap:"8px",margin:"4px 0 9px",padding:"7px 11px",background:"rgba(220,170,60,.12)",border:"1px solid rgba(220,170,60,.4)",borderRadius:"7px",fontSize:"11.5px",color:"#d8b048"}},
              React.createElement("span",null,"⚠"),
              React.createElement("span",null,"Podaci su izmenjeni posle računanja — preračunaj horoskop da znak i podznak budu tačni.")
            ),
            // Dugme za preracun (uvek vidljivo - radnica moze da ispravi vreme/mesto pa preracuna)
            React.createElement("button",{className:"btn "+(s.chStale?"bgd":"bol")+" bsm",style:{marginBottom:"9px"},disabled:s.status==="computing"||busy,onClick:function(){doCalc(idx);}},
              s.status==="computing"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Računam..."):"↻ Preračunaj horoskop"),
            // Sun/Moon/Asc with degrees
            React.createElement("div",{className:"sgnrow"},
              React.createElement("div",{className:"sgni"},React.createElement("div",{className:"sgnl"},"Sunce"),React.createElement("div",{className:"sgnv"},s.ch.sunSign)),
              React.createElement("div",{className:"sgni"},React.createElement("div",{className:"sgnl"},"Mesec"),React.createElement("div",{className:"sgnv"},s.ch.moonSign)),
              s.ch.ascSign&&s.ch.ascSign!=="Nepoznato"&&React.createElement("div",{className:"sgni"},React.createElement("div",{className:"sgnl"},"Ascendent"),React.createElement("div",{className:"sgnv"},s.ch.ascSign+(s.ch.ascDeg?" "+s.ch.ascDeg+"\u00B0":"")))
            ),
            // Planets with degrees + retrograde
            React.createElement("div",{className:"ct",style:{marginTop:"8px"}},"Planete"),
            React.createElement("div",{className:"pgrid"},
              s.ch.planets.map(function(p){return React.createElement("div",{key:p.name,className:"prow"},
                React.createElement("span",{className:"pn"},p.name+(p.retrograde?" \u211E":"")),
                React.createElement("span",{className:"pv"},p.sign+" "+p.degInSign+"\u00B0"+(p.house?" · "+p.house+"K":""))
              );})
            ),
            // Elements & Qualities
            React.createElement("div",{style:{display:"flex",gap:"12px",marginTop:"10px",flexWrap:"wrap"}},
              React.createElement("div",{style:{flex:1,minWidth:"140px"}},
                React.createElement("div",{className:"ct"},"Elementi"),
                Object.keys(calcElements(s.ch.planets)).map(function(el){var cnt=calcElements(s.ch.planets)[el];return React.createElement("div",{key:el,style:{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px",fontSize:"11px"}},
                  React.createElement("span",{style:{width:"8px",height:"8px",borderRadius:"50%",background:ELEM_CLR[el],flexShrink:0}}),
                  React.createElement("span",{style:{color:"var(--mt)",minWidth:"65px"}},el),
                  React.createElement("span",{style:{color:"var(--gd2)",fontWeight:500}},cnt)
                );})
              ),
              React.createElement("div",{style:{flex:1,minWidth:"140px"}},
                React.createElement("div",{className:"ct"},"Kvalitet"),
                Object.keys(calcQualities(s.ch.planets)).map(function(q){var cnt=calcQualities(s.ch.planets)[q];return React.createElement("div",{key:q,style:{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px",fontSize:"11px"}},
                  React.createElement("span",{style:{color:"var(--mt)",minWidth:"85px"}},q),
                  React.createElement("span",{style:{color:"var(--gd2)",fontWeight:500}},cnt)
                );})
              )
            ),
            // Houses
            s.ch.houses&&s.ch.houses.length>0&&React.createElement("div",{style:{marginTop:"10px"}},
              React.createElement("div",{className:"ct"},"Kuce ("+s.ch.houses.length+")"),
              React.createElement("div",{className:"pgrid"},
                s.ch.houses.map(function(h){return React.createElement("div",{key:h.num,className:"prow"},
                  React.createElement("span",{className:"pn"},h.num+". kuca"),
                  React.createElement("span",{className:"pv"},h.sign+" "+h.deg+"\u00B0")
                );})
              )
            ),
            // Aspects - split positive/negative
            React.createElement("div",{style:{marginTop:"9px"}},
              React.createElement("div",{className:"ct"},"Pozitivni Aspekti"),
              React.createElement("div",{className:"asplist"},
                s.ch.aspects.filter(function(a){return POSITIVE_ASP.indexOf(a.aspect)>=0;}).slice(0,15).map(function(a,i){
                  var cl=a.aspect==="Konjunkcija"?"ac0":a.aspect==="Trigon"?"at":"as";
                  return React.createElement("div",{key:"p"+i,className:cl},a.p1+" "+a.aspect+" "+a.p2+" ",React.createElement("span",{style:{opacity:.5}},"(orb "+a.orb+"\u00B0)"));
                })
              ),
              React.createElement("div",{className:"ct",style:{marginTop:"8px"}},"Izazovni Aspekti"),
              React.createElement("div",{className:"asplist"},
                s.ch.aspects.filter(function(a){return POSITIVE_ASP.indexOf(a.aspect)<0;}).slice(0,15).map(function(a,i){
                  var cl=a.aspect==="Opozicija"?"ao":a.aspect==="Kvadrat"?"aq":"ax";
                  return React.createElement("div",{key:"n"+i,className:cl},a.p1+" "+a.aspect+" "+a.p2+" ",React.createElement("span",{style:{opacity:.5}},"(orb "+a.orb+"\u00B0)"));
                })
              )
            )
          ),
          // TRANSITS
          s.transits&&s.transits.length>0&&React.createElement("div",{className:"card",style:{marginTop:"8px"}},
            React.createElement("div",{className:"ct"},"Trenutni Tranziti ("+s.transits.length+")"),
            s.transits[0].natalPlanet
              ?React.createElement("div",{className:"asplist"},
                s.transits.map(function(t,i){
                  var isPoz=POSITIVE_ASP.indexOf(t.aspect)>=0;
                  return React.createElement("div",{key:i,className:isPoz?"at":"ao",style:{padding:"3px 0"}},
                    t.planet+" "+t.aspect+" "+t.natalPlanet+(t.house?" ("+t.house+". kuca)":"")+" ",
                    React.createElement("span",{style:{opacity:.5}},"orb "+t.orb+"\u00B0")
                  );
                })
              )
              :React.createElement("div",{className:"pgrid"},
                s.transits.map(function(t,i){
                  return React.createElement("div",{key:i,className:"prow",style:{borderLeft:"2px solid var(--gd)"}},
                    React.createElement("span",{className:"pn"},t.planet+(t.retrograde?" \u211E":"")),
                    React.createElement("span",{className:"pv"},t.sign+" "+t.deg+"\u00B0")
                  );
                })
              )
          ),
          React.createElement("button",{className:"btn bgd bfull",onClick:function(){if(s.chStale){toast2("Prvo preračunaj horoskop — podaci su izmenjeni.");return;}doGen(idx);},disabled:busy||s.chStale},
            s.status==="generating"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Generisem u pozadini..."):s.chStale?"Prvo preračunaj horoskop":"Generiši Analizu"
          ),
          (s.status!=="done"&&s.status!=="generating")&&(s.parsed||s.paste.trim()||s.client.ime||s.client.datum||s.client.vreme||s.client.mesto||s.hasPart||s.partner.ime||s.partner.datum)&&React.createElement("button",{className:"btn bol bfull",style:{marginTop:"8px"},onClick:function(){if(window.confirm("Da li si sigurna? Svi uneti i izracunati podaci ce biti obrisani i ekran ce se vratiti na pocetno stanje.")){upSlot(idx,function(){return emptySlot();});}}},"✖ Ocisti i pocni ispocetka")
        ),
      // ANALYSIS OUTPUT
      (s.analysis||s.status==="generating")&&React.createElement("div",{style:{marginTop:"12px"}},
        React.createElement("div",{className:"ct",style:{marginBottom:"8px"}},"Gotova Analiza"),
        ch.length>0&&React.createElement(ChunkTracker,{ch:ch,ci:s.copyIdx,setCi:function(i){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:i});});}}),
        s.status==="generating"
          ?React.createElement(GeneratingProgress,{startedAt:s.genStartedAt,statusText:s.analysis,onForceCheck:function(){forceCheckAnaliza(idx);},onCancel:function(skip){cancelStuckAnaliza(idx,skip);}})
          :React.createElement(React.Fragment,null,
            // PRE-SEND VIDLJIV WARNING (Marko 9.6.: "isti problemi svaki dan")
            // Backend prepend-uje "[UPOZORENJE..." u tekst kad detektuje issues
            // (Q&A skipped, no_closing, english leak). Bez vidljivog banner-a
            // Suzana to ne primeti - kopira ceo tekst klijentu pa onda primeti.
            // Crveni banner: jasno pre nego sto klikne Kopiraj.
            (/^\[UPOZORENJE/.test(s.analysis||"")||s.qaWarn)&&React.createElement("div",{style:{padding:"10px 12px",margin:"8px 0",background:"rgba(220,80,80,.15)",border:"1px solid rgba(220,80,80,.5)",borderRadius:"8px",color:"#ffb0b0",fontSize:"13px",lineHeight:1.4}},
              React.createElement("strong",null,"⚠ Proveri pre slanja klijentu!"),
              /^\[UPOZORENJE/.test(s.analysis||"")&&React.createElement("div",{style:{marginTop:"4px",fontSize:"12px"}},(s.analysis.match(/^\[UPOZORENJE[^\]]*\]/)||[""])[0].replace(/^\[UPOZORENJE:?\s*/,"").replace(/\]$/,"")),
              s.qaWarn&&React.createElement("div",{style:{marginTop:"4px",fontSize:"12px"}},"AI je odgovorio na priblizno "+s.qaWarn+" pitanja klijenta. Proveri sekciju \"Odgovori na tvoja pitanja\" pre slanja — moguce je da nedostaje neko pitanje.")
            ),
            React.createElement("div",{className:"aout"},s.analysis)
          ),
        React.createElement("div",{className:"abar"},
          s.copyIdx<ch.length
            ?React.createElement("button",{className:"btn bgd",style:{flex:1,fontSize:"12px"},onClick:function(){doCopy(ch[s.copyIdx],"Dio "+(s.copyIdx+1)+"/"+ch.length);upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:Math.min(sl.copyIdx+1,ch.length)});});}},"Kopiraj "+(s.copyIdx+1)+"/"+ch.length)
            :React.createElement("button",{className:"btn bol bsm",onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:0});});}},"Ponovi"),
          React.createElement("button",{className:"btn bol bsm",disabled:s.copyIdx===0,onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:Math.max(0,sl.copyIdx-1)});});}},"<"),
          React.createElement("button",{className:"btn bol bsm",disabled:s.copyIdx>=ch.length-1,onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:Math.min(ch.length-1,sl.copyIdx+1)});});}},">" ),
          React.createElement("button",{className:"btn bol bsm",onClick:function(){cpText(s.analysis);toast2("Sve kopirano!");}},"\u0041ll"),
          React.createElement("button",{className:"btn bol bsm",onClick:function(){if(s.chStale){toast2("Prvo prera\u010Dunaj horoskop \u2014 podaci su izmenjeni.");return;}doGen(idx);},disabled:busy||s.chStale},"\u21BA")
        ),
        // NOVA ANALIZA dugme
        s.status==="done"&&React.createElement("button",{className:"btn bol bfull",style:{marginTop:"12px"},onClick:function(){upSlot(idx,function(){return emptySlot();});}},"\u21BB Nova analiza")
      )
    );
  }

  // SPLASH SCREEN -------------------------------------------------------------
  if(showSplash){
    return React.createElement(React.Fragment,null,
      React.createElement("style",null,CSS),
      React.createElement("div",{className:"splash"},
        React.createElement("div",{className:"splash-content"},
          React.createElement(Logo,{size:72}),
          React.createElement("div",{className:"splash-title"},"Astro Balkan"),
          React.createElement("div",{style:{display:"inline-block",position:"relative"}},
            React.createElement("div",{className:"splash-text"},"Softver koji koristi NASA preciznost")
          )
        )
      )
    );
  }

  // SITE PASSWORD ------------------------------------------------------------
  if(!siteAccess){
    return React.createElement(React.Fragment,null,
      React.createElement("style",null,CSS),
      React.createElement("div",{className:"lwrap"},
        React.createElement("div",{className:"lcard"},
          React.createElement("div",{className:"llogo"},
            React.createElement(Logo,{size:56}),
            React.createElement("h1",{style:{marginTop:"10px"}},"Astro Balkan"),
            React.createElement("p",null,"Profesionalni Astrološki Alat")
          ),
          React.createElement("div",{className:"ldiv"}),
          React.createElement("div",{style:{textAlign:"center",marginBottom:"14px",fontSize:"12px",color:"var(--mt)"}},"Unesite pristupnu lozinku"),
          React.createElement("div",{className:"lfld"},
            React.createElement("label",null,"Lozinka"),
            React.createElement("input",{type:"password",value:sitePw,onChange:function(e){setSitePw(e.target.value);setSitePwErr("");},placeholder:"\u2022\u2022\u2022\u2022",style:{textAlign:"center",fontSize:"18px",letterSpacing:"4px"},onKeyDown:function(e){if(e.key==="Enter"){if(sitePw==="2026"){localStorage.setItem("site_access","true");setSiteAccess(true);}else{setSitePwErr("Pogresna lozinka.");}}}})
          ),
          sitePwErr&&React.createElement("div",{className:"lerr"},sitePwErr),
          React.createElement("button",{className:"lbtn",onClick:function(){if(sitePw==="2026"){localStorage.setItem("site_access","true");setSiteAccess(true);}else{setSitePwErr("Pogresna lozinka.");}}},"Pristupi"),
          React.createElement("div",{style:{textAlign:"center",marginTop:"14px",fontSize:"11px",color:"var(--mt)",letterSpacing:"2px",opacity:".6"}},"\u2726 \u2727 \u2726")
        )
      )
    );
  }

  // LOGIN --------------------------------------------------------------------
  if(!user){
    return React.createElement(React.Fragment,null,
      React.createElement("style",null,CSS),
      toast&&React.createElement("div",{className:"toast"},toast),
      React.createElement("div",{className:"lwrap"},
        React.createElement("div",{className:"lcard"},
          React.createElement("div",{className:"llogo"},
            React.createElement(Logo,{size:56}),
            React.createElement("h1",{style:{marginTop:"10px"}},"Astro Balkan"),
            React.createElement("p",null,"Profesionalni Astrološki Alat"),
            React.createElement("p",{style:{fontFamily:"'Marcellus',serif",fontSize:"14px",color:"#c9a84c",marginTop:"8px",letterSpacing:"1px",textTransform:"none"}},"Softver koji ima NASA preciznost")
          ),
          React.createElement("div",{className:"ldiv"}),
          lm!=="verify"&&lm!=="forgot"&&React.createElement("div",{className:"ltabs"},
            React.createElement("button",{className:"ltab "+(lm==="login"?"on":""),onClick:function(){setLm("login");setLerr("");setLsuc("");}},"\u0050rijava"),
            React.createElement("button",{className:"ltab "+(lm==="register"?"on":""),onClick:function(){setLm("register");setLerr("");setLsuc("");}},"\u004eapravi Nalog")
          ),
          lm==="login"&&React.createElement(React.Fragment,null,
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Email"),React.createElement("input",{type:"email",value:lEmail,onChange:function(e){setLEmail(e.target.value);},placeholder:"vas@email.com",onKeyDown:function(e){if(e.key==="Enter")doLogin();}})),
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Lozinka"),React.createElement("input",{type:"password",value:lPw,onChange:function(e){setLPw(e.target.value);},placeholder:"••••••••",onKeyDown:function(e){if(e.key==="Enter")doLogin();}})),
            lerr&&React.createElement("div",{className:"lerr"},lerr),
            lsuc&&React.createElement("div",{className:"lsuc"},lsuc),
            React.createElement("button",{className:"lbtn",onClick:doLogin},"Prijavi Se"),
            React.createElement("button",{className:"llink",onClick:function(){setLm("forgot");setLerr("");setFStep(1);}},"\u005aaboravili lozinku?")
          ),
          lm==="register"&&React.createElement(React.Fragment,null,
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Vaše Ime"),React.createElement("input",{value:rName,onChange:function(e){setRName(e.target.value);},placeholder:"Ime i prezime"})),
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Email"),React.createElement("input",{type:"email",value:rEmail,onChange:function(e){setREmail(e.target.value);},placeholder:"vas@email.com"})),
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Lozinka"),React.createElement("input",{type:"password",value:rPw,onChange:function(e){setRPw(e.target.value);},placeholder:"Min. 6 znakova"})),
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Potvrdi Lozinku"),React.createElement("input",{type:"password",value:rPw2,onChange:function(e){setRPw2(e.target.value);},placeholder:"Ponovi lozinku",onKeyDown:function(e){if(e.key==="Enter")doRegister();}})),
            lerr&&React.createElement("div",{className:"lerr"},lerr),
            React.createElement("button",{className:"lbtn",onClick:doRegister},"Nastavi")
          ),
          lm==="verify"&&React.createElement(React.Fragment,null,
            React.createElement("div",{style:{textAlign:"center",marginBottom:"10px",fontSize:"13px",color:"var(--mt)",lineHeight:"1.6"}},"Verifikacioni kod je poslan na email."),
            lsuc&&React.createElement("div",{className:"lsuc"},lsuc),
            React.createElement("div",{className:"lfld"},React.createElement("label",null,"Unesite Kod iz Emaila"),React.createElement("input",{value:entCode,onChange:function(e){setEntCode(e.target.value);},placeholder:"6-cifreni kod",style:{letterSpacing:"4px",textAlign:"center",fontSize:"18px"},onKeyDown:function(e){if(e.key==="Enter")doVerify();}})),
            lerr&&React.createElement("div",{className:"lerr"},lerr),
            React.createElement("button",{className:"lbtn",onClick:doVerify},"Potvrdi Registraciju"),
            React.createElement("button",{className:"llink",onClick:function(){setLm("register");setLerr("");}},"Nazad")
          ),
          lm==="forgot"&&React.createElement(React.Fragment,null,
            React.createElement("div",{style:{textAlign:"center",marginBottom:"14px",fontSize:"12px",color:"var(--mt)",lineHeight:"1.6"}},fStep===1?"Unesite email za reset.":"Unesite reset kod i novu lozinku."),
            fStep===1&&React.createElement(React.Fragment,null,
              React.createElement("div",{className:"lfld"},React.createElement("label",null,"Email"),React.createElement("input",{type:"email",value:fEmail,onChange:function(e){setFEmail(e.target.value);},placeholder:"vas@email.com",onKeyDown:function(e){if(e.key==="Enter")doForgot1();}})),
              lerr&&React.createElement("div",{className:"lerr"},lerr),
              React.createElement("button",{className:"lbtn",onClick:doForgot1},"Generiši Reset Kod")
            ),
            fStep===2&&React.createElement(React.Fragment,null,
              React.createElement("div",{style:{textAlign:"center",marginBottom:"10px",fontSize:"12px",color:"var(--grn)",lineHeight:"1.6"}},"Kod je poslan na email!"),
              React.createElement("div",{className:"lfld"},React.createElement("label",null,"Reset Kod iz Emaila"),React.createElement("input",{value:fCode,onChange:function(e){setFCode(e.target.value);},style:{letterSpacing:"3px",textAlign:"center"}})),
              React.createElement("div",{className:"lfld"},React.createElement("label",null,"Nova Lozinka"),React.createElement("input",{type:"password",value:fNewPw,onChange:function(e){setFNewPw(e.target.value);},placeholder:"Min. 6 znakova",onKeyDown:function(e){if(e.key==="Enter")doForgot2();}})),
              lerr&&React.createElement("div",{className:"lerr"},lerr),
              React.createElement("button",{className:"lbtn",onClick:doForgot2},"Promijeni Lozinku")
            ),
            React.createElement("button",{className:"llink",onClick:function(){setLm("login");setLerr("");setFStep(1);}},"Nazad na prijavu")
          ),
          React.createElement("div",{style:{textAlign:"center",marginTop:"14px",fontSize:"11px",color:"var(--mt)",letterSpacing:"2px",opacity:".6"}},"\u2726 \u2727 \u2726")
        )
      )
    );
  }

  // COUNTRY SELECT -----------------------------------------------------------
  if(showCtr){
    return React.createElement(React.Fragment,null,
      React.createElement("style",null,CSS),
      React.createElement("div",{className:"lwrap"},
        React.createElement("div",{className:"lcard"},
          React.createElement("div",{className:"llogo"},React.createElement(Logo,{size:50}),React.createElement("h1",{style:{marginTop:"8px",fontSize:"26px"}},"Odaberi Regiju"),React.createElement("p",null,"Za koje trziste radis?")),
          React.createElement("div",{className:"ldiv"}),
          React.createElement("div",{className:"csel"},
            React.createElement("button",{className:"cbtn",onClick:function(){selectCtr("sr");}},React.createElement("span",{className:"cflag"},"\uD83C\uDDF7\uD83C\uDDF8"),React.createElement("div",{className:"cname"},"Srbija"),React.createElement("div",{className:"csub"},"Astrolog Suzana")),
            React.createElement("button",{className:"cbtn",onClick:function(){selectCtr("hr");}},React.createElement("span",{className:"cflag"},"\uD83C\uDDED\uD83C\uDDF7"),React.createElement("div",{className:"cname"},"Hrvatska"),React.createElement("div",{className:"csub"},"Astrolog Marija"))
          )
        )
      )
    );
  }

  // MAIN ---------------------------------------------------------------------
  var navItems=[
    {id:"a1",l:"Analiza 1",icon:"\u2726"},{id:"a2",l:"Analiza 2",icon:"\u2726"},{id:"a3",l:"Analiza 3",icon:"\u2726"},{id:"baza",l:"Baza",icon:"\uD83D\uDCC1"},
    {id:"downsell1",l:"Downsell 1",icon:"\u21BB"},{id:"downsell2",l:"Downsell 2",icon:"\u21BB"},{id:"downsell3",l:"Downsell 3",icon:"\u21BB"},{id:"prompt",l:"Prompt",icon:"\u2699"},
    {id:"pitanja1",l:"D. Pitanja 1",icon:"\u2753"},{id:"pitanja2",l:"D. Pitanja 2",icon:"\u2753"},{id:"pitanja3",l:"D. Pitanja 3",icon:"\u2753"},
    {id:"prijava",l:"Prijavi problem",icon:"\ud83d\udce3"}
  ];
  if(user.role==="admin")navItems.push({id:"admin",l:"Admin",icon:"\uD83D\uDC64"});

  return React.createElement(React.Fragment,null,
    React.createElement("style",null,CSS),
    React.createElement("div",{className:"app"},
      // HEADER
      React.createElement("div",{className:"hdr"},
        React.createElement("div",{className:"hdr-top"},
          React.createElement("div",{className:"hbrand"},React.createElement(Logo,{size:40})),
          React.createElement("div",{className:"huser"},
            user.role==="admin"&&React.createElement("span",{className:"abadge"},"ADMIN"),
            React.createElement("span",null,country==="hr"?"\uD83C\uDDED\uD83C\uDDF7":"\uD83C\uDDF7\uD83C\uDDF8"),
            React.createElement("span",null,user.name),
            React.createElement("button",{className:"hlout",style:{fontSize:"9px",padding:"3px 8px"},onClick:function(){setShowCtr(true);}},"\uD83C\uDF0D"),
            React.createElement("button",{className:"hlout",onClick:doLogout},"Odjava")
          )
        )
      ),

      // CONTENT

      // SLOTS
      ["a1","a2","a3"].indexOf(tab)>=0&&React.createElement("div",{className:"sec"},
        React.createElement("div",{className:"stitle",style:{justifyContent:"center"}},React.createElement("span",null,"Analiza "+tab[1]),React.createElement("span",{style:{fontSize:"14px",color:"var(--gd2)",fontWeight:400,fontStyle:"italic",letterSpacing:"1px"}}," \u00B7 NASA preciznost")),
        SlotView({idx:parseInt(tab[1])-1})
      ),

      // DOWNSELL
      ["downsell1","downsell2","downsell3"].indexOf(tab)>=0&&(function(){
        var dsIdx=parseInt(tab.slice(-1))-1;
        var ds=dsSlots[dsIdx];
        var dsMatches=(function(){
          if(!ds.clientName||ds.clientId)return [];
          var q=normSearch(ds.clientName.trim());
          if(!q)return [];
          var starts=[],contains=[];
          clientsCache.forEach(function(c){
            if(!c.name)return;
            var n=normSearch(c.name);
            if(n.indexOf(q)===0)starts.push(c);
            else if(n.indexOf(q)>0)contains.push(c);
          });
          return starts.concat(contains).slice(0,20);
        })();
        return React.createElement("div",{className:"sec"},
          React.createElement("div",{className:"stitle"},"Downsell "+(dsIdx+1)),
          React.createElement("div",{className:"card card-hi"},
            React.createElement("div",{className:"ct"},"Generiši Analizu Perioda"),
            React.createElement("p",{style:{fontSize:"12px",color:"var(--mt)",marginBottom:"10px",lineHeight:"1.7"}},"Ako je klijent vec u bazi, izaberi ga iz liste i istorijat ce se automatski povuci. Inace nalepi prethodnu analizu rucno."),
            React.createElement("div",{className:"fld",style:{position:"relative"}},
              React.createElement("label",null,"Ime klijenta"),
              React.createElement("input",{value:ds.clientName,onChange:function(e){var v=e.target.value;upDs(dsIdx,function(s){return Object.assign({},s,{clientName:v,clientId:null});});loadClients();},placeholder:"Npr. Karolina"}),
              dsMatches.length>0&&React.createElement("div",{style:{position:"absolute",top:"100%",left:0,right:0,background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"6px",marginTop:"2px",zIndex:10,maxHeight:"200px",overflowY:"auto"}},
                dsMatches.map(function(c){return React.createElement("div",{key:c.id,style:{padding:"8px 10px",cursor:"pointer",borderBottom:"1px solid var(--bd)",fontSize:"12px"},onClick:function(){upDs(dsIdx,function(s){return Object.assign({},s,{clientName:c.name,clientBirthDate:c.birth_date||"",clientId:c.id});});toast2("Klijent izabran - istorijat ce se povuci automatski");}},
                  React.createElement("div",{style:{fontWeight:600,color:"var(--gd2)"}},c.name),
                  React.createElement("div",{style:{fontSize:"10px",color:"var(--mt)"}},(c.birth_date?fmtDMYFromISO(c.birth_date):"bez datuma")+(c.birth_place?" \u00B7 "+c.birth_place:"")+" \u00B7 "+(c.total_count||0)+" analiza")
                );})
              )
            ),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Datum rodjenja klijenta (za uparivanje)"),React.createElement(DateInput3,{value:ds.clientBirthDate,onChange:function(v){upDs(dsIdx,function(s){return Object.assign({},s,{clientBirthDate:v,clientId:null});});}})),
            ds.clientId&&React.createElement("div",{style:{padding:"8px 10px",background:"rgba(220,180,80,0.1)",borderLeft:"3px solid var(--gd2)",borderRadius:"4px",marginBottom:"10px",fontSize:"11px",color:"var(--mt)"}},"\u2713 Klijent prepoznat. Istorijat (sve prethodne analize, downsell, pitanja) ce se automatski povuci pri generisanju."),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Prethodna analiza"+(ds.clientId?" (opciono - istorijat se povlaci automatski)":"")),React.createElement("textarea",{value:ds.paste,onChange:function(e){var v=e.target.value;upDs(dsIdx,function(s){return Object.assign({},s,{paste:v});});},style:{minHeight:"110px"},placeholder:ds.clientId?"Opciono - mozes ostaviti prazno":"Nalepi prethodnu analizu klijenta..."})),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Dodatna pitanja klijenta (opciono)"),React.createElement("textarea",{value:ds.pitanja,onChange:function(e){var v=e.target.value;upDs(dsIdx,function(s){return Object.assign({},s,{pitanja:v});});},placeholder:"Upisi pitanja klijenta ako ih ima...",style:{minHeight:"60px"}})),
            React.createElement("button",{className:"btn bgd bfull",onClick:function(){doDsGen(dsIdx);},disabled:ds.st==="generating"||(!ds.paste.trim()&&!ds.clientId)},
              ds.st==="generating"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Generisem..."):"Generiši Analizu Perioda"
            )
          ),
          (ds.an||ds.st==="generating")&&React.createElement(React.Fragment,null,
            React.createElement(ChunkTracker,{ch:getChunks(ds.an),ci:ds.ci,setCi:function(fn){upDs(dsIdx,function(s){return Object.assign({},s,{ci:typeof fn==="function"?fn(s.ci):fn});});}}),
            ds.st==="generating"
              ?React.createElement(GeneratingProgress,{startedAt:ds.genStartedAt,statusText:ds.an,onCancel:function(skip){cancelStuckDs(dsIdx,skip);}})
              :React.createElement("div",{className:"aout"},ds.an),
            React.createElement("div",{className:"abar"},
              ds.ci<getChunks(ds.an).length
                ?React.createElement("button",{className:"btn bgd",style:{flex:1,fontSize:"12px"},onClick:function(){var ch=getChunks(ds.an);doCopy(ch[ds.ci],"Dio "+(ds.ci+1)+"/"+ch.length);upDs(dsIdx,function(s){return Object.assign({},s,{ci:Math.min(s.ci+1,ch.length)});});}},"Kopiraj "+(ds.ci+1)+"/"+getChunks(ds.an).length)
                :React.createElement("button",{className:"btn bol bsm",onClick:function(){upDs(dsIdx,function(s){return Object.assign({},s,{ci:0});});}},"Ponovi"),
              React.createElement("button",{className:"btn bol bsm",disabled:ds.ci===0,onClick:function(){upDs(dsIdx,function(s){return Object.assign({},s,{ci:Math.max(0,s.ci-1)});});}},"<"),
              React.createElement("button",{className:"btn bol bsm",disabled:ds.ci>=getChunks(ds.an).length-1,onClick:function(){upDs(dsIdx,function(s){return Object.assign({},s,{ci:Math.min(getChunks(ds.an).length-1,s.ci+1)});});}},">" ),
              React.createElement("button",{className:"btn bol bsm",onClick:function(){cpText(ds.an);toast2("Sve kopirano!");}},"Sve")
            ),
            ds.st==="done"&&React.createElement("button",{className:"btn bol bfull",style:{marginTop:"10px"},onClick:function(){upDs(dsIdx,function(){return{paste:"",pitanja:"",clientName:"",clientBirthDate:"",clientId:null,an:"",st:"idle",ci:0,jobId:null};});}},"\u21BB Nova analiza")
          )
        );
      })(),

      // PITANJA
      ["pitanja1","pitanja2","pitanja3"].indexOf(tab)>=0&&(function(){
        var pqIdx=parseInt(tab.slice(-1))-1;
        var pq=pqSlots[pqIdx];
        var pqMatches=(function(){
          if(!pq.clientName||pq.clientId)return [];
          var q=normSearch(pq.clientName.trim());
          if(!q)return [];
          var starts=[],contains=[];
          clientsCache.forEach(function(c){
            if(!c.name)return;
            var n=normSearch(c.name);
            if(n.indexOf(q)===0)starts.push(c);
            else if(n.indexOf(q)>0)contains.push(c);
          });
          return starts.concat(contains).slice(0,20);
        })();
        return React.createElement("div",{className:"sec"},
          React.createElement("div",{className:"stitle"},"D. Pitanja "+(pqIdx+1)),
          React.createElement("div",{className:"card card-hi"},
            React.createElement("p",{style:{fontSize:"12px",color:"var(--mt)",marginBottom:"10px",lineHeight:"1.7"}},"Ako je klijent vec u bazi, izaberi ga iz liste i istorijat ce se automatski povuci. Inace nalepi prethodnu analizu rucno."),
            React.createElement("div",{className:"fld",style:{position:"relative"}},
              React.createElement("label",null,"Ime klijenta"),
              React.createElement("input",{value:pq.clientName,onChange:function(e){var v=e.target.value;upPq(pqIdx,function(s){return Object.assign({},s,{clientName:v,clientId:null});});loadClients();},placeholder:"Npr. Karolina"}),
              pqMatches.length>0&&React.createElement("div",{style:{position:"absolute",top:"100%",left:0,right:0,background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"6px",marginTop:"2px",zIndex:10,maxHeight:"200px",overflowY:"auto"}},
                pqMatches.map(function(c){return React.createElement("div",{key:c.id,style:{padding:"8px 10px",cursor:"pointer",borderBottom:"1px solid var(--bd)",fontSize:"12px"},onClick:function(){upPq(pqIdx,function(s){return Object.assign({},s,{clientName:c.name,clientBirthDate:c.birth_date||"",clientId:c.id});});toast2("Klijent izabran - istorijat ce se povuci automatski");}},
                  React.createElement("div",{style:{fontWeight:600,color:"var(--gd2)"}},c.name),
                  React.createElement("div",{style:{fontSize:"10px",color:"var(--mt)"}},(c.birth_date?fmtDMYFromISO(c.birth_date):"bez datuma")+(c.birth_place?" \u00B7 "+c.birth_place:"")+" \u00B7 "+(c.total_count||0)+" analiza")
                );})
              )
            ),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Datum rodjenja klijenta (za uparivanje)"),React.createElement(DateInput3,{value:pq.clientBirthDate,onChange:function(v){upPq(pqIdx,function(s){return Object.assign({},s,{clientBirthDate:v,clientId:null});});}})),
            pq.clientId&&React.createElement("div",{style:{padding:"8px 10px",background:"rgba(220,180,80,0.1)",borderLeft:"3px solid var(--gd2)",borderRadius:"4px",marginBottom:"10px",fontSize:"11px",color:"var(--mt)"}},"\u2713 Klijent prepoznat. Istorijat (sve prethodne analize, downsell, pitanja) ce se automatski povuci pri generisanju."),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Prethodna analiza klijenta"+(pq.clientId?" (opciono - istorijat se povlaci automatski)":"")),React.createElement("textarea",{value:pq.prev,onChange:function(e){var v=e.target.value;upPq(pqIdx,function(s){return Object.assign({},s,{prev:v});});},placeholder:pq.clientId?"Opciono - mozes ostaviti prazno":"Nalepi prethodnu analizu...",style:{minHeight:"100px"}})),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Dodatna pitanja klijenta"),React.createElement("textarea",{value:pq.quest,onChange:function(e){var v=e.target.value;upPq(pqIdx,function(s){return Object.assign({},s,{quest:v});});},placeholder:"Upisi pitanja klijenta...",style:{minHeight:"80px"}})),
            React.createElement("button",{className:"btn bgd bfull",onClick:function(){doPqGen(pqIdx);},disabled:pq.st==="generating"||(!pq.prev.trim()&&!pq.clientId)||!pq.quest.trim()},
              pq.st==="generating"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Generisem..."):"Generisi Odgovore"
            )
          ),
          (pq.an||pq.st==="generating")&&React.createElement(React.Fragment,null,
            React.createElement(ChunkTracker,{ch:getChunks(pq.an),ci:pq.ci,setCi:function(fn){upPq(pqIdx,function(s){return Object.assign({},s,{ci:typeof fn==="function"?fn(s.ci):fn});});}}),
            pq.st==="generating"
              ?React.createElement(GeneratingProgress,{startedAt:pq.genStartedAt,statusText:pq.an,onCancel:function(skip){cancelStuckPq(pqIdx,skip);}})
              :React.createElement("div",{className:"aout"},pq.an),
            React.createElement("div",{className:"abar"},
              pq.ci<getChunks(pq.an).length
                ?React.createElement("button",{className:"btn bgd",style:{flex:1,fontSize:"12px"},onClick:function(){var ch=getChunks(pq.an);doCopy(ch[pq.ci],"Dio "+(pq.ci+1)+"/"+ch.length);upPq(pqIdx,function(s){return Object.assign({},s,{ci:Math.min(s.ci+1,ch.length)});});}},"Kopiraj "+(pq.ci+1)+"/"+getChunks(pq.an).length)
                :React.createElement("button",{className:"btn bol bsm",onClick:function(){upPq(pqIdx,function(s){return Object.assign({},s,{ci:0});});}},"Ponovi"),
              React.createElement("button",{className:"btn bol bsm",disabled:pq.ci===0,onClick:function(){upPq(pqIdx,function(s){return Object.assign({},s,{ci:Math.max(0,s.ci-1)});});}},"<"),
              React.createElement("button",{className:"btn bol bsm",disabled:pq.ci>=getChunks(pq.an).length-1,onClick:function(){upPq(pqIdx,function(s){return Object.assign({},s,{ci:Math.min(getChunks(pq.an).length-1,s.ci+1)});});}},">" ),
              React.createElement("button",{className:"btn bol bsm",onClick:function(){cpText(pq.an);toast2("Sve kopirano!");}},"Sve")
            ),
            pq.st==="done"&&React.createElement("button",{className:"btn bol bfull",style:{marginTop:"10px"},onClick:function(){upPq(pqIdx,function(){return{prev:"",quest:"",clientName:"",clientBirthDate:"",clientId:null,an:"",st:"idle",ci:0,jobId:null};});}},"\u21BB Nova analiza")
          )
        );
      })(),

      // BAZA
      tab==="baza"&&React.createElement("div",{className:"sec"},
        React.createElement("div",{className:"stitle"},bazaView==="trash"?"🗑 Korpa":"Baza Analiza"),
        // Toggle: Aktivne / Korpa
        React.createElement("div",{style:{display:"flex",gap:"6px",marginBottom:"10px"}},
          React.createElement("button",{className:"tab "+(bazaView==="active"?"on":""),onClick:function(){setBazaView("active");}},"📁 Aktivne ("+analyses.length+")"),
          React.createElement("button",{className:"tab "+(bazaView==="trash"?"on":""),onClick:function(){setBazaView("trash");loadTrash();}},"🗑 Korpa"+(trashItems.length>0?" ("+trashItems.length+")":""))
        ),
        // KORPA view
        bazaView==="trash"&&(function(){
          if(trashItems.length===0)return React.createElement("div",{className:"empty"},React.createElement("div",{className:"ico"},"🗑"),React.createElement("p",null,"Korpa je prazna."));
          return React.createElement(React.Fragment,null,
            React.createElement("p",{style:{fontSize:"11px",color:"var(--mt)",marginBottom:"10px"}},trashItems.length+" obrisanih analiza. Mozes ih vratiti ili trajno obrisati."),
            trashItems.map(function(a){
              return React.createElement("div",{key:a.id,className:"acard",style:{opacity:0.85}},
                React.createElement("div",{className:"acard-top"},
                  React.createElement("div",{className:"acard-name"},(a.clientName||"Nepoznat")+" · "+(a.jobType||"analiza")),
                  React.createElement("div",{className:"acard-date",style:{color:"var(--red)"}},"obrisano: "+a.deletedAt)
                ),
                (a.ownerName||a.owner)&&React.createElement("div",{style:{fontSize:"9.5px",color:"var(--gd)",marginTop:"2px",fontStyle:"italic"}},"Generisao: "+(a.ownerName||a.owner)),
                React.createElement("div",{className:"acard-prev"},fmtText(a.analysis||"")),
                React.createElement("div",{style:{display:"flex",gap:"6px",marginTop:"8px"}},
                  React.createElement("button",{className:"btn bgd bsm",onClick:function(e){
                    e.stopPropagation();
                    fetchSafe(API+"/api/analyses/"+a.id+"/restore",{method:"POST",headers:{"x-user-id":user.id||"","x-user-role":user.role||""}})
                      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
                      .then(function(res){
                        if(!res.ok){toast2(res.j&&res.j.error?res.j.error:"Greska pri vracanju.");return;}
                        setTrashItems(function(prev){return prev.filter(function(x){return x.id!==a.id;});});
                        // Refresh aktivnih analiza
                        fetchSafe(API+"/api/analyses?limit=2000").then(function(r){return r.json();}).then(function(d){if(d.analyses)setAnalyses(d.analyses);}).catch(function(){});
                        toast2("Analiza vracena.");
                      }).catch(function(){toast2("Greska pri vracanju.");});
                  }},"↩ Vrati"),
                  React.createElement("button",{className:"btn brd bsm",onClick:function(e){
                    e.stopPropagation();
                    if(!window.confirm("Trajno obrisati ovu analizu? Ovo se NE moze opozvati."))return;
                    fetchSafe(API+"/api/analyses/"+a.id+"/permanent",{method:"DELETE",headers:{"x-user-id":user.id||"","x-user-role":user.role||""}})
                      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
                      .then(function(res){
                        if(!res.ok){toast2(res.j&&res.j.error?res.j.error:"Greska.");return;}
                        setTrashItems(function(prev){return prev.filter(function(x){return x.id!==a.id;});});
                        toast2("Trajno obrisano.");
                      }).catch(function(){toast2("Greska.");});
                  }},"🗑 Trajno obrisi")
                )
              );
            })
          );
        })(),
        // AKTIVNE - postojeci kod ide samo ako bazaView === "active"
        bazaView==="active"&&(function(){return React.createElement(React.Fragment,null,
        // Per-user statistika i filter (klik na pill = filtriraj listu po tom korisniku)
        (function(){
          var statsByUser={}; // key -> {key, name, total, analiza, downsell, pitanja}
          for(var i=0;i<myAnalyses.length;i++){
            var a=myAnalyses[i];
            var key=a.ownerName||a.owner||"(nepoznato)";
            if(!statsByUser[key])statsByUser[key]={key:key,name:key,total:0,analiza:0,downsell:0,pitanja:0};
            statsByUser[key].total++;
            var t=(a.types&&a.types[0])||"analiza";
            if(t==="downsell")statsByUser[key].downsell++;
            else if(t==="pitanja")statsByUser[key].pitanja++;
            else statsByUser[key].analiza++;
          }
          var pills=Object.keys(statsByUser).map(function(k){return statsByUser[k];}).sort(function(x,y){return y.total-x.total;});
          if(pills.length===0)return null;
          return React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"10px"}},
            pills.map(function(p){
              var active=bazaUserFilter===p.key;
              return React.createElement("button",{
                key:p.key,
                className:"btn bsm "+(active?"bgd":"bol"),
                style:{fontSize:"11px",padding:"4px 8px",lineHeight:"1.2",textAlign:"left"},
                onClick:function(){setBazaUserFilter(active?"":p.key);},
                title:active?"Klikni da uklonis filter":"Klikni za filter po "+p.name
              },
                React.createElement("div",{style:{fontWeight:600}},"\uD83D\uDC64 "+p.name+" "+p.total),
                React.createElement("div",{style:{fontSize:"9.5px",opacity:0.85,marginTop:"1px"}},p.analiza+" analiza \u00B7 "+p.downsell+" downsell \u00B7 "+p.pitanja+" pitanja")
              );
            })
          );
        })(),
        React.createElement("div",{className:"fld",style:{marginBottom:"6px"}},React.createElement("input",{value:bazaSearch,onChange:function(e){setBazaSearch(e.target.value);},placeholder:"Pretrazi po imenu, datumu, znaku...",className:"sel-input"})),
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:"6px",marginBottom:"10px"}},
          React.createElement("label",{style:{fontSize:"10px",color:"var(--mt)"}},"Datum:"),
          React.createElement("input",{type:"date",value:bazaDateFilter,onChange:function(e){setBazaDateFilter(e.target.value);},style:{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"6px",padding:"5px 8px",color:"var(--tx)",fontFamily:"'Jost',sans-serif",fontSize:"12px"}}),
          bazaDateFilter&&React.createElement("button",{className:"btn bol bsm",onClick:function(){setBazaDateFilter("");}},"\u2715")
        ),
        (function(){
          var q=bazaSearch.toLowerCase().trim();
          var filtered=myAnalyses;
          if(bazaUserFilter)filtered=filtered.filter(function(a){return(a.ownerName||a.owner||"(nepoznato)")===bazaUserFilter;});
          if(q)filtered=filtered.filter(function(a){var bd=a.birthDate||"";var bdSr=bd?fmtDMY(new Date(bd)):"";return((a.clientName||"")+" "+(a.sign||"")+" "+(a.date||"")+" "+(a.mesto||"")+" "+bd+" "+bdSr).toLowerCase().indexOf(q)>=0;});
          if(bazaDateFilter){var dfSr=fmtDMY(new Date(bazaDateFilter));filtered=filtered.filter(function(a){return(a.rawDate||"")===bazaDateFilter||(a.date||"").startsWith(dfSr);});}
          var dateLabel=bazaDateFilter?fmtDMY(new Date(bazaDateFilter)):"";
          // Razlika izmedju 3 stanja (Suzana 11.6. prijava bb8e3bb1: vidi
          // "Nema analiza" iako ih ima 1477 u DB-u - fetch je tiho padao):
          // 1) bazaLoading \u2192 "Ucitavam..."
          // 2) bazaErr && nista nije ucitano \u2192 "Server se budi" sa Osvezi
          // 3) inace \u2192 originalna poruka
          var showLoading=bazaLoading&&filtered.length===0&&!(q||bazaDateFilter||bazaUserFilter);
          var showServerErr=bazaErr&&analyses.length===0&&!(q||bazaDateFilter||bazaUserFilter);
          return filtered.length===0
            ?(showLoading
              ?React.createElement("div",{className:"empty"},React.createElement("div",{className:"ico"},"\u23F3"),React.createElement("p",null,"U\u010Ditavam Bazu..."))
              :showServerErr
                ?React.createElement("div",{className:"empty"},
                  React.createElement("div",{className:"ico"},"\u26A0"),
                  React.createElement("p",{style:{color:"#ffb0b0"}},"Server se budi - Baza trenutno nedostupna."),
                  React.createElement("p",{style:{fontSize:"11px",color:"var(--mt)",marginTop:"4px"}},"NE radi iste ljude ponovo - analize SU sacuvane, samo se ne ucitavaju. Klikni Osvezi za 30s."),
                  React.createElement("button",{className:"btn bgd bsm",style:{marginTop:"10px"},onClick:function(){
                    setBazaLoading(true);setBazaErr(false);
                    fetchWithRetry(API+"/api/analyses?limit=2000",{},{attempts:4}).then(function(r){return r.json();}).then(function(d){
                      setBazaLoading(false);setBazaErr(false);
                      if(d.analyses)setAnalyses(d.analyses);
                      if(typeof d.total==="number")setTotalAnalyses(d.total);
                    }).catch(function(){setBazaLoading(false);setBazaErr(true);});
                  }},"\u21BB Osve\u017Ei Bazu"))
                :React.createElement("div",{className:"empty"},React.createElement("div",{className:"ico"},"\uD83D\uDCC1"),React.createElement("p",null,(q||bazaDateFilter||bazaUserFilter)?"Nema rezultata":"Jos nema sacuvanih analiza.")))
            :React.createElement(React.Fragment,null,
              React.createElement("p",{style:{fontSize:"11px",color:"var(--mt)",marginBottom:"10px"}},filtered.length+(bazaUserFilter?" analiza od "+bazaUserFilter:bazaDateFilter?" analiza uradjeno "+dateLabel:q?" pronadjeno":(totalAnalyses>analyses.length?" od "+totalAnalyses+" analiza (prikazano poslednjih "+analyses.length+")":" analiza"))),
              filtered.map(function(a){
                return React.createElement("div",{key:a.id,className:"acard",onClick:function(){setViewAn(a);}},
                  React.createElement("div",{className:"acard-top"},
                    React.createElement("div",{className:"acard-name"},(a.clientName||"Nepoznat")+(a.sign?" \u00B7 "+a.sign:"")),
                    React.createElement("div",{className:"acard-date"},a.date)
                  ),
                  (a.ownerName||a.owner)&&React.createElement("div",{style:{fontSize:"9.5px",color:"var(--gd)",marginTop:"2px",fontStyle:"italic"}},"Generisao: "+(a.ownerName||a.owner)),
                  a.mesto&&React.createElement("div",{style:{fontSize:"10px",color:"var(--mt)",marginTop:"1px"}},a.mesto),
                  React.createElement("div",{className:"acard-prev"},fmtText(a.analysis||""))
                );
              })
            );
        })()
        );})()
      ),

      // PROMPT
      tab==="prompt"&&React.createElement("div",{className:"sec"},
        React.createElement("div",{className:"stitle"},"Promptovi"),
        React.createElement("div",{className:"tabs"},
          React.createElement("button",{className:"tab "+(editPr==="main"?"on":""),onClick:function(){setEditPr("main");}},"Glavni"),
          React.createElement("button",{className:"tab "+(editPr==="ds"?"on":""),onClick:function(){setEditPr("ds");}},"Downsell"),
          React.createElement("button",{className:"tab "+(editPr==="pitanja"?"on":""),onClick:function(){setEditPr("pitanja");}},"Pitanja")
        ),
        React.createElement("div",{style:{display:"flex",gap:"6px",marginBottom:"12px"}},
          React.createElement("span",{style:{fontSize:"11px",color:"var(--mt)",alignSelf:"center"}},"Regija:"),
          React.createElement("button",{className:"tab "+(country==="sr"?"on":""),onClick:function(){selectCtr("sr");}},"\uD83C\uDDF7\uD83C\uDDF8 Srbija"),
          React.createElement("button",{className:"tab "+(country==="hr"?"on":""),onClick:function(){selectCtr("hr");}},"\uD83C\uDDED\uD83C\uDDF7 Hrvatska")
        ),
        React.createElement("div",{className:"card"},
          React.createElement("div",{className:"ct"},editPr==="main"?"Glavni Prompt ("+astroName+")":editPr==="ds"?"Downsell Prompt":"Pitanja Prompt"),
          React.createElement("div",{className:"fld"},
            React.createElement("textarea",{value:custPr[country]&&custPr[country][editPr]?custPr[country][editPr]:"",onChange:function(e){if(user.role!=="admin")return;var val=e.target.value;setCustPr(function(p){var n=Object.assign({},p);n[country]=Object.assign({},n[country]);n[country][editPr]=val;return n;});},rows:12,placeholder:"Ostavi prazno za default prompt.",readOnly:user.role!=="admin"})
          ),
          user.role==="admin"
            ?React.createElement("div",{className:"abar"},
              React.createElement("button",{className:"btn bgd",onClick:function(){
                stoSet("custPr",custPr);
                fetchSafe(API+"/api/prompts",{method:"POST",headers:{"Content-Type":"application/json","x-user-role":"admin"},body:JSON.stringify({country:country,type:editPr,content:(custPr[country]&&custPr[country][editPr])||""})}).then(function(){toast2("Sacuvano u bazu!");}).catch(function(){toast2("Sacuvano lokalno.");});
              }},"\u0053acuvaj"),
              React.createElement("button",{className:"btn bol bsm",onClick:function(){setCustPr(function(p){var n=Object.assign({},p);n[country]=Object.assign({},n[country]);n[country][editPr]="";return n;});}},"\u0052eset")
            )
            :React.createElement("div",{style:{fontSize:"11px",color:"var(--mt)",marginTop:"8px"}},"Samo admin moze mijenjati promptove.")
        )
      ),

      // ADMIN
      tab==="admin"&&user.role==="admin"&&React.createElement("div",{className:"sec"},
        React.createElement("div",{className:"stitle"},"Admin Panel"),
        React.createElement("div",{className:"card card-hi"},
          React.createElement("div",{className:"ct"},"Dodaj Novu Korisnicu"),
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Ime"),React.createElement("input",{value:nuData.name,onChange:function(e){setNuData(function(p){return Object.assign({},p,{name:e.target.value});});},placeholder:"Ime i prezime"})),
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Email"),React.createElement("input",{value:nuData.email,onChange:function(e){setNuData(function(p){return Object.assign({},p,{email:e.target.value});});},placeholder:"email@example.com"})),
          React.createElement("div",{className:"r2"},
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Lozinka"),React.createElement("input",{type:"password",value:nuData.pw,onChange:function(e){setNuData(function(p){return Object.assign({},p,{pw:e.target.value});});}})),
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Regija"),
              React.createElement("select",{value:nuData.country,onChange:function(e){setNuData(function(p){return Object.assign({},p,{country:e.target.value});});},className:"sel-input"},
                React.createElement("option",{value:"sr"},"\uD83C\uDDF7\uD83C\uDDF8 Srbija"),
                React.createElement("option",{value:"hr"},"\uD83C\uDDED\uD83C\uDDF7 Hrvatska")
              )
            )
          ),
          React.createElement("button",{className:"btn bgd bfull",onClick:addAdminUser},"\u002B Dodaj")
        ),
        React.createElement("div",{className:"card"},
          React.createElement("div",{className:"ct"},"Korisnici ("+adminUsers.length+")"),
          adminUsers.map(function(u){
            return React.createElement("div",{key:u.id||u.email,className:"urow"},
              React.createElement("div",{className:"uav"},(u.name||"?")[0]),
              React.createElement("div",{style:{flex:1}},
                React.createElement("div",{style:{fontSize:"13px",fontWeight:500}},u.name," ",u.role==="admin"&&React.createElement("span",{className:"abadge",style:{fontSize:"8px",marginLeft:"4px"}},"ADMIN")," ",u.country==="hr"?"\uD83C\uDDED\uD83C\uDDF7":"\uD83C\uDDF7\uD83C\uDDF8"," ",!u.verified&&React.createElement("span",{style:{fontSize:"9px",color:"var(--red)"}},"(neverifikovan)")),
                React.createElement("div",{style:{fontSize:"10.5px",color:"var(--mt)",marginTop:"1px"}},u.email)
              ),
              u.id!==(user&&user.id)&&React.createElement("button",{className:"btn bsm brd",onClick:function(){deleteAdminUser(u.id);}},"Ukloni")
            );
          })
        )
      ),

      // PRIJAVA PROBLEMA
      tab==="prijava"&&React.createElement("div",{className:"sec"},
        React.createElement("div",{className:"stitle"},"📣 Prijavi problem"),
        React.createElement("div",{className:"card card-hi"},
          React.createElement("div",{style:{fontSize:"12px",color:"var(--mt)",lineHeight:1.5,marginBottom:"12px"}},"Opiši šta ne radi i (najbolje) zakači screenshot. Prijava stiže direktno na rešavanje — javićemo se čim sredimo."),
          React.createElement("div",{className:"fld"},
            React.createElement("label",null,"Gde se desio problem? (možeš označiti više)"),
            React.createElement("div",{className:"tabs"},
              ["Analiza 1","Analiza 2","Analiza 3","Downsell 1","Downsell 2","Downsell 3","Dodatna pitanja 1","Dodatna pitanja 2","Dodatna pitanja 3","Baza","Prompt","Drugo"].map(function(o){
                var on=repScreens.indexOf(o)>=0;
                return React.createElement("button",{key:o,type:"button",className:"tab "+(on?"on":""),onClick:function(){
                  setRepScreens(function(prev){return prev.indexOf(o)>=0?prev.filter(function(x){return x!==o;}):prev.concat([o]);});
                }},(on?"✓ ":"")+o);
              })
            )
          ),
          React.createElement("div",{className:"fld"},
            React.createElement("label",null,"Opis problema"),
            React.createElement("textarea",{value:repDesc,onChange:function(e){setRepDesc(e.target.value);},placeholder:"Npr. Unela sam vreme 18.30 ali ne računa podznak...",style:{minHeight:"110px"}})
          ),
          React.createElement("div",{className:"fld"},
            React.createElement("label",null,"Screenshot (slika ekrana)"),
            React.createElement("input",{type:"file",accept:"image/*",onChange:function(e){handleRepImage(e.target.files&&e.target.files[0]);},style:{fontSize:"12px",color:"var(--mt)",width:"100%"}})
          ),
          repImg&&React.createElement("div",{style:{marginBottom:"10px"}},
            React.createElement("img",{src:repImg,style:{maxWidth:"100%",borderRadius:"8px",border:"1px solid var(--bd)"}}),
            React.createElement("button",{className:"btn bol bsm",style:{marginTop:"6px"},onClick:function(){setRepImg(null);}},"Ukloni sliku")
          ),
          React.createElement("button",{className:"btn bgd bfull",style:{marginTop:"6px"},onClick:submitReport,disabled:repSending||!repDesc.trim()},
            repSending?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Šaljem..."):"Pošalji prijavu")
        ),
        user&&user.role==="admin"&&React.createElement("div",{style:{marginTop:"18px"}},
          React.createElement("div",{className:"ct"},"Prijave ("+repList.length+")"),
          repList.length===0&&React.createElement("div",{className:"empty"},React.createElement("div",{className:"ico"},"📭"),"Još nema prijava."),
          repList.map(function(rp){
            return React.createElement("div",{key:rp.id,className:"card",style:{borderColor:rp.status==="reseno"?"rgba(96,176,96,.35)":"var(--bd)"}},
              React.createElement("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"5px"}},
                React.createElement("span",{style:{fontSize:"12px",color:"var(--gd2)",fontWeight:600}},(rp.reporter_name||"radnica")+(rp.screen?" · "+rp.screen:"")),
                React.createElement("span",{className:"slst "+(rp.status==="reseno"?"stdone":"strun")},rp.status==="reseno"?"Rešeno":"Novo")
              ),
              React.createElement("div",{style:{fontSize:"12px",color:"var(--tx)",lineHeight:1.5,whiteSpace:"pre-wrap"}},rp.description),
              rp.image_url&&React.createElement("a",{href:rp.image_url,target:"_blank",rel:"noopener",style:{display:"inline-block",marginTop:"6px"}},React.createElement("img",{src:rp.image_url,style:{maxWidth:"160px",borderRadius:"6px",border:"1px solid var(--bd)"}})),
              React.createElement("div",{style:{display:"flex",gap:"6px",marginTop:"8px",alignItems:"center",flexWrap:"wrap"}},
                rp.github_issue_url&&React.createElement("a",{href:rp.github_issue_url,target:"_blank",rel:"noopener",className:"btn bol bsm"},"GitHub"),
                React.createElement("button",{className:"btn bsm "+(rp.status==="reseno"?"bol":"bgd"),onClick:function(){markReport(rp.id,rp.status==="reseno"?"novo":"reseno");}},rp.status==="reseno"?"Vrati u Novo":"Označi rešeno"),
                React.createElement("span",{style:{fontSize:"10px",color:"var(--mt)",marginLeft:"auto"}},rp.created_at?new Date(rp.created_at).toLocaleString("sr-RS"):"")
              )
            );
          })
        )
      ),

      // BOTTOM NAV
      React.createElement("nav",{className:"bnav"},
        navItems.map(function(n){
          var isActive=tab===n.id;
          var isGen=false,isDone=false;
          if(["a1","a2","a3"].indexOf(n.id)>=0){
            var sa=slots[parseInt(n.id[1])-1];
            isGen=sa.status==="generating";
            isDone=sa.status==="done"&&!!sa.analysis;
          }else if(n.id.indexOf("downsell")===0){
            var sd=dsSlots[parseInt(n.id.slice(-1))-1];
            isGen=sd.st==="generating";
            isDone=sd.st==="done"&&!!sd.an;
          }else if(n.id.indexOf("pitanja")===0){
            var sp=pqSlots[parseInt(n.id.slice(-1))-1];
            isGen=sp.st==="generating";
            isDone=sp.st==="done"&&!!sp.an;
          }
          var showRun=isGen&&!isActive;
          var showDone=isDone&&!isActive;
          return React.createElement("button",{key:n.id,className:"bnav-btn "+(isActive?"on":""),onClick:function(){setTab(n.id);}},
            React.createElement("span",{className:"bnav-ico"},n.icon,
              showRun&&React.createElement("span",{className:"ndot-run"}),
              !showRun&&showDone&&React.createElement("span",{className:"ndot-done"})
            ),
            React.createElement("span",{className:"bnav-lbl"},n.l)
          );
        })
      )
    ),

    // MODAL
    viewAn&&(function(){
      var cleanText=fmtText(viewAn.analysis||"");
      return React.createElement("div",{className:"modal-bg",onClick:function(){setViewAn(null);}},
        React.createElement("div",{className:"modal",onClick:function(e){e.stopPropagation();}},
          React.createElement("div",{className:"modal-title"},(viewAn.clientName||"Analiza")+" · "+viewAn.date),
          React.createElement("div",{className:"aout",style:{maxHeight:"60vh"}},cleanText),
          React.createElement("div",{className:"abar",style:{marginTop:"12px"}},
            React.createElement("button",{className:"btn bgd bsm",onClick:function(){cpText(cleanText);toast2("Kopirano!");}},"\uD83D\uDCCB Kopiraj"),
            viewAn.clientName&&viewAn.clientName!=="Downsell"&&viewAn.clientName!=="Pitanja"&&React.createElement("button",{className:"btn bpu bsm",onClick:function(){
              var name=viewAn.clientName;
              var all=analyses.filter(function(a){return a.clientName===name;});
              if(all.length<=1){cpText(cleanText);toast2("Kopirano 1 analiza!");}
              else{var txt=all.map(function(a){return fmtText(a.analysis||"");}).join("\n\n---\n\n");cpText(txt);toast2("Kopirano "+all.length+" analiza!");}
            }},"\uD83D\uDCCB Sve za "+((viewAn.clientName||"").split(" - ")[0]||"klijenta")),
            (user.role==="admin"||(viewAn.owner&&user.email&&viewAn.owner===user.email))&&React.createElement("button",{className:"btn brd bsm",onClick:function(){if(!window.confirm("Premestiti analizu u korpu? Mozes je vratiti kasnije iz Korpe."))return;var id=viewAn.id;fetchSafe(API+"/api/analyses/"+id,{method:"DELETE",headers:{"x-user-id":user.id||"","x-user-role":user.role||""}}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(res){if(!res.ok){toast2(res.j&&res.j.error?res.j.error:"Greska pri brisanju.");return;}setAnalyses(function(prev){var upd=prev.filter(function(a){return a.id!==id;});try{stoSet("analyses",upd.slice(0,50));}catch(e){}return upd;});setViewAn(null);toast2("Premesteno u korpu.");}).catch(function(){toast2("Greska pri brisanju.");});}},"🗑 U korpu"),
            React.createElement("button",{className:"btn bol bsm",onClick:function(){setViewAn(null);}},"\u005aatvori")
          )
        )
      );
    })(),

    overloadPrompt&&React.createElement("div",{className:"modal-bg",onClick:function(){setOverloadPrompt(null);}},
      React.createElement("div",{className:"modal",style:{maxWidth:"480px",margin:"auto"},onClick:function(e){e.stopPropagation();}},
        React.createElement("div",{className:"modal-title",style:{color:"#ffb84d"}},"⚠ DeepSeek trenutno nije dostupan"),
        React.createElement("p",{style:{fontSize:"13px",color:"var(--mt)",lineHeight:"1.6",marginBottom:"16px"}},
          overloadPrompt.geminiAvailable
            ?"DeepSeek API je preopterećen. Možeš pokušati sa Gemini backup AI-em — koristi iste prompt-ove i daje isti kvalitet."
            :"Gemini backup AI nije konfigurisan na serveru. Sačekaj 1-2 minuta i pokušaj DeepSeek ponovo."
        ),
        React.createElement("div",{style:{display:"flex",gap:"8px",justifyContent:"flex-end"}},
          React.createElement("button",{className:"btn bol bsm",onClick:function(){setOverloadPrompt(null);}},"Otkaži"),
          overloadPrompt.geminiAvailable&&React.createElement("button",{className:"btn bgd bsm",onClick:function(){var fn=overloadPrompt.retryFn;setOverloadPrompt(null);if(fn)fn();}},"✨ Pokušaj sa Gemini")
        )
      )
    ),

    toast&&React.createElement("div",{className:"toast"},toast)
  );
}
