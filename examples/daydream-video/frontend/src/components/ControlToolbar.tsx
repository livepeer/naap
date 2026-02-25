/**
 * ControlToolbar - Bottom dock control panel for stream controls
 *
 * Two-row layout:
 *  Row 1: Full-width prompt input
 *  Row 2: Status | Model | Seed | Presets | ControlNet | Settings | Timer | Start/Stop
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Square, Dices, Sparkles, ChevronUp, ChevronDown,
  Settings, Sliders, Box, Clock, Wifi, WifiOff, RefreshCw,
  AlertCircle, X,
} from 'lucide-react';
import { getModels, ModelInfo } from '../lib/api';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface StreamParams {
  prompt: string;
  modelId: string;
  negativePrompt: string;
  seed: number;
  numInferenceSteps: number;
  controlnets: Record<string, number>;
}

interface ControlToolbarProps {
  params: StreamParams;
  onChange: (params: Partial<StreamParams>) => void;
  onStart: () => void;
  onStop: () => void;
  isStreaming: boolean;
  canStart: boolean;
  onSettingsClick: () => void;
  status: ConnectionStatus;
  elapsedTime: string;
  sessionActive: boolean;
  error: string | null;
  onErrorDismiss: () => void;
  statusMessage: string | null;
}

const CONTROLNET_INFO = [
  { name: 'pose', label: 'Pose', emoji: '🕺' },
  { name: 'edge', label: 'Edge', emoji: '✏️' },
  { name: 'canny', label: 'Canny', emoji: '📐' },
  { name: 'depth', label: 'Depth', emoji: '🌊' },
  { name: 'color', label: 'Color', emoji: '🎨' },
];

const PRESETS: Array<{ id: string; name: string; emoji: string; prompt: string; controlnets: Record<string, number> }> = [
  { id: 'anime', name: 'Anime Me', emoji: '🎭', prompt: 'anime style, vibrant colors', controlnets: { pose: 0.3, edge: 0, canny: 0, depth: 0.4, color: 0.2 } },
  { id: 'comic', name: 'Comic Book', emoji: '💥', prompt: 'comic book style, bold lines', controlnets: { pose: 0, edge: 0.4, canny: 0.5, depth: 0, color: 0.3 } },
  { id: 'dream', name: 'Dream Mode', emoji: '✨', prompt: 'dreamy, ethereal, magical', controlnets: { pose: 0, edge: 0.5, canny: 0, depth: 0.4, color: 0.2 } },
  { id: 'neon', name: 'Neon Glow', emoji: '🌈', prompt: 'neon lights, cyberpunk', controlnets: { pose: 0, edge: 0.6, canny: 0.3, depth: 0, color: 0 } },
];

export const ControlToolbar: React.FC<ControlToolbarProps> = ({
  params,
  onChange,
  onStart,
  onStop,
  isStreaming,
  canStart,
  onSettingsClick,
  status,
  elapsedTime,
  sessionActive,
  error,
  onErrorDismiss,
  statusMessage,
}) => {
  const [showSliders, setShowSliders] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Local prompt state for debounced updates
  const [localPrompt, setLocalPrompt] = useState(params.prompt);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local prompt with params when params change externally
  useEffect(() => {
    setLocalPrompt(params.prompt);
  }, [params.prompt]);

  // Debounced prompt update
  const debouncedPromptUpdate = useCallback((value: string) => {
    console.log('[ControlToolbar] debouncedPromptUpdate scheduled for:', value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      console.log('[ControlToolbar] Debounce timer fired, calling onChange with:', value);
      onChange({ prompt: value });
    }, 500); // 500ms debounce
  }, [onChange]);

  // Handle prompt input change
  const handlePromptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    console.log('[ControlToolbar] handlePromptChange called, value:', value);
    setLocalPrompt(value);
    debouncedPromptUpdate(value);
  };

  // Handle Enter key - immediate submit
  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    console.log('[ControlToolbar] handlePromptKeyDown called, key:', e.key);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      console.log('[ControlToolbar] Enter pressed, calling onChange with prompt:', localPrompt);
      onChange({ prompt: localPrompt });
    }
  };

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Default models fallback
  const DEFAULT_MODELS: ModelInfo[] = [
    { id: 'stabilityai/sd-turbo', name: 'SD Turbo', description: 'Fast SD model' },
    { id: 'stabilityai/sdxl-turbo', name: 'SDXL Turbo', description: 'High quality SDXL' },
  ];

  useEffect(() => {
    const loadModels = async () => {
      try {
        const data = await getModels();
        if (data && data.length > 0) {
          setModels(data);
        } else {
          setModels(DEFAULT_MODELS);
        }
      } catch (err) {
        // Use fallback models if backend not available
        console.log('[ControlToolbar] Using default models (backend not ready)');
        setModels(DEFAULT_MODELS);
      }
    };
    loadModels();
  }, []);

  const randomizeSeed = () => {
    onChange({ seed: Math.floor(Math.random() * 100000) });
  };

  const handleControlnetChange = (name: string, value: number) => {
    onChange({
      controlnets: {
        ...params.controlnets,
        [name]: value,
      },
    });
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    onChange({
      prompt: preset.prompt,
      controlnets: { ...params.controlnets, ...preset.controlnets },
    });
    setShowPresets(false);
  };

  const applyModel = (modelId: string) => {
    onChange({ modelId });
    setShowModels(false);
  };

  const statusPill = (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800/80 rounded-lg border border-gray-700/50">
      {status === 'connected' ? (
        <>
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <Wifi className="w-3.5 h-3.5 text-green-400" />
        </>
      ) : status === 'connecting' ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
          <span className="text-xs text-yellow-400">Connecting</span>
        </>
      ) : status === 'error' ? (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs text-red-400">Error</span>
        </>
      ) : (
        <>
          <div className="w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-xs text-gray-400">Ready</span>
        </>
      )}
    </div>
  );

  return (
    <div className="w-full z-30">
      {/* Inline error / status toast — now grounded above the console */}
      {(error || statusMessage) && (
        <div className="absolute bottom-full left-0 right-0 px-4 pb-4 flex justify-center pointer-events-none">
          {error ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/90 backdrop-blur-md rounded-full shadow-lg border border-red-400/20 pointer-events-auto animate-in fade-in slide-in-from-bottom-2">
              <AlertCircle className="w-4 h-4 text-white flex-shrink-0" />
              <span className="text-white text-sm font-medium">{error}</span>
              <button onClick={onErrorDismiss} className="ml-1 p-0.5 hover:bg-white/20 rounded-full transition-colors">
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600/90 backdrop-blur-md rounded-full shadow-lg border border-blue-400/20 pointer-events-auto animate-in fade-in slide-in-from-bottom-2">
              <Sparkles className="w-4 h-4 text-white animate-pulse" />
              <span className="text-white text-sm font-medium">{statusMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* ControlNet sliders panel — anchored to bottom console */}
      {showSliders && (
        <div className="mx-4 mb-2 p-5 bg-[#111] backdrop-blur-2xl rounded-2xl border border-white/5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-white uppercase tracking-wider">ControlNets</span>
            </div>
            <button onClick={() => setShowSliders(false)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="grid grid-cols-5 gap-6">
            {CONTROLNET_INFO.map((cn) => (
              <div key={cn.name} className="flex flex-col items-center">
                <div className="text-2xl mb-2">{cn.emoji}</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={(params.controlnets[cn.name] || 0) * 100}
                  onChange={(e) => handleControlnetChange(cn.name, parseInt(e.target.value) / 100)}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-purple-500"
                  style={{
                    background: `linear-gradient(to right, #8b5cf6 ${(params.controlnets[cn.name] || 0) * 100}%, #374151 ${(params.controlnets[cn.name] || 0) * 100}%)`,
                  }}
                />
                <div className="flex flex-col items-center mt-2">
                  <span className="text-[10px] font-bold text-gray-500 uppercase">{cn.label}</span>
                  <span className="text-xs font-mono text-purple-400">
                    {Math.round((params.controlnets[cn.name] || 0) * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-4 border-t border-white/5 grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Negative Prompt</label>
              <input
                type="text"
                value={params.negativePrompt}
                onChange={(e) => onChange({ negativePrompt: e.target.value })}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50 transition-all"
                placeholder="Avoid: blurry, low quality..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block flex justify-between">
                <span>Inference Steps</span>
                <span className="text-purple-400">{params.numInferenceSteps}</span>
              </label>
              <input
                type="range"
                min="1"
                max="4"
                value={params.numInferenceSteps}
                onChange={(e) => onChange({ numInferenceSteps: parseInt(e.target.value) })}
                className="w-full h-1.5 mt-3"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Grounded Console */}
      <div className="p-4 bg-[#0a0a0a] border-t border-white/5 flex flex-col gap-4">
        {/* Row 1: The Prompt Control */}
        <div className="flex items-center gap-4">
          <div className="flex-1 relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Sparkles className="w-5 h-5 text-purple-400 group-focus-within:animate-pulse" />
            </div>
            <input
              type="text"
              value={localPrompt}
              onChange={handlePromptChange}
              onKeyDown={handlePromptKeyDown}
              placeholder="Describe your transformation... (e.g., superhero, neon anime)"
              className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-lg text-white placeholder:text-gray-500 focus:outline-none focus:bg-white/10 focus:border-purple-500/30 transition-all"
            />
            <div className="absolute right-4 inset-y-0 flex items-center">
              <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-xs font-semibold text-gray-500 bg-white/5 border border-white/10 rounded-md uppercase tracking-tighter">
                Enter ↵
              </kbd>
            </div>
          </div>

          {/* Primary Action Button — now part of the prompt row for quick start */}
          {isStreaming ? (
            <button
              onClick={onStop}
              className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-bold shadow-[0_0_30px_rgba(220,38,38,0.2)] transition-all active:scale-95 flex items-center gap-3 h-full min-w-[180px] justify-center"
            >
              <Square className="w-5 h-5 fill-current" />
              <span>Stop AI</span>
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={!canStart}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-2xl font-bold shadow-[0_0_30px_rgba(139,92,246,0.2)] transition-all active:scale-95 disabled:opacity-30 disabled:grayscale flex items-center gap-3 h-full min-w-[180px] justify-center"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Go Live</span>
            </button>
          )}
        </div>

        {/* Row 2: Tool Strip */}
        <div className="flex items-center gap-2">
          {/* Status Badge */}
          <div className="flex-shrink-0">
            {statusPill}
          </div>

          <div className="w-px h-6 bg-white/10 mx-2" />

          {/* Model Selector */}
          <div className="relative">
            <button
              onClick={() => { setShowModels(!showModels); setShowPresets(false); }}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all ${showModels ? 'bg-purple-600/20 text-purple-300 ring-1 ring-purple-500/50' : 'hover:bg-white/5 text-gray-400'}`}
            >
              <Box className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium truncate max-w-[120px]">
                {models.find(m => m.id === params.modelId)?.name || 'Model'}
              </span>
              <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${showModels ? 'rotate-0' : 'rotate-180'}`} />
            </button>
            {showModels && (
              <div className="absolute bottom-full mb-4 left-0 w-72 bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="px-5 py-3 border-b border-white/5 bg-white/5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Select Intelligence</span>
                </div>
                <div className="max-h-64 overflow-y-auto py-2">
                  {models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => applyModel(model.id)}
                      className={`w-full px-5 py-3 text-left hover:bg-white/5 transition-all flex flex-col gap-0.5 ${params.modelId === model.id ? 'bg-purple-600/10 text-purple-300' : 'text-gray-400'}`}
                    >
                      <span className="text-sm font-semibold">{model.name}</span>
                      <span className="text-[10px] text-gray-500 line-clamp-1">{model.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Seed Panel */}
          <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-xl border border-white/5">
            <input
              type="number"
              value={params.seed}
              onChange={(e) => onChange({ seed: parseInt(e.target.value) || 42 })}
              className="w-[84px] bg-transparent text-center font-mono text-sm text-purple-300 focus:outline-none"
              title="Seed value"
            />
            <button
              onClick={randomizeSeed}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-all active:scale-90"
              title="Randomize"
            >
              <Dices className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Presets */}
          <div className="relative">
            <button
              onClick={() => { setShowPresets(!showPresets); setShowModels(false); }}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all ${showPresets ? 'bg-purple-600/20 text-purple-300 ring-1 ring-purple-500/50' : 'hover:bg-white/5 text-gray-400'}`}
            >
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-medium">Presets</span>
              <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${showPresets ? 'rotate-0' : 'rotate-180'}`} />
            </button>
            {showPresets && (
              <div className="absolute bottom-full mb-4 left-0 w-56 bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="p-2 grid grid-cols-1 gap-1">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className="w-full px-4 py-2.5 text-left hover:bg-white/5 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <span className="text-xl group-hover:scale-125 transition-transform">{preset.emoji}</span>
                      <span className="text-sm font-medium text-gray-300">{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ControlNet Toggle */}
          <button
            onClick={() => setShowSliders(!showSliders)}
            className={`p-2 rounded-xl transition-all ${
              showSliders
                ? 'bg-purple-600 text-white shadow-[0_0_20px_rgba(139,92,246,0.3)]'
                : 'hover:bg-white/5 text-gray-400'
            }`}
            title="Configure Effects"
          >
            <Sliders className="w-5 h-5" />
          </button>

          <div className="flex-1" />

          {/* Settings & Timer Info */}
          <div className="flex items-center gap-4">
            {sessionActive && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 rounded-lg border border-purple-500/10">
                <Clock className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                <span className="text-sm font-mono font-medium text-purple-300">{elapsedTime}</span>
              </div>
            )}
            <button
              onClick={onSettingsClick}
              className="p-2 hover:bg-white/5 rounded-xl transition-all text-gray-500 hover:text-gray-300"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ControlToolbar;
