const API = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export async function askClaude(messages, system) {
  const res = await fetch(`${API}/api/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: system || 'Ti si AstroBalkan astrolog. Odgovaraj na srpskom jeziku o astrologiji.',
      messages
    })
  });
  if (!res.ok) throw new Error('API greška');
  const data = await res.json();
  return data.content?.[0]?.text || 'Nema odgovora.';
}

export async function parseBirthChart(messages) {
  const res = await fetch(`${API}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: 'Ti si stručni astrolog. Analiziraj natalni horoskop na osnovu datih podataka. Odgovaraj na srpskom.',
      messages
    })
  });
  if (!res.ok) throw new Error('API greška');
  const data = await res.json();
  return data.content?.[0]?.text || 'Nema odgovora.';
}

export async function getHoroscope(sign) {
  const res = await fetch(`${API}/api/astro/daily-horoscope`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sign })
  });
  if (!res.ok) throw new Error('Astro API greška');
  return res.json();
}
