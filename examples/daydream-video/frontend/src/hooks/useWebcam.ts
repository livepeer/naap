/**
 * useWebcam - Camera enumeration and stream management hook
 */

import { useState, useEffect, useCallback } from 'react';

export interface UseWebcamResult {
  devices: MediaDeviceInfo[];
  selectedDevice: string;
  stream: MediaStream | null;
  isLoading: boolean;
  error: string | null;
  selectDevice: (deviceId: string) => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

export function useWebcam(): UseWebcamResult {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enumerate available cameras
  useEffect(() => {
    const getDevices = async () => {
      try {
        // First request permission to access cameras
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop());

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoDevices);

        if (videoDevices.length > 0 && !selectedDevice) {
          setSelectedDevice(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error('Failed to enumerate devices:', err);
        setError('Camera access denied. Please allow camera access.');
      }
    };

    getDevices();

    // Listen for device changes (camera connected/disconnected)
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, []);

  const startCamera = useCallback(async () => {
    if (!selectedDevice) {
      setError('No camera selected');
      return;
    }

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
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });

      setStream(newStream);
    } catch (err) {
      console.error('Failed to start camera:', err);
      setError('Failed to access camera. Please check permissions.');
      setStream(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice, stream]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDevice(deviceId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    devices,
    selectedDevice,
    stream,
    isLoading,
    error,
    selectDevice,
    startCamera,
    stopCamera,
  };
}

export default useWebcam;
