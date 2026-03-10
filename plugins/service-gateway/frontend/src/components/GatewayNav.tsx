/**
 * GatewayNav — Horizontal sub-navigation for the Service Gateway plugin.
 * Renders inside MemoryRouter so it has access to useLocation/useNavigate.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { label: 'Connectors', path: '/', match: (p: string) => p === '/' || p.startsWith('/new') || p.startsWith('/connectors') },
  { label: 'Dashboard', path: '/dashboard', match: (p: string) => p === '/dashboard' },
  { label: 'Master Keys', path: '/master-keys', match: (p: string) => p === '/master-keys' },
  { label: 'Plans', path: '/plans', match: (p: string) => p === '/plans' },
] as const;

export const GatewayNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav aria-label="Service Gateway" className="flex border-b border-gray-800 px-6 bg-gray-900/50 shrink-0" role="tablist">
      {NAV_ITEMS.map((item) => {
        const active = item.match(location.pathname);
        return (
          <button
            key={item.label}
            role="tab"
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(item.path)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              active
                ? 'text-blue-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {item.label}
            {active && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
};
