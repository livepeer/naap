import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Star, MoreVertical, Eye, EyeOff, Trash2 } from 'lucide-react';
import { LucideIcon } from './LucideIcon';
import type { PluginPackage } from '../lib/api';

interface PluginCardProps {
  plugin: PluginPackage;
  onUnpublish?: (name: string) => void;
}

export const PluginCard: React.FC<PluginCardProps> = ({ plugin, onUnpublish }) => {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = React.useState(false);

  const getStatusBadge = () => {
    switch (plugin.publishStatus) {
      case 'published':
        return <span className="badge badge-success">Published</span>;
      case 'unlisted':
        return <span className="badge badge-warning">Unlisted</span>;
      case 'deprecated':
        return <span className="badge badge-error">Deprecated</span>;
      default:
        return <span className="badge badge-info">Draft</span>;
    }
  };

  return (
    <div className="glass-card p-5 hover:border-accent-emerald/30 transition-all cursor-pointer">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4" onClick={() => navigate(`/plugins/${plugin.name}`)}>
          <div className="p-3 bg-bg-tertiary rounded-xl">
            <LucideIcon name={plugin.icon || 'Package'} className="w-6 h-6 text-accent-emerald" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{plugin.displayName || plugin.name}</h3>
            <p className="text-sm text-text-secondary">{plugin.name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {getStatusBadge()}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-2 rounded-lg hover:bg-bg-tertiary transition-colors"
            >
              <MoreVertical className="w-4 h-4 text-text-secondary" />
            </button>
            
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-white/10 rounded-lg shadow-xl z-10 min-w-[160px]">
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/plugins/${plugin.name}`); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-bg-tertiary flex items-center gap-2"
                >
                  <Eye className="w-4 h-4" /> View Details
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onUnpublish?.(plugin.name); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-bg-tertiary flex items-center gap-2 text-accent-amber"
                >
                  <EyeOff className="w-4 h-4" /> Unlist
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onUnpublish?.(plugin.name); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-bg-tertiary flex items-center gap-2 text-accent-rose"
                >
                  <Trash2 className="w-4 h-4" /> Deprecate
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <p className="mt-3 text-sm text-text-secondary line-clamp-2">
        {plugin.description || 'No description available'}
      </p>
      
      <div className="mt-4 flex items-center gap-6 text-sm text-text-secondary">
        <div className="flex items-center gap-1">
          <Download className="w-4 h-4" />
          <span>{(plugin.downloads ?? 0).toLocaleString()}</span>
        </div>
        {plugin.rating != null && (
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 text-accent-amber" />
            <span>{plugin.rating.toFixed(1)}</span>
          </div>
        )}
        <span className="text-text-secondary/60">{plugin.category || 'other'}</span>
      </div>
    </div>
  );
};
