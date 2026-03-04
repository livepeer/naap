import React from 'react';
import type { RenderSpec, AnalyticsResult, PanelSpec } from '../types';
import { BarChart } from './BarChart';
import { MetricGauge } from './MetricGauge';
import { DataTable } from './DataTable';

interface DynamicRendererProps {
  spec: RenderSpec;
  data: AnalyticsResult;
}

const PanelWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">{children}</div>
);

function renderPanel(panel: PanelSpec, data: AnalyticsResult, idx: number) {
  const config = (panel.config || {}) as Record<string, unknown>;

  switch (panel.type) {
    case 'bar_chart':
      return (
        <PanelWrapper key={idx}>
          <BarChart
            data={data.orchestrators}
            valueKey={String(config.valueKey || 'score')}
            labelKey={String(config.labelKey || 'orchestrator')}
            color={String(config.color || 'purple')}
            title={panel.title}
          />
        </PanelWrapper>
      );

    case 'data_table':
      return (
        <PanelWrapper key={idx}>
          <DataTable
            data={data.orchestrators}
            columns={config.columns as string[] | undefined}
            title={panel.title}
          />
        </PanelWrapper>
      );

    case 'metric_gauge':
      return (
        <MetricGauge
          key={idx}
          value={Number(config.value || 0)}
          label={String(config.label || panel.title)}
          unit={String(config.unit || '')}
          color={String(config.color || 'purple')}
        />
      );

    default:
      return null;
  }
}

export const DynamicRenderer: React.FC<DynamicRendererProps> = ({ spec, data }) => {
  const gauges = spec.panels.filter((p) => p.type === 'metric_gauge');
  const charts = spec.panels.filter((p) => p.type !== 'metric_gauge');

  const layoutClass =
    spec.layout === 'split'
      ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
      : spec.layout === 'grid'
      ? 'grid grid-cols-1 gap-4'
      : 'flex flex-col gap-4';

  return (
    <div className="space-y-4">
      {spec.title && <h3 className="text-lg font-semibold text-gray-100">{spec.title}</h3>}
      {spec.summary && <p className="text-sm text-gray-400">{spec.summary}</p>}

      {gauges.length > 0 && (
        <div className={`grid gap-3 ${gauges.length >= 3 ? 'grid-cols-3' : gauges.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {gauges.map((p, i) => renderPanel(p, data, i))}
        </div>
      )}

      <div className={layoutClass}>
        {charts.map((p, i) => renderPanel(p, data, gauges.length + i))}
      </div>
    </div>
  );
};
