/**
 * TeamGuard — Context-aware wrapper for team/personal scope.
 *
 * In team scope:  renders children normally (connectors scoped to team).
 * In personal scope (no team): renders children with a subtle info banner
 *   explaining the personal context. Does NOT block the user.
 */

import React from 'react';
import { useTeam } from '@naap/plugin-sdk';

interface TeamGuardProps {
  children: React.ReactNode;
}

export const TeamGuard: React.FC<TeamGuardProps> = ({ children }) => {
  const teamContext = useTeam();
  const hasTeam = !!teamContext?.currentTeam;

  return (
    <>
      {!hasTeam && (
        <div className="mx-6 mt-4 mb-0 px-4 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3">
          <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-blue-300">
            <span className="font-medium">Personal scope</span> — connectors you create here are private to you.
            Select a team from the sidebar to manage shared team connectors.
          </p>
        </div>
      )}
      {children}
    </>
  );
};
