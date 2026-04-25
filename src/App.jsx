import React from 'react'
import { useState, useEffect, useRef } from "react";

// ASTRO ENGINE -------------------------------------------------------------
const SIGNS=["Ovan","Bik","Blizanci","Rak","Lav","Devica","Vaga","Skorpija","Strelac","Jarac","Vodolija","Ribe"];
function r2d(r){return r*180/Math.PI;}
function d2r(d){return d*Math.PI/180;}
function norm(d){return((d%360)+360)%360;}
function jd(y,m,d,h){if(m<=2){y--;m+=12;}var A=Math.floor(y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+h/24+B-1524.5;}
function sunLon(J){var T=(J-2451545)/36525,M=d2r(norm(357.52911+35999.05029*T)),L0=280.46646+36000.76983*T,C=(1.914602-0.004817*T)*Math.sin(M)+(0.019993-0.000101*T)*Math.sin(2*M)+0.000289*Math.sin(3*M);return norm(L0+C);}
function moonLon(J){var T=(J-2451545)/36525,L=218.3164477+481267.88123421*T,D=d2r(norm(297.8501921+445267.1114034*T)),M=d2r(norm(357.5291092+35999.0502909*T)),Mp=d2r(norm(134.9633964+477198.8675055*T)),F=d2r(norm(93.2720950+483202.0175233*T));return norm(L+6.288774*Math.sin(Mp)+1.274027*Math.sin(2*D-Mp)+0.658314*Math.sin(2*D)+0.213618*Math.sin(2*Mp)-0.185116*Math.sin(M)-0.114332*Math.sin(2*F)+0.058793*Math.sin(2*D-2*Mp)+0.057066*Math.sin(2*D-M-Mp)+0.053322*Math.sin(2*D+Mp)+0.045758*Math.sin(2*D-M));}
function plLon(J,pl){
  var T=(J-2451545)/36525;
  var d={
    Mercury:{L0:252.250906,Ld:149472.6742,M0:174.7948,Md:149472.5153,e:0.20563},
    Venus:  {L0:181.979801,Ld:58517.8156, M0:50.4161, Md:58517.8036, e:0.00677},
    Mars:   {L0:355.433275,Ld:19140.2993, M0:19.3730, Md:19140.2993, e:0.09341},
    Jupiter:{L0:34.351519, Ld:3034.9057,  M0:20.0202, Md:3034.9057,  e:0.04839},
    Saturn: {L0:50.077444, Ld:1222.1138,  M0:317.0207,Md:1222.1138,  e:0.05415},
    Uranus: {L0:314.055005,Ld:428.4748,   M0:141.0498,Md:428.4748,   e:0.04717},
    Neptune:{L0:304.348665,Ld:218.4862,   M0:256.2284,Md:218.4862,   e:0.00859},
    Pluto:  {L0:238.958116,Ld:144.9600,   M0:14.8820, Md:144.9600,   e:0.24883}
  };
  var p=d[pl];if(!p)return 0;
  var L=norm(p.L0+p.Ld*T);
  var M=d2r(norm(p.M0+p.Md*T));
  var C=r2d((2*p.e-p.e*p.e*p.e/4)*Math.sin(M)+(5/4)*p.e*p.e*Math.sin(2*M));
  return norm(L+C);
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
function calcChart(dateStr,timeStr,lat,lon){
  var parts=dateStr.split("-"),y=parseInt(parts[0]),m=parseInt(parts[1]),d=parseInt(parts[2]);
  var tparts=(timeStr||"12:00").split(":"),h=parseInt(tparts[0]),mn=parseInt(tparts[1]);
  var J=jd(y,m,d,h+mn/60-lon/15);
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
  return{sunSign:signOf(pos.Sunce),moonSign:signOf(pos.Mesec),ascSign:ad?signOf(ad):"Nepoznato",ascDeg:ad?degIn(ad):"0",planets:planets,aspects:aspects,houses:houses};
}
var CITIES={beograd:[44.8176,20.4633],"novi sad":[45.2671,19.8335],nis:[43.3209,21.8954],sarajevo:[43.8476,18.3564],zagreb:[45.8150,15.9819],split:[43.5081,16.4402],rijeka:[45.3271,14.4422],osijek:[45.5550,18.6955],doboj:[44.7333,18.0833],tuzla:[44.5384,18.6734],"banja luka":[44.7722,17.1910],podgorica:[42.4411,19.2636],skopje:[41.9981,21.4254],london:[51.5074,-0.1278],berlin:[52.5200,13.4050],wien:[48.2082,16.3738],paris:[48.8566,2.3522],"new york":[40.7128,-74.0060],dubai:[25.2048,55.2708],munich:[48.1351,11.5820],stuttgart:[48.7758,9.1829],frankfurt:[50.1109,8.6821],hamburg:[53.5753,10.0153]};
function getCoords(city){if(!city)return[44.8176,20.4633];var k=city.toLowerCase().trim();var keys=Object.keys(CITIES);for(var i=0;i<keys.length;i++){if(k.indexOf(keys[i])>=0||keys[i].indexOf(k)>=0)return CITIES[keys[i]];}return[44.8176,20.4633];}

// TEXT UTILS ---------------------------------------------------------------
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
  // Ukloni AI "razmisljanje naglas" fraze ("Ne bas, ali otprilike", "Zapravo,", "(ako pretpostavimo)", "(vec u aspektu)")
  t=t.replace(/\s*\(ako pretpostavimo\)/gi,"");
  t=t.replace(/\s*\(vec u aspektu\)/gi,"");
  t=t.replace(/\s*\(već u aspektu\)/gi,"");
  t=t.replace(/\s*u zavisnosti od aspekta\.?/gi,"");
  // Ukloni uvodni preamble posle vokativa (safety net ako AI ipak ubaci)
  t=t.replace(/^([^,\n]{1,30},\s+)(evo tvoje[^.]{5,200}\.\s*|evo ti detaljn[^.]{5,200}\.\s*|na osnovu (tvoje|vasih|vaših)[^.]{5,200}(videcemo|videćemo|videces|videćeš|ceka|čeka|cekaju|čekaju)[^.]{0,200}\.\s*|videcemo (sta|šta|da) [^.]{5,200}\.\s*|videćemo (sta|šta|da) [^.]{5,200}\.\s*|donosim ti [^.]{5,200}\.\s*|krecemo sa [^.]{5,200}\.\s*|krećemo sa [^.]{5,200}\.\s*)/i,"$1");
  return t.replace(/^#{1,6}\s*/gm,"").replace(/^\s*---+\s*$/gm,"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1").replace(/^[-–—*•]\s*/gm,"").replace(/__/g,"").replace(/ [-–—] /g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function getChunks(text,max){
  if(!max)max=2900;
  var ch=[],pos=0;
  while(pos<text.length){
    if(pos+max>=text.length){ch.push(text.slice(pos).trim());break;}
    var end=pos+max;
    while(end>pos&&text[end]!='.'&&text[end]!='!'&&text[end]!='?')end--;
    if(end===pos)end=pos+max;else end+=1;
    ch.push(text.slice(pos,end).trim());
    pos=end;
    while(pos<text.length&&text[pos]===' ')pos++;
  }
  return ch.filter(function(x){return x.length>0;});
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
var PR_SR_DS="Na osnovu analize napisi TACNE PERIODE u narednih 12 meseci. Fokus: konkretni datumi promena, kada pokrenuti, kada cekati, periodi energije, rizicni periodi, da li ce se planovi realizovati. Pisi na srpskom ekavicom, sa ti, zenski rod, brutalno iskren/a. Bez emojija, bez ## --- **, bez crtica. Konkretni datumi od - do.";
var PR_HR_MAIN="Ja sam Astrolog Marija. Poslat cu ti podatke o osobi. Na temelju toga napisi jednu detaljnu i opsirnu astrološku analizu, jer si ti vrhunski astrolog s vise od 30 godina iskustva. Analiza treba obuhvatiti ljubav i posao u narednih 12 mjeseci. Na sva izravna pitanja odgovori jasno bez mozda, koristi bit ce i ce. Gledaj aspekte i kuce, posebno 7. kucu. Gledaj orb aspekata. Analizom zapocni imenom osobe. Obracaj se izravno sa ti. Bez emojija, bez crtica, bez ## --- **. Budi brutalno iskren. Pisi na hrvatskom jeziku. Gramaticki ispravno. Na kraju: Hvala ti puno na povjerenju i zelim ti zivot ispunjen mirom, radoscu i srecom.\nAstrolog Marija";
var PR_HR_DS="Na osnovu analize napisi TOCNE PERIODE u narednih 12 mjeseci. Fokus: konkretni datumi promjena, kada pokrenuti, kada cekati, periodi energije, rizicni periodi, da li ce se planovi ostvariti. Pisi na hrvatskom jeziku, sa ti, brutalno iskren/a. Bez emojija, bez ## --- **, bez crtica. Konkretni datumi od - do.";

// API ----------------------------------------------------------------------
async function parseMsg(text){
  var systemPrompt='Izvuci podatke o osobama iz poruke i vrati SAMO JSON bez ikakvog teksta oko njega.\n\n*** NAJVAZNIJE - PROCITAJ PRE SVEGA OSTALOG ***\nPolje "pitanja" u JSON-u je NAJKRITICNIJI izlaz ovog zadatka. Astrolog na osnovu ovog polja zna sta da odgovori klijentu. Ako ovde izostavis ili skratis bilo sta, klijent NECE dobiti odgovor na svoje pitanje i sve pada u vodu.\n\nSVAKO pitanje, briga, tema, osoba, emocija ili zahtev koji klijent pomene MORA da se nadje u polju "pitanja", sa punim detaljima.\n\n*** CATCH-ALL PRAVILO ZA "pitanja" ***\nSve sto u poruci NIJE cisti podatak (ime klijenta, datum rodjenja, vreme rodjenja, mesto rodjenja) OBAVEZNO ide u polje "pitanja". Ovo ukljucuje:\n- Svaku recenicu teksta koju klijent napise\n- Sva pitanja ("da li", "kada", "hoce li", "sta")\n- Sve brige, emocije, strahove, nadanja\n- Pominjanje drugih osoba (deca, muz, roditelji, prijatelji) i sta klijent zeli da zna o njima\n- Sva podrucja zivota (posao, ljubav, zdravlje, novac, putovanja, selidba, sud, skola)\n- Napomene, dodatne informacije, kontekst koji klijent daje\n\nKada izvlacis podatke: prvo izvuci ime/datum/vreme/mesto u odgovarajuca polja, zatim SVE preostalo sto ima ikakvog smisla ide u "pitanja" polje.\n\nPolje "pitanja" sme biti prazno SAMO u jednom slucaju: cela poruka je striktno samo "Ime Datum Vreme Mesto" bez bilo kakvog drugog teksta. Ako postoji IJEDNA slobodna recenica — OBAVEZNO u "pitanja".\n\nKada si u dilemi "da li ovo ide u pitanja ili ne" — UVEK stavi u pitanja. Bolje je imati vise nego premalo.\n\n*** IMENA - KOPIRAJ KARAKTER PO KARAKTER ***\nSva imena (klijenta, partnera, trecih osoba) KOPIRAJ TACNO ONAKO kako su napisana u ulaznoj poruci, karakter po karakter. NIKAD ne zamenjuj slicna ali razlicita imena:\n- Milka ≠ Milica (to su DVA RAZLICITA imena). Ako je u poruci 'Milka', napisi 'Milka' u JSON-u, NIKADA 'Milica'.\n- Maja ≠ Marija. Ako je u poruci 'Maja', napisi 'Maja', ne 'Marija'.\n- Vanja ≠ Vanesa. Ana ≠ Anja ≠ Anica. Nada ≠ Nadica. Mira ≠ Mirjana.\nKLjUCNO: pre vracanja JSON, ponovo procitaj originalno ime iz poruke i proveri da si ga zapisao SLOVO ZA SLOVO. Ne "pametno ispravljaj" imena koja ti deluju neobicno - klijenti bolje znaju svoje ime od tebe.\n\nFormat odgovora:\n{"klijent":{"ime":"","datum":"YYYY-MM-DD","vreme":"HH:MM","mesto":""},"partner":{"ime":"","datum":"YYYY-MM-DD","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nKLJUCNA PRAVILA:\n1. Prva osoba u poruci = KLIJENT\n2. *** PARTNER polje je ISKLJUCIVO za ROMANTICNOG partnera ***\n   - PARTNER = muz, zena, suprug, supruga, decko, devojka, verenik, verenica, partner, partnerka, momak, dragi, draga, bivsi, bivsa (romanticni kontekst)\n   - Postavi imaPartnera=true i popuni partner objekat SAMO ako je druga osoba eksplicitno romanticni partner\n   - NIKAD partner polje ne popunjavaj za: sin, cerka, kcerka, kci, beba, dete, deca, brat, sestra, tata, otac, mama, majka, baba, deda, unuk, unuka, tetka, ujak, stric, ujna, strina, rodjak, rodjaka, prijatelj, prijateljica, kolega, koleginica, sef, komsija, komsinica\n3. Ako u poruci postoji OSOBA KOJA NIJE ROMANTICNI PARTNER (npr. sin, cerka, brat, prijatelj itd.) - NJEN datum/ime/mesto NE ide u partner polje, nego u "pitanja" polje kao kontekst za klijenta: "Klijent pita za [sin/cerka/brat] [ime] rodjen/a [datum] u [mesto]". Tako astrolog zna o kome klijent pita.\n4. Ako druga osoba nema oznaku odnosa (samo ime + datum, npr. "Marko 24.04.1987\\nJelena 27.05.2006") - PRETPOSTAVI da je romanticni partner i postavi imaPartnera=true.\n5. datum MORA biti YYYY-MM-DD u izlazu (1987-04-24)\n6. vreme MORA biti HH:MM u izlazu (10:40)\n7. mesto - samo grad bez drzave\n8. Ako cela poruka pocinje sa "Moja cerka", "Moj sin", "Moj brat" itd. - analiza JE za tu osobu, pa klijent ime=cerka Ana / sin Marko itd. (ukljuci rec odnosa u ime). imaPartnera=false.\n9. REDOSLED POLJA NIJE VAZAN - ime/datum/vreme/mesto mogu doci bilo kojim redom\n\nTOLERANTNI FORMATI ZA DATUM (sve ovo prepoznaj kao datum i konvertuj u YYYY-MM-DD):\n- 24.04.1987 ili 24/04/1987 ili 24-04-1987 → 1987-04-24\n- 4.1.2000 ili 4/1/2000 → 2000-01-04\n- 24 04 1987 (razmaci umesto tacaka) → 1987-04-24\n- 4 1 95 ili 4.1.95 (2-cifrena godina) → za godine 00-30 dodaj 2000 (95→1995, 05→2005), za 31-99 dodaj 1900 (95→1995, 87→1987)\n- 24041987 (bez separatora, DDMMYYYY, 8 cifara) → 1987-04-24\n- 4011987 (bez separatora, DMMYYYY, 7 cifara) → 1987-01-04\n- 2752006 (bez separatora, 7 cifara, DMYYYY) → 2006-05-27 (27 dan, 5 mesec, 2006 godina)\n- 321995 ili 3021995 (D.M.YYYY bez separatora) → 1995-02-03\n- 1987-04-24 (vec ispravan) → 1987-04-24\n- BITNO: ako je broj 6 cifara → pokusa D M YYYY (1.2.1995 = 121995), ako je 7 → DD M YYYY ili D MM YYYY, ako je 8 → DD MM YYYY\n\nTOLERANTNI FORMATI ZA VREME (sve ovo prepoznaj kao vreme i konvertuj u HH:MM):\n- 10:40 → 10:40\n- 10.40 (tacka umesto dvotacke) → 10:40\n- 10 40 (razmak) → 10:40\n- 10h40 ili 10-40 → 10:40\n- 5:40 ili 5.40 ili 5 40 (jedna cifra sat) → 05:40\n- 540 (bez separatora, 3 cifre) → 05:40\n- 1040 (bez separatora, 4 cifre) → 10:40\n\nPREPOZNAJ po formatu:\n- Broj vezan sa tackama/crticama/razmacima koji izgleda kao datum = DATUM\n- 6-8 cifara u nizu koje mogu da formiraju datum = DATUM (konvertuj)\n- Brojevi 0-23 za sate i 0-59 za minute odvojeni separatorom = VREME\n- 3-4 cifre u nizu koje mogu biti HHMM = VREME\n- Reci sa velikim pocetnim slovom koje su imena (Marko, Ana, Suzana, Jovana, Jelena) = IME\n- Gradovi (Beograd, Nis, Doboj, Novi Sad, Sarajevo, Zagreb, Banja Luka, Bijeljina, Tuzla, Mostar itd) = MESTO\n\nPRIMERI:\n\nUnos: "Marko 24.04.1987 10:40 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 24.04.1987 10.40 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 24 04 1987 10 40 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 24041987 1040 Beograd"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1987-04-24","vreme":"10:40","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Marko 4.1.2000 5.40 Doboj"\nIzlaz: {"klijent":{"ime":"Marko","datum":"2000-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "4 1 95 5 40 Doboj Marko"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1995-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "4 1 95 5 40 Doboj Marko\\n2752006 Jelena"\nIzlaz: {"klijent":{"ime":"Marko","datum":"1995-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"Jelena","datum":"2006-05-27","vreme":"","mesto":""},"imaPartnera":true,"pitanja":""}\n\nUnos: "Ana 321995 1420 Nis"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-02-03","vreme":"14:20","mesto":"Nis"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "4.1.2000 Marko 5.40 Doboj\\n27.5.2006 Jelena"\nIzlaz: {"klijent":{"ime":"Marko","datum":"2000-01-04","vreme":"05:40","mesto":"Doboj"},"partner":{"ime":"Jelena","datum":"2006-05-27","vreme":"","mesto":""},"imaPartnera":true,"pitanja":""}\n\nUnos: "Ana, 15.07.1995, Nis\\nMarko, 20.03.1990, Beograd"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-07-15","vreme":"","mesto":"Nis"},"partner":{"ime":"Marko","datum":"1990-03-20","vreme":"","mesto":"Beograd"},"imaPartnera":true,"pitanja":""}\n\nUnos: "Ja sam Ana 15.07.1995 Nis, moj muz je Marko 20.03.1990 Beograd"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-07-15","vreme":"","mesto":"Nis"},"partner":{"ime":"Marko","datum":"1990-03-20","vreme":"","mesto":"Beograd"},"imaPartnera":true,"pitanja":""}\n\nUnos: "Moja cerka Ana, 15.07.1995 u 14:20 u Nisu"\nIzlaz: {"klijent":{"ime":"cerka Ana","datum":"1995-07-15","vreme":"14:20","mesto":"Nis"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":""}\n\nUnos: "Karolina 24.04.1987 Beograd, moj sin Marko 5.6.2010"\nIzlaz: {"klijent":{"ime":"Karolina","datum":"1987-04-24","vreme":"","mesto":"Beograd"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za sina Marka rodjenog 05.06.2010."}\n\nUnos: "Ana 15.07.1995 Nis, moja cerka Milica 12.03.2018"\nIzlaz: {"klijent":{"ime":"Ana","datum":"1995-07-15","vreme":"","mesto":"Nis"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za cerku Milicu rodjenu 12.03.2018."}\n\nUnos: "Ja sam Jovana 20.11.1988, pita me brat Petar 5.3.1985 za posao"\nIzlaz: {"klijent":{"ime":"Jovana","datum":"1988-11-20","vreme":"","mesto":""},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za brata Petra rodjenog 05.03.1985, interesuje ga posao."}\n\nUnos: "Marina 3.5.1990 Novi Sad, tata Milan 8.8.1960"\nIzlaz: {"klijent":{"ime":"Marina","datum":"1990-05-03","vreme":"","mesto":"Novi Sad"},"partner":{"ime":"","datum":"","vreme":"","mesto":""},"imaPartnera":false,"pitanja":"Klijent pita za tatu Milana rodjenog 08.08.1960."}\n\n*** KRITICNO - POLJE "pitanja" MORA BITI KOMPLETNO ***\nPolje "pitanja" u JSON-u je OD NAJVECE VAZNOSTI. Astrolog na osnovu ovog polja zna na sta da odgovori. Ako ovde nesto izostavis ili skratis, klijent NECE dobiti odgovor na svoje pitanje.\n\nOBAVEZNA PRAVILA za "pitanja":\n1. Ekstrahuj SVAKO pitanje, brigu, zahtev ili temu koju klijent pominje. NIKADA ne preskaci pitanje jer izgleda slicno prethodnom.\n2. Zadrzi SVE konkretne detalje: imena drugih osoba, datumi rodjenja, specificne brige (zdravlje, brak, posao, deca, novac, penzija, selidba, sud itd).\n3. Za SVAKU osobu koju klijent pominje (dete, muz, brat, tata, prijatelj, sestra), zapisi u zasebnoj recenici sa PUNIM KONTEKSTOM (ime, datum rodjenja ako je dostupan, sta klijent zeli da zna o toj osobi).\n4. Ako klijent spominje zabrinutost, emociju ili strah, prenesi to ('zabrinuta je za', 'plasi se da', 'zeli da zna da li', 'interesuje je').\n5. Ako klijent trazi savet ili odluku ('da li da', 'kada da', 'hoce li'), prenesi to kao direktno pitanje.\n6. Kombinuj samo ako je vise pitanja o ISTOJ osobi/temi; razdvoj ako su o razlicitim osobama ili temama.\n7. Koristi srpski ekavicu, jasne recenice. Bez dvotacki, bez listi sa crticama. Svaka tema jedna recenica, razdvojene razmakom.\n\nPRIMERI DETALJNE EKSTRAKCIJE:\n\nUnos (deo poruke): "Imam sina Marka 05.07.2018, zanima me kako mu je u skoli i da li ce imati problema sa ponasanjem. Takodje brine me zdravlje mog muza, ima probleme sa srcem zadnjih godina. I da li cu uspeti da dobijem invalidsku penziju na koju sam aplicirala u martu?"\n\nIspravna ekstrakcija za polje "pitanja":\n"Klijent pita za sina Marka rodjenog 05.07.2018, interesuje je kako mu je u skoli i da li ce imati problema sa ponasanjem. Klijent brine za zdravlje muza koji ima problema sa srcem zadnjih godina. Klijent pita da li ce uspeti da dobije invalidsku penziju na koju je aplicirala u martu."\n\nLOSA ekstrakcija (NE RADITI OVAKO): "Klijent pita za sina i muza i penziju." (PREVISE KRATKO, izgubljeni svi detalji!)\n\nDrugi primer:\nUnos: "Pita me cerka Milica 10.05.1993 hoce li imati dece i kada, i da li ce se udati za sadasnjeg momka. I sestra Dragica 14.12.1975 ima neki sud oko nasledstva pa je zanima hoce li dobiti parnicu."\n\nIspravna ekstrakcija:\n"Klijent pita za cerku Milicu rodjenu 10.05.1993, zanima je hoce li imati dece i kada, i da li ce se udati za sadasnjeg momka. Klijent pita za sestru Dragicu rodjenu 14.12.1975 koja ima sudski spor oko nasledstva, interesuje je hoce li dobiti parnicu."\n\nAko ne razumes neki deo poruke, PRENESI GA KAKO JESTE umesto da skratis ili izbacis. Bolje je da astrolog dobije malo nejasan detalj nego da ne zna uopste da postoji.\n\n*** KRITICNO - SELF-CHECK PRE VRACANJA JSON ***\nPre nego sto vratis JSON, OBAVEZNO izvedi sledece korake:\n1. Ponovo procitaj kompletnu klijentovu poruku od pocetka do kraja.\n2. Izbroj koliko distinkcnih TEMA (osoba, briga, pitanja, emocija, zahteva) je klijent pomenuo.\n3. Broj recenica/tema u tvom "pitanja" polju treba da odgovara broju tema iz poruke.\n4. Za svaku pomenutu osobu (dete, muz, roditelj, prijatelj, bivsi partner) — proveri da li je zabelezena sa imenom, datumom i konkretnim pitanjem klijenta.\n5. Za svako pomenuto podrucje zivota (posao, ljubav, zdravlje, novac, penzija, selidba, sud, deca) — proveri da li je u polju "pitanja".\n6. Ako bilo sta nedostaje, DOPUNI polje "pitanja" pre vracanja JSON.\n\nPrimer self-check-a: klijentova poruka pominje SINA, MUZA i PENZIJU (3 teme). Tvoj "pitanja" mora da ima 3 distinkcne recenice — po jednu za svaku temu.\n\nAko si posle self-check-a video da nesto nedostaje a vec pises JSON — STANI, popravi polje "pitanja", tek onda vrati JSON.\n\nVAZNO: Vrati iskljucivo JSON, bez komentara, bez markdown formatiranja. Ako neki podatak nedostaje ostavi prazan string. Nikad ne ostavljaj sve polja prazna ako ima informacija.';
  // Retry up to 4 times with increasing backoff if overloaded
  var d=null,lastError=null;
  var MAX_RETRIES=4;
  for(var attempt=0;attempt<MAX_RETRIES;attempt++){
    try{
      var r=await fetch("https://astrobalkan-backend.onrender.com/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({max_tokens:4096,system:systemPrompt,messages:[{role:"user",content:"Izvuci podatke iz sledece poruke:\n\n"+text}]})});
      d=await r.json();
      if(d.content&&d.content[0]&&d.content[0].text)break;
      if(d.error&&(d.error.type==="overloaded_error"||d.error.type==="rate_limit_error"||(d.error.message||"").toLowerCase().indexOf("overload")>=0)){
        lastError=d.error;
        var wait=2000+attempt*2000; // 2s, 4s, 6s, 8s
        console.warn("parseMsg attempt "+(attempt+1)+" overloaded, retry in "+wait+"ms");
        await new Promise(function(res){setTimeout(res,wait);});
        continue;
      }
      lastError=d.error;
      break;
    }catch(e){
      lastError={message:e.message};
      console.error("parseMsg network error attempt "+(attempt+1)+":",e.message);
      await new Promise(function(res){setTimeout(res,2000);});
    }
  }
  if(!d||d.error||d.type==="error"||!(d.content&&d.content[0]&&d.content[0].text)){
    console.error("parseMsg final Anthropic error:",JSON.stringify(lastError||d||{}).slice(0,500));
    var errMsg=(lastError&&lastError.message)||(d&&d.error&&d.error.message)||"Nepoznata";
    if((errMsg||"").toLowerCase().indexOf("overload")>=0)errMsg="Anthropic servers preopterećeni. Sacekaj minut i probaj ponovo.";
    return {__error:errMsg};
  }
  var t=(d.content&&d.content[0]&&d.content[0].text)||"";
  if(!t){
    console.error("parseMsg empty response from Claude:",JSON.stringify(d).slice(0,500));
    return {__error:"Prazan odgovor od AI - proveri Anthropic API kljuc"};
  }
  try{
    var parsed=JSON.parse(t.replace(/```json|```/g,"").trim());
    // Fix date format if AI returned DD.MM.YYYY instead of YYYY-MM-DD
    function fixDate(d){if(!d)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;var m=d.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);if(m)return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");return d;}
    if(parsed.klijent){parsed.klijent.datum=fixDate(parsed.klijent.datum);}
    if(parsed.partner){parsed.partner.datum=fixDate(parsed.partner.datum);}
    // Detect empty result
    var k=parsed.klijent||{};
    if(!k.ime&&!k.datum&&!k.vreme&&!k.mesto){
      console.warn("parseMsg empty fields, raw response:",t.slice(0,300));
      return {__error:"AI nije prepoznao podatke - probaj jasniji format"};
    }
    // FALLBACK za pitanja: NAJAGRESIVNIJI - uvek raw ako je > 30 chars.
    // "Marko 24.04.1987 Beograd" = ~24 chars. Sve preko toga znaci da ima dodatnih pitanja/komentara.
    // Raw uvek pobedjuje AI ekstrakciju - astrolog mora da vidi sve sto je klijent napisao.
    var pitanjaTxt=(parsed.pitanja||"").trim();
    var rawMsg=(text||"").trim();
    if(rawMsg.length>30){
      console.log("parseMsg: pitanja set to raw msg. raw="+rawMsg.length+" ai="+pitanjaTxt.length);
      parsed.pitanja=rawMsg;
    }
    console.log("parseMsg result:",JSON.stringify(parsed).slice(0,300));
    return parsed;
  }catch(e){console.error("parseMsg JSON error:",e,t.slice(0,200));return {__error:"AI odgovor nije valjan JSON: "+t.slice(0,100)};}
}
async function stoSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
async function stoGet(k,def){try{var r=localStorage.getItem(k);return r?JSON.parse(r):def;}catch(e){return def;}}

var API="https://astrobalkan-backend.onrender.com";

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

function emptySlot(){return{mode:"messenger",paste:"",parsed:null,client:{ime:"",datum:"",vreme:"",mesto:"",napomena:"",pitanja:""},partner:{ime:"",datum:"",vreme:"",mesto:""},hasPart:false,ch:null,pch:null,transits:null,types:["analiza"],status:"idle",analysis:"",copyIdx:0,jobId:null};}

// CSS ----------------------------------------------------------------------
var CSS="@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Jost:wght@300;400;500&display=swap');\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}\n:root{--bg:#02000d;--sf:rgba(15,10,28,.9);--sf2:rgba(22,15,38,.92);--bd:rgba(180,140,60,.18);--bd2:rgba(180,140,60,.35);--gd:#c9a84c;--gd2:#e8c96d;--tx:#ede5ff;--mt:#9080b0;--ac:#9b6fd4;--ac2:#7c4fc0;--red:#c06060;--grn:#60b060;}\nbody{font-family:'Jost',sans-serif;color:var(--tx);min-height:100vh;background:var(--bg);overflow-x:hidden;padding-bottom:180px;}\nbody::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 15% 25%,rgba(100,30,180,.5) 0%,transparent 50%),radial-gradient(ellipse at 85% 15%,rgba(40,15,100,.6) 0%,transparent 45%),linear-gradient(170deg,#05010f 0%,#090320 35%,#0d0525 65%,#060115 100%);}\nbody::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(1.5px 1.5px at 8% 5%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 20% 10%,rgba(255,255,220,.9) 0%,transparent 100%),radial-gradient(2px 2px at 33% 4%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 47% 8%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 60% 3%,rgba(255,240,200,.9) 0%,transparent 100%),radial-gradient(2px 2px at 75% 7%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(2.5px 2.5px at 22% 40%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 48% 44%,rgba(255,255,255,.8) 0%,transparent 100%),radial-gradient(2px 2px at 46% 60%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 25% 75%,rgba(255,255,255,.9) 0%,transparent 100%),radial-gradient(2px 2px at 70% 78%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 50% 87%,rgba(255,255,255,.9) 0%,transparent 100%);animation:tw 7s ease-in-out infinite alternate;}\n@keyframes tw{0%{opacity:.5}50%{opacity:1}100%{opacity:.6}}\n.app{position:relative;z-index:1;max-width:720px;margin:0 auto;padding-bottom:190px;}\n.lwrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 18px;position:relative;z-index:1;}\n.lcard{width:100%;max-width:420px;background:linear-gradient(145deg,rgba(18,10,36,.97),rgba(10,5,24,.99));border:1px solid var(--bd2);border-radius:22px;padding:36px 26px;box-shadow:0 0 80px rgba(100,50,200,.2);}\n.llogo{text-align:center;margin-bottom:22px;}\n.llogo h1{font-family:'Cormorant Garamond',serif;font-size:34px;font-weight:600;color:var(--gd2);letter-spacing:3px;text-shadow:0 0 30px rgba(201,168,76,.5);}\n.llogo p{font-size:10px;color:var(--mt);letter-spacing:3px;text-transform:uppercase;margin-top:4px;}\n.ldiv{height:1px;background:linear-gradient(90deg,transparent,var(--bd2),transparent);margin:18px 0;}\n.lfld{margin-bottom:13px;}\n.lfld label{display:block;font-size:11px;color:var(--mt);letter-spacing:.5px;margin-bottom:5px;}\n.lfld input{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--bd);border-radius:8px;padding:11px 14px;color:var(--tx);font-family:'Jost',sans-serif;font-size:14px;outline:none;transition:border-color .2s;}\n.lfld input:focus{border-color:var(--gd);}\n.lbtn{width:100%;padding:13px;background:linear-gradient(135deg,#b8922a,#c9a84c,#e8c96d);color:#1a0e00;font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:600;letter-spacing:1.5px;border:none;border-radius:9px;cursor:pointer;transition:all .2s;box-shadow:0 4px 20px rgba(201,168,76,.3);margin-top:4px;}\n.lbtn:hover{transform:translateY(-1px);}\n.lerr{color:#e07070;font-size:12px;text-align:center;margin:10px 0 0;}\n.lsuc{color:#70e070;font-size:12px;text-align:center;margin:10px 0 0;}\n.ltabs{display:flex;gap:6px;margin-bottom:18px;}\n.ltab{flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--bd);background:transparent;color:var(--mt);font-family:'Jost',sans-serif;font-size:12px;cursor:pointer;transition:all .2s;}\n.ltab.on{border-color:var(--gd);background:rgba(201,168,76,.1);color:var(--gd2);}\n.llink{display:block;margin:12px auto 0;background:none;border:none;color:var(--mt);font-size:12px;cursor:pointer;font-family:'Jost',sans-serif;text-decoration:underline;}\n.csel{display:flex;gap:10px;margin-bottom:18px;}\n.cbtn{flex:1;padding:14px 8px;border-radius:12px;border:2px solid var(--bd);background:transparent;cursor:pointer;transition:all .2s;text-align:center;}\n.cbtn:hover,.cbtn.on{border-color:var(--gd);background:rgba(201,168,76,.1);}\n.cflag{font-size:28px;display:block;margin-bottom:5px;}\n.cname{font-family:'Cormorant Garamond',serif;font-size:15px;color:var(--gd2);font-weight:600;}\n.csub{font-size:10px;color:var(--mt);margin-top:2px;}\n.vcode{font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:var(--gd2);font-family:'Cormorant Garamond',serif;background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.3);border-radius:10px;padding:16px;margin:14px 0;}\n.hdr{padding:0;background:linear-gradient(180deg,rgba(12,6,28,.98) 0%,rgba(8,4,20,.85) 100%);backdrop-filter:blur(20px);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:100;}\n.hdr-top{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;}\n.hbrand{display:flex;align-items:center;gap:11px;}\n.hname{font-family:'Cormorant Garamond',serif;font-size:21px;font-weight:600;color:var(--gd2);letter-spacing:2.5px;}\n.hsub{font-size:9px;color:var(--mt);letter-spacing:2px;text-transform:uppercase;margin-top:1px;}\n.huser{display:flex;align-items:center;gap:7px;}\n.huser span{font-size:11px;color:var(--mt);}\n.hlout{background:transparent;border:1px solid var(--bd);color:var(--mt);font-size:10px;padding:4px 10px;border-radius:12px;cursor:pointer;font-family:'Jost',sans-serif;transition:all .2s;}\n.hlout:hover{border-color:var(--red);color:var(--red);}\n.abadge{background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.35);color:var(--gd);font-size:9px;padding:2px 8px;border-radius:10px;}\n.bnav{display:flex;flex-wrap:wrap;background:linear-gradient(0deg,rgba(8,4,20,.99) 0%,rgba(12,6,28,.95) 100%);border-top:1px solid var(--bd);padding:6px 2px;padding-bottom:max(10px,env(safe-area-inset-bottom,10px));position:fixed;bottom:0;left:0;right:0;z-index:200;max-width:720px;margin:0 auto;}\n.bnav-btn{flex:1 0 25%;max-width:25%;display:flex;flex-direction:column;align-items:center;gap:2px;background:none;border:none;color:var(--mt);font-family:'Jost',sans-serif;cursor:pointer;padding:4px 2px;transition:all .2s;border-radius:8px;position:relative;}\n.bnav-btn.on{color:var(--gd2);background:linear-gradient(180deg,rgba(201,168,76,.22) 0%,rgba(201,168,76,.08) 100%);box-shadow:inset 0 2px 0 var(--gd),0 0 20px rgba(201,168,76,.35);transform:translateY(-2px) scale(1.04);}\n.bnav-btn.on .bnav-ico{text-shadow:0 0 18px rgba(232,201,109,.9);font-size:24px;}\n.bnav-btn.on .bnav-lbl{font-weight:700;color:var(--gd2);text-shadow:0 0 10px rgba(232,201,109,.5);}\n.bnav-ico{font-size:20px;line-height:1;position:relative;}\n.bnav-lbl{font-size:8px;font-weight:500;letter-spacing:.2px;}\n.ndot{position:absolute;top:-2px;right:-6px;width:7px;height:7px;background:var(--ac);border-radius:50%;}\n.ndot-run{position:absolute;top:-2px;right:-6px;width:8px;height:8px;background:#e04040;border-radius:50%;box-shadow:0 0 6px rgba(224,64,64,.8);animation:dotPulse 1.2s ease-in-out infinite;}\n.ndot-done{position:absolute;top:-2px;right:-6px;width:8px;height:8px;background:#50c070;border-radius:50%;box-shadow:0 0 6px rgba(80,192,112,.7);}\n@keyframes dotPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.4);opacity:.6}}\n.sec{padding:16px 14px;}\n.stitle{font-family:'Cormorant Garamond',serif;font-size:19px;color:var(--gd2);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:9px;}\n.card{background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px;}\n.card-hi{border-color:rgba(201,168,76,.3);background:linear-gradient(145deg,rgba(20,14,35,.95),rgba(15,10,28,.98));}\n.ct{font-size:10px;font-weight:500;color:var(--gd);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:9px;}\n.fld{margin-bottom:8px;}\n.fld label{display:block;font-size:10.5px;color:var(--mt);margin-bottom:3px;}\n.fld input,.fld textarea{width:100%;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:8px 11px;color:var(--tx);font-family:'Jost',sans-serif;font-size:13px;outline:none;transition:border-color .2s;}\n.fld input:focus,.fld textarea:focus{border-color:var(--gd);}\n.fld input[type=date],.fld input[type=time]{-webkit-appearance:none;appearance:none;color-scheme:dark;}\n.fld textarea{resize:vertical;min-height:72px;}\n.r2{display:grid;grid-template-columns:1fr 1fr;gap:7px;}\n.div1{height:1px;background:var(--bd);margin:9px 0;}\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:9px 16px;border-radius:7px;font-family:'Jost',sans-serif;font-size:12.5px;font-weight:500;cursor:pointer;border:none;transition:all .2s;}\n.bgd{background:linear-gradient(135deg,#b8922a,#c9a84c);color:#1a0e00;font-weight:600;box-shadow:0 2px 12px rgba(201,168,76,.25);}\n.bgd:hover{opacity:.9;transform:translateY(-1px);}\n.bpu{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;}\n.bpu:hover{opacity:.9;transform:translateY(-1px);}\n.bol{background:transparent;border:1px solid var(--bd);color:var(--mt);}\n.bol:hover{border-color:var(--gd);color:var(--tx);}\n.brd{background:transparent;border:1px solid var(--red);color:var(--red);}\n.bsm{padding:5px 10px;font-size:11px;}\n.bfull{width:100%;}\n.btn:disabled{opacity:.4;cursor:not-allowed;}\n.tabs{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:11px;}\n.tab{padding:5px 12px;border-radius:16px;font-size:11px;border:1px solid var(--bd);background:transparent;color:var(--mt);cursor:pointer;font-family:'Jost',sans-serif;transition:all .2s;}\n.tab.on{background:var(--ac2);border-color:var(--ac);color:#fff;}\n.tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px;}\n.tbtn{padding:11px 5px;border-radius:8px;border:1px solid var(--bd);background:var(--sf2);color:var(--mt);cursor:pointer;text-align:center;font-family:'Jost',sans-serif;font-size:10.5px;transition:all .2s;position:relative;}\n.tbtn.on{border-color:var(--gd);background:rgba(201,168,76,.1);color:var(--gd2);}\n.tico{font-size:18px;display:block;margin-bottom:4px;line-height:1;}\n.srow{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--sf2);border-radius:5px;font-size:11px;margin-bottom:7px;}\n.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}\n.dot-w{background:var(--gd);}\n.slhdr{display:flex;align-items:center;gap:7px;margin-bottom:9px;}\n.slbadge{background:linear-gradient(135deg,rgba(201,168,76,.2),rgba(201,168,76,.08));color:var(--gd2);border:1px solid rgba(201,168,76,.28);border-radius:5px;padding:2px 9px;font-size:10px;font-weight:600;font-family:'Cormorant Garamond',serif;}\n.slst{font-size:10px;padding:2px 8px;border-radius:10px;margin-left:auto;}\n.stidl{background:rgba(138,122,170,.12);color:var(--mt);}\n.strun{background:rgba(155,111,212,.2);color:var(--ac);}\n.stdone{background:rgba(96,176,96,.18);color:var(--grn);}\n.aout{background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:15px;font-size:13px;line-height:2.05;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;color:var(--tx);min-height:160px;max-height:55vh;overflow-y:auto;font-family:'Jost',sans-serif;}\n.aout::-webkit-scrollbar{width:3px;}\n.aout::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px;}\n.cur::after{content:'|';animation:bl 1s infinite;color:var(--gd);}\n@keyframes bl{0%,100%{opacity:1}50%{opacity:0}}\n.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:3px;}\n.prow{display:flex;justify-content:space-between;padding:4px 8px;background:var(--sf2);border-radius:4px;font-size:11px;}\n.pn{color:var(--mt)}.pv{color:var(--gd2);font-weight:500;}\n.sgnrow{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;}\n.sgni{background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:6px 10px;text-align:center;}\n.sgnl{font-size:9px;color:var(--mt);margin-bottom:2px;}\n.sgnv{font-size:14px;color:var(--gd2);font-family:'Cormorant Garamond',serif;font-weight:600;}\n.asplist{font-size:10.5px;color:var(--mt);line-height:1.9;}\n.ac0{color:#e8c96d}.ao{color:#c06060}.at{color:#60a090}.aq{color:#c07840}.as{color:#7090d0}.ax{color:#8a7aaa}\n.ctrack{background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.2);border-radius:8px;padding:10px 12px;margin-bottom:9px;}\n.cdots{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;}\n.cdot{width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:600;cursor:pointer;transition:all .15s;}\n.abar{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;}\n.urow{display:flex;align-items:center;gap:9px;padding:10px 13px;background:var(--sf);border:1px solid var(--bd);border-radius:8px;margin-bottom:7px;}\n.uav{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--ac2),var(--gd));display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0;}\n.acard{background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:border-color .2s;}\n.acard:hover{border-color:var(--gd);}\n.acard-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}\n.acard-name{font-size:13.5px;font-weight:500;font-family:'Cormorant Garamond',serif;color:var(--gd2);}\n.acard-date{font-size:10px;color:var(--mt);}\n.acard-prev{font-size:11.5px;color:var(--mt);line-height:1.5;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}\n.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:flex;align-items:flex-end;}\n.modal{background:var(--sf);border:1px solid var(--bd);border-radius:16px 16px 0 0;padding:20px 16px;width:100%;max-height:88vh;overflow-y:auto;}\n.modal-title{font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--gd2);margin-bottom:14px;}\n.toast{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(20,12,38,.97);border:1px solid var(--gd);color:var(--tx);padding:10px 20px;border-radius:20px;font-size:12px;z-index:999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.4);animation:tIn .3s ease;}\n@keyframes tIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}\n.spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:var(--gd);border-radius:50%;animation:sp .7s linear infinite;display:inline-block;}\n@keyframes sp{to{transform:rotate(360deg)}}\n.empty{text-align:center;padding:36px 20px;color:var(--mt);}\n.empty .ico{font-size:30px;margin-bottom:10px;opacity:.4;}\n.sel-input{width:100%;background:var(--sf2);border:1px solid var(--bd);border-radius:6px;padding:8px 11px;color:var(--tx);font-family:'Jost',sans-serif;font-size:13px;outline:none;}\n.splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#02000d;overflow:hidden;animation:splashFade .8s ease 3.2s forwards;}\n.splash::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(80,20,160,.4) 0%,transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(20,10,80,.5) 0%,transparent 50%),radial-gradient(ellipse at 50% 50%,rgba(10,5,40,.3) 0%,transparent 70%);}\n.splash::after{content:'';position:absolute;inset:0;background-image:radial-gradient(1px 1px at 10% 15%,rgba(255,255,255,.9) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 25% 8%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 40% 22%,rgba(255,240,200,.8) 0%,transparent 100%),radial-gradient(2px 2px at 55% 5%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 70% 18%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 85% 12%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 15% 35%,rgba(255,255,220,.9) 0%,transparent 100%),radial-gradient(2px 2px at 35% 45%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 50% 38%,rgba(255,255,255,.8) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 65% 42%,rgba(255,240,200,.9) 0%,transparent 100%),radial-gradient(1px 1px at 80% 35%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(2px 2px at 20% 55%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 45% 62%,rgba(255,255,255,.9) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 60% 58%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 75% 65%,rgba(255,240,200,.8) 0%,transparent 100%),radial-gradient(2px 2px at 90% 52%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 8% 72%,rgba(255,255,255,.85) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 30% 78%,rgba(220,230,255,1) 0%,transparent 100%),radial-gradient(2px 2px at 55% 85%,rgba(255,255,255,1) 0%,transparent 100%),radial-gradient(1px 1px at 72% 88%,rgba(255,255,220,.9) 0%,transparent 100%),radial-gradient(1.5px 1.5px at 88% 75%,rgba(255,255,255,.95) 0%,transparent 100%),radial-gradient(1px 1px at 42% 92%,rgba(255,255,255,.8) 0%,transparent 100%);animation:tw 5s ease-in-out infinite alternate;}\n.splash-content{position:relative;z-index:1;text-align:center;}\n.splash-title{font-family:'Cormorant Garamond',serif;font-size:36px;font-weight:600;color:var(--gd2);letter-spacing:3px;text-shadow:0 0 40px rgba(201,168,76,.6);margin-top:20px;opacity:0;animation:splashIn .8s ease .3s forwards;}\n.splash-text{font-family:'Cormorant Garamond',serif;font-size:15px;color:#c9a84c;letter-spacing:1px;margin-top:14px;font-style:italic;overflow:hidden;white-space:nowrap;width:0;border-right:2px solid rgba(201,168,76,.7);animation:typing 2s steps(36) .8s forwards,blinkCaret .6s step-end infinite;}\n@keyframes splashIn{from{opacity:0;transform:translateY(15px)}to{opacity:1;transform:translateY(0)}}\n@keyframes splashFade{to{opacity:0;pointer-events:none}}\n@keyframes typing{from{width:0}to{width:100%}}\n@keyframes blinkCaret{0%,100%{border-color:rgba(201,168,76,.7)}50%{border-color:transparent}}\n";

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
  // Persist slots to localStorage tako da ne nestanu kad korisnik zatvori app
  function loadSlots(key,fallback){try{var raw=localStorage.getItem(key);if(!raw)return fallback;var parsed=JSON.parse(raw);if(Array.isArray(parsed)&&parsed.length===fallback.length)return parsed;return fallback;}catch(e){return fallback;}}
  var emptyDs={paste:"",pitanja:"",clientName:"",clientBirthDate:"",clientId:null,an:"",st:"idle",ci:0,jobId:null};
  var emptyPq={prev:"",quest:"",clientName:"",clientBirthDate:"",clientId:null,an:"",st:"idle",ci:0,jobId:null};
  var [slots,setSlots]=useState(function(){return loadSlots("ab_slots",[emptySlot(),emptySlot(),emptySlot()]);});
  var [custPr,setCustPr]=useState({sr:{main:"",ds:"",pitanja:""},hr:{main:"",ds:"",pitanja:""}});
  var [analyses,setAnalyses]=useState([]);
  var [toast,setToast]=useState("");
  var [dsSlots,setDsSlots]=useState(function(){return loadSlots("ab_dsSlots",[emptyDs,emptyDs,emptyDs]);});
  function upDs(idx,fn){setDsSlots(function(prev){var nv=prev.slice();nv[idx]=fn(nv[idx]);return nv;});}
  var [pqSlots,setPqSlots]=useState(function(){return loadSlots("ab_pqSlots",[emptyPq,emptyPq,emptyPq]);});
  function upPq(idx,fn){setPqSlots(function(prev){var nv=prev.slice();nv[idx]=fn(nv[idx]);return nv;});}
  useEffect(function(){try{localStorage.setItem("ab_slots",JSON.stringify(slots));}catch(e){}},[slots]);
  useEffect(function(){try{localStorage.setItem("ab_dsSlots",JSON.stringify(dsSlots));}catch(e){}},[dsSlots]);
  useEffect(function(){try{localStorage.setItem("ab_pqSlots",JSON.stringify(pqSlots));}catch(e){}},[pqSlots]);
  // Resume polling ako neki slot jos uvek ima status "generating" posle restart-a app-a
  useEffect(function(){
    slots.forEach(function(s,idx){
      if(s&&s.status==="generating"&&s.jobId){
        (async function(){
          try{
            var resp=await fetch(API+"/api/generate/"+s.jobId);
            if(!resp.ok)return;
            var job=await resp.json();
            if(job.status==="done"){
              var finalText=fmtText(job.serbian_text||"");
              upSlot(idx,function(cur){return Object.assign({},cur,{status:"done",analysis:finalText,jobId:null});});
            }else if(job.status==="error"){
              upSlot(idx,function(cur){return Object.assign({},cur,{status:"done",analysis:job.serbian_text||"Greska pri generisanju."});});
            }
          }catch(e){console.warn("Resume A"+(idx+1)+" failed:",e.message);}
        })();
      }
    });
    dsSlots.forEach(function(s,idx){
      if(s&&s.st==="generating"&&s.jobId){
        (async function(){
          try{
            var resp=await fetch(API+"/api/generate/"+s.jobId);
            if(!resp.ok)return;
            var job=await resp.json();
            if(job.status==="done"){
              var ft=fmtText(job.serbian_text||"");
              upDs(idx,function(cur){return Object.assign({},cur,{an:ft,st:"done",jobId:null});});
            }else if(job.status==="error"){
              upDs(idx,function(cur){return Object.assign({},cur,{an:job.serbian_text||"Greska.",st:"done"});});
            }
          }catch(e){console.warn("Resume DS"+(idx+1)+" failed:",e.message);}
        })();
      }
    });
    pqSlots.forEach(function(s,idx){
      if(s&&s.st==="generating"&&s.jobId){
        (async function(){
          try{
            var resp=await fetch(API+"/api/generate/"+s.jobId);
            if(!resp.ok)return;
            var job=await resp.json();
            if(job.status==="done"){
              var ft=fmtText(job.serbian_text||"");
              upPq(idx,function(cur){return Object.assign({},cur,{an:ft,st:"done",jobId:null});});
            }else if(job.status==="error"){
              upPq(idx,function(cur){return Object.assign({},cur,{an:job.serbian_text||"Greska.",st:"done"});});
            }
          }catch(e){console.warn("Resume Pq"+(idx+1)+" failed:",e.message);}
        })();
      }
    });
  },[]);
  var [clientsCache,setClientsCache]=useState([]);
  var [clientsLoaded,setClientsLoaded]=useState(false);
  async function loadClients(){
    if(clientsLoaded)return;
    try{
      var r=await fetch(API+"/api/clients");
      var d=await r.json();
      setClientsCache(d.clients||[]);
      setClientsLoaded(true);
    }catch(e){console.warn("loadClients failed:",e.message);}
  }
  var [editPr,setEditPr]=useState("main");
  var [viewAn,setViewAn]=useState(null);
  var [bazaSearch,setBazaSearch]=useState("");
  var [bazaDateFilter,setBazaDateFilter]=useState("");
  var [nuData,setNuData]=useState({name:"",email:"",pw:"",country:"sr"});
  var [activeJobs,setActiveJobs]=useState({});

  useEffect(function(){
    stoGet("custPr",{sr:{main:"",ds:"",pitanja:""},hr:{main:"",ds:"",pitanja:""}}).then(function(local){
      setCustPr(local);
      // Load from backend (overrides local)
      fetch(API+"/api/prompts").then(function(r){return r.json();}).then(function(d){
        if(d.prompts&&Object.keys(d.prompts).length>0){
          var merged={sr:Object.assign({main:"",ds:"",pitanja:""},local.sr||{},d.prompts.sr||{}),hr:Object.assign({main:"",ds:"",pitanja:""},local.hr||{},d.prompts.hr||{})};
          setCustPr(merged);stoSet("custPr",merged);
        }
      }).catch(function(){});
    });
    stoGet("analyses",[]).then(setAnalyses);
    stoGet("session",null).then(function(u){if(u){setUser(u);if(!u.country)setShowCtr(true);}});
    // Load shared analyses from backend - all users see all
    fetch(API+"/api/analyses?limit=300").then(function(r){return r.json();}).then(function(d){
      if(d.analyses&&d.analyses.length>0){setAnalyses(d.analyses);}
    }).catch(function(e){console.warn("Could not load shared analyses:",e.message);});
  },[]);

  // Refresh analyses from backend periodically while on Baza tab
  useEffect(function(){
    if(tab!=="baza")return;
    var refresh=function(){
      fetch(API+"/api/analyses?limit=300").then(function(r){return r.json();}).then(function(d){
        if(d.analyses)setAnalyses(d.analyses);
      }).catch(function(){});
    };
    refresh();
    var interval=setInterval(refresh,15000); // refresh every 15 sec
    return function(){clearInterval(interval);};
  },[tab]);

  useEffect(function(){
    var t=setTimeout(function(){setShowSplash(false);},4000);
    return function(){clearTimeout(t);};
  },[]);

  useEffect(function(){
    if(tab==="admin"&&user&&user.role==="admin") loadAdminUsers();
    if(tab&&(tab.indexOf("downsell")===0||tab.indexOf("pitanja")===0)) loadClients();
  },[tab]);

  function toast2(m){setToast(m);setTimeout(function(){setToast("");},3000);}
  function upSlot(i,fn){setSlots(function(p){return p.map(function(s,j){return j===i?fn(s):s;});});}
  var country=(user&&user.country)||"sr";
  function getPr(type){var cp=custPr[country];return(cp&&cp[type])||(country==="hr"?(type==="main"?PR_HR_MAIN:PR_HR_DS):(type==="main"?PR_SR_MAIN:PR_SR_DS));}
  var astroName=country==="hr"?"Marija":"Suzana";

  // AUTH
  async function doLogin(){
    setLerr("");
    try{
      var r=await fetch(API+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:lEmail.trim().toLowerCase(),password:lPw})});
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
      var r=await fetch(API+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:rEmail.trim().toLowerCase(),password:rPw,name:rName.trim(),country:"sr"})});
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
      var r=await fetch(API+"/api/auth/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:pendUser.email,code:entCode})});
      var d=await r.json();
      if(!r.ok)return setLerr(d.error||"Pogresan kod.");
      setLm("login");setLerr("");setLsuc("Email verifikovan! Prijavi se.");
    }catch(e){setLerr("Greska. Provjeri konekciju.");}
  }
  async function doForgot1(){
    if(!fEmail.includes("@"))return setLerr("Unesite email.");
    setLerr("");
    try{
      var r=await fetch(API+"/api/auth/forgot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:fEmail.trim().toLowerCase()})});
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
      var r=await fetch(API+"/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:fEmail.trim().toLowerCase(),code:fCode,newPassword:fNewPw})});
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
      var r=await fetch(API+"/api/admin/users",{headers:{"x-user-id":user.id}});
      var d=await r.json();
      if(d.users)setAdminUsers(d.users);
    }catch(e){}
  }
  async function deleteAdminUser(id){
    try{
      await fetch(API+"/api/admin/users/"+id,{method:"DELETE",headers:{"x-user-id":user.id}});
      loadAdminUsers();
      toast2("Korisnik uklonjen.");
    }catch(e){toast2("Greska.");}
  }
  async function addAdminUser(){
    if(!nuData.name||!nuData.email||!nuData.pw)return toast2("Popuni sva polja.");
    try{
      var r=await fetch(API+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json","x-admin-override":"true","x-user-id":(user&&user.id)||""},body:JSON.stringify({email:nuData.email.toLowerCase(),password:nuData.pw,name:nuData.name,country:nuData.country})});
      var d=await r.json();
      if(!r.ok)return toast2(d.error||"Greska.");
      setNuData({name:"",email:"",pw:"",country:"sr"});
      toast2(d.message&&d.message.indexOf("updated")>=0?"Lozinka korisnika azurirana!":"Korisnik dodat!");
      loadAdminUsers();
    }catch(e){toast2("Greska.");}
  }

  // PARSE
  async function doParse(idx){
    var s=slots[idx];if(!s.paste.trim())return;
    upSlot(idx,function(s){return Object.assign({},s,{status:"parsing"});});
    try{
      var p=await parseMsg(s.paste);
      if(p&&p.__error){
        upSlot(idx,function(s){return Object.assign({},s,{status:"idle"});});
        toast2(p.__error);
      }else if(p){
        upSlot(idx,function(s){return Object.assign({},s,{status:"idle",parsed:p,paste:"",
          client:Object.assign({},s.client,p.klijent||{},{pitanja:p.pitanja||""}),
          partner:p.imaPartnera?Object.assign({},s.partner,p.partner||{}):s.partner,
          hasPart:p.imaPartnera||s.hasPart,
          types:p.imaPartnera?["sinastrija"]:s.types
        });});
        toast2("Podaci prepoznati!");
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

  function makeBirthData(dateStr,timeStr,cityName){
    var p=dateStr.split("-"),dt=(timeStr||"12:00").split(":");
    var coords=getCoords(cityName);
    return{year:parseInt(p[0]),month:parseInt(p[1]),day:parseInt(p[2]),hour:parseInt(dt[0]),minute:parseInt(dt[1]),latitude:coords[0],longitude:coords[1],timezone:getTimezone(cityName)};
  }

  async function astroPost(endpoint,body){
    var resp=await fetch("https://astrobalkan-backend.onrender.com/api/astro"+endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    if(!resp.ok){console.warn("AstroAPI "+endpoint+" => HTTP "+resp.status);return null;}
    return await resp.json();
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

  async function callAstroAPI(dateStr,timeStr,cityName){
    try{
      var bd=makeBirthData(dateStr,timeStr,cityName);

      // PRIMARY: Use backend Swiss Ephemeris (NASA-level precision)
      try{
        var chartResp=await fetch(API+"/api/chart",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bd)});
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
      var coords=getCoords(cityName);
      var dp=dateStr.split("-"),tp=(timeStr||"12:00").split(":");
      var J=jd(parseInt(dp[0]),parseInt(dp[1]),parseInt(dp[2]),parseInt(tp[0])+parseInt(tp[1])/60-coords[1]/15);
      if(timeStr){var ad=ascLon(J,coords[0],coords[1]);var mc=mcLon(J,coords[1]);chart.ascSign=signOf(ad);chart.ascDeg=degIn(ad);var hs=getHouses(ad,mc,coords[0]);chart.houses=hs.map(function(h,i){return{num:i+1,sign:signOf(h),deg:degIn(h)};});}
      chart.solarReturn=null;
      chart.source="astrology-api-v3-fallback";
      return chart;
    }catch(e){console.warn("callAstroAPI failed:",e.message);return null;}
  }

  // Synastry via API (za sinastiju)
  async function callSynastryAPI(dateStr1,timeStr1,city1,dateStr2,timeStr2,city2){
    try{
      var bd1=makeBirthData(dateStr1,timeStr1,city1);
      var bd2=makeBirthData(dateStr2,timeStr2,city2);
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
      console.log("doCalc START for:",sl.client.ime,sl.client.datum,sl.client.vreme,sl.client.mesto);
      // Try astrology-api.io first (Swiss Ephemeris precision)
      var c=null;
      try{c=await callAstroAPI(sl.client.datum,sl.client.vreme,sl.client.mesto);}catch(e){console.error("callAstroAPI crashed:",e);}
      if(!c){
        // Fallback to local calculation
        console.log("Using local fallback calculation");
        var coords=getCoords(sl.client.mesto);
        c=calcChart(sl.client.datum,sl.client.vreme,coords[0],coords[1]);
        console.log("Local calc result:",c?c.planets.length+" planets":"null");
      }
      var pc=null;
      if(sl.hasPart&&sl.partner.datum){
        try{pc=await callAstroAPI(sl.partner.datum,sl.partner.vreme,sl.partner.mesto);}catch(e){console.error("Partner callAstroAPI crashed:",e);}
        if(!pc){var pc2=getCoords(sl.partner.mesto);pc=calcChart(sl.partner.datum,sl.partner.vreme,pc2[0],pc2[1]);}
      }
      console.log("doCalc DONE, planets:",c?c.planets.length:0,"aspects:",c?c.aspects.length:0);
      upSlot(idx,function(s){return Object.assign({},s,{ch:c,pch:pc,status:"idle"});});
      // Fetch transits in background
      fetchTransits(idx,sl.client.datum,sl.client.vreme,sl.client.mesto);
    }catch(e){
      console.error("doCalc FATAL error:",e);
      upSlot(idx,function(s){return Object.assign({},s,{status:"idle"});});
    }
  }

  async function fetchTransits(idx,dateStr,timeStr,cityName){
    try{
      var bd=makeBirthData(dateStr,timeStr,cityName);
      console.log("TRANSITS calling:",API+"/api/astro/transits","body:",JSON.stringify({birth_data:bd}).slice(0,200));
      var resp=await fetch(API+"/api/astro/transits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({birth_data:bd})});
      console.log("TRANSITS status:",resp.status);
      if(!resp.ok){var errText=await resp.text();console.error("TRANSITS error response:",errText.slice(0,300));return;}
      var data=await resp.json();
      console.log("TRANSITS full response:",JSON.stringify(data).slice(0,800));
      var transits=parseTransits(data);
      console.log("TRANSITS parsed:",transits.length,"items",transits.length>0?JSON.stringify(transits[0]):"(empty)");
      if(transits&&transits.length>0){
        upSlot(idx,function(s){return Object.assign({},s,{transits:transits});});
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
    var sl=slots[idx];if(!sl||!sl.ch)return;
    upSlot(idx,function(s){return Object.assign({},s,{status:"generating",analysis:"",copyIdx:0});});
    var today=new Date(),todayStr=fmtDMY(today);
    var MONTH_EN=["January","February","March","April","May","June","July","August","September","October","November","December"];
    var curYear=today.getFullYear(),curMonth=today.getMonth(),curMonthName=MONTH_EN[curMonth];
    var dateAwareness="\n\n*** CRITICAL - DATE AWARENESS ***\nTODAY: "+todayStr+"\nCURRENT YEAR: "+curYear+"\nCURRENT MONTH: "+curMonthName+" "+curYear+"\n\nSTRICT DATE RULES:\n1. Every date you write in forecasts MUST be AFTER today ("+todayStr+").\n2. Verify each month you mention — if that month has already passed this year, either use the SAME month of "+(curYear+1)+" or skip to a future month.\n   - Example: if today is "+curMonthName+" "+curYear+" and you want 'u martu', March "+curYear+" is past — use 'u martu "+(curYear+1)+"'.\n   - Example: if today is May "+curYear+" and you want 'u januaru', that's past — use 'u januaru "+(curYear+1)+"'.\n3. NEVER write "+(curYear-1)+" or earlier as the current or future year. Current year is "+curYear+".\n4. All forecasts span "+todayStr+" to end of "+(curYear+1)+".\n5. Before writing each date, pause and verify: 'Is this date after "+todayStr+"? Yes → write it. No → shift to "+(curYear+1)+" or skip.'\n6. If the client mentions a FIXED future event (due date, wedding, surgery on specific date), respect that exact date. Do NOT write predictions that contradict or undermine it.\n7. DATE FORMAT — NUMERIC ONLY: every date MUST be written as digits in DD.MM.YYYY format. CORRECT: '20.10.2026.', 'od 5.8. do 15.9.2027.', '15.3.2027.'. FORBIDDEN: spelling out numbers ('dvadesetog oktobra', 'dve hiljade dvadeset šeste'), descriptive phrases without digits ('u petom mesecu', 'krajem drugog meseca'). Day and month as numerals, year as 4 digits. When giving a period, use 'od DD.MM. do DD.MM.YYYY.' or 'DD.MM. — DD.MM.YYYY.'. Descriptive phrases like 'pocetkom maja' or 'sredinom juna' are OK when no specific date is needed — but any number MUST be a digit.\n";
    var personContext="\n*** CRITICAL - PERSON CONTEXT SEPARATION ***\nThe main client is: "+(sl.client.ime||"client")+".\n- ALL forecasts, predictions, love/work/health statements refer to THIS CLIENT unless text explicitly says otherwise.\n- If the context mentions OTHER people (child, partner, parent, sibling, friend, ex), keep their contexts strictly SEPARATED.\n- NEVER attribute the client's situation to another person.\n- NEVER attribute another person's situation (pregnancy, illness, marriage, new job) to the client.\n- If an event is about the client's daughter, write it AS ABOUT THE DAUGHTER, not as about the client.\n- When in doubt whose life an event belongs to, re-read the context carefully before writing.\n";
    var ptxt=sl.ch.planets.map(function(p){return p.name+": "+p.sign+" "+p.degInSign+"°"+(p.house?" ("+p.house+". kuca)":"");}).join("\n");
    var atxt=sl.ch.aspects.map(function(a){return a.p1+" "+a.aspect+" "+a.p2+" (orb: "+a.orb+"°)";}).join("\n");
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
    var sys=identityLock+"WRITE IN ENGLISH. Text will be translated to Serbian later."+dateAwareness+personContext+"\n\nYou are "+aName+", a top FEMALE astrologer with 30 years of experience. You write everything in FEMININE voice.\n\n*** CRITICAL - FEMININE VOICE (ALWAYS, NO EXCEPTIONS) ***\nEvery self-reference, every past-tense verb about yourself, every adjective agreeing with you must be FEMININE. The translation into Serbian must preserve feminine grammatical forms. Examples of CORRECT feminine forms in Serbian that the translator will produce:\n- 'videla sam' (NOT 'video sam')\n- 'pogledala sam' (NOT 'pogledao sam')\n- 'napisala sam' (NOT 'napisao sam')\n- 'primetila sam' (NOT 'primetio sam')\n- 'zakljucila sam' (NOT 'zakljucio sam')\n- 'rekla bih' (NOT 'rekao bih')\n- 'iskrena sam' (NOT 'iskren sam')\n- 'sigurna sam' (NOT 'siguran sam')\n- 'bila sam' (NOT 'bio sam')\nWhen writing in English, always use 'I saw', 'I noticed', 'I wrote', 'I concluded', 'I would say', 'I am certain', etc., and add the English note '(feminine voice - translate to Serbian feminine form)' in your output IF the word can be ambiguous. The translator is instructed to always use feminine Serbian forms for the astrologer's voice.\n\n*** CRITICAL - HEALTH DISCLAIMER ***\nIf the analysis mentions health, illness, body, pregnancy, medical conditions, therapy, medication, diet, anxiety, depression, sleep, or any physical/mental wellness topic — you MUST end that section (or the analysis) with a clear disclaimer in the voice of the female astrologer: 'Molim te da ovo ne uzimas kao medicinski savet. Ja sam astrolog, nisam lekar. Obavezno se konsultuj sa lekarom i slusaj njegove/njene savete. Astrologija ukazuje na energetske sklonosti, ali samo lekar moze da ti da stvarnu dijagnozu i terapiju.' Write this in English so it gets translated, e.g.: 'Please do not take this as medical advice. I am an astrologer, not a doctor. You must consult a doctor and follow their advice. Astrology shows energetic tendencies, but only a doctor can give you a real diagnosis and treatment.'\n";
    if(isSinastrija){
      sys+="\n\nTASK: SYNASTRY analysis comparing TWO natal charts - about the RELATIONSHIP DYNAMIC between "+(sl.client.ime||"client")+" and "+partnerName+". This is about the COUPLE.";
    }else{
      sys+="\n\nTHIRD PERSON RULE: If Name contains family relation (daughter, son, brother, sister, husband, wife, mom, dad, friend, aunt, uncle) - analysis is about that person, speak TO client ABOUT them in third person. Otherwise address directly using 'ti'.";
    }
    sys+="\n\nTONE: Start the analysis by addressing the client ('"+(sl.client.ime||"klijent")+"') directly with their name followed by a comma, then IMMEDIATELY dive into the SUBSTANCE of the analysis. First sentence after the vocative must describe the client's nature, character, or a concrete insight from the chart.\n\n*** CRITICAL - NO INTRO PREAMBLE ***\nAfter the opening vocative, NEVER write a preamble/introduction sentence describing what the analysis will cover. The client already knows they are reading an analysis — do NOT announce it.\n\nFORBIDDEN intro phrases (never use these or variations):\n- 'evo tvoje detaljne analize'\n- 'evo tvoje astroloske analize'\n- 'na osnovu podataka/tvoje karte/vasih natalnih karata'\n- 'videces sta te ceka'\n- 'videcemo sta vas ceka u ljubavi, poslu, zivotu'\n- 'prognoze za narednih 12 meseci' (as intro — can appear as substance later)\n- 'krecemo sa analizom'\n- 'donosim ti analizu'\n- 'pogledala sam tvoju kartu i...'\n- Any sentence that merely ANNOUNCES what the analysis will cover instead of delivering insight\n\nCORRECT opening examples (straight into substance):\n- 'Milice, tvoj Sunce u Ribama pokazuje duboku emotivnu prirodu...'\n- 'Jovana, vidim osobu koja je dugo nosila tugu...'\n- 'Marko, tvoja karta otkriva coveka izmedju stabilnosti i nemira...'\n\nWRONG openings (preamble):\n- 'Gordana, evo tvoje detaljne analize za narednih 12 meseci...' (banned: preamble)\n- 'Ana, na osnovu tvoje karte videcemo sta te ceka...' (banned: preamble)\n\n*** CRITICAL - CORRECT SERBIAN VOCATIVE FOR NAMES ***\nThe ONLY valid client name is: '"+(sl.client.ime||"klijent")+"' (confirmed in CLIENT IDENTITY LOCK at top).\nThe names listed below are GRAMMAR EXAMPLES — they are NOT the client. Do NOT use them as the client's name, only as a pattern reference for applying vocative endings to '"+(sl.client.ime||"klijent")+"'. If '"+(sl.client.ime||"klijent")+"' fits one of these patterns, apply it; if uncertain, use '"+(sl.client.ime||"klijent")+"' in nominative.\n\nFEMALE NAMES (examples only, not the client):\n- Names ending in -ica: Milica→Milice, Zorica→Zorice, Dragica→Dragice, Radica→Radice, Ljubica→Ljubice, Jasmina→Jasmina (-ina keeps same)\n- Names ending in -ana/-ina/-ena/-ela: KEEP AS IS — Dragana→Dragana, Jovana→Jovana, Karolina→Karolina, Jelena→Jelena, Svetlana→Svetlana, Gordana→Gordana, Milena→Milena, Daniela→Daniela\n- Names ending in -a (other than -ica/-ana/-ina/-ena/-ela): KEEP AS IS — Ana→Ana, Ivana→Ivana, Sanja→Sanja, Marina→Marina, Nina→Nina, Tanja→Tanja, Mirjana→Mirjana, Milka→Milka, Magda→Magda, Vanja→Vanja, Maja→Maja, Nada→Nada, Ljilja→Ljilja, Mira→Mira, Iva→Iva, Marija→Marija\n- Names ending in -ija: KEEP AS IS — Marija→Marija, Natalija→Natalija, Sofija→Sofija\n\n*** KRITICNO - SLICNA A RAZLICITA IMENA ***\nNIKADA ne mesaj slicna ali RAZLICITA imena:\n- Milka ≠ Milica. Milka ostaje Milka (zavrsava na -ka). Milica postaje Milice.\n- Maja ≠ Marija. Maja ostaje Maja. Marija ostaje Marija.\n- Vanja ≠ Vanesa. Vanja ostaje Vanja.\n- Nada ≠ Nadica. Nada ostaje Nada. Nadica postaje Nadice.\nUvek koristi TACNO ime iz CLIENT IDENTITY LOCK. Ne zamenjuj ga slicnim imenom!\n\nMALE NAMES:\n- Consonant ending: Marko→Marko (keep, -o ending), Ivan→Ivane, Dragan→Dragane, Stefan→Stefane, Milan→Milane, Nikola→Nikola (keep, -a masculine keeps)\n- Names ending in -o: KEEP AS IS — Marko→Marko, Darko→Darko, Zdravko→Zdravko, Vladimir→Vladimire\n- Names ending in -a masculine: KEEP AS IS — Nikola→Nikola, Luka→Luka, Uroš→Uroše\n\nABSOLUTE RULES:\n- NEVER 'Dragana' → 'Dragano' or 'Dragane' (both WRONG for female Dragana)\n- NEVER 'Jovana' → 'Jovano' (WRONG)\n- NEVER 'Karolina' → 'Karolino' (WRONG)\n- NEVER add '-o' ending to female -ana/-ina/-ena names\n- WHEN IN DOUBT, USE NOMINATIVE (name as written) — it sounds natural in modern Serbian\n- Wrong vocative sounds uneducated and offends the client\n\n*** CRITICAL - CLIENT NAME USAGE: ONLY IN OPENING VOCATIVE ***\nThe CLIENT's name ('"+(sl.client.ime||"klijent")+"') appears ONLY ONCE — in the vocative at the very beginning of the analysis (first sentence, followed by comma).\nAfter that opening, you MUST address the client using 'ti' (and its forms: tebi, tebe, tvoj, tvoja, tvoje) throughout the ENTIRE text — NEVER write the client's name again anywhere in the body, in section headers, in transitions, or at the end.\nFORBIDDEN:\n- Repeating the client's name in paragraph starts (e.g., 'A sad, Milice...')\n- Using the client's name in section titles\n- Ending the analysis with the client's name (e.g., 'Srecno, Ana')\n- ANY occurrence of the client's name after the first sentence\nThe closing is always 'Hvala ti puno...' — WITHOUT the name.\nThis rule eliminates all vocative errors: the name appears exactly 1x, so there is no chance to mis-conjugate it repeatedly.\n\nWarm, direct 'ti' address.\n\n*** CRITICAL - NEVER 100% GUARANTEES FOR FUTURE EVENTS ***\nAstrology shows TENDENCIES and POSSIBILITIES, not certain future events. Differentiate tone:\n\nCHARACTER descriptions / patterns / general insights — speak with CERTAINTY:\n- 'Tvoja priroda je...' (OK)\n- 'Tvoj Mesec pokazuje...' (OK)\n- 'Karta donosi...' (OK)\n- 'Imas tendenciju da...' (OK)\n- 'Ti si osoba koja...' (OK)\n\nSPECIFIC FUTURE EVENTS with dates — NEVER guarantee, use probability language:\n\nFORBIDDEN (100% garancije za buduce dogadjaje):\n- 'U martu 2027. ces se udati.' (WRONG - 100% garancija)\n- 'Desice se trudnoca u junu 2026.' (WRONG)\n- 'Dobices posao 15.09.2026.' (WRONG)\n- 'Rodice se dete u septembru 2026.' (WRONG)\n- 'Ce se desiti brak' sa datumom (WRONG)\n\nCORRECT (verovatnoca, ne garancija):\n- 'U martu 2027. postoji velika mogucnost za brak.' (OK)\n- 'Jun 2026. donosi snaznu energiju za trudnocu.' (OK)\n- 'Sredinom septembra 2026. otvara se sansa za novi posao.' (OK)\n- 'Septembar 2026. nosi potencijal za rodjenje deteta.' (OK)\n- 'Ovo vreme pogoduje braku.' (OK)\n\nCoristi fraze: 'postoji velika mogucnost', 'snazna sansa', 'otvara se prilika', 'donosi energiju za', 'potencijal', 'pogoduje', 'vreme je povoljno za', 'mogucnost', 'ukazuje na'. Izbegavaj 'ce se desiti', 'sigurno', '100%', 'garantujem', 'obavezno' za konkretne buduce dogadjaje sa datumom. I DALJE ZABRANjeno slabo hedging 'mozda', 'moglo bi', 'verovatno' — to nije relativizovanje, to je AI kukavicluk.\n\n*** CRITICAL - NEVER WRITE WHAT YOU CAN'T DO ***\nYou have full chart data for the client. NEVER write disclaimers about limitations or missing data. The client MUST NEVER feel the service is incomplete. If partner/child has no birth time, quietly work with what you have (Sun sign from date) without mentioning limitations.\n\nFORBIDDEN (ruse kredibilitet usluge):\n- 'Za dublju analizu bilo bi potrebno izracunati tacnu kartu...'\n- 'Nemam podatke za Mesec/Ascendent deteta...'\n- 'Ne mogu da vidim Ascendent bez tacnog vremena...'\n- 'Bez tacnog vremena rodjenja ne mogu precizno...'\n- 'Idealno bi bilo da imamo...'\n- 'Bila bi potrebna dodatna informacija...'\n- 'Za preciznu prognozu treba mi...'\n- Bilo koja recenica koja pominje sta AI NE MOZE ili sta NEDOSTAJE.\n\nAstrolog sa 30 godina iskustva nikad ne najavljuje svoje granice klijentu. Radi sa onim sto imas. Ako je partner samo datum rodjenja — opisuj Sun sign i ne pominji da nedostaje Mesec/Ascendent.\n\n*** CRITICAL - EXACT CHART DATA ***\nThe PODACI O KLIJENTU section contains EXACT astrological data calculated by NASA-grade Swiss Ephemeris: Sunce, Mesec, Ascendent, planetary positions, houses, and aspects are 100% ACCURATE based on the provided birth date, time, and place. You MUST use these EXACT values. NEVER hedge with words like 'verovatno', 'mozda', 'zavisno od vremena', 'priblizno', 'oko' when discussing the chart. If the data says 'Sunce: Pisces, Ascendent: Taurus' - write confidently that Sun is in Pisces and Ascendant is in Taurus. NEVER guess, NEVER add uncertainty phrases. The data you received IS the correct chart - trust it absolutely.\n\nFORBIDDEN:\n- NEVER planet names, houses, degrees, astrological terms in text - write what it MEANS concretely\n- NEVER physical metaphors ('sedi nasuprot mene', 'sit across from me', 'imagine sitting')\n- NEVER dashes (-) - use commas instead\n- NEVER markdown: # ## ### **bold** *italic* --- __underline__\n- NEVER bullets or lists with dots, dashes, asterisks or any decorative symbol\n- NEVER checkmarks (✅ ✓ ✔ ☑) or X marks (❌ ✗ ×) or arrows (→ ➡ ⇒)\n- NEVER 'Evo', 'Hajde da pogledamo', 'Analiziramo' - sounds like AI\n- NEVER 'Kljucno je da', 'Vazno je istaci', 'Treba napomenuti' - AI cliches\n- NEVER 'T.' or 'Tr.' or 'Transit' prefix before planets. Write 'Saturn', 'Jupiter', NOT 'T.Saturn', 'Tr.Jupiter'. The client does not know what 'T.' means.\n- NEVER 'Tranzitni' or 'Tranzitna' prefix before planet names. Write 'Saturn donosi', NOT 'Tranzitni Saturn donosi'. Klijent ne razume termin 'tranzitni'.\n- NEVER parenthetical 'data notes' or 'reasoning' in the text like '(podaci: Pluton u Vagi, verovatno 7. kuca)', '(napomena: ...)', '(pretpostavka: ...)', '(jer ...)'. The analysis must be CLEAN PROSE. Never show your calculation/data reasoning to the client.\n- NEVER mention 'kuca' / 'house' / '7. kuca' / '10. kuca' — the client does not care about astrological houses. Just describe what the life area means (love, work, home).\n- NEVER self-questioning or thinking aloud in the text: 'T.Jupiter ulazi u Vagu?' is WRONG (AI asking itself). 'Zapravo,...' as self-correction is WRONG. '(ako pretpostavimo)' is WRONG. '(vec u aspektu)' is WRONG. 'u zavisnosti od aspekta' is WRONG. Be definitive. If unsure — leave it out entirely.\n- NEVER degree symbols like '3° Riba', '15° Lav' — client doesn't care about technical degrees.\n- WRITE LIKE A HUMAN: natural paragraphs, no symbols, no decoration. Indistinguishable from real person typing.\n- NEVER emojis in body (only Astrolog "+aName+" \u2764\uFE0F at very end)\n- NEVER skip any client question\n- NEVER hedge the chart data ('verovatno', 'mozda', 'zavisno od tacnog vremena', 'priblizno')\n\nMANDATORY SECTIONS (ALL must be present, REGARDLESS of admin prompt):";
    if(isSinastrija){
      sys+="\n1. Intro about the couple - immediate impression of their bond\n2. Emotional compatibility - how they feel each other\n3. Love and attraction - chemistry, passion, intimacy\n4. Communication dynamics - how they talk and understand\n5. Challenges and karma - what each must learn\n6. POSITIVE AND NEGATIVE TRAITS - list 4-5 positive and 4-5 negative traits FOR EACH PERSON separately, with advice what they should improve\n7. POSAO I NOVAC ZA "+(sl.client.ime||"KLIJENTA").toUpperCase()+" - career and money forecast for "+(sl.client.ime||"the client")+" INDIVIDUALLY (NOT about couple's business) - career direction, business opportunities, financial forecast next 12 months, best periods for work/investment (MUST be detailed, focused ONLY on "+(sl.client.ime||"the client")+")\n8. 12-MONTH FORECAST FOR THE RELATIONSHIP - divide by periods (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) with CONCRETE events in each period\n9. Honest conclusion about long-term potential";
    }else{
      sys+="\n1. Emotional intro - who is this person\n2. Inner world - character, psychology\n3. LJUBAV - major section - who is partner, what will happen in next 12 months CONCRETELY, romantic periods, warnings (MUST be detailed)\n4. POSAO I NOVAC - major section - career direction, business opportunities, financial forecast 12 months, best periods for investment/work (MUST be detailed)\n5. 12-MONTH FORECAST - divided by periods (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) with CONCRETE events in each period\n6. POSITIVE AND NEGATIVE TRAITS - list 4-5 positive and 4-5 negative traits, advice what to improve\n7. Health (brief) - end with disclaimer 'ovo nije medicinski savet, obavezno se obrati lekaru za sve zdravstvene probleme'\n8. Honest conclusion";
    }
    if(hasPitanja){
      sys+="\n\n*** CLIENT HAS ASKED SPECIFIC QUESTIONS ***\nYou MUST answer EVERY question from the client directly, clearly, and with certainty. Create a dedicated section titled 'Odgovori na tvoja pitanja' where you address each question one by one. Use 'bice' or 'ce se desiti' - never 'mozda' or 'moglo bi'. THIS IS MANDATORY - do not skip any question.\n\n*** CRITICAL - REFRAME EVERY QUESTION IN SECOND PERSON ***\nWhen you present the client's question before answering it, NEVER copy it verbatim in first person. REPHRASE it addressing the client with 'ti' (you) form. Examples:\n- Client wrote 'Ja sam zaljubljen u nju, sta da radim?' → you write 'Zaljubljen si u nju i pitas se sta da radis.' (then the answer)\n- Client wrote 'Ja sam dobar, zanima me ljubav' → you write 'Rekao si da si dobar, zanima te ljubav.' (then the answer)\n- Client wrote 'Da li cu se udati?' → you write 'Pitas se da li ces se udati.' (then the answer)\n- Client wrote 'Kada cu dobiti posao?' → you write 'Pitas kada ces dobiti posao.' (then the answer)\nRULES: swap 'ja/me/mene/moj' with 'ti/te/tebe/tvoj'; swap 'cu/sam' with 'ces/si'. Add natural lead-ins ('Pitas se...', 'Zanima te...', 'Rekao si da...', 'Zelis da znas...'). Keep ALL specific details (names, dates, context). Do NOT use quotation marks — integrate the rephrased question naturally into a sentence. Answer immediately after in 'ti' form.";
    }
    if(hasNapomena){
      sys+="\n\n*** ASTROLOGER'S NOTE (HIGHEST PRIORITY) ***\nThe astrologer has provided specific instructions in NAPOMENA. These instructions OVERRIDE any structure conflicts and MUST be followed strictly. Read NAPOMENA carefully and adjust the analysis accordingly.";
    }
    sys+="\n\nGRAMMAR: Serbian ekavica, Latin alphabet only. Perfect grammar. Titles end with ':' + newline. Questions end with '?' + newline. Never use '?:' together.\n\n*** MANDATORY LENGTH — minimum 2000 words. This is NOT optional. ***\n- Count your output as you write. If you near the end with less than 2000 words, CONTINUE — add more depth: more concrete events, more specific dates, more sub-topics within each life area.\n- Each mandatory section (love, work, 12-month forecast, traits, questions) must be at least 250 words on its own.\n- A short analysis (under 2000 words) is a FAILURE. Better verbose than concise.\n- Do NOT write the closing 'Hvala ti puno...' until you have produced at least 2000 words of analysis.\n- If the client has questions, those MUST be answered thoroughly, adding to the word count.\n\nAT THE END write exactly:\n"+(isSinastrija?"Hvala ti puno na poverenju i zelim ti odnos ispunjen ljubavlju, razumevanjem i radoscu.":"Hvala ti puno na poverenju i zelim ti zivot ispunjen mirom, radoscu i srecom.")+"\n\nAstrolog "+aName+" \u2764\uFE0F\n\nToday is: "+todayStr;
    var mainPr=getPr("main");
    // Build transit text
    var trTxt="";
    if(sl.transits&&sl.transits.length>0){
      if(sl.transits[0].natalPlanet){trTxt="\n\nTRANZITI ZA DANAS ("+todayStr+"):\n"+sl.transits.map(function(t){return t.planet+" "+t.aspect+" "+t.natalPlanet+(t.house?" ("+t.house+". kuca)":"")+" (orb "+t.orb+"°)"+(t.interpretation?" - "+t.interpretation:"");}).join("\n");}
      else{trTxt="\n\nTRANZITNE POZICIJE DANAS ("+todayStr+"):\n"+sl.transits.map(function(t){return t.planet+": "+t.sign+" "+t.deg+"°"+(t.retrograde?" R":"");}).join("\n");}
    }
    var srTxt="";
    if(sl.ch.solarReturn&&sl.ch.solarReturn.planets.length>0){
      srTxt="\n\nSOLARNA REVOLUCIJA (karta za "+sl.ch.solarReturn.year+". godinu):\n"+sl.ch.solarReturn.planets.map(function(p){return p.name+": "+p.sign+" "+p.deg+"°"+(p.house?" ("+p.house+". kuca)":"");}).join("\n");
    }
    var treceOsobe=["cerka","kcerka","ćerka","kćerka","sin","brat","sestra","zet","snaha","muz","muž","supruga","mama","tata","majka","otac","prijatelj","prijateljica","komsija","komšija","komsinca","komšinica","tetka","stric","ujak"];
    var imeLow=(sl.client.ime||"").toLowerCase().trim();
    var isTrece=treceOsobe.some(function(r){return imeLow.indexOf(r)>=0;});
    var trecePrefix=isTrece?"NAJVAZNIJE PRAVILO - TRECE LICE:\nOva analiza NIJE za klijenta koji ti se obraca nego za njegovu/njenu "+sl.client.ime+". Ti pricas sa klijentom O toj osobi.\nPISI UVEK OVAKO: 'Tvoja "+sl.client.ime+" je osoba koja...', 'Ona nosi u sebi...', 'Njen zivot je...', 'Vidim da je ona...'\nNIKAD NE PISI OVAKO: 'Ti si osoba koja...', 'Gledam tvoju kartu...', 'Vidim da si ti...'\nObraces se klijentu i pricas mu o njegovoj/njenoj "+sl.client.ime+" u trecem licu (ona/on). Klijent cita ovu analizu da razume svoju "+sl.client.ime+", ne sebe.\n\n":"";
    var hasTime=sl.client.vreme&&sl.client.vreme.trim().length>0;
    var ascInfo=hasTime&&sl.ch.ascSign&&sl.ch.ascSign!=="Nepoznato"?", Ascendent: "+sl.ch.ascSign+(sl.ch.ascDeg?" "+sl.ch.ascDeg+"°":""):"";
    var usr=trecePrefix+mainPr+"\n\n---\n\nPODACI O KLIJENTU:\nIme: "+(sl.client.ime||"")+"\nDatum rodjenja: "+sl.client.datum+", Vreme: "+(sl.client.vreme||"nije dostavljeno")+", Mesto: "+(sl.client.mesto||"nepoznato")+"\nSunce: "+sl.ch.sunSign+", Mesec: "+sl.ch.moonSign+ascInfo+"\n\nPLANETE:\n"+ptxt+"\n\nASPEKTI:\n"+atxt+pTxt+trTxt+srTxt;
    if(sl.client.napomena&&sl.client.napomena.trim()){
      usr+="\n\nNAPOMENA ASTROLOGA (OBAVEZNO POSTOVATI - PRIORITET NAD SVIM OSTALIM INSTRUKCIJAMA): "+sl.client.napomena;
    }
    usr+="\n\nPITANJA KLIJENTA: "+(sl.client.pitanja||"Bez specificnih pitanja. Napisi kompletnu analizu po promptu.");
    var ri=idx;
    try{
      // Submit job to backend for background processing
      var resp=await fetch(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system_prompt:sys,user_prompt:usr,client_name:sl.client.ime||"",job_type:"analiza",user_id:user&&user.id||"",birth_date:sl.client.datum||null,birth_time:sl.client.vreme||null,birth_place:sl.client.mesto||null})});
      var jobData=await resp.json();
      if(!jobData.id)throw new Error(jobData.error||"Failed to create job");
      // Save job ID in slot and localStorage
      upSlot(ri,function(s){return Object.assign({},s,{jobId:jobData.id,analysis:"Generisem analizu u pozadini..."});});
      var jobs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
      jobs["a"+(ri+1)]={id:jobData.id,clientName:sl.client.ime,tab:"a"+(ri+1),idx:ri};
      localStorage.setItem("activeJobs",JSON.stringify(jobs));
      // Start polling
      pollJob(jobData.id,ri,"a"+(ri+1),{birthDate:sl.client.datum,mesto:sl.client.mesto});
    }catch(err){
      console.error("doGen error:",err);
      upSlot(ri,function(s){return Object.assign({},s,{status:"done",analysis:"Greska: "+err.message});});
    }
  }

  // DOWNSELL GEN - prima idx (0, 1, ili 2) za jedan od 3 slota
  async function doDsGen(idx){
    var ds=dsSlots[idx];
    if(!ds.paste.trim()&&!ds.clientId)return;
    upDs(idx,function(s){return Object.assign({},s,{st:"generating",an:"",ci:0});});
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
    var sys=dsIdentityLock+"WRITE IN ENGLISH. The text will be translated to Serbian later."+dateAwarenessDS+personContextDS+contextAccuracyDS+multiPastDS+"\n\nYou are "+aName+", a top FEMALE astrologer with 30 years of experience. You write everything in FEMININE voice.\n\n*** CRITICAL - FEMININE VOICE (ALWAYS) ***\nYour voice is female. When translated to Serbian, every self-reference must be feminine: 'videla sam' (NOT 'video sam'), 'pogledala sam' (NOT 'pogledao sam'), 'napisala sam' (NOT 'napisao sam'), 'primetila sam', 'zakljucila sam', 'rekla bih', 'iskrena sam', 'sigurna sam', 'bila sam'. In English use 'I saw', 'I noticed' etc. — the translator is instructed to always use FEMININE Serbian forms for the astrologer.\n\n*** CRITICAL - HEALTH DISCLAIMER ***\nIf you mention health, illness, body, pregnancy, medical conditions, therapy, medication, diet, anxiety, depression, sleep, or any wellness topic — end that section with: 'Please do not take this as medical advice. I am an astrologer, not a doctor. You must consult a doctor and follow their advice. Astrology shows energetic tendencies, but only a doctor can give you a real diagnosis and treatment.'\n\n*** CRITICAL - CORRECT SERBIAN VOCATIVE (examples below are PATTERNS only, NOT the client) ***\nUse CORRECT Serbian vocative. The names in the examples below are ILLUSTRATIONS of grammar rules — they are NOT the current client. FEMALE: names on -ica→-e (e.g. Milica→Milice); names on -ana/-ina/-ena/-a KEEP AS IS (e.g. Dragana→Dragana, Ana→Ana). MALE: consonant→-e (e.g. Ivan→Ivane); on -o or -a keep (e.g. Marko→Marko). NEVER add '-o' ending to female -ana/-ina/-ena names. Wrong grammar offends. KRITICNO: NIKADA ne mesaj slicna ali RAZLICITA imena (Milka ≠ Milica, Maja ≠ Marija, Vanja ≠ Vanesa, Nada ≠ Nadica) — uvek koristi TACNO ime iz CLIENT IDENTITY LOCK.\n\n*** CRITICAL - NO CLIENT NAME IN DOWNSELL BODY ***\nDo NOT write the client's name ANYWHERE in the Downsell text. A Downsell has no greeting — it is a periods forecast, so there is no opening line that needs the name.\nAddress the client using 'ti' (tebi, tebe, tvoj, tvoja, tvoje) throughout every period and every sentence.\nFORBIDDEN: writing the name in section headers, transitions between periods, paragraph starts, or the end of any period.\nIf you feel tempted to write the name, STOP — replace with 'ti'.\nThis rule eliminates vocative errors: no name, no chance to mis-conjugate.\n\nTASK: Based on the client analysis, write EXACT PERIODS for the next 12 months with specific dates. You may reference transits and planets as these are concrete forecast data.\n\n*** CRITICAL - NO INTRO PREAMBLE ***\nDownsell has NO greeting and NO intro. Start IMMEDIATELY with the first period. FORBIDDEN openings:\n- 'Evo tvojih perioda...', 'Na osnovu analize, videcemo...', 'Krecemo sa periodima...', 'Donosim ti prognozu za...', 'U narednih 12 meseci videces...'\nCORRECT opening: first sentence IS the first period's forecast (e.g., 'Od 5.5. do 20.6.2026. donosice ti...').\n\nWRITING STYLE: Write as a warm, living person talking to the client. Each period should be a natural paragraph of 5-6 sentences. Dates must be concrete and written within sentences without breaking.\n\nFORBIDDEN (text MUST look like a real person wrote it, not AI):\n- Uppercase section titles (APRIL MAY 2026 etc)\n- Bullet lists or any list with bullets/dashes/asterisks/dots\n- Short paragraphs of 1-2 sentences\n- Markdown symbols (## ** --- __)\n- Checkmarks (✅ ✓ ✔ ☑) or X marks (❌ ✗ ×) or arrows (→ ➡ ⇒) or any decorative symbol\n- ANY emoji in body (📌 📝 💡 🎯 ✨ 🔮 🌹 etc.)\n- Phrases 'Evo', 'Hajde da pogledamo', 'Analiziramo' - sounds like AI\n- Phrases 'Kljucno je da', 'Vazno je istaci', 'Treba napomenuti' - AI cliches\n- Guessing chart positions for other people without their exact time/place ('najverovatnije', 'verovatno Jarcu ili Vodniku')\n- Masculine forms ('video sam', 'pogledao sam' — always feminine)\n- Write LIKE A HUMAN: only words, commas, periods, question marks. NO symbols. NO decoration.\n\nSTRUCTURE: Write period by period as natural paragraphs. Each period has a concrete date and description of what will happen. Be direct and brutally honest.\n\n*** CRITICAL - NEVER 100% GUARANTEES FOR EVENTS ***\nNEVER guarantee specific future events. For periods use PROBABILITY language:\n- WRONG: 'U martu 2027. ces se udati.', 'Desice se trudnoca u junu.', 'Dobices posao 15.09.'\n- CORRECT: 'U martu 2027. postoji velika mogucnost za brak.', 'Jun 2026. donosi snaznu energiju za trudnocu.', 'Sredinom septembra 2026. otvara se sansa za posao.'\nCoristi: 'velika mogucnost', 'snazna sansa', 'otvara se prilika', 'donosi energiju', 'potencijal', 'pogoduje', 'povoljno za'. Izbegavaj 'ce se desiti', 'sigurno', '100%', 'garantujem' za konkretne dogadjaje. I DALJE zabranjeno slabo hedging 'mozda', 'moglo bi'.\n\n*** CRITICAL - NEVER WRITE WHAT YOU CAN'T DO ***\nNEVER disclaim missing data or limitations. FORBIDDEN: 'Za dublju analizu bilo bi potrebno...', 'Nemam podatke za...', 'Ne mogu bez...', 'Idealno bi bilo da imamo...'. Radi sa podacima koje imas. Ne rusi kredibilitet usluge.\n\n*** MANDATORY LENGTH — minimum 1800 words. This is NOT optional. ***\n- Count your output. If under 1800 words at the last period, CONTINUE with more periods or more depth per period.\n- Each period paragraph must be at least 8-10 sentences (not 5-6).\n- A short Downsell (under 1800 words) is a FAILURE. Better verbose than concise.\n\nIf questions reference other people (child, partner) without full birth data, use Sun sign only (from date) and focus on client's own chart dynamics with that person. NEVER ask for more data from client.\n\nDo NOT write any greeting or closing. No 'Thank you'. The analysis ends with the last period.\n\nToday is: "+todayStr+".";
    if(hasDsPitanja){
      sys+="\n\n*** CRITICAL - CLIENT HAS ASKED QUESTIONS ***\nThe client has asked SPECIFIC QUESTIONS in the DODATNA PITANJA KLIJENTA section of the user message. You MUST answer EVERY question directly, clearly, and in detail. Create a dedicated section titled 'Odgovori na tvoja pitanja' (place it near the end, right before the last forecast period OR at the very end as the closing of the analysis). For each question, write a paragraph of 5-7 sentences with a CERTAIN answer using 'bice', 'ce', 'desice se' — NEVER 'mozda', 'moglo bi', 'verovatno'. NEVER skip a question. NEVER merge multiple questions into one short answer. The questions are the PRIMARY PURPOSE of this Downsell - ignoring them means you have failed the task.\n\n*** CRITICAL - REFRAME EVERY QUESTION IN SECOND PERSON ***\nWhen you present the client's question before answering it, NEVER copy it verbatim in first person. REPHRASE it addressing the client with 'ti' form. Examples: 'Ja sam zaljubljen, sta da radim?' → 'Zaljubljen si i pitas se sta da radis.' 'Da li cu se udati?' → 'Pitas se da li ces se udati.' 'Kada cu dobiti posao?' → 'Pitas kada ces dobiti posao.' RULES: swap 'ja/me/moj/cu/sam' with 'ti/te/tvoj/ces/si'. Add natural lead-ins ('Pitas se...', 'Zanima te...', 'Rekao si da...'). Keep ALL specific details. Do NOT quote; integrate naturally. Answer in 'ti' form.";
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
      var dsName=ds.clientName.trim()||"Downsell";
      var resp=await fetch(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system_prompt:sys,user_prompt:usrContent,client_name:dsName,job_type:"downsell",user_id:user&&user.id||"",birth_date:ds.clientBirthDate||null,client_id:ds.clientId||null})});
      var jobData=await resp.json();
      if(!jobData.id)throw new Error(jobData.error||"Failed");
      upDs(idx,function(s){return Object.assign({},s,{an:"Generisem u pozadini...",jobId:jobData.id});});
      var jobs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
      var dsKey="ds"+(idx+1);
      jobs[dsKey]={id:jobData.id,clientName:"Downsell - "+dsName,tab:"downsell"+(idx+1),idx:idx};
      localStorage.setItem("activeJobs",JSON.stringify(jobs));
      var dsJobId=jobData.id;
      var dsInterval=setInterval(async function(){
        try{
          var jbs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
          if(!jbs[dsKey]){clearInterval(dsInterval);return;}
          var r=await fetch(API+"/api/generate/"+dsJobId);var j=await r.json();
          if(j.status==="generating")upDs(idx,function(s){return Object.assign({},s,{an:"Generisem analizu..."});});
          else if(j.status==="translating")upDs(idx,function(s){return Object.assign({},s,{an:"Prevodim na srpski..."});});
          else if(j.status==="done"){
            clearInterval(dsInterval);
            var jbs2=JSON.parse(localStorage.getItem("activeJobs")||"{}");delete jbs2[dsKey];localStorage.setItem("activeJobs",JSON.stringify(jbs2));
            var ft=fmtText(j.serbian_text||"");
            upDs(idx,function(s){return Object.assign({},s,{an:ft,st:"done",jobId:null});});
            setAnalyses(function(prev){
              if(prev.some(function(a){return a.jobId===dsJobId;}))return prev;
              var now=new Date();
              var upd=[{id:"d"+Date.now(),jobId:dsJobId,clientName:"Downsell - "+(dsName||belgradeDate(now)),sign:"",date:belgradeDateTime(now),rawDate:belgradeRawDate(now),types:["downsell"],analysis:ft,country:country,owner:user&&user.email}].concat(prev).slice(0,200);stoSet("analyses",upd);return upd;
            });
            toast2("Downsell "+(idx+1)+" gotov!");
          }else if(j.status==="error"){clearInterval(dsInterval);upDs(idx,function(s){return Object.assign({},s,{an:j.serbian_text||"Greska.",st:"done"});});var jbs3=JSON.parse(localStorage.getItem("activeJobs")||"{}");delete jbs3[dsKey];localStorage.setItem("activeJobs",JSON.stringify(jbs3));}
        }catch(e){}
      },3000);
    }catch(e){upDs(idx,function(s){return Object.assign({},s,{st:"done",an:"Greska: "+e.message});});}
  }

  // PITANJA GEN - prima idx (0, 1, 2)
  async function doPqGen(idx){
    var pq=pqSlots[idx];
    if((!pq.prev.trim()&&!pq.clientId)||!pq.quest.trim())return;
    upPq(idx,function(s){return Object.assign({},s,{st:"generating",an:"",ci:0});});
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
    var sys=pqPr||(pqIdentityLock+"WRITE IN ENGLISH. The text will be translated to Serbian later."+dateAwarenessPQ+personContextPQ+contextAccuracyPQ+multiPastPQ+"\n\nYou are "+aName+", a top FEMALE astrologer with 30 years of experience. You write everything in FEMININE voice.\n\n*** CRITICAL - FEMININE VOICE (ALWAYS) ***\nYour voice is female. When translated to Serbian, every self-reference must be feminine: 'videla sam' (NOT 'video sam'), 'pogledala sam' (NOT 'pogledao sam'), 'napisala sam' (NOT 'napisao sam'), 'primetila sam', 'zakljucila sam', 'rekla bih', 'iskrena sam', 'sigurna sam', 'bila sam'. In English use 'I saw', 'I noticed' etc. — the translator is instructed to always use FEMININE Serbian forms for the astrologer.\n\n*** CRITICAL - HEALTH DISCLAIMER ***\nIf ANY question touches health, illness, body, pregnancy, medical conditions, therapy, medication, diet, anxiety, depression, sleep, or wellness — after answering that question include this disclaimer: 'Please do not take this as medical advice. I am an astrologer, not a doctor. You must consult a doctor and follow their advice. Astrology shows energetic tendencies, but only a doctor can give you a real diagnosis and treatment.'\n\n*** CRITICAL - CORRECT SERBIAN VOCATIVE (examples below are PATTERNS only, NOT the client) ***\nUse CORRECT Serbian vocative. The names below are ILLUSTRATIONS of grammar rules — NOT the current client. FEMALE: names on -ica→-e (e.g. Milica→Milice); names on -ana/-ina/-ena/-a KEEP AS IS (e.g. Dragana→Dragana, Ana→Ana). MALE: consonant→-e (e.g. Ivan→Ivane); on -o or -a keep (e.g. Marko→Marko). NEVER add '-o' ending to female -ana/-ina/-ena names. KRITICNO: NIKADA ne mesaj slicna ali RAZLICITA imena (Milka ≠ Milica, Maja ≠ Marija, Vanja ≠ Vanesa, Nada ≠ Nadica) — uvek koristi TACNO ime iz CLIENT IDENTITY LOCK.\n\n*** CRITICAL - NO CLIENT NAME IN PITANJA BODY ***\nDo NOT write the client's name ANYWHERE in your answers. This is a Q&A response without greeting — there is no opening line that needs the name.\nAddress the client using 'ti' (tebi, tebe, tvoj, tvoja, tvoje) throughout every answer.\nFORBIDDEN: writing the name in section headers, in transitions between answers, at the start of any paragraph, or at the end.\nIf tempted to write the name, STOP — use 'ti'.\nThis rule eliminates vocative errors: no name, no chance to mis-conjugate.\n\nTODAY'S DATE: "+todayStr+". Current year is "+today.getFullYear()+". All forecasts must be for "+today.getFullYear()+" and "+(today.getFullYear()+1)+". NEVER write about past years as present.\n\nTASK: The client sent their previous analysis and has additional questions. Answer ONLY the asked questions, thoroughly and in detail.\n\n*** CRITICAL - NO INTRO PREAMBLE ***\nPitanja response has NO greeting and NO intro. Start IMMEDIATELY with the first answer. FORBIDDEN openings:\n- 'Evo odgovora na tvoja pitanja...', 'Na osnovu tvoje karte videcemo...', 'Odgovaram ti na pitanja...', 'Sada cu ti odgovoriti...'\nCORRECT opening: first sentence IS the reframed first question + answer (e.g., 'Pitas se hoces li se udati za sadasnjeg partnera. Gledajuci tvoju kartu...').\n\n*** CRITICAL - REFRAME EVERY QUESTION IN SECOND PERSON ***\nWhen you present the client's question before answering it, NEVER copy it verbatim in first person. REPHRASE it addressing the client with 'ti' form. Examples: 'Ja sam zaljubljen, sta da radim?' → 'Zaljubljen si i pitas se sta da radis.' 'Da li cu se udati?' → 'Pitas se da li ces se udati.' 'Kada cu dobiti posao?' → 'Pitas kada ces dobiti posao.' RULES: swap 'ja/me/moj/cu/sam' with 'ti/te/tvoj/ces/si'. Add natural lead-ins ('Pitas se...', 'Zanima te...', 'Rekao si da...'). Keep ALL specific details (names, dates). Do NOT quote; integrate naturally. Answer immediately in 'ti' form.\n\n*** CRITICAL - HANDLING QUESTIONS ABOUT OTHER PEOPLE ***\nIf a question references ANOTHER person (e.g. 'my son born 29.09.2013'):\n- Use whatever data IS provided. Do NOT ask for more data.\n- If only birth date given: Discuss Sun sign only. Do NOT mention Moon or Ascendant.\n- NEVER hedge ('najverovatnije', 'verovatno', 'mozda').\n- Focus on client's own chart dynamics with this person.\n\nWRITING STYLE: Write warmly, emotionally and directly. No uppercase titles. No bullet lists. Each answer in paragraph form with 10-12 sentences.\n\n*** CRITICAL - NEVER 100% GUARANTEES ***\nFor specific future events with dates, use PROBABILITY language, NEVER guarantee:\n- WRONG: 'Udaces se u martu 2027.' / 'Desice se trudnoca u junu.' / 'Dobices posao 15.09.'\n- CORRECT: 'U martu 2027. postoji velika mogucnost za brak.' / 'Jun 2026. donosi snaznu energiju za trudnocu.' / 'Sredinom septembra 2026. otvara se sansa za posao.'\nCoristi: 'velika mogucnost', 'snazna sansa', 'otvara se prilika', 'donosi energiju', 'potencijal', 'pogoduje'. Izbegavaj 'ce se desiti', 'sigurno', '100%', 'garantujem'. ALI zabranjeno i slabo hedging 'mozda', 'moglo bi', 'verovatno'.\n\n*** CRITICAL - NEVER WRITE WHAT YOU CAN'T DO ***\nNEVER mention missing data or limitations. FORBIDDEN: 'Za dublju analizu bilo bi potrebno...', 'Nemam podatke...', 'Ne mogu bez...', 'Idealno bi bilo...'. Radi sa podacima koje imas.\n\n*** MANDATORY LENGTH — minimum 1500 words. This is NOT optional. ***\n- Count your output. If under 1500 words after the last question, add more depth to each answer: more concrete events, more specific dates, more dimensions.\n- Each question's answer must be at least 200 words on its own.\n- A short Pitanja response (under 1500 words) is a FAILURE. Better verbose than concise.\n\nFORBIDDEN (text MUST look like a real person wrote it, not AI):\n- Uppercase section titles\n- Bullet lists or any list with bullets/dashes/asterisks/dots\n- Planet names/houses in text\n- Hedging\n- Asking for more data\n- Markdown symbols (## ** --- __)\n- Checkmarks (✅ ✓ ✔ ☑) or X marks (❌ ✗ ×) or arrows (→ ➡ ⇒) or any decorative symbol\n- ANY emoji in body (📌 📝 💡 🎯 ✨ 🔮 🌹 etc.)\n- Phrases 'Evo', 'Hajde da pogledamo', 'Analiziramo' - sounds like AI\n- Phrases 'Kljucno je da', 'Vazno je istaci', 'Treba napomenuti' - AI cliches\n- 'T.' or 'Tr.' or 'Transit' or 'Tranzitni' or 'Tranzitna' prefix before planets. Write 'Saturn', 'Jupiter', NOT 'T.Saturn' ili 'Tranzitni Saturn'. Klijent ne zna ove termine.\n- Parenthetical data/reasoning notes like '(podaci: Pluton u Vagi, verovatno 7. kuca)', '(napomena: ...)', '(pretpostavka: ...)'. Analiza je CIST PROZA - nikad ne pokazuj kalkulacije ili rezonovanje.\n- Mentioning 'kuca' / '7. kuca' / 'house' - klijent ne zna sta su astroloske kuce.\n- Self-questioning or thinking aloud: 'T.Jupiter ulazi u Vagu?' (AI asking itself) is WRONG. 'Zapravo,...' (self-correction) is WRONG. '(ako pretpostavimo)' is WRONG. '(vec u aspektu)' is WRONG. 'u zavisnosti od aspekta' is WRONG. Be definitive; if unsure leave it out.\n- Degree symbols like '3° Riba', '15° Lav' — client doesn't care about technical degrees.\n- Masculine forms ('video sam', 'pogledao sam' — always feminine)\n- Write LIKE A HUMAN: only words, commas, periods, question marks. NO symbols. NO decoration.\n\nDo NOT write greeting or closing. Just answer.");
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
      var pqName=pq.clientName.trim()||"Pitanja";
      var resp=await fetch(API+"/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system_prompt:sys,user_prompt:pqUsr,client_name:pqName,job_type:"pitanja",user_id:user&&user.id||"",birth_date:pq.clientBirthDate||null,client_id:pq.clientId||null})});
      var jobData=await resp.json();
      if(!jobData.id)throw new Error(jobData.error||"Failed");
      upPq(idx,function(s){return Object.assign({},s,{an:"Generisem u pozadini...",jobId:jobData.id});});
      var jobs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
      var pqKey="pq"+(idx+1);
      jobs[pqKey]={id:jobData.id,clientName:"D. Pitanja - "+pqName,tab:"pitanja"+(idx+1),idx:idx};
      localStorage.setItem("activeJobs",JSON.stringify(jobs));
      var pqJobId=jobData.id;
      var pqInterval=setInterval(async function(){
        try{
          var jbs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
          if(!jbs[pqKey]){clearInterval(pqInterval);return;}
          var r=await fetch(API+"/api/generate/"+pqJobId);var j=await r.json();
          if(j.status==="generating")upPq(idx,function(s){return Object.assign({},s,{an:"Generisem odgovore..."});});
          else if(j.status==="translating")upPq(idx,function(s){return Object.assign({},s,{an:"Prevodim na srpski..."});});
          else if(j.status==="done"){
            clearInterval(pqInterval);
            var jbs2=JSON.parse(localStorage.getItem("activeJobs")||"{}");delete jbs2[pqKey];localStorage.setItem("activeJobs",JSON.stringify(jbs2));
            var ft=fmtText(j.serbian_text||"");
            upPq(idx,function(s){return Object.assign({},s,{an:ft,st:"done",jobId:null});});
            setAnalyses(function(prev){
              if(prev.some(function(a){return a.jobId===pqJobId;}))return prev;
              var now=new Date();
              var upd=[{id:"q"+Date.now(),jobId:pqJobId,clientName:"D. Pitanja - "+(pqName||belgradeDate(now)),sign:"",date:belgradeDateTime(now),rawDate:belgradeRawDate(now),types:["pitanja"],analysis:ft,country:country,owner:user&&user.email}].concat(prev).slice(0,200);stoSet("analyses",upd);return upd;
            });
            toast2("D. Pitanja "+(idx+1)+" gotova!");
          }else if(j.status==="error"){clearInterval(pqInterval);upPq(idx,function(s){return Object.assign({},s,{an:j.serbian_text||"Greska.",st:"done"});});var jbs3=JSON.parse(localStorage.getItem("activeJobs")||"{}");delete jbs3[pqKey];localStorage.setItem("activeJobs",JSON.stringify(jbs3));}
        }catch(e){}
      },3000);
    }catch(e){upPq(idx,function(s){return Object.assign({},s,{st:"done",an:"Greska: "+e.message});});}
  }

  // TRANSLATE TO SERBIAN
  // POLL JOB STATUS
  function pollJob(jobId,slotIdx,tabKey,meta){
    var interval=setInterval(async function(){
      try{
        // Check if job already completed (prevent duplicate saves)
        var jobs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
        if(tabKey&&!jobs[tabKey]){clearInterval(interval);return;}

        var resp=await fetch(API+"/api/generate/"+jobId);
        if(!resp.ok)return;
        var job=await resp.json();
        if(job.status==="generating"){
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{analysis:"Generisem analizu..."});});
        }else if(job.status==="translating"){
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{analysis:"Prevodim na srpski..."});});
        }else if(job.status==="done"){
          clearInterval(interval);
          // Remove from active jobs FIRST to prevent duplicates
          var jbs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
          if(tabKey)delete jbs[tabKey];
          localStorage.setItem("activeJobs",JSON.stringify(jbs));

          var finalText=fmtText(job.serbian_text||"");
          if(slotIdx!==null){
            upSlot(slotIdx,function(s){return Object.assign({},s,{status:"done",analysis:finalText,jobId:null});});
          }
          // Save to analyses only if not already saved
          setAnalyses(function(prev){
            if(prev.some(function(a){return a.jobId===jobId;}))return prev;
            var now=new Date();
            var na={id:"j"+Date.now(),jobId:jobId,clientName:job.client_name||"",sign:"",date:belgradeDateTime(now),rawDate:belgradeRawDate(now),birthDate:meta&&meta.birthDate||"",mesto:meta&&meta.mesto||"",types:[job.job_type||"analiza"],analysis:finalText,country:country,owner:user&&user.email};
            var upd=[na].concat(prev).slice(0,200);stoSet("analyses",upd);return upd;
          });
          toast2("Analiza za "+(job.client_name||"klijenta")+" je gotova!");
        }else if(job.status==="error"){
          clearInterval(interval);
          if(slotIdx!==null)upSlot(slotIdx,function(s){return Object.assign({},s,{status:"done",analysis:job.serbian_text||"Greska pri generisanju."});});
          var jbs2=JSON.parse(localStorage.getItem("activeJobs")||"{}");
          if(tabKey)delete jbs2[tabKey];
          localStorage.setItem("activeJobs",JSON.stringify(jbs2));
        }
      }catch(e){console.warn("Poll error:",e.message);}
    },3000);
  }

  // Resume polling for active jobs on app load
  useEffect(function(){
    var jobs=JSON.parse(localStorage.getItem("activeJobs")||"{}");
    Object.keys(jobs).forEach(function(key){
      var j=jobs[key];
      if(j&&j.id){
        console.log("Resuming poll for job:",j.id,key);
        pollJob(j.id,j.idx!==undefined?j.idx:null,key);
      }
    });
  },[]);

  async function translateToSerbian(englishText){
    try{
      var resp=await fetch(API+"/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({max_tokens:16000,system:"Prevedi ovaj tekst na srpski jezik, ekavica, ISKLJUCIVO latinicno pismo. Ovo NIJE doslovan prevod nego ADAPTACIJA na prirodan srpski jezik.\n\nOBAVEZNA PRAVILA:\n- Meseci na srpskom u pravilnom padezu: January=januar, February=februar, March=mart, April=april, May=maj, June=jun, July=jul, August=avgust, September=septembar, October=oktobar, November=novembar, December=decembar\n- Meseci u padezu: u januaru, od maja do jula, tokom avgusta, krajem septembra\n- NIKAD ne pisi Juli, Maj, Oktobar sa velikim slovom niti u nominativu kad treba drugi padez\n- nature=priroda NIKAD natura\n- NIKAD ne koristi crtice (-) u tekstu\n- Ne duplaj slova (ne pisi srcemm, borbaa)\n- Gramatika mora biti 100% ispravna po srpskom pravopisu\n- Zadrzi sve prazne redove i formatiranje originala\n- Zadrzi sva imena i datume\n- Vrati SAMO prevedeni tekst bez komentara",messages:[{role:"user",content:englishText}]})});
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
    function upC(f,v){upSlot(idx,function(sl){var c=Object.assign({},sl.client);c[f]=v;return Object.assign({},sl,{client:c});});}
    function upP(f,v){upSlot(idx,function(sl){var p=Object.assign({},sl.partner);p[f]=v;return Object.assign({},sl,{partner:p});});}
    var busy=["generating","parsing","computing"].indexOf(s.status)>=0;
    var ch=s.analysis?getChunks(s.analysis):[];
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
          s.status==="parsing"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," AI cita..."):"\u2746 Prepoznaj Sve Automatski"
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
          React.createElement("div",{className:"fld"},React.createElement("label",null,"Mesto"),React.createElement("input",{value:s.client.mesto,onChange:function(e){upC("mesto",e.target.value);},placeholder:"npr. Beograd"})),
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
            React.createElement("div",{className:"fld"},React.createElement("label",null,"Mesto"),React.createElement("input",{value:s.partner.mesto,onChange:function(e){upP("mesto",e.target.value);},placeholder:"Mesto partnera"})),
            !s.partner.datum&&React.createElement("div",{className:"srow"},React.createElement("div",{className:"dot dot-w"}),React.createElement("span",null,"Nepotpuni podaci"))
          )
        )
      ),
      // CALC or GENERATE
      !s.ch
        ?React.createElement("button",{className:"btn bgd bfull",onClick:function(){doCalc(idx);},disabled:!s.client.datum||busy},
            s.status==="computing"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Racunam..."):"Izracunaj Horoskop")
        :React.createElement(React.Fragment,null,
          React.createElement("div",{className:"card"},
            React.createElement("div",{className:"ct"},"Horoskop: "+s.client.ime),
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
          React.createElement("button",{className:"btn bgd bfull",onClick:function(){doGen(idx);},disabled:busy},
            s.status==="generating"?React.createElement(React.Fragment,null,React.createElement("span",{className:"spin"})," Generisem u pozadini..."):"Generiši Analizu"
          )
        ),
      // ANALYSIS OUTPUT
      s.analysis&&React.createElement("div",{style:{marginTop:"12px"}},
        React.createElement("div",{className:"ct",style:{marginBottom:"8px"}},"Gotova Analiza"),
        ch.length>0&&React.createElement(ChunkTracker,{ch:ch,ci:s.copyIdx,setCi:function(i){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:i});});}}),
        React.createElement("div",{className:"aout "+(s.status==="generating"?"cur":"")},s.analysis),
        React.createElement("div",{className:"abar"},
          s.copyIdx<ch.length
            ?React.createElement("button",{className:"btn bgd",style:{flex:1,fontSize:"12px"},onClick:function(){doCopy(ch[s.copyIdx],"Dio "+(s.copyIdx+1)+"/"+ch.length);upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:Math.min(sl.copyIdx+1,ch.length)});});}},"Kopiraj "+(s.copyIdx+1)+"/"+ch.length)
            :React.createElement("button",{className:"btn bol bsm",onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:0});});}},"Ponovi"),
          React.createElement("button",{className:"btn bol bsm",disabled:s.copyIdx===0,onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:Math.max(0,sl.copyIdx-1)});});}},"<"),
          React.createElement("button",{className:"btn bol bsm",disabled:s.copyIdx>=ch.length-1,onClick:function(){upSlot(idx,function(sl){return Object.assign({},sl,{copyIdx:Math.min(ch.length-1,sl.copyIdx+1)});});}},">" ),
          React.createElement("button",{className:"btn bol bsm",onClick:function(){cpText(s.analysis);toast2("Sve kopirano!");}},"\u0041ll"),
          React.createElement("button",{className:"btn bol bsm",onClick:function(){doGen(idx);},disabled:busy},"\u21BA")
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
            React.createElement("p",{style:{fontFamily:"'Cormorant Garamond',serif",fontSize:"13px",color:"#c9a84c",marginTop:"8px",fontStyle:"italic",letterSpacing:"0.5px",textTransform:"none"}},"Softver koji ima NASA preciznost")
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
    {id:"pitanja1",l:"D. Pitanja 1",icon:"\u2753"},{id:"pitanja2",l:"D. Pitanja 2",icon:"\u2753"},{id:"pitanja3",l:"D. Pitanja 3",icon:"\u2753"}
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
        var dsMatches=clientsCache.filter(function(c){
          if(!ds.clientName||ds.clientId)return false;
          return c.name&&c.name.toLowerCase().indexOf(ds.clientName.toLowerCase())===0;
        }).slice(0,5);
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
          ds.an&&React.createElement(React.Fragment,null,
            React.createElement(ChunkTracker,{ch:getChunks(ds.an),ci:ds.ci,setCi:function(fn){upDs(dsIdx,function(s){return Object.assign({},s,{ci:typeof fn==="function"?fn(s.ci):fn});});}}),
            React.createElement("div",{className:"aout "+(ds.st==="generating"?"cur":"")},ds.an),
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
        var pqMatches=clientsCache.filter(function(c){
          if(!pq.clientName||pq.clientId)return false;
          return c.name&&c.name.toLowerCase().indexOf(pq.clientName.toLowerCase())===0;
        }).slice(0,5);
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
          pq.an&&React.createElement(React.Fragment,null,
            React.createElement(ChunkTracker,{ch:getChunks(pq.an),ci:pq.ci,setCi:function(fn){upPq(pqIdx,function(s){return Object.assign({},s,{ci:typeof fn==="function"?fn(s.ci):fn});});}}),
            React.createElement("div",{className:"aout "+(pq.st==="generating"?"cur":"")},pq.an),
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
        React.createElement("div",{className:"stitle"},"Baza Analiza"),
        React.createElement("div",{className:"fld",style:{marginBottom:"6px"}},React.createElement("input",{value:bazaSearch,onChange:function(e){setBazaSearch(e.target.value);},placeholder:"Pretrazi po imenu, datumu, znaku...",className:"sel-input"})),
        React.createElement("div",{style:{display:"flex",alignItems:"center",gap:"6px",marginBottom:"10px"}},
          React.createElement("label",{style:{fontSize:"10px",color:"var(--mt)"}},"Datum:"),
          React.createElement("input",{type:"date",value:bazaDateFilter,onChange:function(e){setBazaDateFilter(e.target.value);},style:{background:"var(--sf2)",border:"1px solid var(--bd)",borderRadius:"6px",padding:"5px 8px",color:"var(--tx)",fontFamily:"'Jost',sans-serif",fontSize:"12px"}}),
          bazaDateFilter&&React.createElement("button",{className:"btn bol bsm",onClick:function(){setBazaDateFilter("");}},"\u2715")
        ),
        (function(){
          var q=bazaSearch.toLowerCase().trim();
          var filtered=myAnalyses;
          if(q)filtered=filtered.filter(function(a){var bd=a.birthDate||"";var bdSr=bd?fmtDMY(new Date(bd)):"";return((a.clientName||"")+" "+(a.sign||"")+" "+(a.date||"")+" "+(a.mesto||"")+" "+bd+" "+bdSr).toLowerCase().indexOf(q)>=0;});
          if(bazaDateFilter){var dfSr=fmtDMY(new Date(bazaDateFilter));filtered=filtered.filter(function(a){return(a.rawDate||"")===bazaDateFilter||(a.date||"").startsWith(dfSr);});}
          var dateLabel=bazaDateFilter?fmtDMY(new Date(bazaDateFilter)):"";
          return filtered.length===0
            ?React.createElement("div",{className:"empty"},React.createElement("div",{className:"ico"},"\uD83D\uDCC1"),React.createElement("p",null,(q||bazaDateFilter)?"Nema rezultata":"Jos nema sacuvanih analiza."))
            :React.createElement(React.Fragment,null,
              React.createElement("p",{style:{fontSize:"11px",color:"var(--mt)",marginBottom:"10px"}},filtered.length+(bazaDateFilter?" analiza uradjeno "+dateLabel:q?" pronadjeno":" analiza")),
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
                fetch(API+"/api/prompts",{method:"POST",headers:{"Content-Type":"application/json","x-user-role":"admin"},body:JSON.stringify({country:country,type:editPr,content:(custPr[country]&&custPr[country][editPr])||""})}).then(function(){toast2("Sacuvano u bazu!");}).catch(function(){toast2("Sacuvano lokalno.");});
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
            React.createElement("button",{className:"btn bol bsm",onClick:function(){setViewAn(null);}},"\u005aatvori")
          )
        )
      );
    })(),

    toast&&React.createElement("div",{className:"toast"},toast)
  );
}
