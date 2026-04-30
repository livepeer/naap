import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveEngine } from '../proactive-engine.js';
import type { ProactiveMessage } from '../proactive-engine.js';
import type { TenantConfig } from '../types.js';

const baseTenantConfig: TenantConfig = {
  tenant_id: 'tenant-1',
  business_type: 'sole_proprietor',
  jurisdiction: 'us',
  region: 'CA',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'America/New_York',
  fiscal_year_start: 1,
  auto_approve_limit_cents: 500_00,
};

function makeMessage(overrides?: Partial<ProactiveMessage>): ProactiveMessage {
  return {
    id: 'msg-1',
    tenant_id: 'tenant-1',
    category: 'daily_pulse',
    urgency: 'informational',
    title_key: 'proactive.daily_pulse',
    body_key: 'proactive.daily_pulse',
    body_params: { income: 100 },
    actions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ProactiveEngine.registerDelivery
// ---------------------------------------------------------------------------
describe('ProactiveEngine.registerDelivery', () => {
  it('registers a delivery handler', async () => {
    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    // Verify by sending a message that should reach the handler
    // We need to ensure it is not quiet hours, so use a timezone trick
    const config = { ...baseTenantConfig, timezone: 'UTC' };

    // Mock Date to a non-quiet-hours time (noon UTC)
    const mockDate = new Date('2025-06-15T12:00:00Z');
    vi.setSystemTime(mockDate);

    await engine.send(makeMessage(), config);
    expect(handler).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// ProactiveEngine.send
// ---------------------------------------------------------------------------
describe('ProactiveEngine.send', () => {
  beforeEach(() => {
    // Set time to noon UTC (not quiet hours for UTC timezone)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers to registered telegram handler', async () => {
    const engine = new ProactiveEngine();
    const telegramHandler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', telegramHandler);

    const msg = makeMessage();
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    expect(telegramHandler).toHaveBeenCalledWith(msg);
  });

  it('falls back to web handler when telegram is unavailable', async () => {
    const engine = new ProactiveEngine();
    const webHandler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('web', webHandler);

    const msg = makeMessage();
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    expect(webHandler).toHaveBeenCalledWith(msg);
  });

  it('prefers telegram over web when both are registered', async () => {
    const engine = new ProactiveEngine();
    const telegramHandler = vi.fn().mockResolvedValue(undefined);
    const webHandler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', telegramHandler);
    engine.registerDelivery('web', webHandler);

    await engine.send(makeMessage(), { ...baseTenantConfig, timezone: 'UTC' });

    expect(telegramHandler).toHaveBeenCalledOnce();
    expect(webHandler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ProactiveEngine.recordEngagement
// ---------------------------------------------------------------------------
describe('ProactiveEngine.recordEngagement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records opened engagement', async () => {
    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ id: 'msg-opened' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    // Advance time before recording
    vi.setSystemTime(new Date('2025-06-15T12:05:00Z'));
    engine.recordEngagement('msg-opened', 'opened');

    // No direct way to inspect internal log, but we verify it does not throw
    // and the handler was called (message was sent)
    expect(handler).toHaveBeenCalledOnce();
  });

  it('records acted_on with action_taken', async () => {
    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ id: 'msg-acted' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    vi.setSystemTime(new Date('2025-06-15T12:10:00Z'));
    // Should not throw
    engine.recordEngagement('msg-acted', 'acted_on', 'confirm:exp-1');
  });

  it('records snoozed engagement', async () => {
    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ id: 'msg-snoozed' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    engine.recordEngagement('msg-snoozed', 'snoozed');
    // Should not throw
  });

  it('records dismissed engagement', async () => {
    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ id: 'msg-dismissed' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    engine.recordEngagement('msg-dismissed', 'dismissed');
    // Should not throw
  });

  it('silently ignores unknown message ids', () => {
    const engine = new ProactiveEngine();
    // Should not throw
    engine.recordEngagement('nonexistent-msg', 'opened');
  });
});

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------
describe('Quiet hours', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers non-critical messages during quiet hours (after 9 PM)', async () => {
    vi.useFakeTimers();
    // 10 PM UTC
    vi.setSystemTime(new Date('2025-06-15T22:00:00Z'));

    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ urgency: 'informational' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    // Handler should NOT be called (message deferred)
    expect(handler).not.toHaveBeenCalled();
    // deliver_at should be set
    expect(msg.deliver_at).toBeDefined();
  });

  it('defers non-critical messages during quiet hours (before 8 AM)', async () => {
    vi.useFakeTimers();
    // 5 AM UTC
    vi.setSystemTime(new Date('2025-06-15T05:00:00Z'));

    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ urgency: 'important' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    expect(handler).not.toHaveBeenCalled();
    expect(msg.deliver_at).toBeDefined();
  });

  it('delivers critical messages even during quiet hours', async () => {
    vi.useFakeTimers();
    // 11 PM UTC — quiet hours
    vi.setSystemTime(new Date('2025-06-15T23:00:00Z'));

    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ urgency: 'critical' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    // Critical messages bypass quiet hours
    expect(handler).toHaveBeenCalledOnce();
  });

  it('delivers messages during active hours (noon)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    const engine = new ProactiveEngine();
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerDelivery('telegram', handler);

    const msg = makeMessage({ urgency: 'informational' });
    await engine.send(msg, { ...baseTenantConfig, timezone: 'UTC' });

    expect(handler).toHaveBeenCalledOnce();
  });
});
