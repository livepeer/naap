/**
 * WebRTC Hooks for Livepeer WHIP/WHEP (Phase 5c)
 *
 * useWHIPPublisher  — push a MediaStream to a WHIP endpoint
 * useWHEPPlayer     — play a WHEP endpoint in a <video>
 * useTrickleControl — live parameter updates via control endpoint
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WHIPState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
}

interface WHEPState {
  status: 'disconnected' | 'connecting' | 'playing' | 'error';
  error: string | null;
}

interface TrickleControlState {
  lastUpdate: number | null;
  error: string | null;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

async function waitForIce(pc: RTCPeerConnection, timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, timeout);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

// ─── useWHIPPublisher ────────────────────────────────────────────────────────

export interface UseWHIPPublisherOptions {
  iceServers?: RTCIceServer[];
}

export function useWHIPPublisher(options?: UseWHIPPublisherOptions) {
  const [state, setState] = useState<WHIPState>({ status: 'disconnected', error: null });
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const publish = useCallback(async (publishUrl: string, stream: MediaStream) => {
    setState({ status: 'connecting', error: null });

    try {
      const pc = new RTCPeerConnection({
        iceServers: options?.iceServers || DEFAULT_ICE_SERVERS,
      });

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      await waitForIce(pc);

      const res = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      });

      if (!res.ok) throw new Error(`WHIP ${res.status}`);

      const answer = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setState({ status: 'error', error: 'Connection lost' });
        }
      });

      pcRef.current = pc;
      setState({ status: 'connected', error: null });
      return pc;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', error: msg });
      throw err;
    }
  }, [options?.iceServers]);

  const stop = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setState({ status: 'disconnected', error: null });
  }, []);

  useEffect(() => () => { pcRef.current?.close(); }, []);

  return { ...state, publish, stop, peerConnection: pcRef.current };
}

// ─── useWHEPPlayer ───────────────────────────────────────────────────────────

export interface UseWHEPPlayerOptions {
  iceServers?: RTCIceServer[];
  autoPlay?: boolean;
}

export function useWHEPPlayer(videoRef: React.RefObject<HTMLVideoElement | null>, options?: UseWHEPPlayerOptions) {
  const [state, setState] = useState<WHEPState>({ status: 'disconnected', error: null });
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const connect = useCallback(async (subscribeUrl: string) => {
    setState({ status: 'connecting', error: null });

    try {
      const pc = new RTCPeerConnection({
        iceServers: options?.iceServers || DEFAULT_ICE_SERVERS,
      });

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.addEventListener('track', (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setState({ status: 'playing', error: null });
        }
      });

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setState({ status: 'error', error: 'Playback connection lost' });
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);

      const res = await fetch(subscribeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      });

      if (!res.ok) throw new Error(`WHEP ${res.status}`);

      const answer = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      pcRef.current = pc;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', error: msg });
      throw err;
    }
  }, [options?.iceServers, videoRef]);

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState({ status: 'disconnected', error: null });
  }, [videoRef]);

  useEffect(() => () => { pcRef.current?.close(); }, []);

  return { ...state, connect, disconnect, peerConnection: pcRef.current };
}

// ─── useTrickleControl ───────────────────────────────────────────────────────

export function useTrickleControl(controlUrl: string | null) {
  const [state, setState] = useState<TrickleControlState>({ lastUpdate: null, error: null });

  const updateParams = useCallback(async (params: Record<string, unknown>) => {
    if (!controlUrl) {
      setState({ lastUpdate: null, error: 'No control URL' });
      return;
    }

    try {
      const res = await fetch(controlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        throw new Error(`Trickle control ${res.status}`);
      }

      setState({ lastUpdate: Date.now(), error: null });
    } catch (err) {
      setState({ lastUpdate: null, error: err instanceof Error ? err.message : String(err) });
    }
  }, [controlUrl]);

  return { ...state, updateParams };
}
