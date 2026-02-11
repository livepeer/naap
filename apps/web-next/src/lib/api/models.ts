/**
 * Shared utilities for Developer API model routes.
 */

/** Map a Prisma DevApiAIModel row to the shape the frontend expects. */
export function serialiseModel(m: {
  id: string;
  name: string;
  tagline: string;
  type: string;
  featured: boolean;
  realtime: boolean;
  costPerMinMin: number;
  costPerMinMax: number;
  latencyP50: number;
  coldStart: number;
  fps: number;
  useCases: string[];
  badges: string[];
  _count?: { gatewayOffers: number };
}) {
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    type: m.type,
    featured: m.featured,
    realtime: m.realtime,
    costPerMin: { min: m.costPerMinMin, max: m.costPerMinMax },
    latencyP50: m.latencyP50,
    coldStart: m.coldStart,
    fps: m.fps,
    gatewayCount: m._count?.gatewayOffers ?? 0,
    useCases: m.useCases,
    badges: m.badges,
  };
}
