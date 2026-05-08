/**
 * Saved Searches page (PR 17).
 *
 * Lists every AbSavedSearch for the tenant, pinned-first. Users can:
 *   • Create a new saved search via a small in-page form (name + scope
 *     + optional structured filters).
 *   • Pin / unpin (the bot's `/searches` command shows pinned only).
 *   • Edit name / pinned state / scope via a modal (stretch — for the
 *     PR 17 scope we keep edit minimal: name + pinned).
 *   • Delete with confirmation.
 *   • Run inline — fetches /run and shows the row count.
 *
 * The page is intentionally self-contained — no shared layout — so the
 * plugin loader can mount it standalone. Mirrors the home-office page.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Pin, PinOff, Trash2, Play, Plus, X } from 'lucide-react';

const API = '/api/v1/agentbook-core';

type SearchScope = 'expense' | 'invoice' | 'mileage' | 'all';

interface SearchQuery {
  scope: SearchScope;
  text?: string;
  categoryName?: string;
  vendorName?: string;
  amountMinCents?: number;
  amountMaxCents?: number;
  startDate?: string;
  endDate?: string;
  isPersonal?: boolean;
  isDeductible?: boolean;
}

interface SavedSearch {
  id: string;
  name: string;
  scope: SearchScope;
  query: SearchQuery;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RunResult {
  scope: SearchScope;
  rows: unknown[];
  count: number;
  search: { id: string; name: string; scope: string };
}

function dollarsToCents(s: string): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  if (!isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export const SavedSearchesPage: React.FC = () => {
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<SearchScope>('expense');
  const [newCategory, setNewCategory] = useState('');
  const [newVendor, setNewVendor] = useState('');
  const [newMinAmount, setNewMinAmount] = useState('');
  const [newMaxAmount, setNewMaxAmount] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newPinned, setNewPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [editName, setEditName] = useState('');
  const [editPinned, setEditPinned] = useState(false);

  // Run result
  const [running, setRunning] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const pinnedCount = useMemo(
    () => items.filter((i) => i.pinned).length,
    [items],
  );

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${API}/searches`).then((res) => res.json());
      if (r?.success) setItems(r.data ?? []);
      else setErr(r?.error ?? 'Failed to load');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reset = () => {
    setNewName('');
    setNewScope('expense');
    setNewCategory('');
    setNewVendor('');
    setNewMinAmount('');
    setNewMaxAmount('');
    setNewStartDate('');
    setNewEndDate('');
    setNewPinned(false);
  };

  const create = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const query: SearchQuery = { scope: newScope };
      if (newCategory.trim()) query.categoryName = newCategory.trim();
      if (newVendor.trim()) query.vendorName = newVendor.trim();
      const minC = dollarsToCents(newMinAmount);
      if (minC !== undefined) query.amountMinCents = minC;
      const maxC = dollarsToCents(newMaxAmount);
      if (maxC !== undefined) query.amountMaxCents = maxC;
      if (newStartDate) query.startDate = newStartDate;
      if (newEndDate) query.endDate = newEndDate;

      const res = await fetch(`${API}/searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          scope: newScope,
          query,
          pinned: newPinned,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setErr(body?.error ?? 'Failed to create');
        return;
      }
      reset();
      setShowCreate(false);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const togglePin = async (s: SavedSearch) => {
    setErr(null);
    const res = await fetch(`${API}/searches/${s.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !s.pinned }),
    });
    const body = await res.json();
    if (!res.ok || !body?.success) {
      setErr(body?.error ?? 'Failed to toggle pin');
      return;
    }
    await load();
  };

  const remove = async (s: SavedSearch) => {
    if (!confirm(`Delete saved search "${s.name}"?`)) return;
    setErr(null);
    const res = await fetch(`${API}/searches/${s.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(body?.error ?? 'Failed to delete');
      return;
    }
    await load();
  };

  const run = async (s: SavedSearch) => {
    setRunning(s.id);
    setRunResult(null);
    setErr(null);
    try {
      const r = await fetch(`${API}/searches/${s.id}/run`).then((res) => res.json());
      if (!r?.success) {
        setErr(r?.error ?? 'Failed to run');
        return;
      }
      setRunResult(r.data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(null);
    }
  };

  const openEdit = (s: SavedSearch) => {
    setEditing(s);
    setEditName(s.name);
    setEditPinned(s.pinned);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setErr(null);
    const res = await fetch(`${API}/searches/${editing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), pinned: editPinned }),
    });
    const body = await res.json();
    if (!res.ok || !body?.success) {
      setErr(body?.error ?? 'Failed to save');
      return;
    }
    setEditing(null);
    await load();
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <Search size={24} /> Saved Searches
        </h1>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 6, border: '1px solid #ccc',
            background: '#0a66ff', color: 'white', cursor: 'pointer',
          }}
        >
          <Plus size={16} /> {showCreate ? 'Close' : 'New'}
        </button>
      </header>

      {err && (
        <div style={{ background: '#fee', border: '1px solid #f99', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {err}
        </div>
      )}

      <p style={{ color: '#666', fontSize: 13 }}>
        Pinned: <strong>{pinnedCount}/10</strong>. Pinned searches surface in the Telegram bot via <code>/searches</code>.
      </p>

      {showCreate && (
        <section style={{ background: '#f7f7f7', padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>New saved search</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              Name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Client meals over $50 in 2026"
                style={{ width: '100%', padding: 8, marginTop: 4 }}
              />
            </label>
            <label>
              Scope
              <select
                value={newScope}
                onChange={(e) => setNewScope(e.target.value as SearchScope)}
                style={{ width: '100%', padding: 8, marginTop: 4 }}
              >
                <option value="expense">Expense</option>
                <option value="invoice">Invoice</option>
                <option value="mileage">Mileage</option>
                <option value="all">All</option>
              </select>
            </label>
            <label>
              Category contains
              <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="meals" style={{ width: '100%', padding: 8, marginTop: 4 }} />
            </label>
            <label>
              Vendor contains
              <input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="Starbucks" style={{ width: '100%', padding: 8, marginTop: 4 }} />
            </label>
            <label>
              Min amount ($)
              <input value={newMinAmount} onChange={(e) => setNewMinAmount(e.target.value)} placeholder="50" style={{ width: '100%', padding: 8, marginTop: 4 }} />
            </label>
            <label>
              Max amount ($)
              <input value={newMaxAmount} onChange={(e) => setNewMaxAmount(e.target.value)} placeholder="500" style={{ width: '100%', padding: 8, marginTop: 4 }} />
            </label>
            <label>
              Start date
              <input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} />
            </label>
            <label>
              End date
              <input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} />
            </label>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <input type="checkbox" checked={newPinned} onChange={(e) => setNewPinned(e.target.checked)} />
            Pin to /searches
          </label>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              disabled={submitting || !newName.trim()}
              onClick={create}
              style={{ padding: '8px 14px', borderRadius: 6, background: '#0a66ff', color: 'white', border: 'none', cursor: 'pointer' }}
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#666' }}>No saved searches yet. Click "New" to create your first.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((s) => (
            <li
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: 12, borderBottom: '1px solid #eee',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {s.pinned && <span style={{ marginRight: 6 }}>📌</span>}
                  {s.name}
                </div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  Scope: {s.scope} · Created {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => run(s)}
                  disabled={running === s.id}
                  title="Run"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}
                >
                  <Play size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => togglePin(s)}
                  title={s.pinned ? 'Unpin' : 'Pin'}
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}
                >
                  {s.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  title="Edit"
                  style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(s)}
                  title="Delete"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #f99', background: '#fff0f0', cursor: 'pointer' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {runResult && (
        <section style={{ marginTop: 24, padding: 16, background: '#f3f9ff', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>{runResult.search.name}</h3>
          <p>
            Scope: <strong>{runResult.scope}</strong> · Matches: <strong>{runResult.count}</strong>
          </p>
          {runResult.count > 0 && (
            <pre style={{ maxHeight: 240, overflow: 'auto', fontSize: 12, background: 'white', padding: 8 }}>
              {JSON.stringify(runResult.rows.slice(0, 10), null, 2)}
            </pre>
          )}
        </section>
      )}

      {editing && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div style={{ background: 'white', padding: 24, borderRadius: 8, minWidth: 360 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Edit saved search</h3>
              <button type="button" onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </header>
            <label style={{ display: 'block', marginBottom: 12 }}>
              Name
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: '100%', padding: 8, marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} />
              Pinned
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setEditing(null)} style={{ padding: '8px 14px' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!editName.trim()}
                style={{ padding: '8px 14px', background: '#0a66ff', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SavedSearchesPage;
