import { useState, useCallback, useRef, useEffect } from 'react';

interface MediaBridgeOptions {
  jobId: string | null;
  publishUrl: string | null;
  subscribeUrl: string | null;
}

/**
 * Chunked upload approach — avoids ERR_ALPN_NEGOTIATION_FAILED.
 *
 * Chrome requires HTTP/2 for streaming-body fetch (duplex: 'half'), but
 * localhost runs HTTP/1.1. Instead we POST each MediaRecorder chunk as an
 * individual request. The backend keeps an ffmpeg session open between chunks.
 */
export function useMediaBridge({ jobId, publishUrl, subscribeUrl }: MediaBridgeOptions) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const abortedRef = useRef(false);
  const [lockedSubscribeUrl, setLockedSubscribeUrl] = useState<string | null>(null);

  const base = () => `/api/v1/lightning`;

  const start = useCallback(async (stream: MediaStream) => {
    if (!jobId || !publishUrl) {
      setError('Job not ready for streaming');
      return;
    }

    abortedRef.current = false;
    setError(null);

    try {
      // 1. Tell backend to open an ffmpeg session + start uploading to Livepeer
      const startRes = await fetch(
        `${base()}/publish/${jobId}/start?url=${encodeURIComponent(publishUrl)}`,
        { method: 'POST' }
      );
      if (!startRes.ok) {
        const body = await startRes.json().catch(() => ({}));
        const detail = body.details ? ` (${body.details})` : '';
        throw new Error((body.error || `Session start failed: ${startRes.status}`) + detail);
      }

      setActive(true);
      if (subscribeUrl) {
        setLockedSubscribeUrl(`${base()}/subscribe/${jobId}?url=${encodeURIComponent(subscribeUrl)}`);
      }

      // 2. Record in short chunks and POST each one to the backend sequentially
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8',
        videoBitsPerSecond: 1_000_000,
      });
      recorderRef.current = recorder;

      // Chain promises to preserve chunk ordering
      let chainPromise = Promise.resolve();

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || abortedRef.current) return;

        chainPromise = chainPromise.then(async () => {
          if (abortedRef.current) return;
          try {
            const buffer = await event.data.arrayBuffer();
            const res = await fetch(`${base()}/publish/${jobId}/chunk`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: buffer,
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error || `Chunk rejected: ${res.status}`);
            }
          } catch (err: any) {
            if (!abortedRef.current) {
              console.error('[bridge] Chunk error:', err);
              setError(err.message);
            }
          }
        });
      };

      recorder.onstop = async () => {
        // Wait for all in-flight chunks, then close the session
        await chainPromise;
        if (!abortedRef.current) {
          fetch(`${base()}/publish/${jobId}/stop`, { method: 'POST' }).catch(() => null);
        }
        setActive(false);
      };

      recorder.onerror = (e) => {
        setError('MediaRecorder error');
        setActive(false);
      };

      // 250 ms chunks — small enough for low latency, big enough to not spam the backend
      recorder.start(250);
      console.log('[bridge] Recording started (chunked mode)');

    } catch (err: any) {
      console.error('[bridge] Start error:', err);
      setError(err.message || 'Failed to start media bridge');
      setActive(false);
    }
  }, [jobId, publishUrl]);

  const stop = useCallback(() => {
    abortedRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setActive(false);
    setLockedSubscribeUrl(null);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const proxiedSubscribeUrl = lockedSubscribeUrl
    || ((jobId && subscribeUrl) ? `${base()}/subscribe/${jobId}?url=${encodeURIComponent(subscribeUrl)}` : null);

  return { start, stop, active, error, subscribeUrl: proxiedSubscribeUrl };
}
