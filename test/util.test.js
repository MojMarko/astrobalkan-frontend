// Regression tests for src/lib/util.js
// Pokrece: npm test
// Cilj: kad iko (ukljucujuci AI) menja util.js, ovi testovi padaju ako se
// pokvari neka popravka koju smo vec radili.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prettifyPitanja, fetchWithRetry } from '../src/lib/util.js';

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

  it('retrira na network error (Failed to fetch) - kljucna popravka 25.5', async () => {
    const mockResp = { ok: true, status: 200 };
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockResp);
    const p = fetchWithRetry('http://test/x', {}, 3);
    // Tick clock kroz backoff
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;
    expect(r).toBe(mockResp);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('baca posle svih pokusaja ako mreza i dalje pada', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    // Pre-attach catch da rejected promise ne ostane unhandled tokom advance timers.
    const settled = fetchWithRetry('http://test/x', {}, 3).then(v => ({ value: v }), e => ({ error: e }));
    await vi.advanceTimersByTimeAsync(3500);
    const result = await settled;
    expect(result.error).toBeInstanceOf(TypeError);
    expect(result.error.message).toBe('Failed to fetch');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('retrira na 5xx (server greska, mozda prolazi)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const p = fetchWithRetry('http://test/x', {}, 3);
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
