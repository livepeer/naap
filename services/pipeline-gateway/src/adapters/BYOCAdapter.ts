/**
 * BYOC Adapter (Phase 5d) -- Bring Your Own Capability
 *
 * Allows plugins to register custom pipeline capabilities.
 * These are proxied through to registered endpoints, with
 * payment-aware proxying and auto-registration from plugin-server-sdk.
 */

import type { IPipelineAdapter, PipelineDescriptor } from '@naap/livepeer-pipeline';
import type { PipelineContext, PipelineResult } from './BatchAIAdapter.js';

export interface BYOCCapability {
  name: string;
  endpoint: string;
  registeredBy: string; // plugin name
  registeredAt: number;
  schema?: { input?: unknown; output?: unknown };
  pricing?: { model: string; unitPrice: number; currency: string };
  healthCheckUrl?: string;
  healthy: boolean;
  lastHealthCheck?: number;
}

export class BYOCAdapter implements IPipelineAdapter {
  readonly name = 'byoc';
  readonly type = 'batch' as const;

  private capabilities = new Map<string, BYOCCapability>();

  canHandle(pipeline: PipelineDescriptor): boolean {
    return pipeline.source === 'byoc' || this.capabilities.has(pipeline.name);
  }

  /** Execute a BYOC pipeline by proxying to the registered endpoint */
  async execute(input: unknown, ctx: PipelineContext): Promise<PipelineResult> {
    const body = input as Record<string, unknown>;
    const pipelineName = (body.__pipeline as string) || '';
    delete body.__pipeline;

    const cap = this.capabilities.get(pipelineName);
    if (!cap) {
      throw new Error(`BYOC capability '${pipelineName}' not registered`);
    }

    if (!cap.healthy) {
      throw new Error(`BYOC capability '${pipelineName}' is currently unhealthy`);
    }

    // Proxy request to the registered endpoint
    const response = await fetch(cap.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': ctx.requestId,
        'x-registered-by': cap.registeredBy,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`BYOC endpoint returned ${response.status}: ${error}`);
    }

    const result = await response.json();

    return {
      result,
      model: (body.model_id as string) || cap.name,
      orchestrator: `byoc:${cap.registeredBy}`,
    };
  }

  // ─── Registration API ──────────────────────────────────────────────────────

  /** Register a new BYOC capability */
  register(name: string, config: Omit<BYOCCapability, 'name' | 'registeredAt' | 'healthy'>): void {
    this.capabilities.set(name, {
      ...config,
      name,
      registeredAt: Date.now(),
      healthy: true,
    });
    console.log(`[byoc] Registered capability '${name}' from ${config.registeredBy} → ${config.endpoint}`);
  }

  /** Unregister a capability */
  unregister(name: string, registeredBy: string): boolean {
    const cap = this.capabilities.get(name);
    if (!cap || cap.registeredBy !== registeredBy) return false;
    this.capabilities.delete(name);
    console.log(`[byoc] Unregistered capability '${name}'`);
    return true;
  }

  /** List all registered capabilities */
  listCapabilities(): BYOCCapability[] {
    return Array.from(this.capabilities.values());
  }

  /** Get a specific capability */
  getCapability(name: string): BYOCCapability | null {
    return this.capabilities.get(name) || null;
  }

  // ─── Health Checking ───────────────────────────────────────────────────────

  /** Health-check all registered capabilities */
  async healthCheckAll(): Promise<void> {
    const checks = Array.from(this.capabilities.values()).map(async (cap) => {
      if (!cap.healthCheckUrl) return;
      try {
        const res = await fetch(cap.healthCheckUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        cap.healthy = res.ok;
      } catch {
        cap.healthy = false;
      }
      cap.lastHealthCheck = Date.now();
    });

    await Promise.allSettled(checks);
  }

  /** Get unhealthy capabilities */
  getUnhealthy(): BYOCCapability[] {
    return Array.from(this.capabilities.values()).filter((c) => !c.healthy);
  }
}
