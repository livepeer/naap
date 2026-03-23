/**
 * AgentBook Expense Backend - v1.0
 *
 * Expense tracking, receipt OCR, auto-categorization,
 * vendor patterns, recurring expense detection,
 * and business/personal separation.
 *
 * Uses @naap/plugin-server-sdk for standardized server setup.
 * Uses unified database schema (packages/database).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

// ============================================
// SERVER SETUP
// ============================================

const { app, start } = createPluginServer(pluginConfig);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', plugin: 'agentbook-expense', timestamp: new Date().toISOString() });
});

// ============================================
// EXPENSE ROUTES
// ============================================

/** Record a new expense */
app.post('/expenses', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/** List expenses */
app.get('/expenses', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/** Get expense by ID */
app.get('/expenses/:id', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/** Update expense */
app.put('/expenses/:id', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/** Auto-categorize an expense */
app.post('/expenses/:id/categorize', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// ============================================
// VENDOR ROUTES
// ============================================

/** List vendors */
app.get('/vendors', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

/** Get vendor by ID */
app.get('/vendors/:id', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// ============================================
// PATTERN ROUTES
// ============================================

/** Get vendor patterns */
app.get('/patterns', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// ============================================
// RECEIPT ROUTES
// ============================================

/** Upload a receipt for OCR */
app.post('/receipts/upload', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// ============================================
// RECURRING EXPENSE ROUTES
// ============================================

/** Get recurring expense rules */
app.get('/recurring-rules', (_req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// ============================================
// START SERVER
// ============================================

start();
