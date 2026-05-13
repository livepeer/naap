import { useEffect, useState } from 'react';
import { billingApi, type PlanTemplate } from '../lib/api';

interface Props { onClose: () => void; onPicked: (t: PlanTemplate) => void; }

export function TemplatePickerModal({ onClose, onPicked }: Props): JSX.Element {
  const [tpls, setTpls] = useState<PlanTemplate[] | null>(null);
  useEffect(() => { billingApi.listTemplates().then(setTpls); }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[600px] rounded-lg bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Start from a template</h3>
          <button onClick={onClose} aria-label="close" className="text-gray-500">×</button>
        </div>
        {!tpls ? <div>Loading…</div> : (
          <div className="grid grid-cols-3 gap-3">
            {tpls.map(t => (
              <button key={t.code} onClick={() => onPicked(t)}
                className="rounded border p-4 text-left hover:bg-gray-50">
                <div className="font-medium">{t.name}</div>
                <div className="text-sm text-gray-500">${(t.priceCents / 100).toFixed(0)} / {t.interval}</div>
                <div className="mt-2 text-xs text-gray-400">{t.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
