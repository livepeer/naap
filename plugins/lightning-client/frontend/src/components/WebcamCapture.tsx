import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CameraOff } from 'lucide-react';

export const WebcamCapture: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setActive(true);
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Camera access denied');
    }
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Webcam Preview</h3>
        <button
          onClick={active ? stop : start}
          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
            active
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
          }`}
        >
          {active ? <CameraOff size={12} /> : <Camera size={12} />}
          {active ? 'Stop' : 'Start'}
        </button>
      </div>

      <div className="relative aspect-[4/3] bg-zinc-900 rounded border border-zinc-700/50 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover ${active ? '' : 'hidden'}`}
        />
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
            <Camera size={32} />
          </div>
        )}
      </div>

      {error && (
        <div className="px-2 py-1.5 bg-red-950/50 border border-red-800 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      {active && (
        <div className="text-[10px] text-zinc-500 text-center">
          Phase 2: "Go Live" will publish this feed through the gateway
        </div>
      )}
    </div>
  );
};
