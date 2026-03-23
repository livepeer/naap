/**
 * Event Emitter — Dual-mode event bus.
 *
 * Local dev: Kafka producer (if KAFKA_BROKERS is set)
 * Vercel/serverless: Database-backed append-only event table
 *
 * Same emitEvent() interface regardless of backend.
 * Every state change MUST emit an event BEFORE committing.
 */

export interface ExecutionEvent {
  event_id: string;
  tenant_id: string;
  event_type: string;
  timestamp: string;
  actor: 'agent' | 'human' | 'system';
  action: Record<string, unknown>;
  reasoning?: string;
  constraints_passed?: string[];
  verification_result?: 'passed' | 'failed' | 'skipped';
  metadata?: Record<string, unknown>;
}

export type EventHandler = (event: ExecutionEvent) => Promise<void>;

interface EventBackend {
  emit(event: ExecutionEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): void;
}

/**
 * Database-backed event backend (works everywhere, including Vercel serverless).
 */
class DatabaseEventBackend implements EventBackend {
  private handlers: Map<string, EventHandler[]> = new Map();

  async emit(event: ExecutionEvent): Promise<void> {
    // In production, this writes to ab_events table via Prisma
    // For now, store in memory and notify handlers
    const handlers = this.handlers.get(event.event_type) || [];
    const wildcardHandlers = this.handlers.get('*') || [];

    for (const handler of [...handlers, ...wildcardHandlers]) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Event handler error for ${event.event_type}:`, err);
      }
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }
}

/**
 * Kafka event backend (local development with full streaming).
 */
class KafkaEventBackend implements EventBackend {
  private handlers: Map<string, EventHandler[]> = new Map();
  private topic: string;

  constructor(topic: string = 'agentbooks.execution_events') {
    this.topic = topic;
    // TODO: Initialize Kafka producer when @naap/services-kafka is available
  }

  async emit(event: ExecutionEvent): Promise<void> {
    // TODO: Produce to Kafka topic
    // For now, fall back to in-memory handler dispatch
    const handlers = this.handlers.get(event.event_type) || [];
    const wildcardHandlers = this.handlers.get('*') || [];

    for (const handler of [...handlers, ...wildcardHandlers]) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Event handler error for ${event.event_type}:`, err);
      }
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }
}

/**
 * Event emitter with automatic backend selection.
 */
export class EventEmitter {
  private backend: EventBackend;

  constructor() {
    const kafkaBrokers = process.env.KAFKA_BROKERS;
    if (kafkaBrokers) {
      this.backend = new KafkaEventBackend();
    } else {
      this.backend = new DatabaseEventBackend();
    }
  }

  async emit(event: ExecutionEvent): Promise<void> {
    return this.backend.emit(event);
  }

  subscribe(eventType: string, handler: EventHandler): void {
    this.backend.subscribe(eventType, handler);
  }
}

/**
 * Convenience function — import { emitEvent } from '@agentbook/framework'
 */
let defaultEmitter: EventEmitter | null = null;

export function getEventEmitter(): EventEmitter {
  if (!defaultEmitter) {
    defaultEmitter = new EventEmitter();
  }
  return defaultEmitter;
}

export async function emitEvent(event: Omit<ExecutionEvent, 'event_id' | 'timestamp'>): Promise<void> {
  const fullEvent: ExecutionEvent = {
    ...event,
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  return getEventEmitter().emit(fullEvent);
}
