/**
 * P&L export hook (S13)
 */

import { useState, useCallback } from 'react';
import { getApiUrl } from '../App';

export function usePnlExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportPnl = useCallback(async (format: 'csv' | 'json', startDate?: string, endDate?: string) => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`${getApiUrl()}/export/pnl?${params}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-pnl.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('P&L export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportPnl, isExporting };
}
