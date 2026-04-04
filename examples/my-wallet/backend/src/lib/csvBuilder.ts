/**
 * Generic CSV builder utility
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
}

/**
 * Build a CSV string from data rows and column definitions
 */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => escapeCsvField(c.header)).join(',');
  const body = rows.map(row =>
    columns.map(col => {
      const val = col.accessor(row);
      return escapeCsvField(val == null ? '' : String(val));
    }).join(',')
  ).join('\n');

  return `${header}\n${body}`;
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
