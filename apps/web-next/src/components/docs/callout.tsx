'use client';

import { Info, AlertTriangle, Lightbulb, AlertCircle } from 'lucide-react';

const calloutStyles = {
  info: {
    icon: Info,
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/5',
    iconColor: 'text-blue-500',
    title: 'Info',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    iconColor: 'text-amber-500',
    title: 'Warning',
  },
  tip: {
    icon: Lightbulb,
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    iconColor: 'text-emerald-500',
    title: 'Tip',
  },
  danger: {
    icon: AlertCircle,
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    iconColor: 'text-red-500',
    title: 'Danger',
  },
};

export function CalloutBlock({
  type = 'info',
  title,
  children,
}: {
  type?: 'info' | 'warning' | 'tip' | 'danger';
  title?: string;
  children: React.ReactNode;
}) {
  const style = calloutStyles[type];
  const Icon = style.icon;

  return (
    <div className={`my-6 rounded-xl border ${style.border} ${style.bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${style.iconColor} mt-0.5 shrink-0`} />
        <div className="min-w-0">
          {(title || style.title) && (
            <p className={`font-semibold text-sm ${style.iconColor} mb-1`}>
              {title || style.title}
            </p>
          )}
          <div className="text-sm text-muted-foreground [&>p]:m-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
