import React, { useState, useRef, useEffect, useMemo } from 'react';

export interface ModelPreset {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  category: string;
  description: string;
  dockerImage?: string;
}

const MODEL_PRESETS: ModelPreset[] = [
  // --- fal.ai ---
  { id: 'fal-flux-dev', name: 'FLUX.1 Dev', provider: 'fal-ai', modelId: 'fal-ai/flux/dev', category: 'Image Generation', description: 'High-quality text-to-image, 12B params' },
  { id: 'fal-flux-schnell', name: 'FLUX.1 Schnell', provider: 'fal-ai', modelId: 'fal-ai/flux/schnell', category: 'Image Generation', description: 'Fast text-to-image, optimized for speed' },
  { id: 'fal-flux-pro', name: 'FLUX.1 Pro', provider: 'fal-ai', modelId: 'fal-ai/flux-pro', category: 'Image Generation', description: 'Best quality FLUX model' },
  { id: 'fal-sd3-medium', name: 'Stable Diffusion 3 Medium', provider: 'fal-ai', modelId: 'fal-ai/stable-diffusion-v3-medium', category: 'Image Generation', description: 'Stability AI SD3 medium model' },
  { id: 'fal-sdxl', name: 'Stable Diffusion XL', provider: 'fal-ai', modelId: 'fal-ai/fast-sdxl', category: 'Image Generation', description: 'Fast SDXL inference' },
  { id: 'fal-lcm-sdxl', name: 'LCM SDXL', provider: 'fal-ai', modelId: 'fal-ai/fast-lcm-diffusion', category: 'Image Generation', description: 'Ultra-fast LCM diffusion, 4 steps' },
  { id: 'fal-recraft-v3', name: 'Recraft V3', provider: 'fal-ai', modelId: 'fal-ai/recraft-v3', category: 'Image Generation', description: 'Vector and icon generation' },
  { id: 'fal-aura-flow', name: 'AuraFlow', provider: 'fal-ai', modelId: 'fal-ai/aura-flow', category: 'Image Generation', description: 'Open-source flow-based model' },
  { id: 'fal-whisper', name: 'Whisper Large V3', provider: 'fal-ai', modelId: 'fal-ai/whisper', category: 'Audio', description: 'Speech-to-text transcription' },
  { id: 'fal-f5-tts', name: 'F5 TTS', provider: 'fal-ai', modelId: 'fal-ai/f5-tts', category: 'Audio', description: 'Text-to-speech synthesis' },
  { id: 'fal-video-wan', name: 'Wan Video', provider: 'fal-ai', modelId: 'fal-ai/wan/v2.1/1.3b', category: 'Video', description: 'Text-to-video generation' },
  { id: 'fal-kling', name: 'Kling Video', provider: 'fal-ai', modelId: 'fal-ai/kling-video/v1/standard/text-to-video', category: 'Video', description: 'High-quality text-to-video' },
  { id: 'fal-sam2', name: 'SAM 2', provider: 'fal-ai', modelId: 'fal-ai/sam2', category: 'Vision', description: 'Segment Anything Model 2' },
  { id: 'fal-florence2', name: 'Florence 2', provider: 'fal-ai', modelId: 'fal-ai/florence-2-large', category: 'Vision', description: 'Image captioning and understanding' },
  // --- Replicate ---
  { id: 'rep-flux-dev', name: 'FLUX.1 Dev', provider: 'replicate', modelId: 'black-forest-labs/flux-dev', category: 'Image Generation', description: 'High-quality text-to-image, 12B params' },
  { id: 'rep-flux-schnell', name: 'FLUX.1 Schnell', provider: 'replicate', modelId: 'black-forest-labs/flux-schnell', category: 'Image Generation', description: 'Fast text-to-image' },
  { id: 'rep-sdxl', name: 'Stable Diffusion XL', provider: 'replicate', modelId: 'stability-ai/sdxl', category: 'Image Generation', description: 'Stability AI SDXL' },
  { id: 'rep-llama-3-1-405b', name: 'Llama 3.1 405B', provider: 'replicate', modelId: 'meta/meta-llama-3.1-405b-instruct', category: 'LLM', description: 'Meta Llama 3.1 largest model' },
  { id: 'rep-llama-3-1-70b', name: 'Llama 3.1 70B', provider: 'replicate', modelId: 'meta/meta-llama-3.1-70b-instruct', category: 'LLM', description: 'Meta Llama 3.1 70B instruct' },
  { id: 'rep-llama-3-1-8b', name: 'Llama 3.1 8B', provider: 'replicate', modelId: 'meta/meta-llama-3.1-8b-instruct', category: 'LLM', description: 'Meta Llama 3.1 8B, fast' },
  { id: 'rep-mixtral-8x7b', name: 'Mixtral 8x7B', provider: 'replicate', modelId: 'mistralai/mixtral-8x7b-instruct-v0.1', category: 'LLM', description: 'Mistral mixture-of-experts model' },
  { id: 'rep-whisper', name: 'Whisper Large V3', provider: 'replicate', modelId: 'openai/whisper', category: 'Audio', description: 'Speech-to-text transcription' },
  { id: 'rep-musicgen', name: 'MusicGen', provider: 'replicate', modelId: 'meta/musicgen', category: 'Audio', description: 'Music generation from text' },
  { id: 'rep-video-crafter', name: 'Stable Video Diffusion', provider: 'replicate', modelId: 'stability-ai/stable-video-diffusion', category: 'Video', description: 'Image-to-video generation' },
  { id: 'rep-codegeex', name: 'CodeGeeX4', provider: 'replicate', modelId: 'thudm/codegeex4-all-9b', category: 'Code', description: 'Code generation model' },
  { id: 'rep-esrgan', name: 'Real-ESRGAN', provider: 'replicate', modelId: 'nightmareai/real-esrgan', category: 'Image Enhancement', description: 'Image upscaling 4x' },
  // --- RunPod Serverless ---
  { id: 'rp-vllm-llama-3-1-70b', name: 'Llama 3.1 70B (vLLM)', provider: 'runpod', modelId: 'meta-llama/Llama-3.1-70B-Instruct', category: 'LLM', description: 'vLLM-served Llama 3.1 on RunPod' },
  { id: 'rp-vllm-llama-3-1-8b', name: 'Llama 3.1 8B (vLLM)', provider: 'runpod', modelId: 'meta-llama/Llama-3.1-8B-Instruct', category: 'LLM', description: 'Fast vLLM Llama 3.1 8B' },
  { id: 'rp-vllm-mistral-7b', name: 'Mistral 7B (vLLM)', provider: 'runpod', modelId: 'mistralai/Mistral-7B-Instruct-v0.3', category: 'LLM', description: 'Mistral 7B instruct on RunPod' },
  { id: 'rp-sdxl', name: 'Stable Diffusion XL', provider: 'runpod', modelId: 'stabilityai/stable-diffusion-xl-base-1.0', category: 'Image Generation', description: 'SDXL on RunPod serverless' },
  { id: 'rp-whisper', name: 'Whisper Large V3', provider: 'runpod', modelId: 'openai/whisper-large-v3', category: 'Audio', description: 'Speech-to-text on RunPod' },
  { id: 'rp-embeddings', name: 'BGE Large Embeddings', provider: 'runpod', modelId: 'BAAI/bge-large-en-v1.5', category: 'Embeddings', description: 'Text embeddings model' },
  // --- Self-hosted ---
  { id: 'self-tgi-llama-3-1-70b', name: 'Llama 3.1 70B (TGI)', provider: 'self-hosted', modelId: 'meta-llama/Llama-3.1-70B-Instruct', category: 'LLM', description: 'HuggingFace TGI, needs 80GB VRAM', dockerImage: 'ghcr.io/huggingface/text-generation-inference:latest' },
  { id: 'self-tgi-llama-3-1-8b', name: 'Llama 3.1 8B (TGI)', provider: 'self-hosted', modelId: 'meta-llama/Llama-3.1-8B-Instruct', category: 'LLM', description: 'HuggingFace TGI, needs 24GB VRAM', dockerImage: 'ghcr.io/huggingface/text-generation-inference:latest' },
  { id: 'self-tgi-mistral-7b', name: 'Mistral 7B (TGI)', provider: 'self-hosted', modelId: 'mistralai/Mistral-7B-Instruct-v0.3', category: 'LLM', description: 'HuggingFace TGI, needs 16GB VRAM', dockerImage: 'ghcr.io/huggingface/text-generation-inference:latest' },
  { id: 'self-vllm-llama-3-1-70b', name: 'Llama 3.1 70B (vLLM)', provider: 'self-hosted', modelId: 'meta-llama/Llama-3.1-70B-Instruct', category: 'LLM', description: 'vLLM server, needs 80GB VRAM', dockerImage: 'vllm/vllm-openai:latest' },
  { id: 'self-vllm-llama-3-1-8b', name: 'Llama 3.1 8B (vLLM)', provider: 'self-hosted', modelId: 'meta-llama/Llama-3.1-8B-Instruct', category: 'LLM', description: 'vLLM server, needs 24GB VRAM', dockerImage: 'vllm/vllm-openai:latest' },
  { id: 'self-comfyui', name: 'ComfyUI', provider: 'self-hosted', modelId: 'comfyui', category: 'Image Generation', description: 'Node-based image generation workflow', dockerImage: 'ghcr.io/ai-dock/comfyui:latest' },
  { id: 'self-whisper', name: 'Whisper Large V3', provider: 'self-hosted', modelId: 'openai/whisper-large-v3', category: 'Audio', description: 'Faster-whisper, needs 4GB VRAM', dockerImage: 'fedirz/faster-whisper-server:latest' },
  { id: 'self-sd-webui', name: 'Stable Diffusion WebUI', provider: 'self-hosted', modelId: 'stable-diffusion', category: 'Image Generation', description: 'AUTOMATIC1111 WebUI', dockerImage: 'ghcr.io/ai-dock/stable-diffusion-webui:latest' },
];

export function getPresetsForProvider(provider: string): ModelPreset[] {
  if (provider === 'fal-ai' || provider === 'replicate' || provider === 'runpod') {
    return MODEL_PRESETS.filter((p) => p.provider === provider);
  }
  return [];
}

export function getSelfHostedPresets(): ModelPreset[] {
  return MODEL_PRESETS.filter((p) => p.provider === 'self-hosted');
}

interface ModelPresetPickerProps {
  presets: ModelPreset[];
  value: string;
  onSelect: (preset: ModelPreset) => void;
  onCustomValue?: (value: string) => void;
  placeholder?: string;
}

export const ModelPresetPicker: React.FC<ModelPresetPickerProps> = ({
  presets,
  value,
  onSelect,
  onCustomValue,
  placeholder = 'Search models or type a custom ID...',
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      const preset = presets.find((p) => p.modelId === value);
      setQuery(preset ? preset.name : value);
    }
  }, [value, presets, open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return presets;
    const lower = query.toLowerCase();
    return presets.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.modelId.toLowerCase().includes(lower) ||
        p.category.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower),
    );
  }, [query, presets]);

  const grouped = useMemo(() => {
    const groups: Record<string, ModelPreset[]> = {};
    for (const p of filtered) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }, [filtered]);

  const flatList = useMemo(() => {
    const items: ModelPreset[] = [];
    for (const cat of Object.keys(grouped)) {
      items.push(...grouped[cat]);
    }
    return items;
  }, [grouped]);

  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx((prev) => Math.min(prev + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && flatList[highlightIdx]) {
      e.preventDefault();
      onSelect(flatList[highlightIdx]);
      setQuery(flatList[highlightIdx].name);
      setOpen(false);
      setHighlightIdx(-1);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlightIdx(-1);
    }
  };

  let flatIdx = -1;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlightIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          const matchedPreset = presets.find((p) => p.name === query || p.modelId === query);
          if (!matchedPreset && query.trim() && query !== value && onCustomValue) {
            onCustomValue(query.trim());
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        data-testid="model-preset-search"
        className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background box-border"
      />

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          data-testid="model-preset-dropdown"
          className="absolute top-full left-0 right-0 max-h-[320px] overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50 mt-1 p-1"
        >
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {category}
              </div>
              {items.map((preset) => {
                flatIdx++;
                const idx = flatIdx;
                return (
                  <div
                    key={preset.id}
                    data-idx={idx}
                    onClick={() => {
                      onSelect(preset);
                      setQuery(preset.name);
                      setOpen(false);
                    }}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`px-3 py-2 cursor-pointer rounded-md flex justify-between items-center gap-2 transition-colors ${
                      highlightIdx === idx ? 'bg-muted' : 'bg-transparent hover:bg-muted/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {preset.name}
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                        {preset.modelId}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {preset.description}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && filtered.length === 0 && query.trim() && (
        <div className="absolute top-full left-0 right-0 bg-card border border-border rounded-lg shadow-lg z-50 mt-1 p-3 text-sm text-muted-foreground">
          No presets match. Using custom model ID: <strong className="text-foreground">{query}</strong>
        </div>
      )}
    </div>
  );
};
