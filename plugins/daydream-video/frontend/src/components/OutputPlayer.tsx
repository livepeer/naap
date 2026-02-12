/**
 * OutputPlayer - Fullscreen WebRTC playback via lvpr.tv iframe
 */

import React from 'react';
import { LivepeerPlayer as _LivepeerPlayer } from '@naap/plugin-sdk';
import { Tv, Loader2, Sparkles } from 'lucide-react';

// Cast to avoid React 18/19 ForwardRef JSX type mismatch
const LivepeerPlayer = _LivepeerPlayer as any;

interface OutputPlayerProps {
  playbackId: string | null;
  isStreaming: boolean;
}

export const OutputPlayer: React.FC<OutputPlayerProps> = ({ playbackId, isStreaming }) => {
  if (!playbackId) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="text-center">
          <div className="relative mb-6">
            <div className="w-24 h-24 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 flex items-center justify-center">
              <Tv className="w-12 h-12 text-gray-500" />
            </div>
            <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-purple-400 animate-pulse" />
          </div>
          
          <h2 className="text-2xl font-bold text-white mb-2">Ready to Transform</h2>
          <p className="text-gray-400 text-lg mb-1">Start your camera and hit Start</p>
          <p className="text-gray-500 text-sm">Your AI-transformed video will appear here</p>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-500/5 rounded-full blur-3xl" />
        </div>
      </div>
    );
  }

  // playbackId is guaranteed truthy here (returned early above when null)
  const isSubscribeUrl = playbackId.startsWith('http');
  const iframeSrc = `https://lvpr.tv/?v=${playbackId}&lowLatency=force`;

  return (
    <div className="relative w-full h-full bg-black">
      {isSubscribeUrl ? (
        <LivepeerPlayer
          subscribeUrl={playbackId}
          autoPlay
          className="absolute inset-0 w-full h-full"
          style={{ borderRadius: '0' }}
        />
      ) : (
        <iframe
          src={iframeSrc}
          allow="autoplay; fullscreen"
          className="absolute inset-0 w-full h-full"
          style={{ border: 'none' }}
          title="AI Video Output"
        />
      )}
      
      {/* Live indicator */}
      <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-red-600 rounded-full shadow-lg">
        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
        <span className="text-xs font-bold text-white tracking-wider">LIVE</span>
      </div>
    </div>
  );
};

export default OutputPlayer;
