import { test, expect, Page } from '@playwright/test';

const JOB_ID = 'e2e-test-job-00000001';
const PUBLISH_URL =
  'https://livepeer-gateway-test.example.com/live/trickle/abc123';
const SUBSCRIBE_URL =
  'https://livepeer-gateway-test.example.com/live/trickle/abc123-out';

// Minimal 188-byte MPEG-TS null packet (sync byte 0x47, PID 0x1FFF = null)
function nullTsPacket(): Buffer {
  const pkt = Buffer.alloc(188, 0xff);
  pkt[0] = 0x47;
  pkt[1] = 0x1f;
  pkt[2] = 0xff;
  pkt[3] = 0x10;
  return pkt;
}

/**
 * Replace useShell.ts with a stub so the plugin renders without
 * the full NaaP shell context wrapper.
 */
const USE_SHELL_MOCK = `
const React = await import("/node_modules/.vite/deps/react.js?v=88fb8878").then(m => m.default || m);
const ShellContextInstance = React.createContext(null);
const noop = () => {};
const noopService = new Proxy({}, { get() { return noop; } });
export const ShellProvider = ShellContextInstance.Provider;
export const ShellProviderV2 = ShellProvider;
export function useShell() {
  return React.useContext(ShellContextInstance) || {
    pluginName: 'lightning-client',
    eventBus: { on() { return noop; }, off: noop, emit: noop },
    navigate: noop, getToken() { return null; }, theme: 'dark',
    auth: noopService, notifications: noopService, logger: noopService,
    permissions: noopService, integrations: noopService, ai: noopService,
    storage: noopService, email: noopService, capabilities: noopService,
  };
}
export const useShellV2 = useShell;
export function useAuthService() { return noopService; }
export function useAuth() { return noopService; }
export function useNotify() { return noopService; }
export function useEvents() { return { on() { return noop; }, off: noop, emit: noop }; }
export function useThemeService() { return noopService; }
export function useLogger() { return { log: noop, warn: noop, error: noop, debug: noop, info: noop }; }
export function usePermissions() { return noopService; }
export function useIntegrations() { return noopService; }
export function usePermission() { return false; }
export function useAI() { return noopService; }
export function useStorage() { return noopService; }
export function useEmail() { return noopService; }
export function useNavigate() { return noop; }
export function useCapabilities() { return noopService; }
export function useCapability() { return false; }
export function useCapabilityInfo() { return { available: false, reason: 'test' }; }
`;

async function mockPluginSdk(page: Page) {
  await page.route('**useShell**', (route) => {
    route.fulfill({ contentType: 'application/javascript', body: USE_SHELL_MOCK });
  });
}

/**
 * Intercept all API routes the Studio page depends on.
 * Returns helpers to inspect which routes were hit.
 */
async function mockApis(page: Page) {
  const calls: Record<string, number> = {};
  const bump = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
  };

  let jobsAfterStart: boolean = false;

  // Gateway health
  await page.route('**/api/v1/gw/livepeer-gateway/health', (route) => {
    bump('health');
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        active_jobs: jobsAfterStart ? 1 : 0,
        version: '1.0.0',
      }),
    });
  });

  // List jobs
  await page.route('**/api/v1/gw/livepeer-gateway/jobs', (route) => {
    bump('listJobs');
    const list = jobsAfterStart
      ? [
          {
            job_id: JOB_ID,
            model_id: 'noop',
            created_at: Date.now() / 1000,
            media_started: false,
          },
        ]
      : [];
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(list),
    });
  });

  // Start job
  await page.route('**/api/v1/gw/livepeer-gateway/start-job', (route) => {
    bump('startJob');
    jobsAfterStart = true;
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        job_id: JOB_ID,
        model_id: 'noop',
        publish_url: PUBLISH_URL,
        subscribe_url: SUBSCRIBE_URL,
        control_url: null,
        events_url: null,
      }),
    });
  });

  // Get job status
  await page.route(
    `**/api/v1/gw/livepeer-gateway/job/${JOB_ID}`,
    (route) => {
      bump('getJob');
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: JOB_ID,
          model_id: 'noop',
          created_at: Date.now() / 1000,
          publish_url: PUBLISH_URL,
          subscribe_url: SUBSCRIBE_URL,
          control_url: null,
          events_url: null,
          has_payment_session: false,
          media_started: false,
        }),
      });
    },
  );

  // Stop job
  await page.route(
    '**/api/v1/gw/livepeer-gateway/stop-job/**',
    (route) => {
      bump('stopJob');
      jobsAfterStart = false;
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    },
  );

  // Lightning: publish start
  await page.route(
    '**/api/v1/lightning/publish/*/start*',
    (route) => {
      bump('publishStart');
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: JOB_ID }),
      });
    },
  );

  // Lightning: publish chunk
  await page.route('**/api/v1/lightning/publish/*/chunk', (route) => {
    bump('publishChunk');
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, bytes: 1024 }),
    });
  });

  // Lightning: publish stop
  await page.route('**/api/v1/lightning/publish/*/stop', (route) => {
    bump('publishStop');
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ stopped: true }),
    });
  });

  // Lightning: subscribe — return MPEG-TS packets so VideoPlayer has data
  await page.route('**/api/v1/lightning/subscribe/**', (route) => {
    bump('subscribe');
    const body = Buffer.concat([
      nullTsPacket(),
      nullTsPacket(),
      nullTsPacket(),
      nullTsPacket(),
    ]);
    route.fulfill({
      contentType: 'video/mp2t',
      body,
    });
  });

  // Control message
  await page.route(
    '**/api/v1/gw/livepeer-gateway/job/*/control',
    (route) => {
      bump('control');
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    },
  );

  // Events SSE — return empty SSE
  await page.route(
    '**/api/v1/gw/livepeer-gateway/job/*/events',
    (route) => {
      bump('events');
      route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"type":"heartbeat"}\n\n',
      });
    },
  );

  return { calls };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Lightning Studio E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mockPluginSdk(page);
    page.on('pageerror', () => {});
  });

  test('renders Studio UI after health check passes', async ({ page }) => {
    await mockApis(page);
    await page.goto('/');

    await expect(page.getByText('Lightning Studio')).toBeVisible();
    await expect(page.getByText('Gateway OK')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('no button-inside-button nesting (hydration fix)', async ({ page }) => {
    const { calls } = await mockApis(page);
    await page.goto('/');
    await expect(page.getByText('Lightning Studio')).toBeVisible();

    // Start a job so the job list renders
    await page.fill('input[placeholder="model_id"]', 'noop');
    await page.click('button:has-text("Start")');

    // Wait for the job list item to appear
    const jobItem = page.locator('[role="button"]').filter({
      hasText: /e2e-test/,
    });
    await expect(jobItem).toBeVisible({ timeout: 5_000 });

    // Verify the fix: the outer element is a div[role=button], NOT a <button>
    const outerTag = await jobItem.evaluate((el) => el.tagName.toLowerCase());
    expect(outerTag).toBe('div');

    // The stop button inside should still be a <button>
    const innerButton = jobItem.locator('button');
    await expect(innerButton).toBeVisible();

    // Critical check: no <button> is a descendant of another <button>
    const nestedButtons = await page.evaluate(() => {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        if (btn.querySelector('button')) return true;
      }
      return false;
    });
    expect(nestedButtons).toBe(false);
    expect(calls['startJob']).toBeGreaterThanOrEqual(1);
  });

  test('Go Live flow calls publish/start and shows LIVE badge', async ({
    page,
  }) => {
    const { calls } = await mockApis(page);
    await page.goto('/');
    await expect(page.getByText('Lightning Studio')).toBeVisible();

    // 1. Start a job
    await page.fill('input[placeholder="model_id"]', 'noop');
    await page.click('button:has-text("Start")');
    await expect(
      page.locator('[role="button"]').filter({ hasText: /e2e-test/ }),
    ).toBeVisible({ timeout: 5_000 });

    // 2. Start the webcam (uses Chromium's fake device)
    const startCameraBtn = page.locator('button:has-text("Start")').last();
    await startCameraBtn.click();

    // Wait for the webcam preview video to become visible
    const webcamVideo = page.locator('video').first();
    await expect(webcamVideo).toBeVisible({ timeout: 5_000 });

    // 3. Go Live button should now be enabled
    const goLiveBtn = page.locator('button:has-text("Go Live")');
    await expect(goLiveBtn).toBeVisible({ timeout: 5_000 });
    await goLiveBtn.click();

    // 4. Wait for publish/start to be called
    await expect
      .poll(() => calls['publishStart'], { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // 5. LIVE badge should appear in header area (output preview)
    const liveBadge = page.locator('span', { hasText: /^LIVE$/ }).first();
    await expect(liveBadge).toBeVisible({ timeout: 5_000 });
  });

  test('playback: VideoPlayer receives subscribe URL and fetches stream', async ({
    page,
  }) => {
    const { calls } = await mockApis(page);
    await page.goto('/');
    await expect(page.getByText('Lightning Studio')).toBeVisible();

    // Start a job
    await page.fill('input[placeholder="model_id"]', 'noop');
    await page.click('button:has-text("Start")');
    await expect(
      page.locator('[role="button"]').filter({ hasText: /e2e-test/ }),
    ).toBeVisible({ timeout: 5_000 });

    // Start webcam
    const startCameraBtn = page.locator('button:has-text("Start")').last();
    await startCameraBtn.click();
    await expect(page.locator('video').first()).toBeVisible({ timeout: 5_000 });

    // Go Live
    await page.locator('button:has-text("Go Live")').click();

    // Wait for publish to start
    await expect
      .poll(() => calls['publishStart'], { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // The subscribe URL should be fetched (VideoPlayer mounts with URL)
    await expect
      .poll(() => calls['subscribe'], { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);

    // Verify video elements exist (webcam + output = 2)
    const videos = page.locator('video');
    await expect(videos).toHaveCount(2);

    // Verify chunks are being sent from MediaRecorder
    await expect
      .poll(() => calls['publishChunk'], { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test('Stop Live stops media bridge and clears LIVE badge', async ({
    page,
  }) => {
    const { calls } = await mockApis(page);
    await page.goto('/');
    await expect(page.getByText('Lightning Studio')).toBeVisible();

    // Start job -> webcam -> Go Live
    await page.fill('input[placeholder="model_id"]', 'noop');
    await page.click('button:has-text("Start")');
    await expect(
      page.locator('[role="button"]').filter({ hasText: /e2e-test/ }),
    ).toBeVisible({ timeout: 5_000 });

    const startCameraBtn = page.locator('button:has-text("Start")').last();
    await startCameraBtn.click();
    await expect(page.locator('video').first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("Go Live")').click();
    const liveBadge = page.locator('span', { hasText: /^LIVE$/ }).first();
    await expect(liveBadge).toBeVisible({ timeout: 10_000 });

    // Stop Live
    const stopLiveBtn = page.locator('button:has-text("Stop Live")');
    await expect(stopLiveBtn).toBeVisible({ timeout: 5_000 });
    await stopLiveBtn.click();

    // Stop Live button should be replaced by Go Live
    await expect(
      page.locator('button:has-text("Go Live")'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('console has no button nesting warnings', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await mockApis(page);
    await page.goto('/');
    await expect(page.getByText('Lightning Studio')).toBeVisible();

    // Start a job to trigger job list rendering
    await page.fill('input[placeholder="model_id"]', 'noop');
    await page.click('button:has-text("Start")');
    await expect(
      page.locator('[role="button"]').filter({ hasText: /e2e-test/ }),
    ).toBeVisible({ timeout: 5_000 });

    // Wait a beat for any deferred warnings
    await page.waitForTimeout(1000);

    const nestingError = consoleErrors.find(
      (e) =>
        e.includes('cannot be a descendant of') ||
        e.includes('button') && e.includes('hydration'),
    );
    expect(nestingError).toBeUndefined();
  });
});
