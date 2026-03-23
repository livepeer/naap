/**
 * AgentBook Invoicing Backend - v1.0
 *
 * Stub implementation with all route scaffolding:
 * - Invoices CRUD, send, void
 * - Clients CRUD
 * - Aging report
 * - Payments
 * - Estimates CRUD + convert
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
  res.json({ status: 'ok', plugin: 'agentbook-invoice', timestamp: new Date().toISOString() });
});

// ============================================
// INVOICE ROUTES
// ============================================

app.post('/invoices', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.get('/invoices', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.get('/invoices/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.post('/invoices/:id/send', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.post('/invoices/:id/void', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// CLIENT ROUTES
// ============================================

app.get('/clients', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.post('/clients', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.get('/clients/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.put('/clients/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// AGING REPORT
// ============================================

app.get('/aging-report', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// PAYMENT ROUTES
// ============================================

app.post('/payments', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// ESTIMATE ROUTES
// ============================================

app.get('/estimates', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.post('/estimates', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

app.post('/estimates/:id/convert', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// ============================================
// START
// ============================================

start();
