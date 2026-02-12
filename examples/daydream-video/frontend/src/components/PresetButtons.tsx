/**
 * Preset Buttons - Quick effect presets
 */

import React from 'react';
import { Wand2, Palette, Cloud, Zap } from 'lucide-react';
import type { StreamParams } from './ParameterPanel';

interface PresetButtonsProps {
  onSelect: (preset: Partial<StreamParams>) => void;
  disabled?: boolean;
}

const PRESETS = [
  {
    id: 'anime',
    name: 'Anime Me',
    icon: Wand2,
    color: 'from-pink-500 to-purple-500',
    preset: {
      prompt: 'anime style, vibrant colors, detailed',
      negativePrompt: 'realistic, photo, blurry',
      seed: 42,
      controlnets: { pose: 0.3, edge: 0.2, canny: 0, depth: 0.4, color: 0.2 },
    },
  },
  {
    id: 'comic',
    name: 'Comic Book',
    icon: Palette,
    color: 'from-yellow-500 to-orange-500',
    preset: {
      prompt: 'comic book style, bold lines, dramatic',
      negativePrompt: 'realistic, photo, soft',
      seed: 123,
      controlnets: { pose: 0, edge: 0.4, canny: 0.5, depth: 0, color: 0.3 },
    },
  },
  {
    id: 'dream',
    name: 'Dream Mode',
    icon: Cloud,
    color: 'from-blue-500 to-cyan-500',
    preset: {
      prompt: 'dreamy, ethereal, soft glow, magical',
      negativePrompt: 'harsh, sharp, realistic',
      seed: 777,
      controlnets: { pose: 0, edge: 0.5, canny: 0, depth: 0.4, color: 0.2 },
    },
  },
  {
    id: 'neon',
    name: 'Neon Glow',
    icon: Zap,
    color: 'from-green-500 to-emerald-500',
    preset: {
      prompt: 'neon lights, cyberpunk, glowing, futuristic',
      negativePrompt: 'natural, soft, muted',
      seed: 2077,
      controlnets: { pose: 0, edge: 0.6, canny: 0.3, depth: 0, color: 0.1 },
    },
  },
];

export const PresetButtons: React.FC<PresetButtonsProps> = ({ onSelect, disabled = false }) => {
  return (
    <div className="flex gap-2 flex-wrap">
      {PRESETS.map((preset) => {
        const Icon = preset.icon;
        return (
          <button
            key={preset.id}
            onClick={() => onSelect(preset.preset)}
            disabled={disabled}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl
              bg-gradient-to-r ${preset.color}
              hover:scale-105 hover:shadow-lg
              transition-all duration-200
              disabled:opacity-50 disabled:hover:scale-100
              text-white font-medium text-sm
            `}
          >
            <Icon className="w-4 h-4" />
            {preset.name}
          </button>
        );
      })}
    </div>
  );
};

export default PresetButtons;
