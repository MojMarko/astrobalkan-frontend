import React, { useState, useEffect } from 'react';
import { askClaude } from '../api';

const SIGN_NAMES = {
  aries: 'Ovan', taurus: 'Bik', gemini: 'Blizanci', cancer: 'Rak',
  leo: 'Lav', virgo: 'Djevica', libra: 'Vaga', scorpio: 'Škorpija',
  sagittarius: 'Strijelac', capricorn: 'Jarac', aquarius: 'Vodolija', pisces: 'Ribe'
};

export default function HoroscopeView({ sign }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setText('');
      try {
        const today = new Date().toLocaleDateString('sr-Latn');
        const result = await askClaude(
          [{ role: 'user', content: `Napiši dnevni horoskop za znak ${SIGN_NAMES[sign]} za danas ${today}. Uključi ljubav, posao i zdravlje. Budi koncizan (max 150 riječi).` }],
          'Ti si AstroBalkan astrolog. Pišeš dnevne horoskope na srpskom jeziku. Budi pozitivan ali realističan.'
        );
        if (!cancelled) setText(result);
      } catch {
        if (!cancelled) setText('Greška pri učitavanju horoskopa. Pokušaj ponovo.');
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [sign]);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid rgba(255,255,255,0.1)'
    }}>
      <h2 style={{ marginBottom: '16px', color: '#c9a0ff' }}>
        {SIGN_NAMES[sign]} - Dnevni Horoskop
      </h2>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(255,255,255,0.5)' }}>
          <div className="spinner" />
          Učitavanje...
        </div>
      ) : (
        <p style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{text}</p>
      )}
    </div>
  );
}
