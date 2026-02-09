/**
 * Developer API Static Data
 * Models and gateway offers are static/reference data
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
  gatewayCount: number;
  useCases: string[];
  badges: string[];
}

export interface GatewayOffer {
  gatewayId: string;
  gatewayName: string;
  price: number;
  latency: number;
  availability: number;
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
    gatewayCount: 8,
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
    gatewayCount: 12,
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
    gatewayCount: 10,
    useCases: ['Creative projects', 'Artistic content'],
    badges: ['Featured', 'Realtime'],
  },
];

export const gatewayOffers: Record<string, GatewayOffer[]> = {
  'model-sd15': [
    { gatewayId: 'gw-1', gatewayName: 'Gateway Alpha', price: 0.02, latency: 120, availability: 99.9 },
    { gatewayId: 'gw-2', gatewayName: 'Gateway Beta', price: 0.03, latency: 100, availability: 99.5 },
  ],
  'model-sdxl': [
    { gatewayId: 'gw-1', gatewayName: 'Gateway Alpha', price: 0.08, latency: 180, availability: 99.9 },
    { gatewayId: 'gw-3', gatewayName: 'Gateway Gamma', price: 0.10, latency: 160, availability: 99.8 },
  ],
  'model-krea': [
    { gatewayId: 'gw-1', gatewayName: 'Gateway Alpha', price: 0.15, latency: 150, availability: 99.9 },
  ],
};

export function getModel(id: string): AIModel | undefined {
  return models.find(m => m.id === id);
}

export function getGatewayOffers(modelId: string): GatewayOffer[] {
  return gatewayOffers[modelId] || [];
}

export function getGatewayOffer(modelId: string, gatewayId: string): GatewayOffer | undefined {
  return getGatewayOffers(modelId).find(g => g.gatewayId === gatewayId);
}
