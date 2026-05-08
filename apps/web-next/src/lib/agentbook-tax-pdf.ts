/**
 * PDF renderer for the year-end tax package (PR 5).
 *
 * Uses `@react-pdf/renderer` (Node-side) to produce a no-frills PDF the
 * accountant can open and transcribe directly to Schedule C / T2125.
 * Sections, in order:
 *
 *   1. Header — tenant year, jurisdiction, form name
 *   2. Period — start/end dates
 *   3. P&L by tax-line — table of line keys + amounts
 *   4. Mileage summary — total quantity + deductible
 *   5. Deductions roll-up — by category + grand total
 *   6. AR snapshot — outstanding balance + aging buckets
 *   7. Signature line — preparer + date
 *
 * Privacy: only the fields explicitly rendered below leave the process.
 * `passwordHash`, `accessTokenEnc`, etc. don't exist on `PackageData`.
 */

import 'server-only';
import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { PackageData } from './agentbook-tax-package';

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  header: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  subheader: {
    fontSize: 11,
    color: '#444',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#888',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  rowAlt: {
    flexDirection: 'row',
    paddingVertical: 2,
    backgroundColor: '#f5f5f5',
  },
  cellLabel: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 8,
  },
  cellAmount: {
    width: 90,
    minWidth: 90,
    flexShrink: 0,
    textAlign: 'right',
  },
  cellSmall: {
    width: 70,
    minWidth: 70,
    flexShrink: 0,
    textAlign: 'right',
  },
  total: {
    flexDirection: 'row',
    paddingTop: 4,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#222',
    fontWeight: 700,
  },
  small: { fontSize: 9, color: '#555' },
  signatureBox: {
    marginTop: 24,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#aaa',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sigLine: {
    width: 220,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingTop: 18,
  },
});

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface PdfDocProps { data: PackageData; }

const PackageDoc: React.FC<PdfDocProps> = ({ data }) => {
  const formName = data.jurisdiction === 'ca' ? 'CRA T2125' : 'IRS Schedule C';
  const year = data.period.start.getUTCFullYear();
  const totalPnl = Object.values(data.pnlByLine).reduce((s, v) => s + v, 0);
  const sortedPnl = Object.entries(data.pnlByLine).sort(([a], [b]) => a.localeCompare(b));
  const sortedDed = Object.entries(data.deductions.byCategory).sort(([, a], [, b]) => b - a);
  const buckets = data.ar.agingBuckets;

  return React.createElement(
    Document,
    { title: `Tax package ${year}`, author: 'AgentBook' },
    React.createElement(
      Page,
      { size: 'LETTER', style: styles.page },

      // Header
      React.createElement(Text, { style: styles.header }, `Year-end Tax Package — ${year}`),
      React.createElement(
        Text,
        { style: styles.subheader },
        `${formName} • Period ${fmtDate(data.period.start)} to ${fmtDate(data.period.end)}`,
      ),

      // P&L by tax line
      React.createElement(Text, { style: styles.sectionTitle }, `P&L by tax line (${formName})`),
      ...sortedPnl.map(([line, cents], i) =>
        React.createElement(
          View,
          { key: `pnl-${i}`, style: i % 2 ? styles.rowAlt : styles.row },
          React.createElement(Text, { style: styles.cellLabel }, line),
          React.createElement(Text, { style: styles.cellAmount }, dollars(cents)),
        ),
      ),
      React.createElement(
        View,
        { style: styles.total },
        React.createElement(Text, { style: styles.cellLabel }, 'Total expenses'),
        React.createElement(Text, { style: styles.cellAmount }, dollars(totalPnl)),
      ),

      // Mileage summary
      React.createElement(Text, { style: styles.sectionTitle }, 'Mileage summary'),
      React.createElement(
        View,
        { style: styles.row },
        React.createElement(Text, { style: styles.cellLabel }, 'Total quantity'),
        React.createElement(
          Text,
          { style: styles.cellAmount },
          `${data.mileage.totalUnit.toFixed(2)} ${data.mileage.entries[0]?.unit ?? (data.jurisdiction === 'ca' ? 'km' : 'mi')}`,
        ),
      ),
      React.createElement(
        View,
        { style: styles.row },
        React.createElement(Text, { style: styles.cellLabel }, 'Deductible amount'),
        React.createElement(Text, { style: styles.cellAmount }, dollars(data.mileage.totalDeductibleCents)),
      ),
      React.createElement(
        View,
        { style: styles.row },
        React.createElement(Text, { style: styles.cellLabel }, 'Trip count'),
        React.createElement(Text, { style: styles.cellAmount }, String(data.mileage.entries.length)),
      ),

      // Deductions
      React.createElement(Text, { style: styles.sectionTitle }, 'Deductions by category'),
      ...sortedDed.map(([cat, cents], i) =>
        React.createElement(
          View,
          { key: `ded-${i}`, style: i % 2 ? styles.rowAlt : styles.row },
          React.createElement(Text, { style: styles.cellLabel }, cat),
          React.createElement(Text, { style: styles.cellAmount }, dollars(cents)),
        ),
      ),
      React.createElement(
        View,
        { style: styles.total },
        React.createElement(Text, { style: styles.cellLabel }, 'Grand total deductions'),
        React.createElement(Text, { style: styles.cellAmount }, dollars(data.deductions.totalCents)),
      ),

      // AR snapshot
      React.createElement(Text, { style: styles.sectionTitle }, 'AR snapshot (as of period end)'),
      React.createElement(
        View,
        { style: styles.row },
        React.createElement(Text, { style: styles.cellLabel }, 'Outstanding balance'),
        React.createElement(Text, { style: styles.cellAmount }, dollars(data.ar.totalCents)),
      ),
      React.createElement(
        View,
        { style: styles.row },
        React.createElement(Text, { style: styles.cellLabel }, 'Oldest invoice (days past due)'),
        React.createElement(Text, { style: styles.cellAmount }, String(data.ar.oldestDays)),
      ),
      ...(['current', '1-30', '31-60', '61-90', '90+'] as const).map((b, i) =>
        React.createElement(
          View,
          { key: `ar-${i}`, style: i % 2 ? styles.rowAlt : styles.row },
          React.createElement(Text, { style: styles.cellLabel }, `Aging — ${b}`),
          React.createElement(Text, { style: styles.cellAmount }, dollars(buckets[b] || 0)),
        ),
      ),

      // Footnote
      React.createElement(
        Text,
        { style: { ...styles.small, marginTop: 14 } },
        `Generated by AgentBook. Confirmed expenses only (${data.expenseCount}); personal spending excluded.`,
      ),

      // Signature line
      React.createElement(
        View,
        { style: styles.signatureBox },
        React.createElement(
          View,
          {},
          React.createElement(Text, { style: styles.small }, 'Prepared by'),
          React.createElement(Text, { style: styles.sigLine }, ' '),
        ),
        React.createElement(
          View,
          {},
          React.createElement(Text, { style: styles.small }, 'Date'),
          React.createElement(Text, { style: styles.sigLine }, ' '),
        ),
      ),
    ),
  );
};

/**
 * Render the package PDF and return its bytes. Caller uploads the
 * buffer to Vercel Blob.
 */
export async function renderPackagePdf(data: PackageData): Promise<Buffer> {
  // The cast is necessary because the React-PDF type definitions assert
  // that `renderToBuffer` accepts a `ReactElement<DocumentProps>` — a
  // wrapper component that *returns* a `<Document>` is structurally
  // identical at runtime but the type system can't infer that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(PackageDoc, { data }) as any;
  const buf = await renderToBuffer(element);
  return buf as Buffer;
}
