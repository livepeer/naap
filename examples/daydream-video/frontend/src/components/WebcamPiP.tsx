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

  const pipSize = isExpanded 
    ? 'w-80 h-60' 
    : 'w-48 h-36';

  return (
    <div 
      className={`absolute top-4 left-4 ${pipSize} z-20 transition-all duration-300 ease-out`}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl border border-white/20">
        {stream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
            
            {/* Camera indicator */}
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/60 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-white font-medium">LIVE</span>
            </div>

            {/* Hover controls */}
            {showControls && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 transition-opacity">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                  title={isExpanded ? 'Minimize' : 'Expand'}
                >
                  {isExpanded ? (
                    <Minimize2 className="w-4 h-4 text-white" />
                  ) : (
                    <Maximize2 className="w-4 h-4 text-white" />
                  )}
                </button>
                
                {!disabled && (
                  <button
                    onClick={stopCamera}
                    className="p-2 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors"
                    title="Stop camera"
                  >
                    <CameraOff className="w-4 h-4 text-white" />
                  </button>
                )}

                {/* Camera selector */}
                {devices.length > 1 && !disabled && (
                  <select
                    value={selectedDevice}
                    onChange={(e) => {
                      setSelectedDevice(e.target.value);
                      if (stream) startCamera();
                    }}
                    className="px-2 py-1 bg-white/20 text-white text-xs rounded-lg border-none focus:outline-none"
                  >
                    {devices.map((device, i) => (
                      <option key={device.deviceId} value={device.deviceId} className="text-black">
                        {device.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full bg-gray-900 flex flex-col items-center justify-center gap-2">
            {isLoading ? (
              <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
            ) : (
              <>
                <CameraOff className="w-8 h-8 text-gray-600" />
                {permissionError && (
                  <span className="text-[9px] text-red-400 text-center px-2 leading-tight">{permissionError}</span>
                )}
                <button
                  onClick={startCamera}
                  disabled={disabled}
                  className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                >
                  <Camera className="w-3 h-3 inline mr-1" />
                  {permissionError ? 'Retry' : 'Start Camera'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WebcamPiP;
