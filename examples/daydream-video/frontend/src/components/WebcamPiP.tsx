/**
 * WebcamPiP - Compact Picture-in-Picture webcam overlay
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CameraOff, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';

interface WebcamPiPProps {
  stream: MediaStream | null;
  onStreamChange: (stream: MediaStream | null) => void;
  disabled?: boolean;
}

export const WebcamPiP: React.FC<WebcamPiPProps> = ({
  stream,
  onStreamChange,
  disabled = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Enumerate available cameras -- deferred until user interaction
  // to avoid Permissions-Policy violation on client-side navigation
  const enumerateCameras = useCallback(async () => {
    try {
      setPermissionError(null);
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(track => track.stop());

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
      setDevices(videoDevices);
      setCameraReady(true);

      if (videoDevices.length > 0 && !selectedDevice) {
        setSelectedDevice(videoDevices[0].deviceId);
      }
    } catch (err: any) {
      console.warn('Camera access not available:', err?.message || err);
      if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission')) {
        setPermissionError('Camera access denied. Try refreshing the page.');
      } else {
        setPermissionError('No camera available.');
      }
    }
  }, [selectedDevice]);

  // Try to enumerate cameras on mount, but don't crash if it fails
  useEffect(() => {
    // Use a small delay to allow Permissions-Policy to take effect
    // after client-side navigation
    const timer = setTimeout(() => {
      enumerateCameras();
    }, 500);
    return () => clearTimeout(timer);
  }, [enumerateCameras]);

  // Update video element when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setPermissionError(null);

    try {
      // If no device selected yet, request permission and enumerate first
      if (!selectedDevice) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
          tempStream.getTracks().forEach(track => track.stop());

          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
          setDevices(videoDevices);
          setCameraReady(true);

          if (videoDevices.length === 0) {
            setPermissionError('No camera found.');
            setIsLoading(false);
            return;
          }

          // Use the first device
          const deviceId = videoDevices[0].deviceId;
          setSelectedDevice(deviceId);

          // Now open the camera with that device
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
          onStreamChange(newStream);
          setIsLoading(false);
          return;
        } catch (err: any) {
          console.warn('Camera permission request failed:', err?.message || err);
          if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission')) {
            setPermissionError('Camera access denied. Please allow camera access and try again.');
          } else {
            setPermissionError('No camera available.');
          }
          setIsLoading(false);
          return;
        }
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: selectedDevice },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      onStreamChange(newStream);
    } catch (err) {
      console.error('Failed to start camera:', err);
      onStreamChange(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice, stream, onStreamChange]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      onStreamChange(null);
    }
  }, [stream, onStreamChange]);

  // Auto-start camera when device is selected
  useEffect(() => {
    if (selectedDevice && !stream && !disabled) {
      startCamera();
    }
  }, [selectedDevice]);

  const pipDims = isExpanded
    ? { width: 256, height: 192 }
    : { width: 160, height: 120 };

  return (
    <div
      className={`transition-all duration-500 ease-in-out flex-shrink-0 group/pip ${stream ? 'shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'shadow-2xl'}`}
      style={{
        width: pipDims.width,
        height: pipDims.height,
        borderRadius: '24px',
        padding: '3px',
        background: stream 
          ? 'linear-gradient(135deg, rgba(34,197,94,0.5), rgba(34,197,94,0.1))' 
          : 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05))'
      }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <div className="relative w-full h-full rounded-[21px] overflow-hidden bg-gray-900 border border-black/20">
        {stream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1] transition-transform duration-700 group-hover/pip:scale-105"
            />

            {/* Status Overlay */}
            <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
              <span className="text-[10px] text-white font-bold tracking-tight">SOURCE</span>
            </div>

            {/* Hover Controls — Refined */}
            <div className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center gap-2 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all active:scale-90"
                title={isExpanded ? 'Minimize' : 'Expand'}
              >
                {isExpanded ? <Minimize2 className="w-4 h-4 text-white" /> : <Maximize2 className="w-4 h-4 text-white" />}
              </button>

              {!disabled && (
                <button
                  onClick={stopCamera}
                  className="p-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 rounded-xl transition-all active:scale-90"
                  title="Stop Camera"
                >
                  <CameraOff className="w-4 h-4 text-white" />
                </button>
              )}

              {devices.length > 1 && !disabled && (
                <select
                  value={selectedDevice}
                  onChange={(e) => {
                    setSelectedDevice(e.target.value);
                    if (stream) startCamera();
                  }}
                  className="px-2 py-1 bg-black/40 text-white text-[10px] rounded-lg border border-white/10 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                >
                  {devices.map((device, i) => (
                    <option key={device.deviceId} value={device.deviceId} className="text-black">
                      {device.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-gray-800 to-gray-900">
            <div className="p-3 bg-white/5 rounded-full">
              <CameraOff className="w-6 h-6 text-gray-500" />
            </div>
            {isLoading ? (
              <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />
            ) : (
              <button
                onClick={startCamera}
                disabled={disabled}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded-full transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {permissionError ? 'Retry Access' : 'Enable Camera'}
              </button>
            )}
            {permissionError && (
              <span className="text-[8px] text-red-400 text-center px-4 leading-tight opacity-80">{permissionError}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WebcamPiP;
