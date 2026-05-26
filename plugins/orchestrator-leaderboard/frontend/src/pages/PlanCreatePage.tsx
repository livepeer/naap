import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { createPlan } from '../lib/api';
import { useCapabilityCatalog } from '../hooks/useCapabilityCatalog';
import { CapabilityGroupPicker } from '../components/CapabilityGroupPicker';
import { FormLabel } from '../components/FormLabel';
import { SectionLabel } from '../components/SectionLabel';

type BillingProviderSlug = 'pymthouse' | 'daydream';

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export const PlanCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [billingProviderSlug] = useState<BillingProviderSlug>('daydream');
  const [topN, setTopN] = useState(10);
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniqueSuffixRef = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36),
  );
  const { pipelines, loading, error: catalogError, meta } = useCapabilityCatalog(billingProviderSlug);
  const capabilityCatalogReady = !loading && meta !== null;

  const generatedBillingPlanId = useMemo(() => {
    const trimmedName = name.trim();
    const slug = slugify(trimmedName || 'new-discovery-plan');
    return `${billingProviderSlug}-${slug}-${uniqueSuffixRef.current}`;
  }, [billingProviderSlug, name]);

  const availableCapabilities = useMemo(
    () => new Set(pipelines.flatMap((pipeline) => pipeline.models.map((model) => model.capability))),
    [pipelines],
  );

  const effectiveSelectedCaps = useMemo(() => {
    if (!capabilityCatalogReady) {
      return selectedCaps;
    }
    return selectedCaps.filter((cap) => availableCapabilities.has(cap));
  }, [availableCapabilities, capabilityCatalogReady, selectedCaps]);

  React.useEffect(() => {
    if (!capabilityCatalogReady) {
      return;
    }
    setSelectedCaps((prev) => prev.filter((cap) => availableCapabilities.has(cap)));
  }, [availableCapabilities, capabilityCatalogReady]);

  function toggleCapability(capability: string) {
    setSelectedCaps((prev) =>
      prev.includes(capability)
        ? prev.filter((cap) => cap !== capability)
        : [...prev, capability],
    );
  }

  function bulkToggleCapabilities(capabilities: string[], select: boolean) {
    setSelectedCaps((prev) => {
      if (select) {
        const toAdd = capabilities.filter((cap) => !prev.includes(cap));
        return [...prev, ...toAdd];
      }
      const removeSet = new Set(capabilities);
      return prev.filter((cap) => !removeSet.has(cap));
    });
  }

  async function onCreate(): Promise<void> {
    if (!name.trim()) {
      setError('Plan name is required');
      return;
    }
    if (effectiveSelectedCaps.length === 0) {
      setError('Pick at least one capability');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const plan = await createPlan({
        billingPlanId: generatedBillingPlanId,
        billingProviderSlug,
        name: name.trim(),
        capabilities: effectiveSelectedCaps,
        topN,
      });
      navigate(`/plans/${plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create discovery plan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 pb-6 pt-3 max-w-[1400px] mx-auto space-y-5">
      <button
        onClick={() => navigate('/plans')}
        className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={16} /> Back to Plans
      </button>

      <div className="glass-card p-5 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Create Discovery Plan</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Plan settings and results are scoped to capabilities allowed by the selected billing provider.
          </p>
        </div>

        {error && (
          <div className="text-sm text-accent-rose bg-accent-rose/10 border border-accent-rose/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FormLabel>Name</FormLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Balanced Streaming"
              className="w-full px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
            />
          </div>
          <div />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FormLabel>Billing plan ID</FormLabel>
            <input
              value={generatedBillingPlanId}
              readOnly
              className="w-full px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-muted text-sm font-mono"
            />
          </div>
          <div>
            <FormLabel>Top N</FormLabel>
            <input
              type="number"
              min={1}
              max={1000}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 10)}
              className="w-full px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
            />
          </div>
        </div>

        <div>
          {catalogError && (
            <div className="text-sm text-accent-rose bg-accent-rose/10 border border-accent-rose/30 rounded-lg px-3 py-2 mb-3">
              {catalogError}
            </div>
          )}
          <div className="glass-card p-4 space-y-3">
            <SectionLabel className="mb-0">
              {`Allowed capabilities (${effectiveSelectedCaps.length} selected)`}
            </SectionLabel>

            <CapabilityGroupPicker
              title="Allowed capabilities"
              showSectionHeader={false}
              pipelines={pipelines}
              loading={loading}
              selectedCapabilities={effectiveSelectedCaps}
              isSelected={(capability) => effectiveSelectedCaps.includes(capability)}
              onToggle={toggleCapability}
              onBulkToggle={bulkToggleCapabilities}
            />
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={onCreate}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {saving ? 'Creating...' : 'Create plan'}
          </button>
        </div>
      </div>
    </div>
  );
};
