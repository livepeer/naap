import dotenv from 'dotenv';
// MUST BE AT THE VERY TOP
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createPluginServer } from '@naap/plugin-server-sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { execSync } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fetch from 'node-fetch';
import https from 'node:https';
import type { Request, Response } from 'express';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginJsonPath = path.resolve(__dirname, '../../plugin.json');
const pluginConfig = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));

const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4112;
const API_PREFIX = '';

const ALLOWED_GATEWAY_HOSTS = [
  'livepeer-gateway-90265565772.us-central1.run.app',
  'hky.eliteencoder.net:8936',
  'localhost:8080',
];

function isUrlAllowed(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return ALLOWED_GATEWAY_HOSTS.includes(url.host);
  } catch {
    return false;
  }
}

// ── Session management ────────────────────────────────────────────────────────
// Two-phase design: /start creates the session entry; ffmpeg is only spawned
// when the first /chunk arrives so the process has data immediately.

interface StreamSession {
  stdin: PassThrough;
  startedAt: number;
  lastChunkAt: number;
  jobId: string;
  publishUrl: string;
  ffmpegStarted: boolean;
  error: string | null;
}

const sessions = new Map<string, StreamSession>();

function startFfmpeg(session: StreamSession): void {
  const { stdin, jobId, publishUrl } = session;
  const outputStream = new PassThrough();

  const command = ffmpeg(stdin)
    .inputFormat('webm')
    .on('start', (cmd) => console.log(`[ffmpeg] Started for ${jobId}: ${cmd}`))
    .on('progress', (p) => console.log(`[ffmpeg] ${jobId}: ${p.frames ?? 0} frames`))
    .on('error', (err) => {
      console.error(`[ffmpeg] Error for ${jobId}: ${err.message}`);
      session.error = err.message;
    })
    .on('end', () => {
      console.log(`[ffmpeg] Finished for ${jobId}`);
      sessions.delete(jobId);
    })
    .videoCodec('libx264')
    .outputFormat('mpegts')
    .outputOptions([
      '-preset ultrafast',
      '-tune zerolatency',
      '-g 30',
      '-an',
    ]);

  command.pipe(outputStream, { end: true });

  // Trickle protocol: send each data chunk as a separate POST rather than
  // one continuous streaming upload. Livepeer closes the connection after
  // each segment so a single streaming body causes "Premature close".
  let segmentQueue = Promise.resolve();
  let segmentIdx = 0;

  // Capture first ~3 seconds of output for diagnostics
  const sampleChunks: Buffer[] = [];
  let sampleBytes = 0;
  const SAMPLE_LIMIT = 200_000;
  let sampleSaved = false;

  outputStream.on('data', (chunk: Buffer) => {
    const idx = segmentIdx++;

    // Save sample of raw ffmpeg output for frame extraction
    if (!sampleSaved && sampleBytes < SAMPLE_LIMIT) {
      sampleChunks.push(Buffer.from(chunk));
      sampleBytes += chunk.length;
      if (sampleBytes >= SAMPLE_LIMIT) {
        sampleSaved = true;
        const sampleDir = path.resolve(__dirname, '../../_debug');
        mkdirSync(sampleDir, { recursive: true });
        const tsFile = path.join(sampleDir, `sample-${jobId.slice(0, 8)}.ts`);
        writeFileSync(tsFile, Buffer.concat(sampleChunks));
        console.log(`[diag] Saved ${sampleBytes} bytes of MPEG-TS to ${tsFile}`);
        try {
          for (let i = 0; i < 3; i++) {
            const jpgFile = path.join(sampleDir, `frame-${jobId.slice(0, 8)}-${i}.jpg`);
            execSync(`ffmpeg -y -i "${tsFile}" -vf "select=eq(pict_type\\,I)" -vsync vfr -frames:v 1 -ss ${i} "${jpgFile}" 2>/dev/null`);
            console.log(`[diag] Extracted frame ${i} → ${jpgFile}`);
          }
        } catch (e: any) {
          console.warn(`[diag] Frame extraction fallback: single frame`);
          try {
            const jpgFile = path.join(sampleDir, `frame-${jobId.slice(0, 8)}-0.jpg`);
            execSync(`ffmpeg -y -i "${tsFile}" -frames:v 1 "${jpgFile}" 2>/dev/null`);
            console.log(`[diag] Extracted single frame → ${jpgFile}`);
          } catch { /* ignore */ }
        }
      }
    }

    segmentQueue = segmentQueue.then(async () => {
      try {
        const res = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'video/mp2t' },
          body: chunk,
          agent: httpsAgent,
        });
        if (idx % 30 === 0) {
          console.log(`[lightning] Trickle segment ${idx} for ${jobId}: ${res.status} (${chunk.length} bytes)`);
        }
      } catch (err: any) {
        console.error(`[lightning] Trickle upload error for ${jobId} seg ${idx}:`, err.message);
      }
    });
  });

  outputStream.on('end', () => {
    console.log(`[lightning] Output stream ended for ${jobId} after ${segmentIdx} segments`);
  });

  session.ffmpegStarted = true;
  console.log(`[lightning] ffmpeg launched for ${jobId}`);
}

// Prune stale sessions (no activity for >10 min)
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.lastChunkAt < cutoff) {
      console.log(`[lightning] Pruning stale session ${id}`);
      try { session.stdin.end(); } catch { /* ignore */ }
      sessions.delete(id);
    }
  }
}, 60_000);

// ── Plugin server ─────────────────────────────────────────────────────────────

const { router, start } = createPluginServer({
  name: 'lightning-client',
  port: Number(PORT),
  requireAuth: false,
  publicRoutes: ['/healthz', '/api/v1/publish', '/api/v1/subscribe', '/publish', '/subscribe'],
  rateLimit: false,
});

// ── Helper ────────────────────────────────────────────────────────────────────

function getUserId(req: Request): string {
  return (req as any).user?.id || 'anonymous';
}

// ── Test endpoint ─────────────────────────────────────────────────────────────

router.post(`${API_PREFIX}/publish/:jobId/test`, async (req: Request, res: Response) => {
  console.log(`[lightning] TEST POST reached backend for job ${req.params.jobId}`);
  res.json({ success: true });
});

// ── PUBLISH: START SESSION ────────────────────────────────────────────────────
// Creates a session entry. ffmpeg is NOT spawned here — it starts lazily on the
// first /chunk so the process always has data available immediately.

router.post(`${API_PREFIX}/publish/:jobId/start`, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const publishUrl = req.query.url as string;

  if (!publishUrl || !isUrlAllowed(publishUrl)) {
    console.error(`[lightning] Invalid publish URL: ${publishUrl}`);
    return res.status(400).json({ error: 'Invalid or missing publish_url' });
  }

  if (sessions.has(jobId)) {
    const old = sessions.get(jobId)!;
    try { old.stdin.end(); } catch { /* ignore */ }
    sessions.delete(jobId);
    console.log(`[lightning] Replaced existing session for ${jobId}`);
  }

  const now = Date.now();
  const stdin = new PassThrough();
  sessions.set(jobId, {
    stdin,
    startedAt: now,
    lastChunkAt: now,
    jobId,
    publishUrl,
    ffmpegStarted: false,
    error: null,
  });

  console.log(`[lightning] Session created for ${jobId} -> ${publishUrl} (ffmpeg deferred)`);
  res.json({ success: true, jobId });
});

// ── PUBLISH: RECEIVE CHUNK ────────────────────────────────────────────────────
// Writes incoming binary data to ffmpeg's stdin. On the very first chunk the
// ffmpeg process is spawned so it has the webm header available immediately.

router.post(`${API_PREFIX}/publish/:jobId/chunk`, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const session = sessions.get(jobId);

  if (!session) {
    console.warn(`[lightning] Chunk received for unknown session ${jobId}`);
    return res.status(404).json({ error: 'Session not found — call /start first' });
  }

  if (session.error) {
    return res.status(500).json({ error: `Session error: ${session.error}` });
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const data = Buffer.concat(chunks);
    if (data.length === 0) {
      return res.json({ ok: true, bytes: 0 });
    }

    if (!session.ffmpegStarted) {
      const sig = data.slice(0, 4).toString('hex');
      console.log(`[lightning] First chunk for ${jobId}: ${data.length} bytes, sig=0x${sig}`);
    }

    session.lastChunkAt = Date.now();

    session.stdin.write(data, (err) => {
      if (err) {
        console.error(`[lightning] Stdin write error for ${jobId}:`, err.message);
        return res.status(500).json({ error: 'Write error' });
      }

      if (!session.ffmpegStarted) {
        startFfmpeg(session);
      }

      res.json({ ok: true, bytes: data.length });
    });
  });
  req.on('error', (err) => {
    console.error(`[lightning] Request error for chunk ${jobId}:`, err.message);
    res.status(500).json({ error: 'Request error' });
  });
});

// ── PUBLISH: STOP SESSION ─────────────────────────────────────────────────────
// Closes ffmpeg's stdin which flushes and ends the Livepeer upload.

router.post(`${API_PREFIX}/publish/:jobId/stop`, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const session = sessions.get(jobId);

  if (session) {
    console.log(`[lightning] Stopping session for ${jobId}`);
    session.stdin.end();
    sessions.delete(jobId);
  }

  res.json({ stopped: true });
});

// ── SUBSCRIBE PROXY ───────────────────────────────────────────────────────────
// Trickle subscribe: each POST to the trickle endpoint returns ONE segment and
// closes. We poll in a loop, concatenating segments into a continuous MPEG-TS
// stream for the browser. Falls back to the input URL if "-out" returns 404.

router.get(`${API_PREFIX}/subscribe/:jobId`, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const subscribeUrl = req.query.url as string;

  if (!subscribeUrl || !isUrlAllowed(subscribeUrl)) {
    return res.status(400).json({ error: 'Invalid or missing subscribe_url' });
  }

  const urls = [subscribeUrl];
  if (subscribeUrl.endsWith('-out')) {
    urls.push(subscribeUrl.slice(0, -4));
  }

  console.log(`[lightning] Subscribe poll loop for ${jobId}, candidates: ${urls.join(' | ')}`);

  let aborted = false;
  let headersSent = false;
  let segmentCount = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 15;

  req.on('close', () => {
    aborted = true;
    console.log(`[lightning] Client closed subscription for ${jobId} after ${segmentCount} segments`);
  });

  // Continuously poll the trickle endpoint for new segments.
  // Each fetch has a 5s timeout to avoid blocking on long-polling endpoints.
  while (!aborted && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
    let gotData = false;

    for (const url of urls) {
      if (aborted) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      try {
        const gatewayRes = await fetch(url, {
          method: 'POST',
          agent: httpsAgent,
          signal: controller.signal as any,
        });

        if (gatewayRes.ok) {
          // Keep timeout active — covers both header wait AND body read.
          // Use arrayBuffer() instead of for-await to avoid Web ReadableStream
          // async-iterator inconsistencies across Node.js versions.
          const buf = await gatewayRes.arrayBuffer();
          clearTimeout(timer);
          const data = Buffer.from(buf);

          if (data.length > 0) {
            if (!headersSent) {
              const ct = gatewayRes.headers.get('content-type') || 'video/mp2t';
              const isMpegTs = data[0] === 0x47;
              const sig = data.slice(0, 4).toString('hex');
              console.log(`[lightning] Subscribe ${jobId}: first segment from ${url} — ` +
                `${data.length} bytes, sig=0x${sig}, mpegts=${isMpegTs}, content-type=${ct}`);

              res.setHeader('Content-Type', isMpegTs ? 'video/mp2t' : ct);
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Transfer-Encoding', 'chunked');
              headersSent = true;
            }
            res.write(data);
            segmentCount++;
            consecutiveErrors = 0;
            gotData = true;
            if (segmentCount % 30 === 0) {
              console.log(`[lightning] Subscribe ${jobId}: ${segmentCount} segments (${data.length} bytes last)`);
            }
          } else if (segmentCount === 0) {
            console.log(`[lightning] Subscribe ${jobId}: trickle returned 200 OK but empty body from ${url}`);
          }
          break;
        } else if (gatewayRes.status === 404) {
          clearTimeout(timer);
          continue;
        } else {
          clearTimeout(timer);
          if (segmentCount === 0) {
            console.warn(`[lightning] Subscribe ${jobId}: trickle returned ${gatewayRes.status} from ${url}`);
          }
          consecutiveErrors++;
        }
      } catch (err: any) {
        clearTimeout(timer);
        if (!aborted) {
          if (err.name === 'AbortError') {
            continue;
          }
          consecutiveErrors++;
          if (consecutiveErrors % 5 === 0) {
            console.warn(`[lightning] Subscribe poll error for ${jobId}: ${err.message} (${consecutiveErrors} consecutive)`);
          }
        }
      }
    }

    if (!gotData) {
      await new Promise((r) => setTimeout(r, headersSent ? 100 : 2000));
    }
  }

  if (!headersSent && !aborted) {
    console.error(`[lightning] Subscribe gave up for ${jobId} after ${MAX_CONSECUTIVE_ERRORS} errors`);
    res.status(502).json({ error: 'Could not connect to stream' });
  } else if (!aborted) {
    res.end();
  }
});

start().then(() => {
  console.log(`⚡ Lightning Client backend running on port ${PORT}`);
});
