// Regression tests for src/lib/util.js
// Pokrece: npm test
// Cilj: kad iko (ukljucujuci AI) menja util.js, ovi testovi padaju ako se
// pokvari neka popravka koju smo vec radili.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prettifyPitanja, fetchWithRetry, conventionalSunSign } from '../src/lib/util.js';

describe('prettifyPitanja - lepo formatiranje pitanja klijenta', () => {
  it('vraca prazan string/null nepromenjen', () => {
    expect(prettifyPitanja('')).toBe('');
    expect(prettifyPitanja(null)).toBe(null);
    expect(prettifyPitanja(undefined)).toBe(undefined);
  });

  it('razlama pred datumom (popravka 27.5 - Markova prijava)', () => {
    // Originalni problem: ". u Suprug . u 06h , BiH sin Luka 23.06.1999. u 15:20 Recite mi..."
    // Datum mora da skoci u novi red (kljucna popravka da astrolog razlikuje datume).
    const messy = 'u Suprug u 06h , BiH sin Luka 23.06.1999. u 15:20 Recite mi dal ce se ozeniti';
    const out = prettifyPitanja(messy);
    expect(out.split('\n').length).toBeGreaterThan(1);
    // Datum 23.06.1999 mora biti na pocetku nekog reda
    const lines = out.split('\n');
    expect(lines.some(l => l.startsWith('23.06.1999'))).toBe(true);
  });

  it('razlama pred starter-ima pitanja (Da li, Recite mi)', () => {
    const txt = 'Klijent ima problem. Recite mi da li ce uspeti, Da li ce uspeti';
    const out = prettifyPitanja(txt);
    const lines = out.split('\n');
    // "Recite mi" i "Da li" moraju da pocnu nove redove
    expect(lines.some(l => l.startsWith('Recite mi'))).toBe(true);
    expect(lines.some(l => l.startsWith('Da li'))).toBe(true);
  });

  it('razlama pred rodbinskim oznakama (Sin, Cerka, Brat)', () => {
    const txt = 'Klijent pita za mene. Sin Marko 5.5.2010, Cerka Ana 3.3.2012';
    const out = prettifyPitanja(txt);
    const lines = out.split('\n');
    expect(lines.some(l => l.startsWith('Sin'))).toBe(true);
    expect(lines.some(l => l.startsWith('Cerka'))).toBe(true);
  });

  it('cuva vec lepo formatirani tekst (idempotentno)', () => {
    const nice = 'Klijent pita za sina Marka.\n\nDa li ce uspeti?\n\nKada ce dobiti posao?';
    const out = prettifyPitanja(nice);
    // Treba da bude funkcionalno isto - svaka tema u svom redu
    expect(out.split('\n\n').length).toBeGreaterThanOrEqual(3);
  });

  it('sazima visestruke prazne redove na max dva', () => {
    const txt = 'Linija jedan\n\n\n\n\nLinija dva\n\n\n\nLinija tri';
    const out = prettifyPitanja(txt);
    // Ne sme imati 3+ uzastopnih \n
    expect(/\n{3,}/.test(out)).toBe(false);
  });
});

describe('fetchWithRetry - hvata transient mrezne greske', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('vraca odgovor ako prvi fetch uspe', async () => {
    const mockResp = { ok: true, status: 200 };
    global.fetch = vi.fn().mockResolvedValueOnce(mockResp);
    const r = await fetchWithRetry('http://test/x', {}, 3);
    expect(r).toBe(mockResp);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('ne retrira na 4xx (klijent greska, retry nema smisla)', async () => {
    const mockResp = { ok: false, status: 400 };
    global.fetch = vi.fn().mockResolvedValue(mockResp);
    const r = await fetchWithRetry('http://test/x', {}, 3);
    expect(r).toBe(mockResp);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retrira na network error (Failed to fetch) - 3 pokusaja sa novim backoff-om', async () => {
    // Backoff: pokusaj 1 -> wait 3s -> pokusaj 2 -> wait 10s -> pokusaj 3. Ukupno 13s.
    const mockResp = { ok: true, status: 200 };
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResp);
    const p = fetchWithRetry('http://test/x', {}, 3);
    await vi.advanceTimersByTimeAsync(14000);
    const r = await p;
    expect(r).toBe(mockResp);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('baca posle svih pokusaja ako mreza i dalje pada', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const settled = fetchWithRetry('http://test/x', {}, 3).then(v => ({ value: v }), e => ({ error: e }));
    await vi.advanceTimersByTimeAsync(14000);
    const result = await settled;
    expect(result.error).toBeInstanceOf(TypeError);
    expect(result.error.message).toBe('Failed to fetch');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('retrira na 5xx (server greska, mozda prolazi)', async () => {
    // Pokusaj 1 fail -> wait 3s -> pokusaj 2 succeed.
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const p = fetchWithRetry('http://test/x', {}, 3);
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('default 4 pokusaja sa eskalirajucim backoff-om (cold start scenario)', async () => {
    // 4 fail-a, ukupno wait 3+10+25 = 38s + last attempt. Posle 4. pokusaja baca.
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const settled = fetchWithRetry('http://test/x', {}).then(v => ({ value: v }), e => ({ error: e }));
    await vi.advanceTimersByTimeAsync(95000);
    const result = await settled;
    expect(result.error).toBeInstanceOf(TypeError);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('onRetry callback se zove pre svakog backoff-a', async () => {
    const mockResp = { ok: true, status: 200 };
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResp);
    const onRetry = vi.fn();
    const p = fetchWithRetry('http://test/x', {}, { attempts: 2, onRetry });
    await vi.advanceTimersByTimeAsync(3500);
    await p;
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, 2, 3000);
  });

  it('per-attempt timeout abort-uje fetch koji visi (Suzana prijava 2.6 11:10)', async () => {
    // Render free tier moze ostaviti fetch da visi unedogled. Bez timeout-a status
    // ostane "generating", UI zaglavljen. Sa timeout-om, abort baca pa retry pa kraj.
    global.fetch = vi.fn().mockImplementation(function(url, opts){
      return new Promise(function(_resolve, reject){
        // Simuliraj fetch koji visi - zavisi od signal.abort
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', function(){
            reject(new DOMException('aborted', 'AbortError'));
          });
        }
        // Nikad ne resolve-uje
      });
    });
    const settled = fetchWithRetry('http://test/x', {}, { attempts: 2, timeoutMs: 5000 })
      .then(v => ({value:v}), e => ({error:e}));
    // 5s timeout + 2s backoff + 5s timeout = 12s total
    await vi.advanceTimersByTimeAsync(15000);
    const result = await settled;
    expect(result.error).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('conventionalSunSign - datumski znak po standardnim tabelama', () => {
  // Marko prijava 30.5: "23.8 je devica on pise lav" - kljucni regresijski test
  it('23.8 = Devica (Marko prijava 30.5, bez obzira na godinu)', () => {
    expect(conventionalSunSign('1982-08-23')).toBe('Devica');
    expect(conventionalSunSign('1985-08-23')).toBe('Devica');
    expect(conventionalSunSign('1990-08-23')).toBe('Devica');
    expect(conventionalSunSign('2000-08-23')).toBe('Devica');
  });

  it('22.8 = Lav (komplement, granica drugu stranu)', () => {
    expect(conventionalSunSign('1982-08-22')).toBe('Lav');
    expect(conventionalSunSign('1990-08-22')).toBe('Lav');
  });

  it('granice svih znakova', () => {
    // Pocetni datumi po standardnim tabelama
    expect(conventionalSunSign('1990-03-21')).toBe('Ovan');
    expect(conventionalSunSign('1990-04-20')).toBe('Bik');
    expect(conventionalSunSign('1990-05-21')).toBe('Blizanci');
    expect(conventionalSunSign('1990-06-21')).toBe('Rak');
    expect(conventionalSunSign('1990-07-23')).toBe('Lav');
    expect(conventionalSunSign('1990-08-23')).toBe('Devica');
    expect(conventionalSunSign('1990-09-23')).toBe('Vaga');
    expect(conventionalSunSign('1990-10-23')).toBe('Skorpija');
    expect(conventionalSunSign('1990-11-22')).toBe('Strelac');
    expect(conventionalSunSign('1990-12-22')).toBe('Jarac');
    expect(conventionalSunSign('1990-01-20')).toBe('Vodolija');
    expect(conventionalSunSign('1990-02-19')).toBe('Ribe');
  });

  it('zadnji datumi svakog znaka', () => {
    expect(conventionalSunSign('1990-04-19')).toBe('Ovan');
    expect(conventionalSunSign('1990-05-20')).toBe('Bik');
    expect(conventionalSunSign('1990-08-22')).toBe('Lav');
    expect(conventionalSunSign('1990-09-22')).toBe('Devica');
    expect(conventionalSunSign('1990-12-21')).toBe('Strelac');
    expect(conventionalSunSign('1990-01-19')).toBe('Jarac');
  });

  it('vraca prazan string za nevazece input', () => {
    expect(conventionalSunSign('')).toBe('');
    expect(conventionalSunSign(null)).toBe('');
    expect(conventionalSunSign('not-a-date')).toBe('');
    expect(conventionalSunSign('1990-13-01')).toBe(''); // nevazeci mesec
  });

  it('sredine svakog znaka (sanity check)', () => {
    expect(conventionalSunSign('1990-04-05')).toBe('Ovan');
    expect(conventionalSunSign('1990-05-15')).toBe('Bik');
    expect(conventionalSunSign('1990-09-05')).toBe('Devica');
    expect(conventionalSunSign('1990-11-15')).toBe('Skorpija');
  });
});

import { bindDatesToNames, findNamePos } from '../src/lib/util.js';

describe('bindDatesToNames - pair imena sa datumima po adjacency', () => {
  // Dragana Micic prijava 2.6.2026 - klijent je dobio analizu sa zamenjenim datumima
  // izmedju cerke i brata. AI parser je halucinirao da Kalini pripada 02.05.1985 (bratov
  // datum) i Mirku 17.01.2023 (cerkin datum). Stari bindDatesToNames sa direction penalty
  // nije ispravio. Novi adjacency algoritam mora da uhvati ovaj pattern (DATUM.Ime).
  it('Kalina/Mirko slucaj iz prijave 2.6 - DATUM.IME pattern pravilno bind-uje', () => {
    const text = "17.01.2023.Kalina , moja cerka\n02.05.1985. moj Brat Mirko";
    const persons = [
      { ime: 'Kalina', odnos: 'cerka', datum: '1985-05-02' }, // AI dao pogresan datum
      { ime: 'Mirko', odnos: 'brat', datum: '2023-01-17' }    // AI dao pogresan datum
    ];
    const result = bindDatesToNames(text, persons);
    const kalina = result.find(p => p.ime === 'Kalina');
    const mirko = result.find(p => p.ime === 'Mirko');
    expect(kalina.datum).toBe('2023-01-17');  // Kalina cerka 17.01.2023
    expect(mirko.datum).toBe('1985-05-02');   // Mirko brat 02.05.1985
  });

  it('IME DATUM pattern (Marko 5.5.1990) pravilno bind-uje', () => {
    const text = "Marko 5.5.1990, Ana 3.3.1995";
    const persons = [
      { ime: 'Marko', datum: '1995-03-03' }, // pogresno (zameni mu Anin datum)
      { ime: 'Ana', datum: '1990-05-05' }    // pogresno
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Marko').datum).toBe('1990-05-05');
    expect(result.find(p => p.ime === 'Ana').datum).toBe('1995-03-03');
  });

  it('DATUM IME pattern (5.5.1990 Marko) pravilno bind-uje', () => {
    const text = "5.5.1990 Marko, 3.3.1995 Ana";
    const persons = [
      { ime: 'Marko', datum: '1995-03-03' }, // pogresno
      { ime: 'Ana', datum: '1990-05-05' }    // pogresno
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Marko').datum).toBe('1990-05-05');
    expect(result.find(p => p.ime === 'Ana').datum).toBe('1995-03-03');
  });

  it('cuva tacne datume ako AI vec ima pravilan pairing', () => {
    const text = "Sin Marko 12.05.2018, cerka Ana 03.09.2020";
    const persons = [
      { ime: 'Marko', odnos: 'sin', datum: '2018-05-12' },
      { ime: 'Ana', odnos: 'cerka', datum: '2020-09-03' }
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Marko').datum).toBe('2018-05-12');
    expect(result.find(p => p.ime === 'Ana').datum).toBe('2020-09-03');
  });

  it('vraca prazan niz nepromenjen', () => {
    expect(bindDatesToNames('', [])).toEqual([]);
    expect(bindDatesToNames(null, [{ ime: 'X', datum: '2020-01-01' }])).toEqual([{ ime: 'X', datum: '2020-01-01' }]);
  });

  it('cuva imena bez datuma (ne ruje persons koji nisu u tekstu)', () => {
    const text = "Marko 5.5.1990";
    const persons = [
      { ime: 'Marko', datum: '1990-05-05' },
      { ime: 'Petar', datum: '1985-01-01' } // ne u tekstu
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Petar').datum).toBe('1985-01-01'); // ne dira
  });

  // Prijava #62 "Mesa datume": pitanja teksta sadrzi SAMO datum trece osobe (muza),
  // daleko od imenovane osobe ciji je datum vec ispravno parsiran (ali ne postoji u
  // tekstu jer je stripovan). Usamljeni tudji datum NE SME da pregazi ispravan datum.
  it('usamljeni tudji datum daleko u tekstu ne krade imenovanu osobu', () => {
    const text = "Milica se raspituje za posao i za zdravlje. Ima jos mnogo pitanja o svemu.\n\nNesto se pobrkalo.\n\nMoj muz je rodjen 09.04.1968 u 12 casova u Somboru, pa me zanima i za njega.";
    const persons = [
      { ime: 'Milica', odnos: '', datum: '1993-05-10' } // ispravan, stripovan iz teksta
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Milica').datum).toBe('1993-05-10'); // ne dira
  });

  it('imena sa dijakritikama na kraju/pocetku se pronalaze (Milos sa š)', () => {
    const text = "Miloš 12.05.1980, Đorđe 03.09.1975";
    const persons = [
      { ime: 'Miloš', datum: '1975-09-03' }, // zamenjeno
      { ime: 'Đorđe', datum: '1980-05-12' }
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Miloš').datum).toBe('1980-05-12');
    expect(result.find(p => p.ime === 'Đorđe').datum).toBe('1975-09-03');
  });
});

describe('findNamePos - pronadji ime sa padezima', () => {
  it('nadje tacno ime', () => {
    expect(findNamePos('marko 5.5.1990', 'marko')).toBe(0);
    expect(findNamePos('imam sina marka', 'marko')).toBe(10); // padez (marka)
  });

  it('vraca -1 ako nema imena', () => {
    expect(findNamePos('test bez imena', 'marko')).toBe(-1);
  });

  it('vraca -1 za invalid input', () => {
    expect(findNamePos('', 'marko')).toBe(-1);
    expect(findNamePos('test', '')).toBe(-1);
  });

  it('nadje ime koje se zavrsava dijakritikom (ASCII \\b bug)', () => {
    expect(findNamePos('miloš 12.5.1980', 'miloš')).toBe(0);
    expect(findNamePos('moj muž 09.04.1968', 'muž')).toBe(4);
    expect(findNamePos('đorđe 3.9.1975', 'đorđe')).toBe(0);
  });

  it('ne matchuje ime unutar duze reci', () => {
    expect(findNamePos('anamarija 1.1.1990', 'ana')).toBe(-1);
  });
});

// Regresija koju je uhvatio review 1.7.2026: LLM-swap korekcija mora da radi i kad
// datum NIJE odmah uz ime (gap "rodjenog" izmedju) - guard ne sme da je blokira.
describe('bindDatesToNames - swap korekcija sa gap-om izmedju imena i datuma', () => {
  it('ispravlja zamenjene datume i kad izmedju stoji "rodjenog"', () => {
    const text = "Pitam za sina Marka rodjenog 05.07.2018 i brata Mirka rodjenog 02.05.1985.";
    const persons = [
      { ime: 'Marko', odnos: 'sin', datum: '1985-05-02' },  // LLM zamenio
      { ime: 'Mirko', odnos: 'brat', datum: '2018-07-05' }  // LLM zamenio
    ];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Marko').datum).toBe('2018-07-05');
    expect(result.find(p => p.ime === 'Mirko').datum).toBe('1985-05-02');
  });
});

// Review 1.7.2026: buduci "period" datumi iz pitanja ("od 5.6.2027") ne smeju da
// udju u pool za vezivanje - binder bi ih inace dodelio osobi kao datum rodjenja.
describe('bindDatesToNames - buduci datumi nisu kandidati', () => {
  it('ne prepisuje osobu na buduci datum iz teksta cak ni kad je adjacentan', () => {
    const text = "Od 5.6.2077 Milica planira da trazi posao. Rodjena je 10.05.1993. u Somboru.";
    const persons = [{ ime: 'Milica', odnos: '', datum: '1993-05-10' }];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Milica').datum).toBe('1993-05-10');
  });
});

// Prijava #80 (Suzana 2.7.): datum SMRTI ("...a 25.08.2004 je datum kada mi je muž
// umro") ne sme u pool - binder bi vezao datum smrti za ime/muza kao rodjenje.
describe('bindDatesToNames - datumi smrti/dogadjaja nisu kandidati', () => {
  it('ne prepisuje osobu na datum smrti iz teksta', () => {
    const text = "Marko je 19.10.2004 9.50h vaga a 25.08.2004 je datum kada mi je muž umro";
    const persons = [{ ime: 'Marko', odnos: '', datum: '2004-10-19' }];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Marko').datum).toBe('2004-10-19');
  });
  it('obican drugi datum rodjenja i dalje normalno ulazi u pool', () => {
    const text = "17.01.2023.Kalina , moja cerka";
    const persons = [{ ime: 'Kalina', odnos: 'cerka', datum: '' }];
    const result = bindDatesToNames(text, persons);
    expect(result.find(p => p.ime === 'Kalina').datum).toBe('2023-01-17');
  });
});

// Prijava 6.7. "Nece da prepoznaje podatke": AI vratio isecen JSON
// ('..."partn') - repair mora da spase kompletna polja umesto greske.
import { repairTruncatedJson } from '../src/lib/util.js';
describe('repairTruncatedJson - popravka isecenog AI JSON-a', () => {
  it('spasava klijenta iz JSON-a isecenog usred kljuca "partner"', () => {
    const cut = '{"klijent":{"ime":"","datum":"1983-12-13","vreme":"02:30","mesto":"Vranje","zemlja":"Srbija"},"partn';
    const obj = repairTruncatedJson(cut);
    expect(obj).not.toBeNull();
    expect(obj.klijent.datum).toBe('1983-12-13');
    expect(obj.klijent.mesto).toBe('Vranje');
  });
  it('spasava JSON isecen usred string vrednosti', () => {
    const cut = '{"klijent":{"ime":"Ana","datum":"1990-01-04"},"imaPartnera":false,"pitanja":"Da li cu dobiti pos';
    const obj = repairTruncatedJson(cut);
    expect(obj).not.toBeNull();
    expect(obj.klijent.ime).toBe('Ana');
  });
  it('vraca null za potpuno neupotrebljiv tekst', () => {
    expect(repairTruncatedJson('nema jsona ovde')).toBeNull();
  });
  it('validan JSON prolazi netaknut', () => {
    const ok = '{"a":1,"b":[1,2]}';
    expect(repairTruncatedJson(ok)).toEqual({a:1,b:[1,2]});
  });
});

// Prijava 23.7. (Suzana) "Mesa datume": klijent napisao "Muz mi 16.05.1979" i
// "Osoba koja me zanima je 21.09.1975". LLM je zamenio datume (muz dobio 21.09.1975).
// Osobe nemaju IME (samo relaciju) pa bindDatesToNames nije ispravljao. Sad se sidri
// na relacijsku rec u tekstu.
describe('bindDatesToNames - sidrenje po relaciji kad nema imena', () => {
  it('ispravlja zamenjene datume muza i osobe od interesa', () => {
    const text = "Muz mi 16.05.1979\nOsoba koja me zanima je 21.09.1975";
    const persons = [
      { ime: '', odnos: 'muz', datum: '1975-09-21' },      // LLM zamenio
      { ime: '', odnos: 'partner', datum: '1979-05-16' }   // LLM zamenio
    ];
    const out = bindDatesToNames(text, persons);
    const muz = out.find(p => p.odnos === 'muz');
    const partner = out.find(p => p.odnos === 'partner');
    expect(muz.datum).toBe('1979-05-16');       // muz je 16.05.1979 (Bik)
    expect(partner.datum).toBe('1975-09-21');   // osoba od interesa je 21.09.1975 (Devica)
  });
  it('ne dira ispravno vezane relacije', () => {
    const text = "Sin mi 05.07.2018, cerka 03.09.2020";
    const persons = [
      { ime: '', odnos: 'sin', datum: '2018-07-05' },
      { ime: '', odnos: 'cerka', datum: '2020-09-03' }
    ];
    const out = bindDatesToNames(text, persons);
    expect(out.find(p => p.odnos === 'sin').datum).toBe('2018-07-05');
    expect(out.find(p => p.odnos === 'cerka').datum).toBe('2020-09-03');
  });
});
