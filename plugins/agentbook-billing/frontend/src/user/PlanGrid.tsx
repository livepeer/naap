import { useEffect, useState } from 'react';
import { billingApi, type Plan } from '../lib/api';

export function PlanGrid({
  currentPlanCode,
  onSubscribe,
}: {
  currentPlanCode: string;
  onSubscribe: (p: Plan) => void;
}): JSX.Element {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => { billingApi.listPlans().then(setPlans); }, []);
  if (!plans) return <div className="text-gray-500">Loading plans…</div>;

  return (
    <div className="grid grid-cols-3 gap-4">
      {plans.map((p) => (
        <div key={p.id} className="rounded-lg border bg-white p-5">
          <div className="text-lg font-semibold">{p.name}</div>
          <div className="text-sm text-gray-500">${(p.priceCents / 100).toFixed(0)} / {p.interval}</div>
          <p className="mt-2 text-sm text-gray-600">{p.description}</p>
          <ul className="mt-3 space-y-1 text-xs text-gray-700">
            <li>Telegram bot: {p.features.telegram_bot ? '✓' : '—'}</li>
            <li>Tax packages: {p.features.tax_package_generation ? '✓' : '—'}</li>
            <li>OCR scans: {p.quotas.ocr_scans === -1 ? '∞' : p.quotas.ocr_scans}/mo</li>
          </ul>
          <button
            disabled={p.code === currentPlanCode}
            onClick={() => onSubscribe(p)}
            className="mt-4 w-full rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {p.code === currentPlanCode ? 'Current plan' : p.priceCents === 0 ? 'Downgrade' : 'Upgrade'}
          </button>
        </div>
      ))}
    </div>
  );
}
