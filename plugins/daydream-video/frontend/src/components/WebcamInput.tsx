/**
 * Webcam Input - Camera selector and local preview
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';

interface WebcamInputProps {
  stream: MediaStream | null;
  onStreamChange: (stream: MediaStream | null) => void;
  disabled?: boolean;
}

export const WebcamInput: React.FC<WebcamInputProps> = ({
  stream,
  onStreamChange,
  disabled = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Enumerate available cameras
  useEffect(() => {
    const getDevices = async () => {
      try {
        // First request permission to access cameras
        await navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => {
            stream.getTracks().forEach(track => track.stop());
          });

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoDevices);

        if (videoDevices.length > 0 && !selectedDevice) {
          setSelectedDevice(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to enumerate devices:', err);
        setError('Camera access denied');
      }
    };

    getDevices();
  }, []);

  // Update video element when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const startCamera = useCallback(async () => {
    if (!selectedDevice) return;

    setIsLoading(true);
    setError(null);

    try {
      // Stop existing stream
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: selectedDevice },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      onStreamChange(newStream);
    } catch (err) {
      console.error('Failed to start camera:', err);
      setError('Failed to access camera');
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

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDevice(deviceId);
    if (stream) {
      // Restart with new device
      startCamera();
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Video Preview */}
      <div className="relative flex-1 bg-gray-900 rounded-xl overflow-hidden">
        {stream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" // Mirrored
            />
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1 bg-black/60 rounded-full">
              <Camera className="w-4 h-4 text-green-400" />
              <span className="text-xs text-white">Your Camera</span>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <CameraOff className="w-16 h-16 text-gray-600 mb-4" />
            <p className="text-gray-400">Camera not active</p>
            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-3 flex items-center gap-2">
        <select
          value={selectedDevice}
          onChange={(e) => handleDeviceChange(e.target.value)}
          disabled={disabled || devices.length === 0}
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-primary-500 disabled:opacity-50"
        >
          {devices.length === 0 ? (
            <option>No cameras found</option>
          ) : (
            devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${devices.indexOf(device) + 1}`}
              </option>
            ))
          )}
        </select>

        {stream ? (
          <button
            onClick={stopCamera}
            disabled={disabled}
            className="p-2 bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50"
            title="Stop camera"
          >
            <CameraOff className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={startCamera}
            disabled={disabled || !selectedDevice || isLoading}
            className="p-2 bg-green-600 hover:bg-green-500 rounded-lg transition-colors disabled:opacity-50"
            title="Start camera"
          >
            {isLoading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Camera className="w-5 h-5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default WebcamInput;
