import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { useQueryDetail } from '../hooks/useQueryDetail';
import { EndpointGuide } from '../components/EndpointGuide';
import { CapabilityGrid } from '../components/CapabilityGrid';
import { CapabilityDetail } from '../components/CapabilityDetail';
import type { EnrichedCapability } from '../lib/types';

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'llm', label: 'LLM' },
  { value: 't2i', label: 'Text to Image' },
  { value: 't2v', label: 'Text to Video' },
  { value: 'i2i', label: 'Image to Image' },
  { value: 'i2v', label: 'Image to Video' },
  { value: 'a2t', label: 'Audio to Text' },
  { value: 'tts', label: 'Text to Speech' },
  { value: 'upscale', label: 'Upscale' },
  { value: 'live-video', label: 'Live Video' },
];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'gpuCount', label: 'GPU Count' },
  { value: 'price', label: 'Price' },
  { value: 'latency', label: 'Latency' },
  { value: 'capacity', label: 'Capacity' },
];

export const QueryDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { query, results, loading, resultsLoading, error, update, remove } = useQueryDetail(id!);
  const [selectedCap, setSelectedCap] = useState<EnrichedCapability | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startEditing = () => {
    if (!query) return;
    setEditForm({
      name: query.name,
      category: query.category || '',
      search: query.search || '',
      minGpuCount: query.minGpuCount ?? '',
      maxPriceUsd: query.maxPriceUsd ?? '',
      minCapacity: query.minCapacity ?? '',
      sortBy: query.sortBy || 'name',
      sortOrder: query.sortOrder || 'asc',
      limit: query.limit,
    });
  };

  const handleSave = async () => {
    if (!editForm) return;
    setSaving(true);
    await update({
      name: editForm.name as string,
      category: (editForm.category as string) || null,
      search: (editForm.search as string) || null,
      minGpuCount: editForm.minGpuCount ? Number(editForm.minGpuCount) : null,
      maxPriceUsd: editForm.maxPriceUsd ? Number(editForm.maxPriceUsd) : null,
      minCapacity: editForm.minCapacity ? Number(editForm.minCapacity) : null,
      sortBy: (editForm.sortBy as string) || null,
      sortOrder: (editForm.sortOrder as string) || null,
      limit: Number(editForm.limit) || 50,
    });
    setSaving(false);
    setEditForm(null);
  };

  const handleDelete = async () => {
    if (!confirm('Delete this query?')) return;
    setDeleting(true);
    const ok = await remove();
    setDeleting(false);
    if (ok) navigate('/queries');
  };

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-bg-tertiary rounded w-64" />
        <div className="h-4 bg-bg-tertiary/80 rounded w-96" />
        <div className="h-40 bg-bg-tertiary/60 rounded" />
      </div>
    );
  }

  if (!query) {
    return (
      <div className="p-6 text-center">
        <p className="text-text-muted">Query not found.</p>
        <button onClick={() => navigate('/queries')} className="text-accent-emerald text-sm mt-2">
          Back to Discovery
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/queries')}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Discovery
      </button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight" data-testid="query-detail-title">
            {query.name}
          </h1>
          <p className="text-sm text-text-muted mt-0.5 font-mono">{query.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          {!editForm ? (
            <button
              onClick={startEditing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-emerald/20 hover:bg-accent-emerald/30 text-accent-emerald text-xs font-medium rounded-lg border border-accent-emerald/30 transition-colors"
            >
              Edit Query
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-emerald/20 hover:bg-accent-emerald/30 text-accent-emerald text-xs font-medium rounded-lg border border-accent-emerald/30 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Apply Changes
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-rose/10 hover:bg-accent-rose/20 text-accent-rose text-xs font-medium rounded-lg border border-accent-rose/20 transition-colors disabled:opacity-50"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 glass-card p-4" style={{ borderColor: 'rgba(220, 38, 38, 0.3)', background: 'rgba(220, 38, 38, 0.05)' }}>
          <AlertCircle size={18} className="text-accent-rose shrink-0" />
          <p className="text-sm text-accent-rose">{error}</p>
        </div>
      )}

      {editForm && (
        <div className="glass-card p-5 space-y-4" data-testid="query-edit-form">
          <h3 className="text-sm font-semibold text-text-primary">Query Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Name</label>
              <input
                type="text"
                value={editForm.name as string}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Category</label>
              <select
                value={editForm.category as string}
                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Search</label>
              <input
                type="text"
                value={editForm.search as string}
                onChange={(e) => setEditForm({ ...editForm, search: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
                placeholder="Filter by keyword..."
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Min GPU Count</label>
              <input
                type="number"
                value={editForm.minGpuCount as string}
                onChange={(e) => setEditForm({ ...editForm, minGpuCount: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max Price (USD)</label>
              <input
                type="number"
                step="0.001"
                value={editForm.maxPriceUsd as string}
                onChange={(e) => setEditForm({ ...editForm, maxPriceUsd: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
                placeholder="No limit"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Min Capacity</label>
              <input
                type="number"
                value={editForm.minCapacity as string}
                onChange={(e) => setEditForm({ ...editForm, minCapacity: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Sort By</label>
              <select
                value={editForm.sortBy as string}
                onChange={(e) => setEditForm({ ...editForm, sortBy: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Sort Order</label>
              <select
                value={editForm.sortOrder as string}
                onChange={(e) => setEditForm({ ...editForm, sortOrder: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Limit</label>
              <input
                type="number"
                value={editForm.limit as number}
                onChange={(e) => setEditForm({ ...editForm, limit: Number(e.target.value) || 50 })}
                className="w-full px-3 py-1.5 text-sm bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary"
                min={1}
                max={100}
              />
            </div>
          </div>
        </div>
      )}

      <EndpointGuide queryId={query.id} querySlug={query.slug} />

      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          Results
          {results && (
            <span className="ml-2 text-xs font-normal text-text-muted">
              {results.total} capability{results.total !== 1 ? 'ies' : 'y'}
            </span>
          )}
        </h3>

        {resultsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card p-4 animate-pulse">
                <div className="aspect-[16/10] rounded-lg bg-bg-tertiary mb-3" />
                <div className="h-4 bg-bg-tertiary rounded w-3/4 mb-2" />
                <div className="h-3 bg-bg-tertiary rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : results && results.items.length > 0 ? (
          <CapabilityGrid
            capabilities={results.items}
            viewMode="grid"
            onSelect={setSelectedCap}
          />
        ) : (
          <div className="text-center py-12 text-text-muted text-sm">
            No capabilities match this query's filters.
          </div>
        )}
      </div>

      {selectedCap && (
        <CapabilityDetail
          capability={selectedCap}
          onClose={() => setSelectedCap(null)}
        />
      )}
    </div>
  );
};
