import { meApi, type CurrentPlanView } from '../lib/api';

export function CurrentPlanCard({ view, onRefresh }: { view: CurrentPlanView; onRefresh: () => void }): JSX.Element {
  const cancel = async (): Promise<void> => {
    if (!window.confirm('Cancel at the end of the current period?')) return;
    await meApi.cancel();
    onRefresh();
  };
  const reactivate = async (): Promise<void> => {
    await meApi.reactivate();
    onRefresh();
  };

  return (
    <div className="rounded-lg border bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-gray-500">Current plan</div>
          <div className="text-2xl font-semibold">{view.plan.name}</div>
        </div>
        <div className="text-right text-sm">
          <div>${(view.plan.priceCents / 100).toFixed(2)} / {view.plan.interval}</div>
          <div className="text-gray-500">{view.status}</div>
          {view.periodEnd && (
            <div className="text-gray-500">Renews {new Date(view.periodEnd).toLocaleDateString()}</div>
          )}
        </div>
      </div>
      {view.cancelAtPeriodEnd && (
        <div className="mt-3 flex items-center justify-between rounded bg-amber-50 p-3 text-sm">
          <span>Cancels at the end of the current period.</span>
          <button onClick={reactivate} className="text-blue-600">Reactivate</button>
        </div>
      )}
      {!view.cancelAtPeriodEnd && view.plan.code !== 'free' && view.status === 'active' && (
        <div className="mt-3 text-right">
          <button onClick={cancel} className="text-sm text-red-600">Cancel subscription</button>
        </div>
      )}
    </div>
  );
}
