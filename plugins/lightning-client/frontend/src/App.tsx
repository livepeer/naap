/**
 * Lightning Client Plugin — Real-time AI Video
 *
 * Streams webcam JPEG frames through a Livepeer gateway for AI processing.
 * HTTP calls (start-job, stop-job) go through the Service Gateway connector.
 * WebSocket (frame exchange) is proxied by the plugin backend.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { createPlugin, useTeam } from '@naap/plugin-sdk';
import { Zap, Camera, CameraOff } from 'lucide-react';

const CONNECTOR_SLUG = 'livepeer-gateway';
const TARGET_FPS = 24;
const CANVAS_W = 640;
const CANVAS_H = 480;

interface Stats {
  status: 'disconnected' | 'connecting' | 'connected';
  sendFps: number;
  recvFps: number;
  latency: number | null;
  framesSent: number;
  framesRecv: number;
}

const LightningApp: React.FC = () => {
  const teamContext = useTeam();
  const teamId = teamContext?.currentTeam?.id;

  const [modelId, setModelId] = useState('noop');
  const [orchUrl, setOrchUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({
    status: 'disconnected', sendFps: 0, recvFps: 0,
    latency: null, framesSent: 0, framesRecv: 0,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const sendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraRafRef = useRef<number | null>(null);
  const sendTimestampsRef = useRef<number[]>([]);
  const recvTimestampsRef = useRef<number[]>([]);
  const lastSendTimeRef = useRef(0);
  const framesSentRef = useRef(0);
  const framesRecvRef = useRef(0);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => {
      const next = [...prev, `[${ts}] ${msg}`];
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, []);

  const gwUrl = useCallback((path: string) => {
    return `${window.location.origin}/api/v1/gw/${CONNECTOR_SLUG}${path}`;
  }, []);

  const gwHeaders = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (teamId) h['x-team-id'] = teamId;
    return h;
  }, [teamId]);

  // Camera preview loop
  const drawCameraPreview = useCallback(() => {
    const video = videoRef.current;
    const canvas = inputCanvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
    cameraRafRef.current = requestAnimationFrame(drawCameraPreview);
  }, []);

  // FPS stats updater
  useEffect(() => {
    statsIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const window = 2000;
      sendTimestampsRef.current = sendTimestampsRef.current.filter((t) => now - t < window);
      recvTimestampsRef.current = recvTimestampsRef.current.filter((t) => now - t < window);
      setStats((prev) => ({
        ...prev,
        sendFps: Math.round(sendTimestampsRef.current.length / (window / 1000)),
        recvFps: Math.round(recvTimestampsRef.current.length / (window / 1000)),
        framesSent: framesSentRef.current,
        framesRecv: framesRecvRef.current,
      }));
    }, 500);
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  const startCamera = useCallback(async () => {
    const ms = await navigator.mediaDevices.getUserMedia({
      video: { width: CANVAS_W, height: CANVAS_H, frameRate: TARGET_FPS },
      audio: false,
    });
    streamRef.current = ms;
    if (videoRef.current) {
      videoRef.current.srcObject = ms;
      await videoRef.current.play();
    }
    cameraRafRef.current = requestAnimationFrame(drawCameraPreview);
    log('Camera started');
  }, [drawCameraPreview, log]);

  const stopCamera = useCallback(() => {
    if (cameraRafRef.current) {
      cancelAnimationFrame(cameraRafRef.current);
      cameraRafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startSending = useCallback(() => {
    if (sendIntervalRef.current) return;
    sendIntervalRef.current = setInterval(() => {
      const ws = wsRef.current;
      const video = videoRef.current;
      const capture = captureCanvasRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !video || !capture) return;

      const ctx = capture.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);

      capture.toBlob(
        (blob) => {
          if (!blob || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          wsRef.current.send(blob);
          framesSentRef.current++;
          lastSendTimeRef.current = Date.now();
          sendTimestampsRef.current.push(lastSendTimeRef.current);
        },
        'image/jpeg',
        0.8,
      );
    }, 1000 / TARGET_FPS);
  }, []);

  const stopSending = useCallback(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setRunning(true);
    framesSentRef.current = 0;
    framesRecvRef.current = 0;
    sendTimestampsRef.current = [];
    recvTimestampsRef.current = [];
    setStats({ status: 'connecting', sendFps: 0, recvFps: 0, latency: null, framesSent: 0, framesRecv: 0 });

    const outCtx = outputCanvasRef.current?.getContext('2d');
    if (outCtx) outCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    try {
      await startCamera();

      // Start job via gateway connector
      log('Starting job...');
      const body: Record<string, string> = { model_id: modelId || 'noop' };
      if (orchUrl.trim()) body.orchestrator_url = orchUrl.trim();

      const jobRes = await fetch(gwUrl('/start-job'), {
        method: 'POST',
        headers: gwHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!jobRes.ok) {
        const err = await jobRes.json().catch(() => ({ error: jobRes.statusText }));
        throw new Error(err.error || `Failed to start job: ${jobRes.status}`);
      }

      const jobData = await jobRes.json();
      // Handle both raw upstream response and gateway envelope format
      const payload = jobData.data ?? jobData;
      const jid = payload.job_id;
      if (!jid) {
        throw new Error('No job_id in response — check connector configuration');
      }
      jobIdRef.current = jid;
      log(`Job started: ${jid}`);

      // Connect WebSocket to backend directly (Next.js can't proxy WS upgrades).
      // In dev the backend runs on port 4112; in production it's co-located.
      const backendHost = window.location.port === '3000'
        ? `${window.location.hostname}:4112`
        : window.location.host;
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProto}//${backendHost}/api/v1/lightning/ws/${jid}`;
      log(`Connecting WebSocket: ${wsUrl}`);
      setStats((prev) => ({ ...prev, status: 'connecting' }));

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        log('WebSocket connected');
        setStats((prev) => ({ ...prev, status: 'connected' }));
        startSending();
      };

      ws.onmessage = (event) => {
        framesRecvRef.current++;
        recvTimestampsRef.current.push(Date.now());

        if (lastSendTimeRef.current > 0) {
          const lat = Date.now() - lastSendTimeRef.current;
          setStats((prev) => ({ ...prev, latency: lat }));
        }

        const blob = new Blob([event.data], { type: 'image/jpeg' });
        createImageBitmap(blob).then((bmp) => {
          const ctx = outputCanvasRef.current?.getContext('2d');
          if (ctx) ctx.drawImage(bmp, 0, 0, CANVAS_W, CANVAS_H);
          bmp.close();
        }).catch(() => {});
      };

      ws.onclose = (event) => {
        log(`WebSocket closed: ${event.reason || event.code}`);
        setStats((prev) => ({ ...prev, status: 'disconnected' }));
        stopSending();
      };

      ws.onerror = () => {
        log('WebSocket error');
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log(`Error: ${msg}`);
      setError(msg);
      setRunning(false);
      stopCamera();
      setStats((prev) => ({ ...prev, status: 'disconnected' }));
    }
  }, [modelId, orchUrl, startCamera, gwUrl, gwHeaders, log, startSending, stopSending]);

  const handleStop = useCallback(async () => {
    stopSending();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (jobIdRef.current) {
      try {
        await fetch(gwUrl(`/stop-job/${jobIdRef.current}`), {
          method: 'DELETE',
          headers: gwHeaders(),
          credentials: 'include',
        });
        log(`Job stopped: ${jobIdRef.current}`);
      } catch (err) {
        log('Error stopping job');
      }
      jobIdRef.current = null;
    }

    stopCamera();
    setRunning(false);
    setStats((prev) => ({ ...prev, status: 'disconnected' }));
  }, [gwUrl, gwHeaders, log, stopCamera, stopSending]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSending();
      if (wsRef.current) wsRef.current.close();
      stopCamera();
    };
  }, [stopCamera, stopSending]);

  const statusColor = stats.status === 'connected' ? '#4caf50' : stats.status === 'connecting' ? '#ff9800' : '#f44336';

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#111', color: '#eee', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Zap size={20} style={{ color: '#f59e0b' }} />
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Livepeer AI Video</h1>
        <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>via {CONNECTOR_SLUG}</span>
      </div>

      {/* Config Panel */}
      <div style={{ padding: '12px 20px', background: '#1a1a1a', borderBottom: '1px solid #333', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: '#999', textTransform: 'uppercase' }}>Model ID</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="noop"
            disabled={running}
            style={{ background: '#222', border: '1px solid #444', color: '#eee', padding: '6px 10px', borderRadius: 4, fontSize: 13, width: 200 }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: '#999', textTransform: 'uppercase' }}>Orchestrator URL (optional)</label>
          <input
            type="text"
            value={orchUrl}
            onChange={(e) => setOrchUrl(e.target.value)}
            placeholder="host:port"
            disabled={running}
            style={{ background: '#222', border: '1px solid #444', color: '#eee', padding: '6px 10px', borderRadius: 4, fontSize: 13, width: 240 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleStart}
            disabled={running}
            style={{ padding: '7px 18px', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: running ? 'not-allowed' : 'pointer', background: running ? '#555' : '#4caf50', color: '#fff' }}
          >
            <Camera size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
            Start
          </button>
          <button
            onClick={handleStop}
            disabled={!running}
            style={{ padding: '7px 18px', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: !running ? 'not-allowed' : 'pointer', background: !running ? '#555' : '#f44336', color: '#fff' }}
          >
            <CameraOff size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
            Stop
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{ padding: '8px 20px', background: '#2d1010', borderBottom: '1px solid #5c2020', color: '#f87171', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Video Panels */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, padding: 20, flexWrap: 'wrap', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Camera Input</span>
          <canvas ref={inputCanvasRef} width={CANVAS_W} height={CANVAS_H} style={{ background: '#000', borderRadius: 6, border: '1px solid #333', maxWidth: '100%' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>AI Output</span>
          <canvas ref={outputCanvasRef} width={CANVAS_W} height={CANVAS_H} style={{ background: '#000', borderRadius: 6, border: '1px solid #333', maxWidth: '100%' }} />
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ padding: '8px 20px', background: '#1a1a1a', borderTop: '1px solid #333', display: 'flex', gap: 24, fontSize: 12, color: '#999' }}>
        <span>
          Status: <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: statusColor, marginRight: 4, verticalAlign: 'middle' }} />
          <span style={{ color: '#eee' }}>{stats.status[0].toUpperCase() + stats.status.slice(1)}</span>
        </span>
        <span>Send FPS: <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{stats.sendFps}</span></span>
        <span>Recv FPS: <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{stats.recvFps}</span></span>
        <span>Latency: <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{stats.latency != null ? `${stats.latency}ms` : '--'}</span></span>
        <span>Frames sent: <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{stats.framesSent}</span></span>
        <span>Frames recv: <span style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>{stats.framesRecv}</span></span>
      </div>

      {/* Log Panel */}
      <div style={{ padding: '8px 20px', background: '#0d0d0d', borderTop: '1px solid #222', fontSize: 11, color: '#777', maxHeight: 80, overflowY: 'auto', fontFamily: '"SF Mono", Menlo, monospace' }}>
        {logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      {/* Hidden elements for capture */}
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
      <canvas ref={captureCanvasRef} width={CANVAS_W} height={CANVAS_H} style={{ display: 'none' }} />
    </div>
  );
};

const plugin = createPlugin({
  name: 'lightningClient',
  version: '1.0.0',
  routes: ['/lightning', '/lightning/*'],
  App: LightningApp,
});

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
