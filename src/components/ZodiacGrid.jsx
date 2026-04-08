import React from 'react';

const SIGNS = [
  { id: 'aries', name: 'Ovan', symbol: '\u2648', dates: '21.3 - 19.4' },
  { id: 'taurus', name: 'Bik', symbol: '\u2649', dates: '20.4 - 20.5' },
  { id: 'gemini', name: 'Blizanci', symbol: '\u264A', dates: '21.5 - 20.6' },
  { id: 'cancer', name: 'Rak', symbol: '\u264B', dates: '21.6 - 22.7' },
  { id: 'leo', name: 'Lav', symbol: '\u264C', dates: '23.7 - 22.8' },
  { id: 'virgo', name: 'Djevica', symbol: '\u264D', dates: '23.8 - 22.9' },
  { id: 'libra', name: 'Vaga', symbol: '\u264E', dates: '23.9 - 22.10' },
  { id: 'scorpio', name: 'Škorpija', symbol: '\u264F', dates: '23.10 - 21.11' },
  { id: 'sagittarius', name: 'Strijelac', symbol: '\u2650', dates: '22.11 - 21.12' },
  { id: 'capricorn', name: 'Jarac', symbol: '\u2651', dates: '22.12 - 19.1' },
  { id: 'aquarius', name: 'Vodolija', symbol: '\u2652', dates: '20.1 - 18.2' },
  { id: 'pisces', name: 'Ribe', symbol: '\u2653', dates: '19.2 - 20.3' }
];

export default function ZodiacGrid({ onSelect, selected }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
      gap: '12px',
      marginBottom: '24px'
    }}>
      {SIGNS.map(sign => (
        <button
          key={sign.id}
          onClick={() => onSelect(sign.id)}
          style={{
            padding: '16px 8px',
            background: selected === sign.id
              ? 'linear-gradient(135deg, #6a3de8, #9b59b6)'
              : 'rgba(255,255,255,0.05)',
            border: selected === sign.id
              ? '1px solid rgba(201,160,255,0.5)'
              : '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            cursor: 'pointer',
            color: '#e0e0ff',
            textAlign: 'center',
            transition: 'all 0.3s'
          }}
        >
          <div style={{ fontSize: '2rem' }}>{sign.symbol}</div>
          <div style={{ fontWeight: 600, marginTop: '4px' }}>{sign.name}</div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
            {sign.dates}
          </div>
        </button>
      ))}
    </div>
  );
}
