/**
 * useExport - Hook for CSV/JSON data export
 */

import { useState, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

type ExportType = 'leaderboard' | 'positions';
type ExportFormat = 'csv' | 'json';

export function useExport() {
  const shell = useShell();
  const { address } = useWallet();
  const [isExporting, setIsExporting] = useState(false);

  const doExport = useCallback(async (type: ExportType, format: ExportFormat) => {
    setIsExporting(true);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const userId = address || '';
      const res = await fetch(`${apiUrl}/export/${type}?format=${format}&userId=${userId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const contentDisposition = res.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1]
        || `${type}-export.${format}`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [shell]);

  const exportCSV = useCallback((type: ExportType) => doExport(type, 'csv'), [doExport]);
  const exportJSON = useCallback((type: ExportType) => doExport(type, 'json'), [doExport]);

  return { exportCSV, exportJSON, isExporting };
}
