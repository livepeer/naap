import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, AlertCircle, Loader2, MonitorPlay } from 'lucide-react';
import mpegts from 'mpegts.js';

interface Props {
  url: string | null;
  className?: string;
}

const MAX_RETRIES = 8;
const RETRY_BASE_MS = 2000;

export const VideoPlayer: React.FC<Props> = ({ url }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url || !videoRef.current) {
      cleanup();
      return;
    }

    retryRef.current = 0;
    createPlayer(url);

    return () => cleanup();
  }, [url]);

  function cleanup() {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = null;
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
    }
    setError(null);
    setLoading(false);
    setPlaying(false);
  }

  function createPlayer(streamUrl: string) {
    if (!videoRef.current || !mpegts.getFeatureList().mseLivePlayback) {
      setError('Browser does not support MSE Live Playback');
      return;
    }

    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
    }

    setLoading(true);
    setError(null);

    const player = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url: streamUrl, hasAudio: false },
      {
        enableStashBuffer: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 1.5,
        liveBufferLatencyMinRemain: 0.3,
        stashInitialSize: 65536,
      }
    );
    player.attachMediaElement(videoRef.current);
    player.load();
    player.play();
    playerRef.current = player;

    player.on(mpegts.Events.ERROR, (type: any, detail: any, info: any) => {
      console.warn(`[VideoPlayer] Error type=${type} (attempt ${retryRef.current + 1}/${MAX_RETRIES}):`, detail, info);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      if (retryRef.current < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(1.5, retryRef.current);
        retryRef.current++;
        setError(`Connecting... (retry ${retryRef.current})`);
        retryTimerRef.current = setTimeout(() => createPlayer(streamUrl), delay);
      } else {
        setError(`${detail}`);
        setLoading(false);
      }
    });

    player.on(mpegts.Events.METADATA_ARRIVED, () => {
      console.log('[VideoPlayer] METADATA_ARRIVED — stream is decodable');
      retryRef.current = 0;
      setError(null);
      setLoading(false);
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    });

    player.on(mpegts.Events.MEDIA_INFO, (info: any) => {
      console.log('[VideoPlayer] MEDIA_INFO:', JSON.stringify(info));
    });

    player.on(mpegts.Events.STATISTICS_INFO, (stats: any) => {
      if (stats.speed !== undefined) {
        console.log(`[VideoPlayer] Stats: speed=${stats.speed?.toFixed(1)}KB/s decodedFrames=${stats.decodedFrames} droppedFrames=${stats.droppedFrames}`);
      }
    });

    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setLoading(false), 8000);
  }

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) videoRef.current.pause();
    else videoRef.current.play();
    setPlaying(!playing);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !muted;
    setMuted(!muted);
  };

  return (
    <div
      style={{ position: 'relative', flex: 1, minHeight: 0, background: '#010409', borderRadius: 8, overflow: 'hidden', border: '1px solid #21262d' }}
      className="group"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />

      {/* Empty state */}
      {!url && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#484f58' }}>
          <MonitorPlay size={44} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No stream</div>
            <div style={{ fontSize: 11, color: '#30363d' }}>Start a job and go live to see output</div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(0,0,0,0.5)' }}>
          <Loader2 size={30} style={{ color: '#f59e0b' }} className="animate-spin" />
          <span style={{ fontSize: 11, color: '#7d8590' }}>Buffering...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(10,2,2,0.85)', padding: 16 }}>
          <AlertCircle size={28} style={{ color: '#f85149' }} />
          <span style={{ fontSize: 11, color: '#f87171', fontFamily: 'monospace', textAlign: 'center', maxWidth: 220 }}>{error}</span>
        </div>
      )}

      {/* Hover controls */}
      {url && !error && (
        <div className="opacity-0 group-hover:opacity-100" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'opacity 0.2s' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={togglePlay} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 2 }}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={toggleMute} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 2 }}>
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
