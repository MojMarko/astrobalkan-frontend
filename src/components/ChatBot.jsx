import React, { useState } from 'react';
import { askClaude } from '../api';

export default function ChatBot() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const reply = await askClaude(updated);
      setMessages([...updated, { role: 'assistant', content: reply }]);
    } catch {
      setMessages([...updated, { role: 'assistant', content: 'Greška. Pokušaj ponovo.' }]);
    }
    setLoading(false);
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid rgba(255,255,255,0.1)'
    }}>
      <h2 style={{ marginBottom: '16px', color: '#c9a0ff' }}>Pitaj Astrologa</h2>
      <div style={{
        maxHeight: '400px',
        overflowY: 'auto',
        marginBottom: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {messages.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '32px' }}>
            Postavi pitanje o astrologiji, horoskopima, planetama...
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            background: m.role === 'user'
              ? 'linear-gradient(135deg, #6a3de8, #9b59b6)'
              : 'rgba(255,255,255,0.08)',
            padding: '12px 16px',
            borderRadius: '12px',
            maxWidth: '80%',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap'
          }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ color: 'rgba(255,255,255,0.5)', padding: '8px' }}>
            Astrolog razmišlja...
          </div>
        )}
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: '8px' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Npr: Kakva je kompatibilnost Ovna i Ribe?"
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.05)',
            color: '#e0e0ff',
            fontSize: '14px',
            outline: 'none'
          }}
        />
        <button type="submit" disabled={loading} style={{
          padding: '12px 24px',
          borderRadius: '12px',
          border: 'none',
          background: 'linear-gradient(135deg, #6a3de8, #9b59b6)',
          color: 'white',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '14px',
          opacity: loading ? 0.6 : 1
        }}>
          Pošalji
        </button>
      </form>
    </div>
  );
}
