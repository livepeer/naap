/**
 * DashboardCard - Card component for dashboard gallery
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Pin, ExternalLink } from 'lucide-react';
import type { Dashboard } from '../types';

interface DashboardCardProps {
  dashboard: Dashboard;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
}

export const DashboardCard: React.FC<DashboardCardProps> = ({
  dashboard,
  isPinned = false,
  onTogglePin,
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/view/${dashboard.id}`);
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin?.(dashboard.id);
  };

  return (
    <div
      onClick={handleClick}
      className="dashboard-card group relative"
    >
      {/* Thumbnail or Placeholder */}
      <div className="aspect-video bg-bg-tertiary rounded-lg mb-3 overflow-hidden flex items-center justify-center">
        {dashboard.thumbnail ? (
          <img
            src={dashboard.thumbnail}
            alt={dashboard.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="dashboard-gradient w-full h-full flex items-center justify-center">
            <LayoutDashboard className="w-12 h-12 text-white/50" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="space-y-1">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-text-primary group-hover:text-accent-purple transition-colors line-clamp-1">
            {dashboard.name}
          </h3>
          <button
            onClick={handlePinClick}
            className={`pin-button ${isPinned ? 'pinned' : 'text-text-secondary'}`}
            aria-label={isPinned ? 'Unpin dashboard' : 'Pin dashboard'}
          >
            <Pin className="w-4 h-4" />
          </button>
        </div>
        
        {dashboard.description && (
          <p className="text-sm text-text-secondary line-clamp-2">
            {dashboard.description}
          </p>
        )}
      </div>

      {/* Hover Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
        <div className="flex items-center gap-2 text-white font-medium">
          <ExternalLink className="w-5 h-5" />
          Open Dashboard
        </div>
      </div>
    </div>
  );
};

export default DashboardCard;
