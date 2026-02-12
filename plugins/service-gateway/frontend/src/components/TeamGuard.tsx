/**
 * TeamGuard — Wraps pages that require team context.
 * If no team is selected, shows a prompt to select one.
 */

import React from 'react';
import { useTeam } from '@naap/plugin-sdk';

interface TeamGuardProps {
  children: React.ReactNode;
}

export const TeamGuard: React.FC<TeamGuardProps> = ({ children }) => {
  const teamContext = useTeam();

  if (!teamContext?.currentTeam) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-500/10 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-200 mb-2">Select a Team</h2>
          <p className="text-gray-400 text-sm">
            Service Gateway connectors are team-scoped. Please select a team from the sidebar to manage your API connectors.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
