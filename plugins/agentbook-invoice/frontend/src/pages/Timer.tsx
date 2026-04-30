import React, { useEffect, useState, useRef } from 'react';
import { Play, Square, Clock, Plus } from 'lucide-react';

const API = '/api/v1/agentbook-invoice';

export const TimerPage: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [entry, setEntry] = useState<any>(null);
  const [elapsed, setElapsed] = useState(0);
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState<any[]>([]);
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    fetch(`${API}/timer/status`).then(r => r.json()).then(d => {
      if (d.data?.running) { setRunning(true); setEntry(d.data.entry); setElapsed(d.data.elapsedMinutes); }
    });
    fetch(`${API}/time-entries?limit=10`).then(r => r.json()).then(d => { if (d.data) setEntries(d.data); });
  }, []);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 60000);
      return () => clearInterval(intervalRef.current);
    }
  }, [running]);

  const startTimer = async () => {
    const res = await fetch(`${API}/timer/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description || 'Working' }),
    });
    const d = await res.json();
    if (d.success) { setRunning(true); setEntry(d.data); setElapsed(0); setDescription(''); }
  };

  const stopTimer = async () => {
    const res = await fetch(`${API}/timer/stop`, { method: 'POST' });
    const d = await res.json();
    if (d.success) { setRunning(false); setEntry(null); setElapsed(0); setEntries(prev => [d.data, ...prev]); }
  };

  const fmtDuration = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

  return (
    <div className="px-4 py-5 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Clock className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Time Tracker</h1>
      </div>

      {/* Timer */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6 text-center">
        <p className="text-5xl font-bold font-mono mb-4">{fmtDuration(elapsed)}</p>
        {running ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">{entry?.description || 'Working...'}</p>
            <button onClick={stopTimer} className="px-8 py-3 bg-red-500 text-white rounded-full font-medium flex items-center gap-2 mx-auto active:scale-95">
              <Square className="w-5 h-5" /> Stop
            </button>
          </div>
        ) : (
          <div>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What are you working on?" className="w-full p-3 border border-border rounded-lg bg-background mb-4 text-center" />
            <button onClick={startTimer} className="px-8 py-3 bg-primary text-primary-foreground rounded-full font-medium flex items-center gap-2 mx-auto active:scale-95">
              <Play className="w-5 h-5" /> Start Timer
            </button>
          </div>
        )}
      </div>

      {/* Recent entries */}
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent Time Entries</h2>
      <div className="space-y-2">
        {entries.map((e: any) => (
          <div key={e.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{e.description}</p>
              <p className="text-xs text-muted-foreground">{new Date(e.startedAt).toLocaleDateString()}{e.project ? ` · ${e.project.name}` : ''}</p>
            </div>
            <span className="font-mono text-sm font-bold">{fmtDuration(e.durationMinutes)}</span>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No time entries yet. Start the timer above!</p>}
      </div>
    </div>
  );
};
