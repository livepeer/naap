import { useEffect, useState } from 'react';
import { CurrentPlanCard } from './CurrentPlanCard';
import { UsageBars } from './UsageBars';
import { PlanGrid } from './PlanGrid';
import { SubscribeModal } from './SubscribeModal';
import { meApi, type CurrentPlanView, type Plan } from '../lib/api';

export function UserApp(): JSX.Element {
  const [view, setView] = useState<CurrentPlanView | null>(null);
  const [picking, setPicking] = useState<Plan | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    meApi.current().then(setView).catch((e: unknown) => console.error(e));
  }, [refresh]);

  if (!view) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <CurrentPlanCard view={view} onRefresh={() => setRefresh((r) => r + 1)} />
      <div className="rounded-lg border bg-white p-6">
        <h3 className="mb-3 text-sm font-medium text-gray-600">Usage this period</h3>
        <UsageBars usage={view.usage} />
      </div>
      <h3 className="text-lg font-semibold">Plans</h3>
      <PlanGrid currentPlanCode={view.plan.code} onSubscribe={setPicking} />
      {picking && (
        <SubscribeModal
          plan={picking}
          onClose={() => setPicking(null)}
          onDone={() => { setPicking(null); setRefresh((r) => r + 1); }}
        />
      )}
    </div>
  );
}
