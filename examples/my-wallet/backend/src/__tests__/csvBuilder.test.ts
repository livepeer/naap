import { describe, it, expect } from 'vitest';
import { buildCsv, type CsvColumn } from '../lib/csvBuilder.js';

interface TestRow {
  name: string;
  value: number;
  active: boolean;
}

const columns: CsvColumn<TestRow>[] = [
  { header: 'Name', accessor: (r) => r.name },
  { header: 'Value', accessor: (r) => r.value },
  { header: 'Active', accessor: (r) => r.active },
];

describe('buildCsv', () => {
  it('generates header row', () => {
    const csv = buildCsv([], columns);
    expect(csv).toBe('Name,Value,Active\n');
  });

  it('generates rows with correct values', () => {
    const rows: TestRow[] = [
      { name: 'Alice', value: 100, active: true },
      { name: 'Bob', value: 200, active: false },
    ];
    const csv = buildCsv(rows, columns);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Name,Value,Active');
    expect(lines[1]).toBe('Alice,100,true');
    expect(lines[2]).toBe('Bob,200,false');
  });

  it('escapes fields containing commas', () => {
    const rows = [{ name: 'Last, First', value: 1, active: true }];
    const csv = buildCsv(rows, columns);
    expect(csv).toContain('"Last, First"');
  });

  it('escapes fields containing double quotes', () => {
    const rows = [{ name: 'He said "hello"', value: 1, active: true }];
    const csv = buildCsv(rows, columns);
    expect(csv).toContain('"He said ""hello"""');
  });

  it('escapes fields containing newlines', () => {
    const rows = [{ name: 'Line1\nLine2', value: 1, active: true }];
    const csv = buildCsv(rows, columns);
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('handles null/undefined accessor values', () => {
    const cols: CsvColumn<{ x: string | null }>[] = [
      { header: 'X', accessor: (r) => r.x },
    ];
    const csv = buildCsv([{ x: null }], cols);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('');
  });
});
