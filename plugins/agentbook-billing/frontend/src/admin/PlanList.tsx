import { useEffect, useState } from 'react';
import { billingApi, type Plan } from '../lib/api';

function fmtPrice(cents: number, currency: string, interval: string): string {
  return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)} / ${interval}`;
}

interface Props { onEdit: (p: Plan) => void; onAdd: () => void; }

export function PlanList({ onEdit, onAdd }: Props): JSX.Element {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (): void => {
    billingApi.listPlans().then(setPlans).catch(e => setErr(String(e)));
  };
  useEffect(load, []);

  const archive = async (p: Plan): Promise<void> => {
    if (!window.confirm(`Archive plan "${p.name}"? Existing subscriptions keep working.`)) return;
    await billingApi.archivePlan(p.id);
    load();
  };

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!plans) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Subscription plans</h2>
        <button onClick={onAdd} className="rounded bg-blue-600 px-4 py-2 text-white">+ New plan from template</button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr><th>Code</th><th>Name</th><th>Price</th><th>Telegram</th><th>Tax pkg</th><th></th></tr>
        </thead>
        <tbody>
          {plans.map(p => (
            <tr key={p.id} className="border-t">
              <td className="py-2"><code>{p.code}</code></td>
              <td>{p.name}</td>
              <td>{fmtPrice(p.priceCents, p.currency, p.interval)}</td>
              <td>{p.features.telegram_bot ? '✓' : '—'}</td>
              <td>{p.features.tax_package_generation ? '✓' : '—'}</td>
              <td className="text-right">
                <button onClick={() => onEdit(p)} className="mr-2 text-blue-600">Edit</button>
                <button onClick={() => archive(p)} className="text-red-600">Archive</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
