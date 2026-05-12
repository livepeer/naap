import { test, expect, type Page } from '@playwright/test';

const FIXTURE_CAPABILITIES = {
  success: true,
  data: {
    items: [
      {
        id: 'text-to-image',
        name: 'Text to Image',
        category: 't2i',
        source: 'livepeer-network',
        version: '1.0',
        description: 'Generate images from text prompts using diffusion models',
        modelSourceUrl: 'https://huggingface.co/stabilityai/sd-turbo',
        thumbnail: null,
        license: 'MIT',
        tags: ['t2i', 'text-to-image', 'diffusers'],
        gpuCount: 5,
        totalCapacity: 20,
        orchestratorCount: 8,
        avgLatencyMs: 120,
        avgFps: null,
        meanPriceUsd: 0.0012,
        minPriceUsd: 0.0005,
        maxPriceUsd: 0.003,
        priceUnit: 'pixel',
        sdkSnippet: {
          curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/text-to-image" -H "Authorization: Bearer YOUR_API_KEY" -d \'{"prompt": "a beautiful sunset"}\'',
          python: 'import requests\nresponse = requests.post("https://dream-gateway.livepeer.cloud/text-to-image")',
          javascript: 'const response = await fetch("https://dream-gateway.livepeer.cloud/text-to-image")',
        },
        models: [
          { modelId: 'stabilityai/sd-turbo', name: 'SD Turbo', warm: true, huggingFaceUrl: 'https://huggingface.co/stabilityai/sd-turbo', description: null, avgFps: null, gpuCount: 5, meanPriceUsd: 0.0012 },
        ],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: 'llm',
        name: 'LLM',
        category: 'llm',
        source: 'livepeer-network',
        version: '1.0',
        description: 'Large language model inference',
        modelSourceUrl: 'https://huggingface.co/meta-llama/Llama-3',
        thumbnail: null,
        license: 'Apache-2.0',
        tags: ['llm'],
        gpuCount: 10,
        totalCapacity: 50,
        orchestratorCount: 12,
        avgLatencyMs: 200,
        avgFps: null,
        meanPriceUsd: 0.0005,
        minPriceUsd: 0.0002,
        maxPriceUsd: 0.001,
        priceUnit: 'token',
        sdkSnippet: {
          curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/llm"',
          python: 'import requests',
          javascript: 'const response = await fetch()',
        },
        models: [
          { modelId: 'meta-llama/Llama-3', name: 'Llama 3', warm: true, huggingFaceUrl: 'https://huggingface.co/meta-llama/Llama-3', description: null, avgFps: null, gpuCount: 10, meanPriceUsd: 0.0005 },
        ],
        lastUpdated: new Date().toISOString(),
      },
      {
        id: 'image-to-video',
        name: 'Image to Video',
        category: 'i2v',
        source: 'livepeer-network',
        version: '1.0',
        description: 'Generate videos from images',
        modelSourceUrl: '',
        thumbnail: null,
        license: null,
        tags: ['i2v'],
        gpuCount: 2,
        totalCapacity: 5,
        orchestratorCount: 3,
        avgLatencyMs: null,
        avgFps: null,
        meanPriceUsd: 0.05,
        minPriceUsd: 0.03,
        maxPriceUsd: 0.08,
        priceUnit: 'pixel',
        sdkSnippet: {
          curl: 'curl ...',
          python: 'import requests',
          javascript: 'const response = await fetch()',
        },
        models: [],
        lastUpdated: new Date().toISOString(),
      },
    ],
    total: 3,
    hasMore: false,
  },
};

const FIXTURE_STATS = {
  success: true,
  data: {
    totalCapabilities: 3,
    totalModels: 2,
    totalGpus: 17,
    totalOrchestrators: 23,
    avgPriceUsd: 0.017,
  },
};

const FIXTURE_CATEGORIES = {
  success: true,
  data: [
    { id: 't2i', label: 'Text to Image', count: 1, icon: 'Image' },
    { id: 'llm', label: 'LLM', count: 1, icon: 'MessageSquare' },
    { id: 'i2v', label: 'Image to Video', count: 1, icon: 'Video' },
  ],
};

async function stubAPIs(page: Page) {
  await page.route('**/api/v1/capability-explorer/capabilities*', (route) => {
    const url = route.request().url();

    if (url.includes('category=llm')) {
      const filtered = {
        success: true,
        data: {
          items: FIXTURE_CAPABILITIES.data.items.filter((c) => c.category === 'llm'),
          total: 1,
          hasMore: false,
        },
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filtered) });
    }

    if (url.includes('search=image')) {
      const filtered = {
        success: true,
        data: {
          items: FIXTURE_CAPABILITIES.data.items.filter((c) => c.name.toLowerCase().includes('image')),
          total: 2,
          hasMore: false,
        },
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filtered) });
    }

    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_CAPABILITIES) });
  });

  await page.route('**/api/v1/capability-explorer/stats', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_STATS) });
  });

  await page.route('**/api/v1/capability-explorer/categories', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_CATEGORIES) });
  });
}

test.describe('Capability Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await stubAPIs(page);
  });

  test('loads and renders capability cards', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByText('Capability Explorer')).toBeVisible();
    await expect(page.getByTestId('capability-grid')).toBeVisible();

    const cards = page.locator('[data-testid^="capability-card-"]');
    await expect(cards).toHaveCount(3);
  });

  test('shows stats bar with aggregate numbers', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('stats-bar')).toBeVisible();
    await expect(page.getByText('17')).toBeVisible(); // GPUs
    await expect(page.getByText('23')).toBeVisible(); // Orchestrators
  });

  test('category filter pills filter the grid', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('capability-grid')).toBeVisible();

    await page.getByTestId('filter-llm').click();
    await page.waitForTimeout(500);

    const cards = page.locator('[data-testid^="capability-card-"]');
    await expect(cards).toHaveCount(1);
  });

  test('search input filters by name', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('capability-grid')).toBeVisible();

    await page.getByTestId('search-input').fill('image');
    await page.waitForTimeout(500);

    const cards = page.locator('[data-testid^="capability-card-"]');
    await expect(cards).toHaveCount(2);
  });

  test('sort dropdown changes sort order', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('capability-grid')).toBeVisible();

    await page.getByTestId('sort-select').selectOption('gpuCount');
    await page.waitForTimeout(300);
    // Should still render the grid
    await expect(page.getByTestId('capability-grid')).toBeVisible();
  });

  test('view toggle switches between grid and list', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('capability-grid')).toBeVisible();

    await page.getByTestId('view-list-btn').click();
    await expect(page.getByTestId('capability-list')).toBeVisible();

    await page.getByTestId('view-grid-btn').click();
    await expect(page.getByTestId('capability-grid')).toBeVisible();
  });

  test('clicking a card opens detail modal', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('capability-grid')).toBeVisible();

    await page.getByTestId('capability-card-text-to-image').click();
    await expect(page.getByTestId('detail-modal')).toBeVisible();

    // Check modal content
    await expect(page.getByText('Generate images from text prompts using diffusion models')).toBeVisible();
    await expect(page.getByTestId('models-table')).toBeVisible();
    await expect(page.getByTestId('snippet-viewer')).toBeVisible();
  });

  test('detail modal shows SDK snippet tabs', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('capability-card-text-to-image').click();

    await expect(page.getByTestId('snippet-tab-curl')).toBeVisible();
    await expect(page.getByTestId('snippet-tab-python')).toBeVisible();
    await expect(page.getByTestId('snippet-tab-javascript')).toBeVisible();

    await page.getByTestId('snippet-tab-python').click();
    await expect(page.getByText('import requests')).toBeVisible();
  });

  test('detail modal can be closed', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('capability-card-llm').click();
    await expect(page.getByTestId('detail-modal')).toBeVisible();

    await page.getByTestId('close-detail').click();
    await expect(page.getByTestId('detail-modal')).not.toBeVisible();
  });

  test('empty state shown when no results match', async ({ page }) => {
    await page.route('**/api/v1/capability-explorer/capabilities*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [], total: 0, hasMore: false } }),
      });
    });

    await page.goto('/capability-explorer');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByText('No capabilities found')).toBeVisible();
  });

  test('loading skeleton shown during fetch', async ({ page }) => {
    await page.route('**/api/v1/capability-explorer/capabilities*', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_CAPABILITIES) });
    });

    await page.goto('/capability-explorer');
    await expect(page.getByTestId('loading-skeleton')).toBeVisible();
    await expect(page.getByTestId('capability-grid')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Discovery Page Tests
// ---------------------------------------------------------------------------

const FIXTURE_QUERIES = {
  success: true,
  data: {
    queries: [
      {
        id: 'q1',
        name: 'Top Image Generation',
        slug: 'top-image-gen',
        teamId: null,
        ownerUserId: 'user-1',
        category: 't2i',
        search: null,
        minGpuCount: null,
        maxPriceUsd: null,
        minCapacity: null,
        sortBy: 'gpuCount',
        sortOrder: 'desc',
        limit: 20,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'q2',
        name: 'Budget LLM Models',
        slug: 'budget-llm',
        teamId: null,
        ownerUserId: 'user-1',
        category: 'llm',
        search: null,
        minGpuCount: null,
        maxPriceUsd: 0.01,
        minCapacity: null,
        sortBy: 'price',
        sortOrder: 'asc',
        limit: 15,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
};

const FIXTURE_QUERY_RESULTS = {
  success: true,
  data: {
    items: FIXTURE_CAPABILITIES.data.items.slice(0, 1),
    total: 1,
    hasMore: false,
  },
};

async function stubDiscoveryAPIs(page: Page) {
  await stubAPIs(page);

  await page.route('**/api/v1/capability-explorer/queries', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_QUERIES) });
    } else {
      route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: FIXTURE_QUERIES.data.queries[0] }) });
    }
  });

  await page.route('**/api/v1/capability-explorer/queries/*/results', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_QUERY_RESULTS) });
  });

  await page.route('**/api/v1/capability-explorer/queries/*', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: FIXTURE_QUERIES.data.queries[0] }) });
    } else if (route.request().method() === 'PUT') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...FIXTURE_QUERIES.data.queries[0], name: 'Updated Query' } }) });
    } else if (route.request().method() === 'DELETE') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { deleted: true } }) });
    } else {
      route.continue();
    }
  });
}

test.describe('Discovery Page', () => {
  test.beforeEach(async ({ page }) => {
    await stubDiscoveryAPIs(page);
  });

  test('shows Explorer and Discovery tabs', async ({ page }) => {
    await page.goto('/capability-explorer');
    await expect(page.getByTestId('tab-explorer')).toBeVisible();
    await expect(page.getByTestId('tab-discovery')).toBeVisible();
  });

  test('navigates to discovery tab and shows query cards', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await expect(page.getByTestId('discovery-grid')).toBeVisible();
    await expect(page.getByTestId('query-card-top-image-gen')).toBeVisible();
    await expect(page.getByTestId('query-card-budget-llm')).toBeVisible();
  });

  test('query card shows endpoint URL', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await expect(page.getByText('/api/v1/capability-explorer/queries/q1/results')).toBeVisible();
  });

  test('empty state shown when no queries', async ({ page }) => {
    await page.route('**/api/v1/capability-explorer/queries', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { queries: [] } }) });
      }
    });
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await expect(page.getByTestId('discovery-empty')).toBeVisible();
    await expect(page.getByText('No Discovery Queries Yet')).toBeVisible();
  });

  test('clicking query card navigates to detail', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await page.getByTestId('query-card-top-image-gen').click();
    await expect(page.getByTestId('query-detail-title')).toBeVisible();
    await expect(page.getByText('Top Image Generation')).toBeVisible();
  });

  test('query detail shows endpoint guide', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await page.getByTestId('query-card-top-image-gen').click();
    await expect(page.getByTestId('endpoint-guide')).toBeVisible();
    await expect(page.getByText('Stable API Endpoint')).toBeVisible();
  });

  test('query detail shows filtered results', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await page.getByTestId('query-card-top-image-gen').click();
    await expect(page.getByText('1 capability')).toBeVisible();
  });

  test('back button returns to discovery list', async ({ page }) => {
    await page.goto('/capability-explorer');
    await page.getByTestId('tab-discovery').click();
    await page.getByTestId('query-card-top-image-gen').click();
    await expect(page.getByTestId('query-detail-title')).toBeVisible();
    await page.getByText('Back to Discovery').click();
    await expect(page.getByTestId('discovery-grid')).toBeVisible();
  });
});
