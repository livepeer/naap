/**
 * useWHIP - WebRTC WHIP Client Hook
 * 
 * Handles WebRTC WHIP connection to Daydream ingest endpoint.
 *
 * IMPORTANT: The WHIP SDP handshake is proxied through the daydream-video
 * backend (`/api/v1/daydream/whip-proxy`) to avoid CORS issues.
 * The external WHIP server (ai.livepeer.com) does not set
 * Access-Control-Allow-Origin, so direct browser fetch() would fail.
 * The actual WebRTC media stream still goes peer-to-peer.
 */

import { useState, useCallback, useRef } from 'react';
import {
  getPluginBackendUrl,
  getCsrfToken,
  generateCorrelationId,
} from '@naap/plugin-sdk';
import { HEADER_CSRF_TOKEN, HEADER_CORRELATION, HEADER_PLUGIN_NAME } from '@naap/types';

// Auth token storage key (must match shell's STORAGE_KEYS.AUTH_TOKEN)
const AUTH_TOKEN_KEY = 'naap_auth_token';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  const shellContext = (window as any).__SHELL_CONTEXT__;
  if (shellContext?.authToken) return shellContext.authToken;
  if (typeof localStorage !== 'undefined') return localStorage.getItem(AUTH_TOKEN_KEY);
  return null;
}

export interface WHIPConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
}

export interface UseWHIPResult {
  state: WHIPConnectionState;
  connect: (whipUrl: string, stream: MediaStream) => Promise<RTCPeerConnection>;
  disconnect: () => void;
  peerConnection: RTCPeerConnection | null;
}

export function useWHIP(): UseWHIPResult {
  const [state, setState] = useState<WHIPConnectionState>({
    status: 'disconnected',
    error: null,
  });
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const connect = useCallback(async (whipUrl: string, stream: MediaStream): Promise<RTCPeerConnection> => {
    setState({ status: 'connecting', error: null });

    try {
      // Create peer connection with STUN server
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      // Add all tracks from the stream
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      await waitForIceGathering(pc);

      // Get the final SDP with all ICE candidates
      const finalSdp = pc.localDescription?.sdp;
      if (!finalSdp) {
        throw new Error('Failed to get local SDP');
      }

      // ─── Send offer via backend proxy (avoids CORS) ──────────────
      const proxyUrl = getPluginBackendUrl('daydream-video', {
        apiPath: '/api/v1/daydream/whip-proxy',
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/sdp',
        'X-WHIP-URL': whipUrl,
        [HEADER_PLUGIN_NAME]: 'daydream-video',
      };

      // Add auth token
      const token = getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Add CSRF token
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        headers[HEADER_CSRF_TOKEN] = csrfToken;
      }

      // Add correlation ID
      headers[HEADER_CORRELATION] = generateCorrelationId();

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        body: finalSdp,
      });

      if (!response.ok) {
        let errorDetail: string;
        try {
          const json = await response.json();
          errorDetail = json?.error?.message || `${response.status} ${response.statusText}`;
        } catch {
          errorDetail = await response.text();
        }
        throw new Error(`WHIP connection failed: ${errorDetail}`);
      }

      // Parse answer SDP
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // Store reference
      peerConnectionRef.current = pc;

      // Monitor connection state
      pc.addEventListener('connectionstatechange', () => {
        switch (pc.connectionState) {
          case 'connected':
            setState({ status: 'connected', error: null });
            break;
          case 'failed':
          case 'disconnected':
            setState({ status: 'error', error: 'WebRTC connection lost' });
            break;
          case 'closed':
            setState({ status: 'disconnected', error: null });
            break;
        }
      });

      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'failed') {
          setState({ status: 'error', error: 'ICE connection failed' });
        }
      });

      setState({ status: 'connected', error: null });
      return pc;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setState({ status: 'error', error: errorMessage });
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setState({ status: 'disconnected', error: null });
  }, []);

  return {
    state,
    connect,
    disconnect,
    peerConnection: peerConnectionRef.current,
  };
}

/**
 * Wait for ICE gathering to complete
 */
async function waitForIceGathering(pc: RTCPeerConnection, timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      // Proceed even if gathering isn't complete - we have enough candidates
      resolve();
    }, timeout);

    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeoutId);
        resolve();
      }
    });
  });
}

export default useWHIP;
