import React, { useEffect, useState } from 'react';
import { Shield, FileText, MessageSquare, Download, Eye, Clock } from 'lucide-react';

const CORE_API = '/api/v1/agentbook-core';
const TAX_API = '/api/v1/agentbook-tax';

interface CPANote {
  id: string;
  content: string;
  attachedTo: string | null;
  attachedType: string | null;
  createdAt: string;
}

export const CPAPortalPage: React.FC = () => {
  const [notes, setNotes] = useState<CPANote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [cpaLink, setCpaLink] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${CORE_API}/cpa/notes`)
      .then(r => r.json())
      .then(data => { if (data.success) setNotes(data.data || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const generateLink = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${CORE_API}/cpa/generate-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cpa@example.com' }),
      });
      const data = await res.json();
      if (data.success) {
        setCpaLink(`${window.location.origin}/agentbook/cpa?token=${data.data.token}`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    await fetch(`${CORE_API}/cpa/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newNote }),
    });
    setNewNote('');
    // Refresh notes
    const res = await fetch(`${CORE_API}/cpa/notes`);
    const data = await res.json();
    if (data.success) setNotes(data.data || []);
  };

  return (
    <div className="px-4 py-5 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">CPA Collaboration</h1>
      </div>

      {/* Generate CPA Link */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <h2 className="font-medium mb-2 flex items-center gap-2"><Eye className="w-4 h-4" /> Share Read-Only Access</h2>
        <p className="text-sm text-muted-foreground mb-4">Generate a secure link for your CPA. They can view your books and leave notes. Expires in 30 days.</p>
        {cpaLink ? (
          <div className="flex gap-2">
            <input type="text" value={cpaLink} readOnly className="flex-1 p-3 bg-muted border border-border rounded-lg font-mono text-xs" />
            <button onClick={() => navigator.clipboard.writeText(cpaLink)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">Copy</button>
          </div>
        ) : (
          <button onClick={generateLink} disabled={generating} className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50">
            {generating ? 'Generating...' : 'Generate CPA Link'}
          </button>
        )}
      </div>

      {/* Quick Export */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'P&L Report', icon: <FileText className="w-4 h-4" />, endpoint: 'reports/pnl' },
          { label: 'Balance Sheet', icon: <FileText className="w-4 h-4" />, endpoint: 'reports/balance-sheet' },
          { label: 'Trial Balance', icon: <FileText className="w-4 h-4" />, endpoint: 'reports/trial-balance' },
          { label: 'Tax Estimate', icon: <FileText className="w-4 h-4" />, endpoint: 'tax/estimate' },
        ].map(report => (
          <button key={report.label} onClick={() => window.open(`${TAX_API}/${report.endpoint}`, '_blank')}
            className="bg-card border border-border rounded-xl p-4 text-center hover:border-primary/50 transition-colors">
            <div className="text-primary mb-2">{report.icon}</div>
            <p className="text-xs font-medium">{report.label}</p>
          </button>
        ))}
      </div>

      {/* CPA Notes */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="font-medium mb-4 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Notes</h2>

        <div className="flex gap-2 mb-4">
          <input type="text" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note..."
            className="flex-1 p-3 border border-border rounded-lg bg-background" onKeyDown={e => e.key === 'Enter' && addNote()} />
          <button onClick={addNote} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">Add</button>
        </div>

        {loading && <p className="text-muted-foreground text-sm">Loading notes...</p>}

        <div className="space-y-3">
          {notes.map(note => (
            <div key={note.id} className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm">{note.content}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(note.createdAt).toLocaleDateString()}
                {note.attachedType && ` \u00b7 ${note.attachedType}`}
              </p>
            </div>
          ))}
          {notes.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-4">No notes yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};
