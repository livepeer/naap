/**
 * Traffic Router Service
 * Routes requests to the appropriate deployment slot based on traffic rules
 *
 * Supports:
 * - Weighted traffic distribution (for canary deployments)
 * - Header-based routing (for testing)
 * - User-based routing (for beta features)
 * - Session stickiness (optional)
 */

import { PrismaClient, PluginDeploymentSlot } from '@naap/database';
import { SlotName as SharedSlotName, isValidDeploymentId, NoActiveSlotError } from './deploymentTypes';

// =============================================================================
// Types
// =============================================================================

export type SlotName = 'blue' | 'green';

export interface TrafficRule {
  deploymentId: string;
  rules: SlotRule[];
}

export interface SlotRule {
  slot: SlotName;
  weight: number; // 0-100
  conditions?: RouteConditions;
}

export interface RouteConditions {
  /** Route if request has these headers */
  headers?: Record<string, string>;
  /** Route if user ID matches */
  userIds?: string[];
  /** Route if team ID matches */
  teamIds?: string[];
  /** Random percentage (for A/B testing) */
  percentage?: number;
}

export interface IncomingRequest {
  userId?: string;
  teamId?: string;
  headers: Record<string, string>;
  sessionId?: string;
}

export interface RouteResult {
  slot: SlotName;
  frontendUrl: string | null;
  backendUrl: string | null;
  version: string;
  reason: string;
}

// In-memory cache for routing decisions
interface RouteCache {
  deploymentId: string;
  slot: SlotName;
  expiresAt: number;
}

// =============================================================================
// Traffic Router Service
// =============================================================================

export function createTrafficRouter(prisma: PrismaClient) {
  // Simple in-memory cache for routing decisions
  // In production, this would use Redis
  const routeCache = new Map<string, RouteCache>();
  const CACHE_TTL_MS = 60000; // 1 minute cache

  // Slot data cache to reduce database queries
  const slotCache = new Map<string, { slots: PluginDeploymentSlot[]; expiresAt: number }>();
  const SLOT_CACHE_TTL_MS = 10000; // 10 second cache for slot data

  /**
   * Clear expired cache entries
   */
  function cleanCache(): void {
    const now = Date.now();
    Array.from(routeCache.entries()).forEach(([key, value]) => {
      if (value.expiresAt < now) {
        routeCache.delete(key);
      }
    });
  }

  /**
   * Get cache key for a request
   */
  function getCacheKey(deploymentId: string, request: IncomingRequest): string {
    // Use session ID for stickiness if available
    if (request.sessionId) {
      return `${deploymentId}:session:${request.sessionId}`;
    }
    // Fall back to user ID
    if (request.userId) {
      return `${deploymentId}:user:${request.userId}`;
    }
    return '';
  }

  /**
   * Get slots for a deployment (with caching)
   */
  async function getSlots(deploymentId: string): Promise<PluginDeploymentSlot[]> {
    // Check cache first
    const cached = slotCache.get(deploymentId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.slots;
    }

    // Fetch from database
    const slots = await prisma.pluginDeploymentSlot.findMany({
      where: { deploymentId },
      orderBy: { slot: 'asc' },
    });

    // Cache the result
    slotCache.set(deploymentId, {
      slots,
      expiresAt: Date.now() + SLOT_CACHE_TTL_MS,
    });

    return slots;
  }

  /**
   * Invalidate slot cache for a deployment
   */
  function invalidateSlotCache(deploymentId: string): void {
    slotCache.delete(deploymentId);
  }

  /**
   * Check if header conditions match
   */
  function matchesHeaders(
    conditions: Record<string, string>,
    requestHeaders: Record<string, string>
  ): boolean {
    for (const [key, value] of Object.entries(conditions)) {
      const headerKey = key.toLowerCase();
      const headerValue = requestHeaders[headerKey];
      if (headerValue !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Select slot based on weighted random selection
   */
  function selectByWeight(slots: PluginDeploymentSlot[]): PluginDeploymentSlot | null {
    // Filter to only active slots with traffic
    const activeSlots = slots.filter(s => s.trafficPercent > 0 && s.status === 'active');

    if (activeSlots.length === 0) {
      // Fall back to any active slot
      const anyActive = slots.find(s => s.status === 'active');
      return anyActive || null;
    }

    if (activeSlots.length === 1) {
      return activeSlots[0];
    }

    // Weighted random selection
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const slot of activeSlots) {
      cumulative += slot.trafficPercent;
      if (random < cumulative) {
        return slot;
      }
    }

    // Fallback to last slot
    return activeSlots[activeSlots.length - 1];
  }

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    /**
     * Route a request to the appropriate slot
     */
    async route(
      deploymentId: string,
      request: IncomingRequest
    ): Promise<RouteResult> {
      // Clean expired cache entries periodically
      if (Math.random() < 0.1) {
        cleanCache();
      }

      // Check cache for sticky sessions
      const cacheKey = getCacheKey(deploymentId, request);
      if (cacheKey) {
        const cached = routeCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          const slots = await getSlots(deploymentId);
          const slot = slots.find(s => s.slot === cached.slot);
          if (slot && slot.status === 'active') {
            return {
              slot: slot.slot as SlotName,
              frontendUrl: slot.frontendUrl,
              backendUrl: slot.backendUrl,
              version: slot.version,
              reason: 'cache',
            };
          }
        }
      }

      const slots = await getSlots(deploymentId);

      if (slots.length === 0) {
        throw new NoActiveSlotError(deploymentId);
      }

      // 1. Check for explicit slot header (for testing)
      const slotHeader = request.headers['x-plugin-slot'];
      if (slotHeader && (slotHeader === 'blue' || slotHeader === 'green')) {
        const slot = slots.find(s => s.slot === slotHeader);
        if (slot) {
          return {
            slot: slot.slot as SlotName,
            frontendUrl: slot.frontendUrl,
            backendUrl: slot.backendUrl,
            version: slot.version,
            reason: 'header-override',
          };
        }
      }

      // 2. Check for version header (route to specific version)
      const versionHeader = request.headers['x-plugin-version'];
      if (versionHeader) {
        const slot = slots.find(s => s.version === versionHeader);
        if (slot && slot.status === 'active') {
          return {
            slot: slot.slot as SlotName,
            frontendUrl: slot.frontendUrl,
            backendUrl: slot.backendUrl,
            version: slot.version,
            reason: 'version-header',
          };
        }
      }

      // 3. Check for beta header (route to canary if available)
      const betaHeader = request.headers['x-plugin-beta'];
      if (betaHeader === 'true') {
        // Find the slot with less traffic (likely the canary)
        const canarySlot = slots
          .filter(s => s.status === 'active' && s.trafficPercent > 0 && s.trafficPercent < 100)
          .sort((a, b) => a.trafficPercent - b.trafficPercent)[0];

        if (canarySlot) {
          return {
            slot: canarySlot.slot as SlotName,
            frontendUrl: canarySlot.frontendUrl,
            backendUrl: canarySlot.backendUrl,
            version: canarySlot.version,
            reason: 'beta-header',
          };
        }
      }

      // 4. Select based on weights
      const selectedSlot = selectByWeight(slots);

      if (!selectedSlot) {
        throw new Error(`No active slots available for deployment: ${deploymentId}`);
      }

      // Cache the result for sticky sessions
      if (cacheKey) {
        routeCache.set(cacheKey, {
          deploymentId,
          slot: selectedSlot.slot as SlotName,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }

      return {
        slot: selectedSlot.slot as SlotName,
        frontendUrl: selectedSlot.frontendUrl,
        backendUrl: selectedSlot.backendUrl,
        version: selectedSlot.version,
        reason: 'weighted',
      };
    },

    /**
     * Get current traffic distribution for a deployment
     */
    async getTrafficDistribution(
      deploymentId: string
    ): Promise<{ slot: SlotName; percent: number; version: string; status: string }[]> {
      const slots = await getSlots(deploymentId);

      return slots.map(s => ({
        slot: s.slot as SlotName,
        percent: s.trafficPercent,
        version: s.version,
        status: s.status,
      }));
    },

    /**
     * Update traffic weights for a deployment
     */
    async updateWeights(
      deploymentId: string,
      bluePercent: number,
      greenPercent: number
    ): Promise<void> {
      // Validate percentages
      if (bluePercent + greenPercent !== 100) {
        throw new Error('Traffic percentages must sum to 100');
      }

      if (bluePercent < 0 || bluePercent > 100 || greenPercent < 0 || greenPercent > 100) {
        throw new Error('Traffic percentages must be between 0 and 100');
      }

      await prisma.$transaction([
        prisma.pluginDeploymentSlot.update({
          where: { deploymentId_slot: { deploymentId, slot: 'blue' } },
          data: { trafficPercent: bluePercent },
        }),
        prisma.pluginDeploymentSlot.update({
          where: { deploymentId_slot: { deploymentId, slot: 'green' } },
          data: { trafficPercent: greenPercent },
        }),
      ]);

      // Invalidate both caches for this deployment
      invalidateSlotCache(deploymentId);
      Array.from(routeCache.entries()).forEach(([key, value]) => {
        if (value.deploymentId === deploymentId) {
          routeCache.delete(key);
        }
      });
    },

    /**
     * Get all backend URLs for a deployment (used by load balancers)
     */
    async getBackendUrls(
      deploymentId: string
    ): Promise<{ slot: SlotName; url: string; weight: number }[]> {
      const slots = await getSlots(deploymentId);

      return slots
        .filter(s => s.backendUrl && s.status === 'active' && s.trafficPercent > 0)
        .map(s => ({
          slot: s.slot as SlotName,
          url: s.backendUrl!,
          weight: s.trafficPercent,
        }));
    },

    /**
     * Get all frontend URLs for a deployment
     */
    async getFrontendUrls(
      deploymentId: string
    ): Promise<{ slot: SlotName; url: string; weight: number }[]> {
      const slots = await getSlots(deploymentId);

      return slots
        .filter(s => s.frontendUrl && s.status === 'active' && s.trafficPercent > 0)
        .map(s => ({
          slot: s.slot as SlotName,
          url: s.frontendUrl!,
          weight: s.trafficPercent,
        }));
    },

    /**
     * Clear routing cache (useful after major changes)
     */
    clearCache(deploymentId?: string): void {
      if (deploymentId) {
        invalidateSlotCache(deploymentId);
        Array.from(routeCache.entries()).forEach(([key, value]) => {
          if (value.deploymentId === deploymentId) {
            routeCache.delete(key);
          }
        });
      } else {
        slotCache.clear();
        routeCache.clear();
      }
    },

    /**
     * Get cache stats (for monitoring)
     */
    getCacheStats(): { size: number; oldestEntry: number | null } {
      let oldest: number | null = null;
      const now = Date.now();

      Array.from(routeCache.values()).forEach(value => {
        const age = now - (value.expiresAt - CACHE_TTL_MS);
        if (oldest === null || age > oldest) {
          oldest = age;
        }
      });

      return {
        size: routeCache.size,
        oldestEntry: oldest,
      };
    },
  };
}

export type TrafficRouter = ReturnType<typeof createTrafficRouter>;
