/**
 * GatewayNav — Compact left sidebar for the Service Gateway plugin.
 * Renders inside MemoryRouter so it has access to useLocation/useNavigate.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  {
    label: 'Connectors',
    path: '/',
    match: (p: string) => p === '/' || p.startsWith('/new') || p.startsWith('/connectors'),
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
      </svg>
    ),
  },
  {
    label: 'Dashboard',
    path: '/dashboard',
    match: (p: string) => p === '/dashboard',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm8-6a6 6 0 100 12 6 6 0 000-12zm0 2a1 1 0 011 1v2.586l1.707 1.707a1 1 0 01-1.414 1.414l-2-2A1 1 0 019 10V7a1 1 0 011-1z" />
      </svg>
    ),
  },
  {
    label: 'Master Keys',
    path: '/master-keys',
    match: (p: string) => p === '/master-keys',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: 'Plans',
    path: '/plans',
    match: (p: string) => p === '/plans',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v3H5V5zm0 5h4v5H5v-5zm6 0h4v5h-4v-5z" />
      </svg>
    ),
  },
] as const;

export const GatewayNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="w-52 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950/40">
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-lg font-semibold text-gray-100 tracking-tight">Service Gateway</h1>
        <p className="text-xs text-gray-500 mt-0.5">API Management</p>
      </div>
      <nav aria-label="Service Gateway" className="flex-1 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = item.match(location.pathname);
          return (
            <button
              key={item.label}
              role="tab"
              aria-selected={active}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? 'bg-blue-600/10 text-blue-400 font-medium'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              <span className={active ? 'text-blue-400' : 'text-gray-500'}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
