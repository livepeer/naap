import type { AIModel, GatewayOffer, DeveloperApiKey, UsageRecord, Invoice } from '@naap/types';

// In-memory store for development - ready to be replaced with Prisma later

// AI Models data
export const models: AIModel[] = [
  {
    id: 'model-sd15',
    name: 'Stable Diffusion 1.5',
    tagline: 'Fast, lightweight image generation for real-time applications',
    type: 'text-to-video',
    featured: false,
    realtime: true,
    costPerMin: { min: 0.02, max: 0.05 },
    latencyP50: 120,
    coldStart: 2000,
    fps: 24,
    gatewayCount: 8,
    useCases: ['Live streaming effects', 'Interactive applications', 'Prototyping'],
    badges: ['Realtime', 'Low-cost'],
  },
  {
    id: 'model-sdxl',
    name: 'SDXL Turbo',
    tagline: 'High-quality video generation with excellent detail',
    type: 'text-to-video',
    featured: true,
    realtime: true,
    costPerMin: { min: 0.08, max: 0.15 },
    latencyP50: 180,
    coldStart: 3500,
    fps: 30,
    gatewayCount: 12,
    useCases: ['Content creation', 'Marketing videos', 'Social media'],
    badges: ['Featured', 'Best Quality', 'Realtime'],
  },
  {
    id: 'model-longlive',
    name: 'LongLive',
    tagline: 'Extended video sequences with temporal consistency',
    type: 'image-to-video',
    featured: true,
    realtime: false,
    costPerMin: { min: 0.12, max: 0.25 },
    latencyP50: 450,
    coldStart: 5000,
    fps: 24,
    gatewayCount: 6,
    useCases: ['Long-form content', 'Animation', 'Film production'],
    badges: ['Featured', 'High-quality'],
  },
  {
    id: 'model-vace',
    name: 'VACE',
    tagline: 'Video-to-video transformation with style transfer',
    type: 'video-to-video',
    featured: false,
    realtime: true,
    costPerMin: { min: 0.10, max: 0.20 },
    latencyP50: 200,
    coldStart: 4000,
    fps: 30,
    gatewayCount: 5,
    useCases: ['Style transfer', 'Video enhancement', 'Effects'],
    badges: ['Realtime'],
  },
  {
    id: 'model-krea',
    name: 'Krea AI',
    tagline: 'Creative AI for unique visual experiences',
    type: 'text-to-video',
    featured: true,
    realtime: true,
    costPerMin: { min: 0.15, max: 0.30 },
    latencyP50: 150,
    coldStart: 2500,
    fps: 30,
    gatewayCount: 10,
    useCases: ['Creative projects', 'Artistic content', 'Experimental'],
    badges: ['Featured', 'Realtime', 'Best Quality'],
  },
  {
    id: 'model-cogvideo',
    name: 'CogVideoX',
    tagline: 'Advanced video generation with superior motion',
    type: 'text-to-video',
    featured: false,
    realtime: false,
    costPerMin: { min: 0.20, max: 0.40 },
    latencyP50: 800,
    coldStart: 8000,
    fps: 24,
    gatewayCount: 4,
    useCases: ['Cinema-quality', 'Professional production', 'VFX'],
    badges: ['Best Quality'],
  },
];

// Gateway offers per model
export const gatewayOffers: Record<string, GatewayOffer[]> = {
  'model-sd15': [
    { gatewayId: 'gw-1', gatewayName: 'Livepeer Studio', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 100, unitPrice: 0.02, regions: ['US-East', 'EU-West'], capacity: 'high' },
    { gatewayId: 'gw-2', gatewayName: 'Decentralized AI Labs', slaTier: 'silver', uptimeGuarantee: 99.9, latencyGuarantee: 150, unitPrice: 0.025, regions: ['EU-West'], capacity: 'medium' },
    { gatewayId: 'gw-4', gatewayName: 'Render Core', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 80, unitPrice: 0.03, regions: ['US-West', 'US-East'], capacity: 'high' },
  ],
  'model-sdxl': [
    { gatewayId: 'gw-1', gatewayName: 'Livepeer Studio', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 150, unitPrice: 0.08, regions: ['US-East', 'EU-West', 'Asia-Pacific'], capacity: 'high' },
    { gatewayId: 'gw-2', gatewayName: 'Decentralized AI Labs', slaTier: 'silver', uptimeGuarantee: 99.9, latencyGuarantee: 200, unitPrice: 0.09, regions: ['EU-West'], capacity: 'medium' },
    { gatewayId: 'gw-3', gatewayName: 'GPU Pool Network', slaTier: 'bronze', uptimeGuarantee: 99.5, latencyGuarantee: 250, unitPrice: 0.085, regions: ['Asia-Pacific'], capacity: 'low' },
    { gatewayId: 'gw-4', gatewayName: 'Render Core', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 120, unitPrice: 0.10, regions: ['US-West', 'US-East'], capacity: 'high' },
  ],
  'model-longlive': [
    { gatewayId: 'gw-1', gatewayName: 'Livepeer Studio', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 400, unitPrice: 0.12, regions: ['US-East'], capacity: 'medium' },
    { gatewayId: 'gw-4', gatewayName: 'Render Core', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 350, unitPrice: 0.15, regions: ['US-West'], capacity: 'high' },
  ],
  'model-vace': [
    { gatewayId: 'gw-1', gatewayName: 'Livepeer Studio', slaTier: 'silver', uptimeGuarantee: 99.9, latencyGuarantee: 200, unitPrice: 0.10, regions: ['US-East'], capacity: 'medium' },
    { gatewayId: 'gw-2', gatewayName: 'Decentralized AI Labs', slaTier: 'silver', uptimeGuarantee: 99.9, latencyGuarantee: 220, unitPrice: 0.11, regions: ['EU-West'], capacity: 'medium' },
  ],
  'model-krea': [
    { gatewayId: 'gw-1', gatewayName: 'Livepeer Studio', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 130, unitPrice: 0.15, regions: ['US-East', 'EU-West'], capacity: 'high' },
    { gatewayId: 'gw-4', gatewayName: 'Render Core', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 120, unitPrice: 0.18, regions: ['US-West', 'US-East'], capacity: 'high' },
    { gatewayId: 'gw-3', gatewayName: 'GPU Pool Network', slaTier: 'bronze', uptimeGuarantee: 99.5, latencyGuarantee: 180, unitPrice: 0.16, regions: ['Asia-Pacific'], capacity: 'medium' },
  ],
  'model-cogvideo': [
    { gatewayId: 'gw-4', gatewayName: 'Render Core', slaTier: 'gold', uptimeGuarantee: 99.99, latencyGuarantee: 700, unitPrice: 0.25, regions: ['US-West'], capacity: 'medium' },
  ],
};

// API Keys store (mutable)
export const apiKeys: DeveloperApiKey[] = [
  {
    id: 'key-1',
    projectName: 'My Video App',
    modelId: 'model-sdxl',
    modelName: 'SDXL Turbo',
    providerDisplayName: 'Daydream',
    keyHash: 'lp_sk_****************************a1b2',
    status: 'active',
    createdAt: '2025-12-01T10:00:00Z',
    lastUsedAt: '2026-01-19T14:30:00Z',
  },
  {
    id: 'key-2',
    projectName: 'Streaming Demo',
    modelId: 'model-sd15',
    modelName: 'Stable Diffusion 1.5',
    providerDisplayName: 'Daydream',
    keyHash: 'lp_sk_****************************c3d4',
    status: 'active',
    createdAt: '2026-01-05T09:00:00Z',
    lastUsedAt: '2026-01-18T16:45:00Z',
  },
];

// Usage records
export const usageRecords: UsageRecord[] = [
  { keyId: 'key-1', date: '2026-01-13', sessions: 45, outputMinutes: 12.5, estimatedCost: 1.00 },
  { keyId: 'key-1', date: '2026-01-14', sessions: 62, outputMinutes: 18.3, estimatedCost: 1.46 },
  { keyId: 'key-1', date: '2026-01-15', sessions: 38, outputMinutes: 9.8, estimatedCost: 0.78 },
  { keyId: 'key-1', date: '2026-01-16', sessions: 71, outputMinutes: 22.1, estimatedCost: 1.77 },
  { keyId: 'key-1', date: '2026-01-17', sessions: 55, outputMinutes: 15.6, estimatedCost: 1.25 },
  { keyId: 'key-1', date: '2026-01-18', sessions: 89, outputMinutes: 28.4, estimatedCost: 2.27 },
  { keyId: 'key-1', date: '2026-01-19', sessions: 43, outputMinutes: 11.2, estimatedCost: 0.90 },
  { keyId: 'key-2', date: '2026-01-13', sessions: 12, outputMinutes: 3.2, estimatedCost: 0.10 },
  { keyId: 'key-2', date: '2026-01-14', sessions: 18, outputMinutes: 4.8, estimatedCost: 0.14 },
  { keyId: 'key-2', date: '2026-01-15', sessions: 25, outputMinutes: 6.5, estimatedCost: 0.20 },
  { keyId: 'key-2', date: '2026-01-16', sessions: 15, outputMinutes: 4.0, estimatedCost: 0.12 },
  { keyId: 'key-2', date: '2026-01-17', sessions: 22, outputMinutes: 5.8, estimatedCost: 0.17 },
  { keyId: 'key-2', date: '2026-01-18', sessions: 30, outputMinutes: 8.1, estimatedCost: 0.24 },
  { keyId: 'key-2', date: '2026-01-19', sessions: 8, outputMinutes: 2.1, estimatedCost: 0.06 },
];

// Invoices
export const invoices: Invoice[] = [
  { id: 'inv-1', date: '2025-12-01', amount: 45.00, status: 'paid' },
  { id: 'inv-2', date: '2026-01-01', amount: 52.30, status: 'paid' },
];

// Helper to generate API key
export function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = 'lp_sk_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Helper to hash API key (just mask it for display)
export function hashApiKey(key: string): string {
  return key.slice(0, 6) + '****************************' + key.slice(-4);
}
