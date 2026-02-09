/**
 * Infrastructure Service
 * 
 * Handles plugin infrastructure provisioning:
 * - Container orchestration (Docker)
 * - Database provisioning (PostgreSQL)
 * - Port allocation
 * - Health monitoring
 */

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { infrastructureRouter } from './api/infrastructure.js';
import { ContainerOrchestrator } from './services/containerOrchestrator.js';
import { DatabaseManager } from './services/databaseManager.js';
import { PortAllocator } from './services/portAllocator.js';
import { HealthMonitor } from './services/healthMonitor.js';

config();

const app = express();
const PORT = process.env.PORT || 4099;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
export const containerOrchestrator = new ContainerOrchestrator();
export const databaseManager = new DatabaseManager();
export const portAllocator = new PortAllocator();
export const healthMonitor = new HealthMonitor();

// Health check
app.get('/healthz', async (_req, res) => {
  const dockerConnected = await containerOrchestrator.isConnected();
  const dbConnected = await databaseManager.isConnected();
  
  res.json({ 
    status: dockerConnected && dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      docker: dockerConnected ? 'connected' : 'disconnected',
      database: dbConnected ? 'connected' : 'disconnected',
    },
  });
});

// API routes
app.use('/api/v1/infrastructure', infrastructureRouter);

// Create HTTP server
const server = createServer(app);

// WebSocket for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Broadcast function for real-time updates
export function broadcast(event: string, data: unknown) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// Start server
server.listen(PORT, async () => {
  console.log(`🚀 Infrastructure service running on port ${PORT}`);
  
  // Initialize connections
  try {
    await containerOrchestrator.connect();
    console.log('✅ Docker connected');
  } catch (error) {
    console.warn('⚠️ Docker not available:', error instanceof Error ? error.message : error);
  }
  
  try {
    await databaseManager.connect();
    console.log('✅ Database manager initialized');
  } catch (error) {
    console.warn('⚠️ Database manager not available:', error instanceof Error ? error.message : error);
  }
  
  // Start health monitoring
  healthMonitor.start();
  console.log('✅ Health monitor started');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  healthMonitor.stop();
  await containerOrchestrator.disconnect();
  await databaseManager.disconnect();
  server.close();
  process.exit(0);
});
