import crypto from 'crypto';

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

export interface ApiKey {
  id: string;
  projectName: string;
  providerDisplayName: string;
  keyHash: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt: string | null;
}

export const models: AIModel[] = [
  { id: 'model-sd15', name: 'Stable Diffusion 1.5', tagline: 'Fast, lightweight image generation', type: 'text-to-video', featured: false, realtime: true, costPerMin: { min: 0.02, max: 0.05 }, latencyP50: 120, coldStart: 2000, fps: 24, useCases: ['Live streaming', 'Prototyping'], badges: ['Realtime'] },
  { id: 'model-sdxl', name: 'SDXL Turbo', tagline: 'High-quality video generation', type: 'text-to-video', featured: true, realtime: true, costPerMin: { min: 0.08, max: 0.15 }, latencyP50: 180, coldStart: 3500, fps: 30, useCases: ['Content creation', 'Marketing'], badges: ['Featured', 'Best Quality'] },
  { id: 'model-krea', name: 'Krea AI', tagline: 'Creative AI for unique visuals', type: 'text-to-video', featured: true, realtime: true, costPerMin: { min: 0.15, max: 0.30 }, latencyP50: 150, coldStart: 2500, fps: 30, useCases: ['Creative projects', 'Artistic content'], badges: ['Featured', 'Realtime'] },
];

export const apiKeys: ApiKey[] = [];

export function generateApiKey(): string {
  return `naap_${crypto.randomBytes(24).toString('hex')}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}
