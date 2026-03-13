/**
 * Lightning Client Backend — WebSocket Proxy
 *
 * Proxies WebSocket connections between the browser and the Livepeer
 * lightweight gateway. The browser sends/receives JPEG frames over WS;
 * this server relays them to the upstream gateway's /ws/stream endpoint.
 *
 * HTTP calls (start-job, stop-job) go through the Service Gateway
 * connector directly from the frontend, so the backend only handles
 * WebSocket proxying and a simple health check.
 */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 4112);
const UPSTREAM_WS_ORIGIN = process.env.UPSTREAM_WS_ORIGIN
  || 'wss://livepeer-gateway-90265565772.us-central1.run.app';

const app = express();
const httpServer = createServer(app);

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', upstream: UPSTREAM_WS_ORIGIN });
});

app.get('/api/v1/lightning/healthz', (_req, res) => {
  res.json({ status: 'ok', upstream: UPSTREAM_WS_ORIGIN });
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const match = url.pathname.match(/\/api\/v1\/lightning\/ws\/(.+)/);

  if (!match) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (clientWs) => {
    const jobId = match[1];
    handleConnection(clientWs, jobId);
  });
});

function handleConnection(clientWs: WebSocket, jobId: string) {
  console.log(`[ws-proxy] Client connected for job ${jobId}`);

  const upstreamUrl = `${UPSTREAM_WS_ORIGIN}/ws/stream?job_id=${jobId}`;
  console.log(`[ws-proxy] Connecting to upstream: ${upstreamUrl}`);

  const upstreamWs = new WebSocket(upstreamUrl);
  upstreamWs.binaryType = 'arraybuffer';

  let clientClosed = false;
  let upstreamClosed = false;
  let framesRelayed = 0;

  upstreamWs.on('open', () => {
    console.log(`[ws-proxy] Upstream connected for job ${jobId}`);
  });

  clientWs.on('message', (data: Buffer | ArrayBuffer) => {
    if (upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(data);
    }
  });

  upstreamWs.on('message', (data: Buffer | ArrayBuffer) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
      framesRelayed++;
      if (framesRelayed % 100 === 0) {
        console.log(`[ws-proxy] Job ${jobId}: ${framesRelayed} frames relayed`);
      }
    }
  });

  clientWs.on('close', () => {
    clientClosed = true;
    console.log(`[ws-proxy] Client disconnected for job ${jobId} (${framesRelayed} frames relayed)`);
    if (!upstreamClosed) upstreamWs.close();
  });

  upstreamWs.on('close', () => {
    upstreamClosed = true;
    console.log(`[ws-proxy] Upstream disconnected for job ${jobId}`);
    if (!clientClosed) clientWs.close();
  });

  clientWs.on('error', (err) => {
    console.error(`[ws-proxy] Client error for job ${jobId}:`, err.message);
    if (!upstreamClosed) upstreamWs.close();
  });

  upstreamWs.on('error', (err) => {
    console.error(`[ws-proxy] Upstream error for job ${jobId}:`, err.message);
    if (!clientClosed) {
      clientWs.close(1011, 'Upstream connection failed');
    }
  });
}

httpServer.listen(PORT, () => {
  console.log(`⚡ Lightning Client backend running on port ${PORT}`);
  console.log(`   Upstream WS: ${UPSTREAM_WS_ORIGIN}`);
});
