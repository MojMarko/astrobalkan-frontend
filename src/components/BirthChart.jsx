import React, { useState } from 'react';
import { parseBirthChart } from '../api';

export default function BirthChart() {
  const [form, setForm] = useState({ name: '', date: '', time: '', city: '' });
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form.name || !form.date || !form.city) return;
    setLoading(true);
    setResult('');
    try {
      const text = await parseBirthChart([{
        role: 'user',
        content: `Analiziraj natalni horoskop za osobu:\nIme: ${form.name}\nDatum rođenja: ${form.date}\nVrijeme rođenja: ${form.time || 'nepoznato'}\nMjesto rođenja: ${form.city}\n\nDaj analizu Sunčevog znaka, Mjesečevog znaka (procijeni na osnovu datuma), i općenite karakteristike. Budi detaljan ali koncizan.`
      }]);
      setResult(text);
    } catch {
      setResult('Greška. Pokušaj ponovo.');
    }
    setLoading(false);
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.05)',
    color: '#e0e0ff',
    fontSize: '14px',
    outline: 'none'
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid rgba(255,255,255,0.1)'
    }}>
      <h2 style={{ marginBottom: '16px', color: '#c9a0ff' }}>Natalni Horoskop</h2>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
        <input
          placeholder="Ime"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          style={inputStyle}
          required
        />
        <input
          type="date"
          value={form.date}
          onChange={e => setForm({ ...form, date: e.target.value })}
          style={inputStyle}
          required
        />
        <input
          type="time"
          value={form.time}
          onChange={e => setForm({ ...form, time: e.target.value })}
          style={inputStyle}
        />
        <input
          placeholder="Mjesto rođenja (npr. Beograd)"
          value={form.city}
          onChange={e => setForm({ ...form, city: e.target.value })}
          style={inputStyle}
          required
        />
        <button type="submit" disabled={loading} style={{
          padding: '14px',
          borderRadius: '12px',
          border: 'none',
          background: 'linear-gradient(135deg, #6a3de8, #9b59b6)',
          color: 'white',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '15px',
          fontWeight: 600,
          opacity: loading ? 0.6 : 1
        }}>
          {loading ? 'Analiziram...' : 'Generiši Natalni Horoskop'}
        </button>
      </form>
      {result && (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '12px',
          padding: '20px',
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap'
        }}>
          {result}
        </div>
      )}
    </div>
  );
}
