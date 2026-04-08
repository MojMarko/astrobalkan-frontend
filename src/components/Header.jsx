import React from 'react';

export default function Header() {
  return (
    <header style={{
      textAlign: 'center',
      padding: '32px 16px 16px',
      background: 'linear-gradient(180deg, rgba(106,61,232,0.3) 0%, transparent 100%)'
    }}>
      <h1 style={{
        fontSize: '2.5rem',
        background: 'linear-gradient(135deg, #c9a0ff, #ffd700)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        marginBottom: '8px'
      }}>
        AstroBalkan
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>
        Tvoj astrološki vodič
      </p>
    </header>
  );
}
