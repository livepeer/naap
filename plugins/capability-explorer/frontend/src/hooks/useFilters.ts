import { useState, useCallback } from 'react';
import type { CapabilityCategory, SortField, SortOrder, ViewMode } from '../lib/types';

export interface FilterState {
  category: CapabilityCategory | undefined;
  search: string;
  sortBy: SortField;
  sortOrder: SortOrder;
  viewMode: ViewMode;
}

export function useFilters() {
  const [filters, setFilters] = useState<FilterState>({
    category: undefined,
    search: '',
    sortBy: 'name',
    sortOrder: 'asc',
    viewMode: 'grid',
  });

  const setCategory = useCallback((category: CapabilityCategory | undefined) => {
    setFilters((f) => ({ ...f, category }));
  }, []);

  const setSearch = useCallback((search: string) => {
    setFilters((f) => ({ ...f, search }));
  }, []);

  const setSortBy = useCallback((sortBy: SortField) => {
    setFilters((f) => ({ ...f, sortBy }));
  }, []);

  const setSortOrder = useCallback((sortOrder: SortOrder) => {
    setFilters((f) => ({ ...f, sortOrder }));
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setFilters((f) => ({ ...f, viewMode }));
  }, []);

  const toggleSortOrder = useCallback(() => {
    setFilters((f) => ({ ...f, sortOrder: f.sortOrder === 'asc' ? 'desc' : 'asc' }));
  }, []);

  return {
    filters,
    setCategory,
    setSearch,
    setSortBy,
    setSortOrder,
    setViewMode,
    toggleSortOrder,
  };
}
