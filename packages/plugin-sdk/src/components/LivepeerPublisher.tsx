/**
 * LivepeerPublisher Component (Phase 5c)
 *
 * WHIP WebRTC publisher for live AI video transformation.
 * Captures from camera or canvas and streams to a WHIP ingest endpoint.
 *
 * Usage:
 * ```tsx
 * <LivepeerPublisher publishUrl="..." autoStart />
 * ```
 */

import React, { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

export interface LivepeerPublisherProps {
  /** WHIP publish URL from pipeline-gateway session */
  publishUrl: string;
  /** MediaStream to publish (camera, canvas, etc.) */
  stream?: MediaStream | null;
  /** Whether to auto-start publishing when stream + publishUrl are available */
  autoStart?: boolean;
  /** ICE servers for WebRTC */
  iceServers?: RTCIceServer[];
  /** Called when connection state changes */
  onConnectionChange?: (state: RTCPeerConnectionState) => void;
  /** Called when publishing starts successfully */
  onPublishStart?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Additional class name */
  className?: string;
  /** Show a local video preview */
  showPreview?: boolean;
}

export interface LivepeerPublisherRef {
  start: () => Promise<void>;
  stop: () => void;
  isPublishing: boolean;
  peerConnection: RTCPeerConnection | null;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const LivepeerPublisher = forwardRef<LivepeerPublisherRef, LivepeerPublisherProps>(
  ({ publishUrl, stream, autoStart, iceServers, onConnectionChange, onPublishStart, onError, className, showPreview }, ref) => {
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [_connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');

    const start = useCallback(async () => {
      if (!stream || !publishUrl) {
        onError?.(new Error('Stream and publishUrl are required'));
        return;
      }

      try {
        const pc = new RTCPeerConnection({
          iceServers: iceServers || DEFAULT_ICE_SERVERS,
        });

        // Add tracks
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Monitor connection state
        pc.addEventListener('connectionstatechange', () => {
          setConnectionState(pc.connectionState);
          onConnectionChange?.(pc.connectionState);
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            onError?.(new Error('WebRTC connection lost'));
          }
        });

        // Create offer
        const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
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

        // Send to WHIP endpoint
        const response = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription?.sdp,
        });

        if (!response.ok) {
          throw new Error(`WHIP connection failed: ${response.status}`);
        }

        const answerSdp = await response.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        pcRef.current = pc;
        setIsPublishing(true);
        onPublishStart?.();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
      }
    }, [stream, publishUrl, iceServers, onConnectionChange, onPublishStart, onError]);

    const stop = useCallback(() => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setIsPublishing(false);
      setConnectionState('closed');
    }, []);

    // Auto-start
    useEffect(() => {
      if (autoStart && stream && publishUrl && !isPublishing) {
        start();
      }
    }, [autoStart, stream, publishUrl, isPublishing, start]);

    // Preview
    useEffect(() => {
      if (showPreview && videoRef.current && stream) {
        videoRef.current.srcObject = stream;
      }
    }, [showPreview, stream]);

    // Cleanup
    useEffect(() => {
      return () => {
        stop();
      };
    }, [stop]);

    useImperativeHandle(ref, () => ({
      start,
      stop,
      isPublishing,
      peerConnection: pcRef.current,
    }));

    if (!showPreview) return null;

    return (
      <div className={className}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0.75rem' }}
        />
        {isPublishing && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', color: '#10b981' }}>
            LIVE
          </div>
        )}
      </div>
    );
  }
);

LivepeerPublisher.displayName = 'LivepeerPublisher';
