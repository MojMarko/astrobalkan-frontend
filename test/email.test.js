// Testovi za email klijenta - polje u formi, auto-prepoznavanje iz Messenger
// poruke i naslov mejla koji radnica salje klijentu.
// Pokrece: npm test

import { describe, it, expect } from 'vitest';
import { validEmail, nadjiEmailUTekstu, mailNaslov } from '../src/lib/util.js';

describe('validEmail - propusta prave adrese, odbija "nema"', () => {
  it('cisti razmake i spusta na mala slova', () => {
    expect(validEmail('  Ana.Petrovic@Gmail.COM ')).toBe('ana.petrovic@gmail.com');
  });

  it('prihvata plus-tag, poddomen i .rs domen', () => {
    expect(validEmail('ana+astro@mail.co.rs')).toBe('ana+astro@mail.co.rs');
    expect(validEmail('m.jovanovic@open.telekom.rs')).toBe('m.jovanovic@open.telekom.rs');
  });

  it('odbija ono sto radnica ukuca kad klijent nema mejl', () => {
    ['nema', 'ne zeli', '-', '/', 'nema mejl', 'ana@', '@gmail.com', 'ana gmail.com'].forEach(v => {
      expect(validEmail(v)).toBe('');
    });
  });

  it('odbija prazno, null i undefined', () => {
    expect(validEmail('')).toBe('');
    expect(validEmail(null)).toBe('');
    expect(validEmail(undefined)).toBe('');
  });

  it('odbija dve adrese u istom polju (zarez/razmak)', () => {
    expect(validEmail('ana@gmail.com, mira@gmail.com')).toBe('');
    expect(validEmail('ana @gmail.com')).toBe('');
  });
});

describe('nadjiEmailUTekstu - mejl iz zalepljene Messenger poruke', () => {
  it('vadi adresu iz poruke sa podacima', () => {
    const poruka = 'Zdravo, ja sam Ana 15.07.1995 u 14:20 Nis. Mejl mi je ana.p@gmail.com hvala!';
    expect(nadjiEmailUTekstu(poruka)).toBe('ana.p@gmail.com');
  });

  it('vraca prvu adresu kad ih ima vise', () => {
    expect(nadjiEmailUTekstu('ana@gmail.com ili mira@yahoo.com')).toBe('ana@gmail.com');
  });

  it('ne izmislja adresu kad je nema', () => {
    expect(nadjiEmailUTekstu('Ana 15.07.1995 Nis, pitam za posao')).toBe('');
    expect(nadjiEmailUTekstu('')).toBe('');
    expect(nadjiEmailUTekstu(null)).toBe('');
  });

  it('ne hvata rec sa @ koja nije mejl (Instagram handle)', () => {
    expect(nadjiEmailUTekstu('nadji me na @ana_astro')).toBe('');
  });
});

describe('mailNaslov - naslov mejla po tipu posla', () => {
  it('analiza nosi ime klijenta', () => {
    expect(mailNaslov('analiza', 'Ana')).toBe('Tvoja astro analiza - Ana | Astrolog Suzana');
  });

  it('dodatna pitanja i downsell imaju svoj naslov', () => {
    expect(mailNaslov('pitanja', 'Marko')).toContain('Odgovori na tvoja pitanja');
    expect(mailNaslov('downsell', 'Marko')).toContain('Tvoja astro prognoza');
  });

  it('bez imena ne ostavlja visecu crticu', () => {
    expect(mailNaslov('analiza', '')).toBe('Tvoja astro analiza | Astrolog Suzana');
    expect(mailNaslov('analiza', '   ')).toBe('Tvoja astro analiza | Astrolog Suzana');
  });
});

import { ocistiZaMejl } from '../src/lib/util.js';

describe('ocistiZaMejl - ostaci iz Messenger vremena ne idu u mejl', () => {
  it('skida pasus "sacuvaj analizu u beleske"', () => {
    const t = 'Kraj analize ovde.\n\nSavetujem ti jos da ovu analizu sačuvaš negde u beleške ako se slučajno izbriše ovde, da imaš negde drugo sačuvano.\n\nHvala ti puno na poverenju.';
    const out = ocistiZaMejl(t);
    expect(out).not.toContain('beleške');
    expect(out).toContain('Kraj analize ovde.');
    expect(out).toContain('Hvala ti puno na poverenju.');
  });

  it('skida stari potpis (E-mail: astrologsuzana@gmail.com + Astrolog Suzana sa srcem)', () => {
    const t = 'Hvala na poverenju.\n\nE-mail: astrologsuzana@gmail.com\nAstrolog Suzana \u{1F497}';
    const out = ocistiZaMejl(t);
    expect(out).not.toContain('astrologsuzana@gmail.com');
    expect(out).not.toContain('Astrolog Suzana');
    expect(out).toContain('Hvala na poverenju.');
  });

  it('staru adresu usred recenice zamenjuje novom (ne sece recenicu)', () => {
    const out = ocistiZaMejl('Pisite nam na astrologsuzana@gmail.com za sve.');
    expect(out).toContain('kontakt@astrologsuzana.com');
    expect(out).not.toContain('astrologsuzana@gmail.com');
  });

  it('obican tekst analize prolazi netaknut', () => {
    const t = 'Ana, tvoja karta pokazuje Mesec u Raku.\n\nSačuvaj snagu za mart - tada stiže prilika.\n\nSve najbolje.';
    expect(ocistiZaMejl(t)).toBe(t);
  });

  it('ne ostavlja duple prazne redove posle ciscenja', () => {
    const t = 'Prvi deo.\n\nSavetujem da analizu sačuvaš u beleške ako se izbriše.\n\nDrugi deo.';
    expect(ocistiZaMejl(t)).toBe('Prvi deo.\n\nDrugi deo.');
  });
});
