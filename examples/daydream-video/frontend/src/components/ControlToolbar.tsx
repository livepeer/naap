/**
 * ControlToolbar - Floating glassmorphism toolbar for stream controls
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Dices, Sparkles, ChevronUp, ChevronDown, Settings, Sliders, Box } from 'lucide-react';
import { getModels, ModelInfo } from '../lib/api';

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

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30">
      {/* Expanded sliders panel */}
      {showSliders && (
        <div className="mx-4 mb-2 p-4 bg-gray-900/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-300">ControlNets</span>
            <button
              onClick={() => setShowSliders(false)}
              className="text-gray-400 hover:text-white"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-5 gap-4">
            {CONTROLNET_INFO.map((cn) => (
              <div key={cn.name} className="text-center">
                <div className="text-lg mb-1">{cn.emoji}</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={(params.controlnets[cn.name] || 0) * 100}
                  onChange={(e) => handleControlnetChange(cn.name, parseInt(e.target.value) / 100)}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #8b5cf6 ${(params.controlnets[cn.name] || 0) * 100}%, #374151 ${(params.controlnets[cn.name] || 0) * 100}%)`,
                  }}
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-gray-400">{cn.label}</span>
                  <span className="text-[10px] font-mono text-purple-400">
                    {Math.round((params.controlnets[cn.name] || 0) * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          
          {/* Advanced settings */}
          <div className="mt-4 pt-3 border-t border-gray-700/50 grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Negative Prompt</label>
              <input
                type="text"
                value={params.negativePrompt}
                onChange={(e) => onChange({ negativePrompt: e.target.value })}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                placeholder="blurry, low quality..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Steps: {params.numInferenceSteps} (realtime: 1-4)</label>
              <input
                type="range"
                min="1"
                max="4"
                value={params.numInferenceSteps}
                onChange={(e) => onChange({ numInferenceSteps: parseInt(e.target.value) })}
                className="w-full h-1.5 mt-2"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main toolbar */}
      <div className="p-4 bg-gray-900/85 backdrop-blur-xl border-t border-white/10">
        <div className="flex items-center gap-3">
          {/* Prompt input */}
          <div className="flex-1 relative">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
            <input
              type="text"
              value={localPrompt}
              onChange={handlePromptChange}
              onKeyDown={handlePromptKeyDown}
              placeholder="Transform into... (e.g., superhero, anime, cyberpunk) - Press Enter to apply"
              className="w-full pl-10 pr-4 py-3 bg-gray-800/80 border border-gray-600 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
            />
          </div>

          {/* Model selection */}
          <div className="relative">
            <button
              onClick={() => {
                setShowModels(!showModels);
                setShowPresets(false);
              }}
              className="px-4 py-3 bg-gray-800/80 border border-gray-600 hover:border-purple-500 rounded-xl transition-colors flex items-center gap-2 min-w-[140px]"
              title="Select AI Model"
            >
              <Box className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-gray-300">
                {models.find(m => m.id === params.modelId)?.name || 'Select Model'}
              </span>
              {showModels ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            
            {showModels && (
              <div className="absolute bottom-full mb-2 right-0 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-700">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Inference Models</span>
                </div>
                {models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => applyModel(model.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-800 transition-colors flex flex-col ${params.modelId === model.id ? 'bg-purple-900/30' : ''}`}
                  >
                    <span className="text-sm font-medium text-white">{model.name}</span>
                    <span className="text-[10px] text-gray-400">{model.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Seed with randomize */}
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={params.seed}
              onChange={(e) => onChange({ seed: parseInt(e.target.value) || 42 })}
              className="w-20 px-3 py-3 bg-gray-800/80 border border-gray-600 rounded-xl text-white text-center font-mono text-sm focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={randomizeSeed}
              className="p-3 bg-purple-600 hover:bg-purple-500 rounded-xl transition-all hover:scale-105"
              title="Randomize seed"
            >
              <Dices className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Presets dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowPresets(!showPresets);
                setShowModels(false);
              }}
              className="px-4 py-3 bg-gray-800/80 border border-gray-600 hover:border-purple-500 rounded-xl transition-colors flex items-center gap-2"
            >
              <span className="text-sm text-gray-300">Presets</span>
              {showPresets ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            
            {showPresets && (
              <div className="absolute bottom-full mb-2 right-0 w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-800 transition-colors flex items-center gap-2"
                  >
                    <span>{preset.emoji}</span>
                    <span className="text-sm text-white">{preset.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ControlNet toggle */}
          <button
            onClick={() => setShowSliders(!showSliders)}
            className={`p-3 rounded-xl transition-all ${
              showSliders 
                ? 'bg-purple-600 text-white' 
                : 'bg-gray-800/80 border border-gray-600 text-gray-300 hover:border-purple-500'
            }`}
            title="ControlNet sliders"
          >
            <Sliders className="w-5 h-5" />
          </button>

          {/* Settings */}
          <button
            onClick={onSettingsClick}
            className="p-3 bg-gray-800/80 border border-gray-600 hover:border-gray-500 rounded-xl transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5 text-gray-400" />
          </button>

          {/* Start/Stop button */}
          {isStreaming ? (
            <button
              onClick={onStop}
              className="px-6 py-3 bg-red-600 hover:bg-red-500 rounded-xl transition-all flex items-center gap-2 font-medium"
            >
              <Square className="w-5 h-5" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={!canStart}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl transition-all flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 disabled:hover:scale-100"
            >
              <Play className="w-5 h-5" />
              <span>Start</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ControlToolbar;
