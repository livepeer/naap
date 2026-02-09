/**
 * DataTable Component
 * 
 * A sortable, paginated table component.
 */

import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export interface Column<T> {
  /** Unique column key */
  key: string;
  /** Column header */
  header: string;
  /** Cell renderer */
  render?: (item: T, index: number) => React.ReactNode;
  /** Accessor function for sorting */
  accessor?: (item: T) => string | number | Date;
  /** Whether column is sortable */
  sortable?: boolean;
  /** Column width (CSS value) */
  width?: string;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  /** Table data */
  data: T[];
  /** Column definitions */
  columns: Column<T>[];
  /** Unique key accessor */
  keyAccessor: (item: T) => string | number;
  /** Whether to show pagination */
  pagination?: boolean;
  /** Items per page */
  pageSize?: number;
  /** Loading state */
  loading?: boolean;
  /** Called when row is clicked */
  onRowClick?: (item: T) => void;
  /** Additional className */
  className?: string;
  /** Empty state message */
  emptyMessage?: string;
}

type SortDirection = 'asc' | 'desc' | null;

export function DataTable<T>({
  data,
  columns,
  keyAccessor,
  pagination = true,
  pageSize = 10,
  loading = false,
  onRowClick,
  className = '',
  emptyMessage = 'No data available',
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Handle sort
  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return data;

    const column = columns.find(c => c.key === sortColumn);
    if (!column?.accessor) return data;

    return [...data].sort((a, b) => {
      const aVal = column.accessor!(a);
      const bVal = column.accessor!(b);

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortColumn, sortDirection, columns]);

  // Paginate data
  const paginatedData = useMemo(() => {
    if (!pagination) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, pagination, currentPage, pageSize]);

  const totalPages = Math.ceil(data.length / pageSize);

  return (
    <div className={`overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`
                    px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wider
                    ${column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left'}
                    ${column.sortable ? 'cursor-pointer hover:text-text-primary transition-colors' : ''}
                  `}
                  style={{ width: column.width }}
                  onClick={() => column.sortable && handleSort(column.key)}
                >
                  <span className="flex items-center gap-1">
                    {column.header}
                    {column.sortable && (
                      <span className="flex flex-col">
                        <ChevronUp
                          size={12}
                          className={sortColumn === column.key && sortDirection === 'asc' ? 'text-accent-blue' : 'opacity-30'}
                        />
                        <ChevronDown
                          size={12}
                          className={`-mt-1 ${sortColumn === column.key && sortDirection === 'desc' ? 'text-accent-blue' : 'opacity-30'}`}
                        />
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center">
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-5 h-5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
                    <span className="text-text-secondary">Loading...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-text-secondary">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((item, index) => (
                <tr
                  key={keyAccessor(item)}
                  onClick={() => onRowClick?.(item)}
                  className={`
                    border-b border-white/5 
                    ${onRowClick ? 'cursor-pointer hover:bg-white/5' : ''}
                    transition-colors
                  `}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`
                        px-4 py-4 text-sm text-text-primary
                        ${column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left'}
                      `}
                    >
                      {column.render
                        ? column.render(item, index)
                        : column.accessor
                        ? String(column.accessor(item))
                        : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
          <p className="text-sm text-text-secondary">
            Showing {(currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, data.length)} of {data.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let page: number;
              if (totalPages <= 5) {
                page = i + 1;
              } else if (currentPage <= 3) {
                page = i + 1;
              } else if (currentPage >= totalPages - 2) {
                page = totalPages - 4 + i;
              } else {
                page = currentPage - 2 + i;
              }
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`
                    w-8 h-8 rounded-lg text-sm font-medium transition-colors
                    ${currentPage === page
                      ? 'bg-accent-blue text-white'
                      : 'hover:bg-white/5 text-text-secondary'
                    }
                  `}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
