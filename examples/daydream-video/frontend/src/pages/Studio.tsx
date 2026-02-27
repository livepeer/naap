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

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebcamPiP } from '../components/WebcamPiP';
import { OutputPlayer } from '../components/OutputPlayer';
import { ControlToolbar, StreamParams, ConnectionStatus } from '../components/ControlToolbar';
import { useWHIP } from '../hooks/useWHIP';
import {
  createStream,
  updateStreamParams,
  endStream,
  type StreamResponse,
} from '../lib/api';

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
    <div className="h-full min-h-[600px] bg-black overflow-hidden selection:bg-purple-500/30 flex flex-col">
      {/* Top Section: Immersive Video Area */}
      <div className="flex-1 relative bg-[#050505] overflow-hidden">
        {/* Fullscreen AI Output */}
        <div className="absolute inset-0 z-0">
          <OutputPlayer
            playbackId={streamInfo?.playbackId || null}
            isStreaming={isStreaming}
          />
        </div>

        {/* Header Overlay — Minimal subtle info */}
        <div className="absolute top-6 right-6 z-20 pointer-events-none">
          {status === 'connected' && (
            <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-top-2">
              <span className="text-[10px] font-bold text-green-400 uppercase tracking-[0.2em] [text-shadow:0_0_10px_rgba(74,222,128,0.5)]">AI Stream Live</span>
              <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-green-400 animate-progress" style={{ width: '100%' }} />
              </div>
            </div>
          )}
        </div>

        {/* Webcam PiP — Floating in the video area */}
        <div className="absolute top-6 left-6 z-30 transition-all duration-500">
          <WebcamPiP stream={webcamStream} onStreamChange={setWebcamStream} disabled={isStreaming} />
        </div>

        {/* Visual Ambient Effects (within video area) */}
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          <div className="absolute -bottom-48 -left-48 w-96 h-96 bg-purple-600/5 blur-[120px] rounded-full" />
          <div className="absolute -top-48 -right-48 w-96 h-96 bg-blue-600/5 blur-[120px] rounded-full" />
        </div>
      </div>

      {/* Bottom Section: Dedicated Control Console (No Overlap) */}
      <div className="flex-shrink-0 bg-[#0a0a0a] border-t border-white/5 relative z-40">
        <ControlToolbar
          params={params}
          onChange={handleParamsChange}
          onStart={startStreaming}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          canStart={!!webcamStream}
          onSettingsClick={() => navigate('/settings')}
          status={status}
          elapsedTime={elapsedTime}
          sessionActive={!!sessionStartTime}
          error={error}
          onErrorDismiss={() => setError(null)}
          statusMessage={statusMessage}
        />
      </div>
    </div>
  );
};

export default Studio;
