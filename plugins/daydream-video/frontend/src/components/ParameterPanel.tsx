/**
 * Parameter Panel - Prompt, seed, and ControlNet controls
 */

import React from 'react';
import { Dices, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

export interface StreamParams {
  prompt: string;
  negativePrompt: string;
  seed: number;
  numInferenceSteps: number;
  controlnets: Record<string, number>;
}

interface ParameterPanelProps {
  params: StreamParams;
  onChange: (params: Partial<StreamParams>) => void;
  disabled?: boolean;
}

const CONTROLNET_INFO = [
  { name: 'pose', label: 'Pose', color: 'from-pink-500 to-rose-500', description: 'Body tracking' },
  { name: 'edge', label: 'Edge', color: 'from-purple-500 to-violet-500', description: 'Soft edges' },
  { name: 'canny', label: 'Canny', color: 'from-blue-500 to-cyan-500', description: 'Sharp edges' },
  { name: 'depth', label: 'Depth', color: 'from-green-500 to-emerald-500', description: '3D structure' },
  { name: 'color', label: 'Color', color: 'from-yellow-500 to-orange-500', description: 'Palette' },
];

export const ParameterPanel: React.FC<ParameterPanelProps> = ({
  params,
  onChange,
  disabled = false,
}) => {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const handleControlnetChange = (name: string, value: number) => {
    onChange({
      controlnets: {
        ...params.controlnets,
        [name]: value,
      },
    });
  };

  const randomizeSeed = () => {
    onChange({ seed: Math.floor(Math.random() * 100000) });
  };

  return (
    <div className="bg-gray-800/80 backdrop-blur-sm rounded-xl p-4 space-y-4">
      {/* Main Prompt */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium mb-2">
          <Sparkles className="w-4 h-4 text-accent-purple" />
          Transform into...
        </label>
        <input
          type="text"
          value={params.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="superman, anime character, neon glow..."
          disabled={disabled}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-lg focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
        />
      </div>

      {/* Seed with randomize */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Seed</label>
          <input
            type="number"
            value={params.seed}
            onChange={(e) => onChange({ seed: parseInt(e.target.value) || 42 })}
            disabled={disabled}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500 disabled:opacity-50"
          />
        </div>
        <button
          onClick={randomizeSeed}
          disabled={disabled}
          className="mt-6 p-3 bg-gradient-to-r from-accent-purple to-accent-pink rounded-xl hover:scale-105 transition-transform disabled:opacity-50"
          title="Randomize seed"
        >
          <Dices className="w-5 h-5" />
        </button>
      </div>

      {/* ControlNet Sliders */}
      <div className="space-y-3">
        <label className="text-sm font-medium">ControlNets</label>
        <div className="grid grid-cols-5 gap-2">
          {CONTROLNET_INFO.map((cn) => (
            <div key={cn.name} className="text-center">
              <div className="relative mb-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={(params.controlnets[cn.name] || 0) * 100}
                  onChange={(e) => handleControlnetChange(cn.name, parseInt(e.target.value) / 100)}
                  disabled={disabled}
                  className="w-full h-2 appearance-none rounded-full cursor-pointer disabled:opacity-50"
                  style={{
                    background: `linear-gradient(to right, ${cn.color.split(' ')[0].replace('from-', '')} ${(params.controlnets[cn.name] || 0) * 100}%, #374151 ${(params.controlnets[cn.name] || 0) * 100}%)`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-400">{cn.label}</span>
              <div className="text-xs font-mono text-primary-400">
                {Math.round((params.controlnets[cn.name] || 0) * 100)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Advanced Settings (Collapsible) */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Advanced Settings
      </button>

      {showAdvanced && (
        <div className="space-y-3 pt-2 border-t border-gray-700">
          <div>
            <label className="text-sm font-medium mb-1 block">Negative Prompt</label>
            <input
              type="text"
              value={params.negativePrompt}
              onChange={(e) => onChange({ negativePrompt: e.target.value })}
              placeholder="blurry, low quality, flat, 2d"
              disabled={disabled}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-primary-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">
              Quality (Inference Steps): {params.numInferenceSteps}
            </label>
            <input
              type="range"
              min="10"
              max="50"
              value={params.numInferenceSteps}
              onChange={(e) => onChange({ numInferenceSteps: parseInt(e.target.value) })}
              disabled={disabled}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ParameterPanel;
