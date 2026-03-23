/**
 * AgentBook Core Backend
 * Double-entry ledger, chart of accounts, journal entries, constraint engine.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

const { app, start } = createPluginServer(pluginConfig);

// === Health Check ===
app.get('/healthz', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', plugin: 'agentbook-core', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: String(err) });
  }
});

// === Journal Entries ===
app.post('/api/v1/agentbook-core/journal-entries', async (req, res) => {
  // TODO: Implement create_journal_entry with constraint engine
  res.status(501).json({ error: 'Not yet implemented' });
});

app.get('/api/v1/agentbook-core/journal-entries', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// === Chart of Accounts ===
app.get('/api/v1/agentbook-core/accounts', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

app.post('/api/v1/agentbook-core/accounts', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// === Trial Balance ===
app.get('/api/v1/agentbook-core/trial-balance', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// === Fiscal Periods ===
app.get('/api/v1/agentbook-core/fiscal-periods', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

app.post('/api/v1/agentbook-core/fiscal-periods/:id/close', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

// === Tenant Config ===
app.get('/api/v1/agentbook-core/tenant-config', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

app.put('/api/v1/agentbook-core/tenant-config', async (req, res) => {
  res.status(501).json({ error: 'Not yet implemented' });
});

start();
