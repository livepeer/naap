/**
 * Build-Time Capability Explorer Seed
 *
 * Seeds demo data into the database so preview deployments
 * have data to demonstrate the capability explorer UI.
 *
 * Seeds:
 *   - CapabilityExplorerConfig (default settings)
 *   - CapabilityMergedView (static demo capabilities)
 *   - CapabilityQuery (4 demo queries for the first user)
 *
 * Idempotent — skips if already exists.
 *
 * Required env vars:
 *   DATABASE_URL - Postgres connection string
 *
 * Usage:
 *   npx tsx bin/seed-capability-explorer.ts
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';

const DEMO_CAPABILITIES = [
  {
    id: 'text-to-image',
    name: 'Text to Image',
    category: 't2i',
    source: 'livepeer-network',
    version: '1.0',
    description: 'Generate high-quality images from text prompts using state-of-the-art diffusion models. Supports multiple model architectures including Stable Diffusion, SDXL, and Lightning variants.',
    modelSourceUrl: 'https://huggingface.co/stabilityai/sdxl-turbo',
    thumbnail: null,
    license: 'openrail++',
    tags: ['t2i', 'text-to-image', 'diffusion', 'stable-diffusion'],
    gpuCount: 12,
    totalCapacity: 48,
    orchestratorCount: 8,
    avgLatencyMs: 320,
    bestLatencyMs: 180,
    avgFps: null,
    meanPriceUsd: 0.003,
    minPriceUsd: 0.001,
    maxPriceUsd: 0.005,
    priceUnit: 'pixel',
    sdkSnippet: {
      curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/text-to-image" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"prompt": "a beautiful sunset over mountains", "model_id": "text-to-image", "width": 1024, "height": 1024}\'',
      python: 'import requests\n\nurl = "https://dream-gateway.livepeer.cloud/text-to-image"\nheaders = {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json",\n}\npayload = {"prompt": "a beautiful sunset over mountains", "model_id": "text-to-image", "width": 1024, "height": 1024}\n\nresponse = requests.post(url, headers=headers, json=payload)\nprint(response.json())',
      javascript: 'const response = await fetch("https://dream-gateway.livepeer.cloud/text-to-image", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({"prompt": "a beautiful sunset over mountains", "model_id": "text-to-image", "width": 1024, "height": 1024}),\n});\n\nconst result = await response.json();\nconsole.log(result);',
    },
    models: [
      { modelId: 'sdxl-turbo', name: 'SDXL Turbo', warm: true, huggingFaceUrl: 'https://huggingface.co/stabilityai/sdxl-turbo', description: 'Fast text-to-image model', avgFps: null, gpuCount: 8, meanPriceUsd: 0.003 },
      { modelId: 'sd-turbo', name: 'SD Turbo', warm: true, huggingFaceUrl: 'https://huggingface.co/stabilityai/sd-turbo', description: null, avgFps: null, gpuCount: 4, meanPriceUsd: 0.002 },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'llm',
    name: 'LLM',
    category: 'llm',
    source: 'livepeer-network',
    version: '1.0',
    description: 'Run large language model inference with OpenAI-compatible chat completions API. Supports streaming, tool calling, and multiple model families.',
    modelSourceUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct',
    thumbnail: null,
    license: 'llama3.1',
    tags: ['llm', 'chat', 'text-generation', 'openai-compatible'],
    gpuCount: 6,
    totalCapacity: 24,
    orchestratorCount: 5,
    avgLatencyMs: 150,
    bestLatencyMs: 80,
    avgFps: null,
    meanPriceUsd: 0.0001,
    minPriceUsd: 0.00005,
    maxPriceUsd: 0.0002,
    priceUnit: 'token',
    sdkSnippet: {
      curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/llm" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model": "llm", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 256}\'',
      python: 'import requests\n\nurl = "https://dream-gateway.livepeer.cloud/llm"\nheaders = {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json",\n}\npayload = {"model": "llm", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 256}\n\nresponse = requests.post(url, headers=headers, json=payload)\nprint(response.json())',
      javascript: 'const response = await fetch("https://dream-gateway.livepeer.cloud/llm", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({"model": "llm", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 256}),\n});\n\nconst result = await response.json();\nconsole.log(result);',
    },
    models: [
      { modelId: 'meta-llama/Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B Instruct', warm: true, huggingFaceUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct', description: 'Meta Llama 3.1 8B parameter instruction-tuned model', avgFps: null, gpuCount: 6, meanPriceUsd: 0.0001 },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'image-to-video',
    name: 'Image to Video',
    category: 'i2v',
    source: 'livepeer-network',
    version: '1.0',
    description: 'Transform static images into dynamic video clips using video diffusion models. Creates smooth, natural motion from a single reference image.',
    modelSourceUrl: 'https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt',
    thumbnail: null,
    license: 'svd-nc',
    tags: ['i2v', 'image-to-video', 'video-generation', 'svd'],
    gpuCount: 4,
    totalCapacity: 12,
    orchestratorCount: 3,
    avgLatencyMs: 2500,
    bestLatencyMs: 1800,
    avgFps: 0.4,
    meanPriceUsd: 0.015,
    minPriceUsd: 0.01,
    maxPriceUsd: 0.025,
    priceUnit: 'pixel',
    sdkSnippet: {
      curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/image-to-video" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -F "image=@input.png" -F "model_id=image-to-video"',
      python: 'import requests\n\nurl = "https://dream-gateway.livepeer.cloud/image-to-video"\nheaders = {"Authorization": "Bearer YOUR_API_KEY"}\nfiles = {"image": open("input.png", "rb")}\ndata = {"model_id": "image-to-video"}\n\nresponse = requests.post(url, headers=headers, files=files, data=data)\nprint(response.json())',
      javascript: 'const formData = new FormData();\nformData.append("image", fileInput);\nformData.append("model_id", "image-to-video");\n\nconst response = await fetch("https://dream-gateway.livepeer.cloud/image-to-video", {\n  method: "POST",\n  headers: { "Authorization": "Bearer YOUR_API_KEY" },\n  body: formData,\n});\n\nconst result = await response.json();\nconsole.log(result);',
    },
    models: [
      { modelId: 'svd-xt', name: 'SVD XT', warm: true, huggingFaceUrl: 'https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt', description: 'Stable Video Diffusion extended', avgFps: 0.4, gpuCount: 4, meanPriceUsd: 0.015 },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'audio-to-text',
    name: 'Audio to Text',
    category: 'a2t',
    source: 'livepeer-network',
    version: '1.0',
    description: 'Transcribe audio into text using Whisper speech recognition models. Supports multiple languages and automatic language detection.',
    modelSourceUrl: 'https://huggingface.co/openai/whisper-large-v3',
    thumbnail: null,
    license: 'apache-2.0',
    tags: ['a2t', 'audio-to-text', 'whisper', 'transcription', 'speech-recognition'],
    gpuCount: 5,
    totalCapacity: 20,
    orchestratorCount: 4,
    avgLatencyMs: 450,
    bestLatencyMs: 200,
    avgFps: null,
    meanPriceUsd: 0.002,
    minPriceUsd: 0.001,
    maxPriceUsd: 0.004,
    priceUnit: 'pixel',
    sdkSnippet: {
      curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/audio-to-text" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -F "audio=@input.wav" -F "model_id=audio-to-text"',
      python: 'import requests\n\nurl = "https://dream-gateway.livepeer.cloud/audio-to-text"\nheaders = {"Authorization": "Bearer YOUR_API_KEY"}\nfiles = {"audio": open("input.wav", "rb")}\ndata = {"model_id": "audio-to-text"}\n\nresponse = requests.post(url, headers=headers, files=files, data=data)\nprint(response.json())',
      javascript: 'const formData = new FormData();\nformData.append("audio", fileInput);\nformData.append("model_id", "audio-to-text");\n\nconst response = await fetch("https://dream-gateway.livepeer.cloud/audio-to-text", {\n  method: "POST",\n  headers: { "Authorization": "Bearer YOUR_API_KEY" },\n  body: formData,\n});\n\nconst result = await response.json();\nconsole.log(result);',
    },
    models: [
      { modelId: 'whisper-large-v3', name: 'Whisper Large V3', warm: true, huggingFaceUrl: 'https://huggingface.co/openai/whisper-large-v3', description: 'OpenAI Whisper large v3', avgFps: null, gpuCount: 5, meanPriceUsd: 0.002 },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'text-to-speech',
    name: 'Text to Speech',
    category: 'tts',
    source: 'livepeer-network',
    version: '1.0',
    description: 'Convert text into natural-sounding speech using neural TTS models. Supports multiple voices and speaking styles.',
    modelSourceUrl: '',
    thumbnail: null,
    license: 'apache-2.0',
    tags: ['tts', 'text-to-speech', 'speech-synthesis'],
    gpuCount: 3,
    totalCapacity: 10,
    orchestratorCount: 2,
    avgLatencyMs: 280,
    bestLatencyMs: 150,
    avgFps: null,
    meanPriceUsd: 0.001,
    minPriceUsd: 0.0005,
    maxPriceUsd: 0.002,
    priceUnit: 'pixel',
    sdkSnippet: {
      curl: 'curl -X POST "https://dream-gateway.livepeer.cloud/text-to-speech" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"text": "Hello, world!", "model_id": "text-to-speech"}\'',
      python: 'import requests\n\nurl = "https://dream-gateway.livepeer.cloud/text-to-speech"\nheaders = {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json",\n}\npayload = {"text": "Hello, world!", "model_id": "text-to-speech"}\n\nresponse = requests.post(url, headers=headers, json=payload)\nprint(response.json())',
      javascript: 'const response = await fetch("https://dream-gateway.livepeer.cloud/text-to-speech", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({"text": "Hello, world!", "model_id": "text-to-speech"}),\n});\n\nconst result = await response.json();\nconsole.log(result);',
    },
    models: [
      { modelId: 'text-to-speech', name: 'Text to Speech', warm: true, huggingFaceUrl: '', description: null, avgFps: null, gpuCount: 3, meanPriceUsd: 0.001 },
    ],
    lastUpdated: new Date().toISOString(),
  },
];

const DEMO_STATS = {
  totalCapabilities: DEMO_CAPABILITIES.length,
  totalModels: DEMO_CAPABILITIES.reduce((sum, c) => sum + c.models.length, 0),
  totalGpus: DEMO_CAPABILITIES.reduce((sum, c) => sum + c.gpuCount, 0),
  totalOrchestrators: DEMO_CAPABILITIES.reduce((sum, c) => sum + c.orchestratorCount, 0),
  avgPriceUsd: DEMO_CAPABILITIES.reduce((sum, c) => sum + (c.meanPriceUsd || 0), 0) / DEMO_CAPABILITIES.length,
};

const categoryMap = new Map<string, { label: string; count: number; icon: string }>();
for (const cap of DEMO_CAPABILITIES) {
  const existing = categoryMap.get(cap.category);
  if (existing) {
    existing.count++;
  } else {
    categoryMap.set(cap.category, { label: cap.name, count: 1, icon: cap.category });
  }
}
const DEMO_CATEGORIES = Array.from(categoryMap.entries()).map(([id, info]) => ({
  id,
  ...info,
}));

const DEMO_QUERY_TEMPLATES = [
  { slug: 'top-image-gen', name: 'Top Image Generation', category: 't2i', sortBy: 'gpuCount', sortOrder: 'desc', limit: 20 },
  { slug: 'budget-llm', name: 'Budget LLM Models', category: 'llm', sortBy: 'price', sortOrder: 'asc', limit: 15, maxPriceUsd: 0.01 },
  { slug: 'high-capacity-video', name: 'High Capacity Video', category: 'i2v', sortBy: 'capacity', sortOrder: 'desc', limit: 10, minGpuCount: 3 },
  { slug: 'all-capabilities', name: 'All Capabilities Overview', sortBy: 'name', sortOrder: 'asc', limit: 50 },
];

async function main() {
  console.log('[seed-cap-explorer] Seeding capability explorer...');

  const prisma = new PrismaClient();

  try {
    // Seed config
    const existingConfig = await prisma.capabilityExplorerConfig.findUnique({ where: { id: 'default' } });
    if (!existingConfig) {
      await prisma.capabilityExplorerConfig.create({
        data: {
          id: 'default',
          refreshIntervalHours: 4,
          enabledSources: { clickhouse: true, huggingface: true },
        },
      });
      console.log('[seed-cap-explorer] Created default config');
    } else {
      console.log('[seed-cap-explorer] Config already exists, skipping');
    }

    // Seed merged view
    const existingView = await prisma.capabilityMergedView.findUnique({ where: { id: 'singleton' } });
    if (!existingView) {
      await prisma.capabilityMergedView.create({
        data: {
          id: 'singleton',
          capabilities: DEMO_CAPABILITIES as unknown as Record<string, unknown>[],
          stats: DEMO_STATS as unknown as Record<string, unknown>,
          categories: DEMO_CATEGORIES as unknown as Record<string, unknown>[],
          sourceIds: ['seed'],
        },
      });
      console.log(`[seed-cap-explorer] Created merged view with ${DEMO_CAPABILITIES.length} capabilities`);
    } else {
      console.log('[seed-cap-explorer] Merged view already exists, skipping');
    }

    // Seed demo queries for first user
    let ownerUserId = SYSTEM_OWNER_ID;
    const existingUser = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existingUser) {
      ownerUserId = existingUser.id;
      console.log(`[seed-cap-explorer] Using existing user: ${ownerUserId}`);
    } else {
      console.log(`[seed-cap-explorer] No users found — using system owner ID`);
    }

    const teamId = `personal:${ownerUserId}`;

    const existingQueries = await prisma.capabilityQuery.findMany({
      where: { ownerUserId },
      select: { slug: true },
    });
    const existingSlugs = new Set(existingQueries.map((q) => q.slug));

    let created = 0;
    for (const tpl of DEMO_QUERY_TEMPLATES) {
      if (existingSlugs.has(tpl.slug)) continue;

      await prisma.capabilityQuery.create({
        data: {
          name: tpl.name,
          slug: tpl.slug,
          category: tpl.category ?? null,
          sortBy: tpl.sortBy ?? null,
          sortOrder: tpl.sortOrder ?? null,
          limit: tpl.limit,
          minGpuCount: ('minGpuCount' in tpl) ? (tpl as Record<string, unknown>).minGpuCount as number : null,
          maxPriceUsd: ('maxPriceUsd' in tpl) ? (tpl as Record<string, unknown>).maxPriceUsd as number : null,
          ownerUserId,
          teamId,
          enabled: true,
        },
      });
      console.log(`[seed-cap-explorer] Created query: ${tpl.name}`);
      created++;
    }

    console.log(`[seed-cap-explorer] Done — capabilities: ${DEMO_CAPABILITIES.length}, queries created: ${created}, queries skipped: ${existingQueries.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-cap-explorer] Failed:', err.message || err);
  process.exit(1);
});
