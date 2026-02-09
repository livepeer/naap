/**
 * LivepeerPlayer Component (Phase 5c)
 *
 * WHEP WebRTC player for viewing live AI video output.
 * Connects to a WHEP subscribe endpoint and renders the video.
 *
 * Usage:
 * ```tsx
 * <LivepeerPlayer subscribeUrl="..." autoPlay />
 * ```
 */

import React, { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

export interface LivepeerPlayerProps {
  /** WHEP subscribe URL from pipeline-gateway session */
  subscribeUrl: string;
  /** Whether to auto-connect when subscribeUrl is available */
  autoPlay?: boolean;
  /** ICE servers for WebRTC */
  iceServers?: RTCIceServer[];
  /** Called when connection state changes */
  onConnectionChange?: (state: RTCPeerConnectionState) => void;
  /** Called when playback starts */
  onPlaybackStart?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Additional class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Poster image shown before playback */
  poster?: string;
}

export interface LivepeerPlayerRef {
  connect: () => Promise<void>;
  disconnect: () => void;
  isPlaying: boolean;
  peerConnection: RTCPeerConnection | null;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const LivepeerPlayer = forwardRef<LivepeerPlayerRef, LivepeerPlayerProps>(
  ({ subscribeUrl, autoPlay, iceServers, onConnectionChange, onPlaybackStart, onError, className, style, poster }, ref) => {
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');

    const connect = useCallback(async () => {
      if (!subscribeUrl) {
        onError?.(new Error('subscribeUrl is required'));
        return;
      }

      try {
        const pc = new RTCPeerConnection({
          iceServers: iceServers || DEFAULT_ICE_SERVERS,
        });

        // Accept incoming tracks
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        // Bind incoming stream to video element
        pc.addEventListener('track', (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setIsPlaying(true);
            onPlaybackStart?.();
          }
        });

        // Monitor connection state
        pc.addEventListener('connectionstatechange', () => {
          setConnectionState(pc.connectionState);
          onConnectionChange?.(pc.connectionState);
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            setIsPlaying(false);
            onError?.(new Error('WebRTC playback connection lost'));
          }
        });

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve();
          const timeout = setTimeout(resolve, 5000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timeout);
              resolve();
            }
          });
        });

        // Send offer to WHEP endpoint
        const response = await fetch(subscribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription?.sdp,
        });

        if (!response.ok) {
          throw new Error(`WHEP connection failed: ${response.status}`);
        }

        const answerSdp = await response.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        pcRef.current = pc;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
      }
    }, [subscribeUrl, iceServers, onConnectionChange, onPlaybackStart, onError]);

    const disconnect = useCallback(() => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsPlaying(false);
      setConnectionState('closed');
    }, []);

    // Auto-play
    useEffect(() => {
      if (autoPlay && subscribeUrl && !isPlaying) {
        connect();
      }
    }, [autoPlay, subscribeUrl, isPlaying, connect]);

    // Cleanup
    useEffect(() => {
      return () => {
        disconnect();
      };
    }, [disconnect]);

    useImperativeHandle(ref, () => ({
      connect,
      disconnect,
      isPlaying,
      peerConnection: pcRef.current,
    }));

    return (
      <div className={className} style={{ position: 'relative', ...style }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          poster={poster}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0.75rem', background: '#000' }}
        />
        {!isPlaying && connectionState !== 'connecting' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)', borderRadius: '0.75rem',
          }}>
            <span style={{ color: '#9ca3af', fontSize: '14px' }}>Waiting for stream...</span>
          </div>
        )}
      </div>
    );
  }
);

LivepeerPlayer.displayName = 'LivepeerPlayer';
