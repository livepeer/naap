/**
 * Orchestrator capability discovery via serviceURI probing.
 * Categorizes orchestrators into: transcoding, realtime_ai, ai_batch, agent, other.
 */

import { prisma } from '../db/client.js';

export type CapabilityCategory = 'transcoding' | 'realtime_ai' | 'ai_batch' | 'agent' | 'other';

const AI_REALTIME_PIPELINES = ['video-to-video', 'live-video-to-video', 'segment-anything-2'];
const AI_BATCH_PIPELINES = [
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'upscale', 'audio-to-text', 'text-to-speech', 'llm',
];

interface CapabilityResult {
  category: CapabilityCategory;
  pipelineId: string | null;
}

export function categorizePipeline(pipelineId: string): CapabilityCategory {
  if (AI_REALTIME_PIPELINES.includes(pipelineId)) return 'realtime_ai';
  if (AI_BATCH_PIPELINES.includes(pipelineId)) return 'ai_batch';
  if (pipelineId.includes('agent') || pipelineId.includes('tool')) return 'agent';
  return 'other';
}

export async function probeCapabilities(serviceURI: string): Promise<CapabilityResult[]> {
  const results: CapabilityResult[] = [];

  // All active orchestrators with a serviceURI have transcoding capability
  results.push({ category: 'transcoding', pipelineId: null });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const url = serviceURI.endsWith('/') ? serviceURI : serviceURI + '/';
    const res = await fetch(`${url}getBroadcasterInfo`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return results;

    // Try capabilities endpoint for AI pipelines
    try {
      const capController = new AbortController();
      const capTimeout = setTimeout(() => capController.abort(), 5000);

      const capRes = await fetch(`${url}capabilities`, {
        signal: capController.signal,
      });
      clearTimeout(capTimeout);

      if (capRes.ok) {
        const capData = await capRes.json();
        const pipelines = capData?.pipelines || capData?.capabilities || [];

        if (Array.isArray(pipelines)) {
          for (const p of pipelines) {
            const pipelineId = typeof p === 'string' ? p : p?.pipeline || p?.id;
            if (pipelineId) {
              const category = categorizePipeline(pipelineId);
              results.push({ category, pipelineId });
            }
          }
        } else if (typeof pipelines === 'object') {
          for (const [pipelineId] of Object.entries(pipelines)) {
            const category = categorizePipeline(pipelineId);
            results.push({ category, pipelineId });
          }
        }
      }
    } catch {
      // No capabilities endpoint — transcoding only
    }
  } catch {
    // Service unreachable — keep transcoding capability
  }

  return results;
}

export async function syncCapabilitiesForOrchestrator(
  orchestratorId: string,
  address: string,
  serviceURI: string,
): Promise<void> {
  const capabilities = await probeCapabilities(serviceURI);

  for (const cap of capabilities) {
    try {
      await prisma.walletOrchestratorCapability.upsert({
        where: {
          address_category_pipelineId: {
            address: address.toLowerCase(),
            category: cap.category,
            pipelineId: cap.pipelineId ?? '',
          },
        },
        update: {
          serviceURI,
          lastChecked: new Date(),
        },
        create: {
          orchestratorId,
          address: address.toLowerCase(),
          category: cap.category,
          pipelineId: cap.pipelineId,
          serviceURI,
        },
      });
    } catch (err: any) {
      if (err.code !== 'P2002') {
        console.warn(`[capabilityService] Error for ${address}:`, err.message);
      }
    }
  }
}

export async function getCapabilitiesByAddress(): Promise<
  Record<string, { categories: string[]; pipelines: string[]; lastChecked: string }>
> {
  const caps = await prisma.walletOrchestratorCapability.findMany({
    orderBy: { lastChecked: 'desc' },
  });

  const result: Record<string, { categories: string[]; pipelines: string[]; lastChecked: string }> = {};

  for (const cap of caps) {
    if (!result[cap.address]) {
      result[cap.address] = { categories: [], pipelines: [], lastChecked: cap.lastChecked.toISOString() };
    }
    if (!result[cap.address].categories.includes(cap.category)) {
      result[cap.address].categories.push(cap.category);
    }
    if (cap.pipelineId && !result[cap.address].pipelines.includes(cap.pipelineId)) {
      result[cap.address].pipelines.push(cap.pipelineId);
    }
  }

  return result;
}
