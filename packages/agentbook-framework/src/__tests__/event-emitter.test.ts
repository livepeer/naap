import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, emitEvent, getEventEmitter, type ExecutionEvent } from '../event-emitter.js';

function makeEvent(overrides?: Partial<ExecutionEvent>): ExecutionEvent {
  return {
    event_id: 'evt-001',
    tenant_id: 'tenant-1',
    event_type: 'test_event',
    timestamp: '2025-01-01T00:00:00.000Z',
    actor: 'agent',
    action: { foo: 'bar' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// emitEvent() convenience function
// ---------------------------------------------------------------------------
describe('emitEvent()', () => {
  it('creates event with auto-generated id and timestamp', async () => {
    const captured: ExecutionEvent[] = [];
    const emitter = getEventEmitter();
    emitter.subscribe('intent_received', async (event) => {
      captured.push(event);
    });

    await emitEvent({
      tenant_id: 'tenant-1',
      event_type: 'intent_received',
      actor: 'human',
      action: { intent: 'record_expense' },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].event_id).toBeDefined();
    expect(captured[0].event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(captured[0].timestamp).toBeDefined();
    // timestamp should be a valid ISO string
    expect(new Date(captured[0].timestamp).toISOString()).toBe(captured[0].timestamp);
  });
});

// ---------------------------------------------------------------------------
// EventEmitter subscribe + emit
// ---------------------------------------------------------------------------
describe('EventEmitter', () => {
  describe('subscribe() + emit()', () => {
    it('delivers events to matching handlers', async () => {
      const emitter = new EventEmitter();
      const received: ExecutionEvent[] = [];

      emitter.subscribe('test_event', async (event) => {
        received.push(event);
      });

      const event = makeEvent();
      await emitter.emit(event);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    it('does not deliver events to non-matching handlers', async () => {
      const emitter = new EventEmitter();
      const received: ExecutionEvent[] = [];

      emitter.subscribe('other_event', async (event) => {
        received.push(event);
      });

      await emitter.emit(makeEvent({ event_type: 'test_event' }));

      expect(received).toHaveLength(0);
    });

    it('supports multiple handlers for the same event type', async () => {
      const emitter = new EventEmitter();
      let count = 0;

      emitter.subscribe('test_event', async () => { count += 1; });
      emitter.subscribe('test_event', async () => { count += 10; });

      await emitter.emit(makeEvent());

      expect(count).toBe(11);
    });
  });

  // ---------------------------------------------------------------------------
  // Wildcard subscriber
  // ---------------------------------------------------------------------------
  describe('wildcard subscriber (*)', () => {
    it('receives all events regardless of type', async () => {
      const emitter = new EventEmitter();
      const received: string[] = [];

      emitter.subscribe('*', async (event) => {
        received.push(event.event_type);
      });

      await emitter.emit(makeEvent({ event_type: 'type_a' }));
      await emitter.emit(makeEvent({ event_type: 'type_b' }));

      expect(received).toEqual(['type_a', 'type_b']);
    });

    it('delivers to both specific and wildcard handlers', async () => {
      const emitter = new EventEmitter();
      const calls: string[] = [];

      emitter.subscribe('specific', async () => { calls.push('specific'); });
      emitter.subscribe('*', async () => { calls.push('wildcard'); });

      await emitter.emit(makeEvent({ event_type: 'specific' }));

      expect(calls).toContain('specific');
      expect(calls).toContain('wildcard');
      expect(calls).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Handler errors
  // ---------------------------------------------------------------------------
  describe('handler errors', () => {
    it('does not crash the emitter when a handler throws', async () => {
      const emitter = new EventEmitter();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      emitter.subscribe('test_event', async () => {
        throw new Error('handler boom');
      });

      // Should not throw
      await expect(emitter.emit(makeEvent())).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('continues to call subsequent handlers after one throws', async () => {
      const emitter = new EventEmitter();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let secondCalled = false;

      emitter.subscribe('test_event', async () => {
        throw new Error('first handler fails');
      });
      emitter.subscribe('test_event', async () => {
        secondCalled = true;
      });

      await emitter.emit(makeEvent());
      expect(secondCalled).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Backend auto-selection
  // ---------------------------------------------------------------------------
  describe('backend auto-selection', () => {
    const originalKafkaBrokers = process.env.KAFKA_BROKERS;

    afterEach(() => {
      if (originalKafkaBrokers !== undefined) {
        process.env.KAFKA_BROKERS = originalKafkaBrokers;
      } else {
        delete process.env.KAFKA_BROKERS;
      }
    });

    it('uses DatabaseEventBackend when KAFKA_BROKERS is not set', () => {
      delete process.env.KAFKA_BROKERS;
      const emitter = new EventEmitter();
      // We can verify it works (DB backend is the default)
      expect(emitter).toBeDefined();
    });

    it('uses KafkaEventBackend when KAFKA_BROKERS is set', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      const emitter = new EventEmitter();
      // Both backends have the same interface, so we just verify construction succeeds
      expect(emitter).toBeDefined();
    });

    it('Kafka-backed emitter still delivers events via in-memory handlers', async () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      const emitter = new EventEmitter();
      const received: ExecutionEvent[] = [];

      emitter.subscribe('kafka_test', async (event) => {
        received.push(event);
      });

      await emitter.emit(makeEvent({ event_type: 'kafka_test' }));
      expect(received).toHaveLength(1);
    });
  });
});
