import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';

// Latest version constant - should be fetched from API in production
export const LATEST_LIVEPEER_VERSION = "v0.8.12";

export interface VersionBadgeProps {
  current: string;
  className?: string;
  onClick?: () => void;
}

export const VersionBadge: React.FC<VersionBadgeProps> = ({ current, className = "", onClick }) => {
  const isLatest = current === LATEST_LIVEPEER_VERSION;
  
  // Simple version comparison logic for mock (v0.8.x)
  const getDiff = (v1: string, v2: string) => {
    const n1 = parseInt(v1.split('.').pop() || '0');
    const n2 = parseInt(v2.split('.').pop() || '0');
    return n2 - n1;
  };
  const diff = getDiff(current, LATEST_LIVEPEER_VERSION);

  return (
    <button 
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-bold transition-all cursor-pointer ${
        isLatest 
        ? 'bg-accent-emerald/10 text-accent-emerald border-accent-emerald/20 hover:bg-accent-emerald/20' 
        : 'bg-accent-amber/10 text-accent-amber border-accent-amber/20 hover:bg-accent-amber/20'
      } ${className}`}
    >
      {current}
      {!isLatest && <span className="opacity-70">({diff} releases behind)</span>}
      {isLatest ? <Check size={10} /> : <AlertTriangle size={10} />}
    </button>
  );
};
