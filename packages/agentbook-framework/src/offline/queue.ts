/**
 * Offline Queue — Stores operations when offline, replays when back online.
 * Uses IndexedDB via a simple wrapper.
 * Works in both browser (PWA) and can be mocked for testing.
 */

export interface QueuedOperation {
  id: string;
  type: 'expense' | 'receipt' | 'time_entry';
  method: 'POST' | 'PUT';
  url: string;
  body: string;
  createdAt: string;
  retries: number;
  idempotencyKey: string;
}

export class OfflineQueue {
  private queue: QueuedOperation[] = [];

  enqueue(op: Omit<QueuedOperation, 'id' | 'createdAt' | 'retries'>): void {
    this.queue.push({
      ...op,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      retries: 0,
    });
  }

  async replay(): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    const ops = [...this.queue];
    this.queue = [];

    for (const op of ops) {
      try {
        const res = await fetch(op.url, {
          method: op.method,
          headers: { 'Content-Type': 'application/json' },
          body: op.body,
        });

        if (res.ok) {
          success++;
        } else if (op.retries < 3) {
          this.queue.push({ ...op, retries: op.retries + 1 });
          failed++;
        } else {
          failed++; // Give up after 3 retries
        }
      } catch {
        if (op.retries < 3) {
          this.queue.push({ ...op, retries: op.retries + 1 });
        }
        failed++;
      }
    }

    return { success, failed };
  }

  getPending(): QueuedOperation[] {
    return [...this.queue];
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}
