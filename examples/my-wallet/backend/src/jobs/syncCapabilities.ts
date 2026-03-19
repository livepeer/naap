/**
 * Periodically probe orchestrator serviceURI endpoints to discover capabilities.
 * Runs every 6 hours; processes in batches to avoid overwhelming endpoints.
 */

import { prisma } from '../db/client.js';
import { syncCapabilitiesForOrchestrator } from '../lib/capabilityService.js';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

export async function syncCapabilities(): Promise<void> {
  try {
    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: {
        isActive: true,
        serviceUri: { not: null },
      },
      select: { id: true, address: true, serviceUri: true },
    });

    if (!orchestrators.length) {
      console.log('[syncCapabilities] No active orchestrators with serviceURI');
      return;
    }

    console.log(`[syncCapabilities] Probing ${orchestrators.length} orchestrators...`);
    let processed = 0;

    for (let i = 0; i < orchestrators.length; i += BATCH_SIZE) {
      const batch = orchestrators.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (orch) => {
          if (!orch.serviceUri) return;
          try {
            await syncCapabilitiesForOrchestrator(orch.id, orch.address, orch.serviceUri);
            processed++;
          } catch (err: any) {
            console.warn(`[syncCapabilities] Failed for ${orch.address}:`, err.message);
          }
        }),
      );

      if (i + BATCH_SIZE < orchestrators.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    console.log(`[syncCapabilities] Processed ${processed}/${orchestrators.length} orchestrators`);
  } catch (err: any) {
    console.error('[syncCapabilities] Error:', err.message);
  }
}
