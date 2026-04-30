import React from 'react';
import { AlertTriangle, TrendingUp, Copy, FileX, Tag, Lightbulb, X } from 'lucide-react';

interface Insight {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  data: any;
  action?: { label: string; type: string; payload: any };
}

const SEVERITY_STYLES: Record<string, { border: string; icon: string }> = {
  critical: { border: 'border-l-red-500', icon: 'text-red-500' },
  warning: { border: 'border-l-amber-500', icon: 'text-amber-500' },
  info: { border: 'border-l-emerald-500', icon: 'text-emerald-500' },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  spike: <TrendingUp className="w-4 h-4" />,
  anomaly: <AlertTriangle className="w-4 h-4" />,
  duplicate: <Copy className="w-4 h-4" />,
  missing_receipt: <FileX className="w-4 h-4" />,
  uncategorized: <Tag className="w-4 h-4" />,
  saving: <Lightbulb className="w-4 h-4" />,
};

export const AdvisorInsights: React.FC<{
  insights: Insight[];
  loading: boolean;
  onDismiss: (id: string) => void;
}> = ({ insights, loading, onDismiss }) => {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 mb-4">
        {[1, 2].map(i => (
          <div key={i} className="min-w-[260px] h-[88px] rounded-xl bg-muted/40 animate-pulse shrink-0" />
        ))}
      </div>
    );
  }

  if (insights.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Insights</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{insights.length}</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {insights.map(insight => {
          const style = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info;
          return (
            <div key={insight.id}
              className={`min-w-[260px] sm:min-w-[280px] bg-card border border-border border-l-4 ${style.border} rounded-xl p-3.5 shrink-0 snap-start relative group`}>
              <button onClick={(e) => { e.stopPropagation(); onDismiss(insight.id); }}
                className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all">
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={style.icon}>{TYPE_ICONS[insight.type] || <AlertTriangle className="w-4 h-4" />}</span>
                <span className="text-xs font-semibold text-foreground">{insight.title}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pr-4">{insight.message}</p>
              {insight.action && (
                <button className="mt-2 text-xs font-medium text-primary hover:underline">{insight.action.label} →</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
