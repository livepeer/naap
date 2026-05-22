import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Trophy, Map } from 'lucide-react';

const TABS = [
  { path: '/', label: 'Leaderboard', icon: Trophy },
  { path: '/plans', label: 'Discovery Plans', icon: Map },
] as const;

export const TabNav: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const activeTab = pathname.startsWith('/plans') ? '/plans' : '/';

  return (
    <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-6 pt-3">
      {TABS.map(({ path, label, icon: Icon }) => {
        const active = path === activeTab;
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all -mb-px border-b-2 ${
              active
                ? 'text-accent-blue border-accent-blue bg-accent-blue/5'
                : 'text-text-muted border-transparent hover:text-text-primary hover:bg-bg-secondary'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        );
      })}
    </div>
  );
};
