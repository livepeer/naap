/**
 * Studio Page
 *
 * Uses the Daydream backend API (which proxies to Daydream.live) for stream
 * management. The control flow:
 *
 * 1. User starts camera → gets MediaStream
 * 2. createStream() → backend calls Daydream.live → returns whipUrl & playbackId
 * 3. useWHIP.connect(whipUrl, stream) → pushes WebRTC to Daydream ingest
 * 4. updateStreamParams() → live prompt/seed changes via backend → Daydream API
 * 5. OutputPlayer connects to playbackId via lvpr.tv iframe
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';
import { WebcamPiP } from '../components/WebcamPiP';
import { OutputPlayer } from '../components/OutputPlayer';
import { ControlToolbar, StreamParams } from '../components/ControlToolbar';
import { useWHIP } from '../hooks/useWHIP';
import {
  createStream,
  updateStreamParams,
  endStream,
  type StreamResponse,
} from '../lib/api';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export const Studio: React.FC = () => {
  const navigate = useNavigate();

  // WHIP client for WebRTC publishing
  const whip = useWHIP();

  // Stream state
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Current stream info from Daydream API
  const [streamInfo, setStreamInfo] = useState<StreamResponse | null>(null);

  // Timer state
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState('00:00');

  // Parameters
  const [params, setParams] = useState<StreamParams>({
    prompt: 'superman',
    modelId: 'stabilityai/sd-turbo',
    negativePrompt: 'blurry, low quality, flat, 2d',
    seed: 42,
    numInferenceSteps: 2,
    controlnets: { pose: 0, edge: 0, canny: 0, depth: 0, color: 0 },
  });

  // Timer effect
  useEffect(() => {
    if (!sessionStartTime) {
      setElapsedTime('00:00');
      return;
    }
    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - sessionStartTime.getTime()) / 1000);
      const minutes = Math.floor(diff / 60).toString().padStart(2, '0');
      const seconds = (diff % 60).toString().padStart(2, '0');
      setElapsedTime(`${minutes}:${seconds}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  // Map WHIP state to our connection status
  useEffect(() => {
    if (whip.state.status === 'connected') setStatus('connected');
    else if (whip.state.status === 'connecting') setStatus('connecting');
    else if (whip.state.status === 'error') {
      setStatus('error');
      setError(whip.state.error || 'WHIP connection failed');
    }
  }, [whip.state.status, whip.state.error]);

  // Start streaming via Daydream API
  const startStreaming = useCallback(async () => {
    if (!webcamStream) {
      setError('Please start your camera first');
      return;
    }

    try {
      setStatus('connecting');
      setError(null);

      // 1. Create stream via backend → Daydream.live API
      const result = await createStream({
        model_id: params.modelId,
        prompt: params.prompt,
        seed: params.seed,
        negative_prompt: params.negativePrompt,
      });

      if (!result?.whipUrl) {
        throw new Error('No WHIP URL returned from Daydream API');
      }

      setStreamInfo(result);

      // 2. Connect WHIP publisher to Daydream ingest
      await whip.connect(result.whipUrl, webcamStream);

      setSessionStartTime(new Date());
    } catch (err) {
      console.error('Failed to start streaming:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to start streaming');
    }
  }, [webcamStream, params, whip]);

  // Stop streaming
  const stopStreaming = useCallback(async () => {
    try {
      whip.disconnect();
      setStatus('disconnected');
      setSessionStartTime(null);
      setError(null);

      // End stream on Daydream API
      if (streamInfo?.streamId) {
        try {
          await endStream(streamInfo.streamId);
        } catch (err) {
          console.warn('Failed to end stream on API:', err);
        }
      }

      setStreamInfo(null);
    } catch (err) {
      console.error('Failed to stop streaming:', err);
    }
  }, [whip, streamInfo]);

  // Update parameters on the fly via Daydream API
  const handleParamsChange = useCallback(
    async (newParams: Partial<StreamParams>) => {
      const updated = { ...params, ...newParams };
      setParams(updated);

      // Only send live updates when connected and we have a stream
      if (status !== 'connected' || !streamInfo?.streamId) {
        setStatusMessage('Settings saved - will apply when you start streaming');
        setTimeout(() => setStatusMessage(null), 2000);
        return;
      }

      try {
        const updatePayload: Record<string, unknown> = {};
        if (newParams.prompt !== undefined) updatePayload.prompt = newParams.prompt;
        if (newParams.negativePrompt !== undefined) updatePayload.negative_prompt = newParams.negativePrompt;
        if (newParams.seed !== undefined) updatePayload.seed = newParams.seed;
        if (newParams.numInferenceSteps !== undefined) {
          updatePayload.num_inference_steps = Math.min(Math.max(newParams.numInferenceSteps, 1), 4);
        }

        if (Object.keys(updatePayload).length > 0) {
          await updateStreamParams(streamInfo.streamId, updatePayload as any);
          setError(null);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to update stream';
        setError(errorMsg);
      }
    },
    [params, status, streamInfo]
  );

  const isStreaming = status === 'connected' || status === 'connecting';

  return (
    <div className="relative h-full min-h-[600px] bg-black overflow-hidden">
      {/* Fullscreen AI Output -- connects via lvpr.tv or WHEP */}
      <div className="absolute inset-0">
        <OutputPlayer
          playbackId={streamInfo?.playbackId || null}
          isStreaming={isStreaming}
        />
      </div>

      {/* PiP Webcam */}
      <WebcamPiP stream={webcamStream} onStreamChange={setWebcamStream} disabled={isStreaming} />

      {/* Minimal Header - top right */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-black/60 backdrop-blur-sm rounded-full">
          {status === 'connected' ? (
            <>
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <Wifi className="w-4 h-4 text-green-400" />
            </>
          ) : status === 'connecting' ? (
            <>
              <RefreshCw className="w-4 h-4 text-yellow-400 animate-spin" />
              <span className="text-xs text-yellow-400">Connecting</span>
            </>
          ) : status === 'error' ? (
            <>
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-red-400">Error</span>
            </>
          ) : (
            <WifiOff className="w-4 h-4 text-gray-400" />
          )}
        </div>

        {sessionStartTime && (
          <div className="flex items-center gap-2 px-3 py-2 bg-black/60 backdrop-blur-sm rounded-full">
            <Clock className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-mono text-white">{elapsedTime}</span>
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-3 bg-red-500/90 backdrop-blur-sm rounded-xl flex items-center gap-3 shadow-2xl">
          <AlertCircle className="w-5 h-5 text-white" />
          <span className="text-white text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-white/60 hover:text-white">×</button>
        </div>
      )}

      {/* Status message toast */}
      {statusMessage && !error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-3 bg-blue-500/90 backdrop-blur-sm rounded-xl flex items-center gap-3 shadow-2xl">
          <span className="text-white text-sm">{statusMessage}</span>
        </div>
      )}

      {/* Floating Control Toolbar */}
      <ControlToolbar
        params={params}
        onChange={handleParamsChange}
        onStart={startStreaming}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        canStart={!!webcamStream}
        onSettingsClick={() => navigate('/settings')}
      />
    </div>
  );
};

export default Studio;
