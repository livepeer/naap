import React from 'react';
import { AlertCircle } from 'lucide-react';

interface VersionBadgeProps {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
}

export const VersionBadge: React.FC<VersionBadgeProps> = ({
  currentVersion,
  latestVersion,
  hasUpdate,
}) => {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        padding: '0.15rem 0.5rem',
        borderRadius: '0.25rem',
        background: '#f3f4f6',
      }}>
        {currentVersion}
      </span>
      {hasUpdate && latestVersion && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          fontSize: '0.7rem',
          padding: '0.15rem 0.5rem',
          borderRadius: '0.25rem',
          background: '#fef3c7',
          color: '#92400e',
        }}>
          <AlertCircle size={12} />
          {latestVersion} available
        </span>
      )}
    </span>
  );
};
