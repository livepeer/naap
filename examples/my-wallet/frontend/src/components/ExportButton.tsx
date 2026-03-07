/**
 * ExportButton - Reusable CSV/JSON export button pair
 */

import React from 'react';

interface ExportButtonProps {
  onExportCSV: () => void;
  onExportJSON: () => void;
  isExporting: boolean;
  label?: string;
}

export const ExportButton: React.FC<ExportButtonProps> = ({
  onExportCSV,
  onExportJSON,
  isExporting,
  label = 'Export',
}) => {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button
        onClick={onExportCSV}
        disabled={isExporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white/5 text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-50"
        aria-label={`${label} CSV`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        CSV
      </button>
      <button
        onClick={onExportJSON}
        disabled={isExporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white/5 text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-50"
        aria-label={`${label} JSON`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        JSON
      </button>
    </div>
  );
};
