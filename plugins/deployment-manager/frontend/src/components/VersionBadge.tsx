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
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
        {currentVersion}
      </span>
      {hasUpdate && latestVersion && (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <AlertCircle size={11} />
          {latestVersion}
        </span>
      )}
    </span>
  );
};
