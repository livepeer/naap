import { useState } from 'react';
import { billingApi, type PlanTemplate, type Plan } from '../lib/api';

type Mode = { kind: 'create'; template: PlanTemplate } | { kind: 'edit'; plan: Plan };

export function PlanEditorModal({ mode, onClose, onSaved }: {
  mode: Mode;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const seed = mode.kind === 'create' ? mode.template : mode.plan;
  const [form, setForm] = useState({
    code: 'code' in seed ? seed.code : '',
    name: seed.name,
    description: seed.description ?? '',
    priceCents: seed.priceCents,
    currency: seed.currency,
    interval: seed.interval,
    features: { ...seed.features },
    quotas: { ...seed.quotas },
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true); setErr(null);
    try {
      if (mode.kind === 'create') {
        await billingApi.createPlan(form);
      } else {
        await billingApi.patchPlan(mode.plan.id, {
          name: form.name,
          description: form.description,
          features: form.features,
          quotas: form.quotas,
        });
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[640px] max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">
          {mode.kind === 'create' ? `Create plan from ${mode.template.name}` : `Edit ${mode.plan.name}`}
        </h3>
        {err && <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{err}</div>}

        <label className="mb-3 block text-sm">
          <span className="text-gray-600">Name</span>
          <input className="mt-1 w-full rounded border px-2 py-1" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>

        {mode.kind === 'create' && (
          <label className="mb-3 block text-sm">
            <span className="text-gray-600">Code (URL-safe, unique)</span>
            <input className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs" value={form.code}
              onChange={e => setForm({ ...form, code: e.target.value })} />
          </label>
        )}

        <label className="mb-3 block text-sm">
          <span className="text-gray-600">Price (cents) — only at create</span>
          <input type="number" disabled={mode.kind !== 'create'}
            className="mt-1 w-full rounded border px-2 py-1 disabled:bg-gray-100" value={form.priceCents}
            onChange={e => setForm({ ...form, priceCents: Number(e.target.value) })} />
        </label>

        <fieldset className="mb-3 rounded border p-3">
          <legend className="px-1 text-sm text-gray-600">Features</legend>
          {(['telegram_bot', 'tax_package_generation', 'multi_user_teams'] as const).map(k => (
            <label key={k} className="mr-4 inline-flex items-center text-sm">
              <input type="checkbox" className="mr-1" checked={form.features[k]}
                onChange={e => setForm({ ...form, features: { ...form.features, [k]: e.target.checked } })} />
              {k}
            </label>
          ))}
        </fieldset>

        <fieldset className="mb-3 rounded border p-3">
          <legend className="px-1 text-sm text-gray-600">Quotas (-1 = unlimited)</legend>
          {(['expenses_created', 'ocr_scans', 'ai_messages', 'invoices_sent', 'bank_connections'] as const).map(k => (
            <label key={k} className="mb-2 block text-sm">
              <span className="inline-block w-40 text-gray-600">{k}</span>
              <input type="number" className="rounded border px-2 py-1" value={form.quotas[k]}
                onChange={e => setForm({ ...form, quotas: { ...form.quotas, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </fieldset>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
          <button disabled={saving} onClick={save}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
