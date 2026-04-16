import React, { useState, useEffect } from 'react';
import type { CapabilityCategory, SortField, ViewMode } from '../lib/types';
import { ALL_CATEGORIES, CATEGORY_SHORT_LABELS, SORT_OPTIONS } from '../lib/constants';
import { Search, LayoutGrid, List, ArrowUpDown } from 'lucide-react';

interface CapabilityFiltersProps {
  category: CapabilityCategory | undefined;
  search: string;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  viewMode: ViewMode;
  onCategoryChange: (cat: CapabilityCategory | undefined) => void;
  onSearchChange: (search: string) => void;
  onSortByChange: (sortBy: SortField) => void;
  onSortOrderToggle: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  total: number;
}

export const CapabilityFilters: React.FC<CapabilityFiltersProps> = ({
  category,
  search,
  sortBy,
  sortOrder,
  viewMode,
  onCategoryChange,
  onSearchChange,
  onSortByChange,
  onSortOrderToggle,
  onViewModeChange,
  total,
}) => {
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, onSearchChange]);

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
          <input
            type="text"
            placeholder="Search capabilities..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-secondary border border-[var(--border-color)] text-text-primary text-sm focus:outline-none focus:border-accent-emerald/50 transition-colors"
            data-testid="search-input"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as SortField)}
            className="px-3 py-2 rounded-lg bg-bg-secondary border border-[var(--border-color)] text-text-primary text-sm focus:outline-none"
            data-testid="sort-select"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <button
            onClick={onSortOrderToggle}
            className="p-2 rounded-lg bg-bg-secondary border border-[var(--border-color)] text-text-secondary hover:text-text-primary transition-colors"
            title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            data-testid="sort-order-btn"
          >
            <ArrowUpDown size={16} className={sortOrder === 'desc' ? 'rotate-180' : ''} />
          </button>

          <div className="flex items-center border border-[var(--border-color)] rounded-lg overflow-hidden">
            <button
              onClick={() => onViewModeChange('grid')}
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-accent-emerald/15 text-accent-emerald' : 'bg-bg-secondary text-text-secondary hover:text-text-primary'}`}
              title="Grid view"
              data-testid="view-grid-btn"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-accent-emerald/15 text-accent-emerald' : 'bg-bg-secondary text-text-secondary hover:text-text-primary'}`}
              title="List view"
              data-testid="view-list-btn"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`pill-btn ${!category ? 'pill-btn-active' : 'pill-btn-inactive'}`}
          onClick={() => onCategoryChange(undefined)}
          data-testid="filter-all"
        >
          All ({total})
        </button>
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`pill-btn ${category === cat ? 'pill-btn-active' : 'pill-btn-inactive'}`}
            onClick={() => onCategoryChange(category === cat ? undefined : cat)}
            data-testid={`filter-${cat}`}
          >
            {CATEGORY_SHORT_LABELS[cat]}
          </button>
        ))}
      </div>
    </div>
  );
};
