import React, { useEffect, useState } from 'react';
import { TrendingUp, Target, Calendar } from 'lucide-react';

const TAX_API = '/api/v1/agentbook-tax';

interface Projection {
  ytdRevenueCents: number;
  projectedAnnualCents: number;
  confidenceLow: number;
  confidenceHigh: number;
  monthsOfData: number;
  methodology: string;
}

export const ProjectionsPage: React.FC = () => {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${TAX_API}/reports/earnings-projection`)
      .then(r => r.json())
      .then(data => { if (data.success || data.data) setProjection(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

  if (loading) return <div className="p-6 text-muted-foreground">Loading projections...</div>;

  return (
    <div className="px-4 py-5 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Earnings Projection</h1>
      </div>

      {projection && (
        <>
          {/* YTD Revenue */}
          <div className="bg-card border border-border rounded-xl p-6 mb-4">
            <p className="text-sm text-muted-foreground mb-1">Year-to-Date Revenue</p>
            <p className="text-4xl font-bold text-green-500">{fmt(projection.ytdRevenueCents)}</p>
            <p className="text-xs text-muted-foreground mt-1">{projection.monthsOfData} months of data</p>
          </div>

          {/* Projection with confidence band */}
          <div className="bg-card border border-border rounded-xl p-6 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium">Projected Annual Revenue</p>
            </div>
            <p className="text-3xl font-bold mb-2">{fmt(projection.projectedAnnualCents)}</p>

            {/* Confidence band visualization */}
            <div className="relative h-8 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className="absolute h-full bg-blue-500/20 rounded-full"
                style={{
                  left: `${(projection.confidenceLow / (projection.confidenceHigh * 1.1)) * 100}%`,
                  width: `${((projection.confidenceHigh - projection.confidenceLow) / (projection.confidenceHigh * 1.1)) * 100}%`,
                }}
              />
              <div
                className="absolute h-full w-1 bg-primary rounded"
                style={{
                  left: `${(projection.projectedAnnualCents / (projection.confidenceHigh * 1.1)) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Low: {fmt(projection.confidenceLow)}</span>
              <span>High: {fmt(projection.confidenceHigh)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{projection.methodology}</p>
          </div>

          {/* Monthly Run Rate */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-primary" />
              <p className="text-sm font-medium">Monthly Run Rate</p>
            </div>
            <p className="text-2xl font-bold">
              {projection.monthsOfData > 0
                ? fmt(Math.round(projection.ytdRevenueCents / projection.monthsOfData))
                : '$0'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Average monthly revenue</p>
          </div>
        </>
      )}

      {!projection && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Record some revenue to see projections!</p>
        </div>
      )}
    </div>
  );
};
