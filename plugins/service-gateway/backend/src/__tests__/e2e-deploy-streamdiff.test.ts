/**
 * E2E Deployment Test: StreamDiffusion SDXL via SSH Bridge
 *
 * Prerequisites (configure via env vars):
 *   E2E_SSH_HOST     - Remote GPU machine
 *   E2E_SSH_PORT     - SSH port (default 22)
 *   E2E_SSH_USER     - SSH username with docker group membership
 *   E2E_SSH_KEY_PATH - Path to local SSH private key
 *   HF_TOKEN         - HuggingFace API token
 *   SSH_BRIDGE_URL   - SSH Bridge base URL (default http://localhost:4116)
 *   NAAP_GW_URL      - NaaP gateway URL (alternative to direct bridge)
 *   NAAP_GW_API_KEY  - Gateway API key (if using gateway)
 *
 * Run: RUN_E2E_DEPLOY=true npx vitest run e2e-deploy-streamdiff
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'fs';

const SKIP = process.env.RUN_E2E_DEPLOY !== 'true';
const HOST = process.env.E2E_SSH_HOST || '';
const PORT = parseInt(process.env.E2E_SSH_PORT || '22', 10);
const USER = process.env.E2E_SSH_USER || 'deploy';
const KEY_PATH = process.env.E2E_SSH_KEY_PATH || '';
const HF_TOKEN = process.env.HF_TOKEN || '';
const BASE_URL = process.env.SSH_BRIDGE_URL || 'http://localhost:4116';
const POLL_INTERVAL_MS = 30_000;
const DEPLOY_TIMEOUT_MS = 45 * 60 * 1000;

const DEPLOY_SCRIPT = `#!/bin/bash
set -euo pipefail

echo "=== Phase 1: Preflight checks ==="
docker --version
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
df -h / --output=avail | tail -1

echo "=== Phase 2: Pull StreamDiffusion ==="
if ! docker images | grep -q streamdiffusion; then
  docker pull ghcr.io/cumulo-autumn/streamdiffusion:latest 2>/dev/null || {
    echo "Pre-built image not found, pulling base pytorch image..."
    docker pull nvcr.io/nvidia/pytorch:24.01-py3
  }
fi

echo "=== Phase 3: Download SDXL model ==="
MODEL_DIR="/opt/models/sdxl"
mkdir -p "\${MODEL_DIR}"
if [ -z "$(ls -A \${MODEL_DIR} 2>/dev/null)" ]; then
  pip install -q huggingface_hub 2>/dev/null || pip3 install -q huggingface_hub
  python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('stabilityai/stable-diffusion-xl-base-1.0', local_dir='\${MODEL_DIR}', token='\${HF_TOKEN}')
print('Download complete')
"
else
  echo "Model already exists at \${MODEL_DIR}"
fi

echo "=== Phase 4: Start inference container ==="
docker stop streamdiff-sdxl 2>/dev/null || true
docker rm streamdiff-sdxl 2>/dev/null || true
docker run -d --name streamdiff-sdxl --gpus all \\
  -p 8080:8080 \\
  -v /opt/models:/models \\
  -e MODEL_PATH=/models/sdxl \\
  nvcr.io/nvidia/pytorch:24.01-py3 \\
  bash -c "pip install streamdiffusion && python -m streamdiffusion.server --model-path /models/sdxl --port 8080"

echo "=== Phase 5: Wait for health ==="
for i in \$(seq 1 30); do
  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo "Server healthy after \$((i * 10))s"
    exit 0
  fi
  echo "Waiting... (\$i/30)"
  sleep 10
done

echo "FAILED: Server not healthy after 300s"
docker logs streamdiff-sdxl --tail 50
exit 1`;

async function bridgeFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (KEY_PATH) {
    headers['x-ssh-private-key'] = readFileSync(KEY_PATH, 'utf-8');
  }
  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

describe.skipIf(SKIP)('E2E: Deploy StreamDiffusion SDXL', () => {
  let jobId: string;

  afterAll(async () => {
    if (!HOST) return;
    try {
      await bridgeFetch('/exec', {
        method: 'POST',
        body: JSON.stringify({
          host: HOST, port: PORT, username: USER,
          command: 'docker stop streamdiff-sdxl 2>/dev/null; docker rm streamdiff-sdxl 2>/dev/null; rm -rf /opt/models/sdxl',
          timeout: 30000,
        }),
      });
    } catch { /* best-effort cleanup */ }
  });

  it('connects to remote host', async () => {
    const res = await bridgeFetch('/connect', {
      method: 'POST',
      body: JSON.stringify({ host: HOST, port: PORT, username: USER }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
  }, 20_000);

  it('passes preflight checks', async () => {
    const res = await bridgeFetch('/exec', {
      method: 'POST',
      body: JSON.stringify({
        host: HOST, port: PORT, username: USER,
        command: 'docker --version && nvidia-smi --query-gpu=name --format=csv,noheader',
        timeout: 15000,
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.exitCode).toBe(0);
  }, 20_000);

  it('submits deployment script', async () => {
    const res = await bridgeFetch('/exec/script', {
      method: 'POST',
      body: JSON.stringify({
        host: HOST, port: PORT, username: USER,
        script: DEPLOY_SCRIPT,
        env: { HF_TOKEN },
        timeout: DEPLOY_TIMEOUT_MS,
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.jobId).toBeTruthy();
    jobId = body.data.jobId;
  }, 60_000);

  it('completes deployment', async () => {
    const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
    let status = 'running';

    while (Date.now() < deadline && status === 'running') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await bridgeFetch(`/jobs/${jobId}`);
      const body = await res.json();
      status = body.data.status;
      if (body.data.stdoutTail) {
        process.stdout.write(body.data.stdoutTail.slice(-200) + '\n');
      }
    }

    expect(status).toBe('completed');

    const finalRes = await bridgeFetch(`/jobs/${jobId}`);
    const finalBody = await finalRes.json();
    expect(finalBody.data.exitCode).toBe(0);
  }, DEPLOY_TIMEOUT_MS + 60_000);

  it('verifies inference server is healthy', async () => {
    const res = await bridgeFetch('/exec', {
      method: 'POST',
      body: JSON.stringify({
        host: HOST, port: PORT, username: USER,
        command: 'curl -sf http://localhost:8080/health',
        timeout: 10000,
      }),
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.exitCode).toBe(0);
  }, 15_000);
}, DEPLOY_TIMEOUT_MS + 120_000);
