import type { HandlerContext, ListCapabilitiesParams } from '../types.js';
import { getCapabilities, getCapability, getCategories, getStats, filterCapabilities } from '../aggregator.js';

export function createResolvers(ctx: HandlerContext) {
  return {
    capabilities: async (args: Partial<ListCapabilitiesParams>) => {
      const all = await getCapabilities(ctx);
      return filterCapabilities(all, {
        category: args.category,
        search: args.search,
        minGpuCount: args.minGpuCount,
        maxPriceUsd: args.maxPriceUsd,
        minCapacity: args.minCapacity,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
    },

    capability: async (args: { id: string }) => {
      return getCapability(args.id, ctx);
    },

    categories: async () => {
      return getCategories(ctx);
    },

    stats: async () => {
      return getStats(ctx);
    },
  };
}
