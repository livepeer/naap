/**
 * AgentBook Tax & Reports Backend - v1.0
 *
 * Stub routes for:
 * - Tax estimation & quarterly installments
 * - Deduction optimization
 * - Financial reports (P&L, Balance Sheet, Cash Flow, Trial Balance)
 * - Cash flow projection & scenarios
 * - Tax form generation (Schedule C / T2125)
 * - Sales tax summary
 *
 * Migrated to @naap/plugin-server-sdk for standardized server setup.
 * Uses unified database schema (packages/database) with plugin_agentbook_tax schema.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

// ============================================
// CREATE SERVER
// ============================================

const server = createPluginServer({
  name: 'agentbook-tax',
  port: parseInt(process.env.PORT || String(pluginConfig.backend?.devPort || 4053), 10),
  prisma: db,
  publicRoutes: ['/healthz'],
});

const { router } = server;

// ============================================
// TAX ESTIMATION
// ============================================

router.get('/agentbook-tax/tax/estimate', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// QUARTERLY INSTALLMENTS
// ============================================

router.get('/agentbook-tax/tax/quarterly', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

router.post('/agentbook-tax/tax/quarterly/:id/record-payment', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// DEDUCTIONS
// ============================================

router.get('/agentbook-tax/tax/deductions', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// FINANCIAL REPORTS
// ============================================

router.get('/agentbook-tax/reports/pnl', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

router.get('/agentbook-tax/reports/balance-sheet', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

router.get('/agentbook-tax/reports/cashflow', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

router.get('/agentbook-tax/reports/trial-balance', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// CASH FLOW PROJECTION & SCENARIOS
// ============================================

router.get('/agentbook-tax/cashflow/projection', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

router.post('/agentbook-tax/cashflow/scenario', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// TAX FORMS (Schedule C / T2125)
// ============================================

router.get('/agentbook-tax/tax/forms', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// SALES TAX SUMMARY
// ============================================

router.get('/agentbook-tax/sales-tax/summary', async (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// START SERVER
// ============================================

server.start().catch((err) => {
  console.error('Failed to start agentbook-tax-svc:', err);
  process.exit(1);
});
