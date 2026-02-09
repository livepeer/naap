/**
 * @naap/livepeer-pipeline
 *
 * Pipeline contract for the isolation boundary between
 * stable platform (Phases 1-4) and fast-iterating AI/video pipelines (Phase 5).
 *
 * Key interfaces:
 * - IPipelineAdapter: implemented by each pipeline type
 * - IPipelineRegistry: discovers pipelines from go-livepeer
 * - PipelineResponse: versioned response envelope
 */

export type { IPipelineAdapter, PipelineRequest, PipelineResult, StreamRequest, StreamSession, PipelineContext, ValidationResult } from './adapter.js';
export type { IPipelineRegistry, PipelineDescriptor, ModelDescriptor, PricingInfo } from './registry.js';
export type { PipelineResponse, PipelineResponseMetadata } from './envelope.js';
