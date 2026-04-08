import React, { useState } from 'react';
import Header from './components/Header';
import ZodiacGrid from './components/ZodiacGrid';
import HoroscopeView from './components/HoroscopeView';
import ChatBot from './components/ChatBot';
import BirthChart from './components/BirthChart';
import './App.css';

const TABS = [
  { id: 'horoscope', label: 'Dnevni Horoskop' },
  { id: 'chat', label: 'Pitaj Astrologa' },
  { id: 'birth', label: 'Natalni Horoskop' }
];

export default function App() {
  const [tab, setTab] = useState('horoscope');
  const [selectedSign, setSelectedSign] = useState(null);

  return (
    <div className="app">
      <Header />
      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="main">
        {tab === 'horoscope' && (
          <>
            <ZodiacGrid onSelect={setSelectedSign} selected={selectedSign} />
            {selectedSign && <HoroscopeView sign={selectedSign} />}
          </>
        )}
        {tab === 'chat' && <ChatBot />}
        {tab === 'birth' && <BirthChart />}
      </main>
      <footer className="footer">
        <p>&copy; 2026 AstroBalkan. Sva prava zadržana.</p>
      </footer>
    </div>
  );
}
