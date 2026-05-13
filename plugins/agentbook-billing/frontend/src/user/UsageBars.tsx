const LABELS: Record<string, string> = {
  expenses_created: 'Expenses created',
  ocr_scans: 'Receipt scans',
  ai_messages: 'AI messages',
  invoices_sent: 'Invoices sent',
  bank_connections: 'Bank connections',
};

export function UsageBars({ usage }: { usage: Record<string, { used: number; limit: number }> }): JSX.Element {
  return (
    <div className="space-y-2">
      {Object.entries(usage).map(([dim, { used, limit }]) => {
        const isUnlimited = limit === -1;
        const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
        return (
          <div key={dim}>
            <div className="flex justify-between text-xs text-gray-600">
              <span>{LABELS[dim] ?? dim}</span>
              <span>{used} {isUnlimited ? '' : `/ ${limit}`}</span>
            </div>
            {!isUnlimited && (
              <div className="h-2 w-full rounded bg-gray-100">
                <div
                  className={`h-2 rounded ${pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-400' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
