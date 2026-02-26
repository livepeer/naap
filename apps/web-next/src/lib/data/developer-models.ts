/**
 * Developer API Static Data
 * Models are static/reference data
 */

export interface AIModel {
  id: string;
  name: string;
  tagline: string;
  type: string;
  featured: boolean;
  realtime: boolean;
  costPerMin: { min: number; max: number };
  latencyP50: number;
  coldStart: number;
  fps: number;
  useCases: string[];
  badges: string[];
}

export const models: AIModel[] = [
  {
    id: 'model-sd15',
    name: 'Stable Diffusion 1.5',
    tagline: 'Fast, lightweight image generation',
    type: 'text-to-video',
    featured: false,
    realtime: true,
    costPerMin: { min: 0.02, max: 0.05 },
    latencyP50: 120,
    coldStart: 2000,
    fps: 24,
    useCases: ['Live streaming', 'Prototyping'],
    badges: ['Realtime'],
  },
  {
    id: 'model-sdxl',
    name: 'SDXL Turbo',
    tagline: 'High-quality video generation',
    type: 'text-to-video',
    featured: true,
    realtime: true,
    costPerMin: { min: 0.08, max: 0.15 },
    latencyP50: 180,
    coldStart: 3500,
    fps: 30,
    useCases: ['Content creation', 'Marketing'],
    badges: ['Featured', 'Best Quality'],
  },
  {
    id: 'model-krea',
    name: 'Krea AI',
    tagline: 'Creative AI for unique visuals',
    type: 'text-to-video',
    featured: true,
    realtime: true,
    costPerMin: { min: 0.15, max: 0.30 },
    latencyP50: 150,
    coldStart: 2500,
    fps: 30,
    useCases: ['Creative projects', 'Artistic content'],
    badges: ['Featured', 'Realtime'],
  },
];

export function getModel(id: string): AIModel | undefined {
  return models.find(m => m.id === id);
}
