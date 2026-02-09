# Livepeer Services Configuration Guide

This guide explains how the NaaP platform integrates with the Livepeer network, how to configure the services to talk to go-livepeer nodes (gateways and orchestrators), and how plugin developers can use the SDK hooks for Livepeer features.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    NaaP Platform                          │
│                                                          │
│  ┌──────────────┐    ┌─────────────────┐                │
│  │  livepeer-svc │    │ pipeline-gateway │                │
│  │  (port 4010)  │    │  (port 4020)     │                │
│  └──────┬───────┘    └───────┬─────────┘                │
│         │                    │                           │
│         │  CLI + AI APIs     │  AI API only              │
│         ▼                    ▼                           │
│  ┌──────────────────────────────────────┐                │
│  │       go-livepeer Node               │                │
│  │  CLI API  :7935  (localhost only)    │                │
│  │  AI API   :9935  (AI gateway)       │                │
│  │  RTMP     :1935  (media ingest)     │                │
│  └──────────────────────────────────────┘                │
│                                                          │
│  ┌──────────────┐    ┌──────────────────┐               │
│  │ Plugin SDK    │    │  @naap/web3      │               │
│  │ useLivepeer*  │    │  useStaking()    │               │
│  │ usePipeline*  │    │  useLPTBalance() │               │
│  └──────────────┘    └──────────────────┘               │
└──────────────────────────────────────────────────────────┘
```

There are **two backend services** that talk to the Livepeer network:

| Service | Port | Purpose |
|---------|------|---------|
| **livepeer-svc** | 4010 | Orchestrator queries, staking info, delegator data, protocol parameters, direct AI calls |
| **pipeline-gateway** | 4020 | AI/video pipeline execution with adapters, feature flags, rate limiting, BYOC |

And **three client packages** used by plugins:

| Package | Purpose |
|---------|---------|
| `@naap/livepeer-node-client` | Low-level HTTP clients for go-livepeer CLI, Media, and AI APIs |
| `@naap/livepeer-pipeline` | Pipeline contract interfaces (adapters, registry, envelope format) |
| `@naap/livepeer-contracts` | Ethereum contract ABIs and addresses for LPT, BondingManager, RoundsManager |

---

## 1. Connecting to go-livepeer

### Prerequisites

You need a running go-livepeer node. There are two main modes:

**Gateway mode** (recommended for AI pipelines):
```bash
livepeer -gateway -network arbitrum-one-mainnet \
  -ethUrl https://arb1.arbitrum.io/rpc \
  -ethKeystorePath /path/to/keystore \
  -httpAddr 0.0.0.0:9935 \
  -cliAddr 127.0.0.1:7935
```

**Orchestrator mode** (for running your own orchestrator):
```bash
livepeer -orchestrator -transcoder -network arbitrum-one-mainnet \
  -ethUrl https://arb1.arbitrum.io/rpc \
  -ethKeystorePath /path/to/keystore \
  -serviceAddr your-public-ip:8935 \
  -cliAddr 127.0.0.1:7935 \
  -httpAddr 0.0.0.0:9935
```

### Key go-livepeer Ports

| Port | Protocol | Description |
|------|----------|-------------|
| **7935** | HTTP | CLI API (localhost only) -- node status, orchestrator queries, staking, protocol params |
| **8935** | HTTP | Service endpoint (orchestrator/transcoder -- public) |
| **9935** | HTTP | AI Gateway / HTTP ingest endpoint |
| **1935** | RTMP | Media ingest (legacy) |

---

## 2. Environment Variables

### livepeer-svc (port 4010)

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVEPEER_CLI_URL` | `http://localhost:7935` | go-livepeer CLI API endpoint |
| `LIVEPEER_AI_URL` | `http://localhost:9935` | go-livepeer AI/Gateway API endpoint |
| `PORT` | `4010` | Service listening port |

### pipeline-gateway (port 4020)

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVEPEER_AI_URL` | `http://localhost:9935` | go-livepeer AI API endpoint |
| `PORT` | `4020` | Service listening port |
| `FEATURE_FLAG_URL` | *(derived from BASE_SVC_URL)* | URL to fetch feature flags |
| `BASE_SVC_URL` | `http://localhost:4000` | Base service URL (used to build feature flag URL) |

### Example `.env` configuration

```bash
# ── Livepeer Node Connection ──
# Point these to your go-livepeer node
LIVEPEER_CLI_URL=http://localhost:7935
LIVEPEER_AI_URL=http://localhost:9935

# ── For remote nodes (e.g., running on a server) ──
# LIVEPEER_CLI_URL=http://your-node-ip:7935
# LIVEPEER_AI_URL=http://your-node-ip:9935

# ── Service ports ──
# These default values work out of the box
# PORT_LIVEPEER_SVC=4010
# PORT_PIPELINE_GATEWAY=4020
```

---

## 3. Starting the Livepeer Services

### Manual start

```bash
# Start livepeer-svc
cd services/livepeer-svc
LIVEPEER_CLI_URL=http://localhost:7935 LIVEPEER_AI_URL=http://localhost:9935 npx tsx src/server.ts

# Start pipeline-gateway (in another terminal)
cd services/pipeline-gateway
LIVEPEER_AI_URL=http://localhost:9935 npx tsx src/server.ts
```

### Verify health

```bash
# livepeer-svc
curl http://localhost:4010/healthz
# Expected: {"status":"ok","service":"livepeer"}

# pipeline-gateway
curl http://localhost:4020/healthz
# Expected: {"status":"ok","service":"pipeline-gateway"}
```

---

## 4. API Reference

### livepeer-svc Endpoints

```
GET  /api/v1/livepeer/node/status           # Node status (up/down, version, addresses)
GET  /api/v1/livepeer/orchestrators          # List registered orchestrators
GET  /api/v1/livepeer/orchestrators/:addr    # Single orchestrator details
GET  /api/v1/livepeer/delegator/:addr        # Delegator info (staking position)
GET  /api/v1/livepeer/protocol               # Protocol parameters (round, inflation, etc.)
GET  /api/v1/livepeer/rounds/current         # Current round info
GET  /api/v1/livepeer/sender/:addr           # Gateway sender deposit/reserve info

POST /api/v1/livepeer/ai/:pipeline           # Execute an AI pipeline directly
POST /api/v1/livepeer/ai/live-video-to-video # Start live video-to-video (WebRTC)
POST /api/v1/livepeer/gateway/fund           # Fund gateway deposit
POST /api/v1/livepeer/gateway/unlock         # Unlock gateway deposit
POST /api/v1/livepeer/gateway/withdraw       # Withdraw unlocked deposit
```

### pipeline-gateway Endpoints

```
GET  /api/v1/pipelines/pipelines             # List available pipelines (feature-flag filtered)
GET  /api/v1/pipelines/models/:pipeline      # List models for a pipeline
POST /api/v1/pipelines/execute/:pipeline     # Execute a pipeline (batch AI)
POST /api/v1/pipelines/stream/start          # Start a streaming session
POST /api/v1/pipelines/stream/:id/update     # Update streaming session params
POST /api/v1/pipelines/stream/:id/stop       # Stop a streaming session
GET  /api/v1/pipelines/jobs/:jobId           # Check async job status
POST /api/v1/pipelines/llm/complete          # LLM completion (streaming SSE)
POST /api/v1/pipelines/byoc/capabilities     # Register BYOC capability
GET  /api/v1/pipelines/metrics               # Pipeline usage metrics
```

---

## 5. Plugin SDK Hooks

### Livepeer Hooks (from `@naap/plugin-sdk`)

```typescript
import {
  useLivepeerNode,       // Node status (connected, version, address)
  useLivepeerNodes,      // Multi-node management
  useLivepeerOrchestrators, // List all orchestrators
  useLivepeerAI,         // Execute AI pipelines via livepeer-svc
  useLiveVideoToVideo,   // WebRTC live video-to-video
  useNetworkStats,       // Protocol parameters + round info
  useGatewayFunding,     // Manage gateway deposit (fund/unlock/withdraw)
} from '@naap/plugin-sdk';
```

**Example: Show node status**
```tsx
function NodeStatus() {
  const { data: node, isLoading } = useLivepeerNode();

  if (isLoading) return <p>Loading...</p>;
  return (
    <div>
      <p>Connected: {node?.connected ? 'Yes' : 'No'}</p>
      <p>Address: {node?.addresses?.node}</p>
    </div>
  );
}
```

**Example: List orchestrators**
```tsx
function OrchestratorList() {
  const { data: orchestrators } = useLivepeerOrchestrators();

  return (
    <ul>
      {orchestrators?.map(o => (
        <li key={o.address}>
          {o.address} -- Stake: {o.delegatedStake}
        </li>
      ))}
    </ul>
  );
}
```

### Pipeline Hooks

```typescript
import {
  usePipelines,      // List available AI pipelines
  usePipeline,       // Execute a specific pipeline
  useLLM,            // LLM streaming completion
  useLiveSession,    // Manage live video sessions (start/update/stop)
  useAsyncJob,       // Poll async job status
  usePipelineQuota,  // Check user quota / rate limits
  usePipelineFlags,  // Feature flag awareness
} from '@naap/plugin-sdk';
```

**Example: Run an AI pipeline**
```tsx
function ImageGenerator() {
  const { execute, result, loading, error } = usePipeline<{ url: string }>('text-to-image');

  return (
    <div>
      <button onClick={() => execute({
        model: 'stabilityai/sd-turbo',
        params: { prompt: 'a beautiful sunset over mountains' }
      })}>
        Generate
      </button>
      {loading && <p>Generating...</p>}
      {result && <img src={result.result.url} />}
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

**Example: LLM streaming**
```tsx
function ChatBot() {
  const { complete, chunks, streaming } = useLLM();

  return (
    <div>
      <button onClick={() => complete({
        model: 'meta-llama/Llama-3.1-8B-Instruct',
        messages: [{ role: 'user', content: 'Hello!' }],
      })}>
        Send
      </button>
      <pre>{chunks.join('')}</pre>
      {streaming && <span>Typing...</span>}
    </div>
  );
}
```

### Web3 / Staking Hooks

```typescript
import {
  useWalletConnect,     // Connect MetaMask / Web3 wallet
  useLPTBalance,        // LPT token balance
  useStaking,           // Bond/unbond LPT to orchestrators
  useCurrentRound,      // Current Livepeer round info
  useSwitchNetwork,     // Switch to Arbitrum
} from '@naap/web3';
// or
import { useStaking, useLPTBalance } from '@naap/livepeer-contracts';
```

**Example: Stake LPT**
```tsx
function StakingPanel() {
  const { bond, unbond, loading } = useStaking();
  const { data: balance } = useLPTBalance();

  return (
    <div>
      <p>LPT Balance: {balance}</p>
      <button
        disabled={loading}
        onClick={() => bond('0xOrchestrator...', '100')}
      >
        Bond 100 LPT
      </button>
    </div>
  );
}
```

---

## 6. Network Configuration

### Mainnet (Arbitrum One)

For production use on Arbitrum mainnet:

```bash
# go-livepeer
livepeer -gateway -network arbitrum-one-mainnet \
  -ethUrl https://arb1.arbitrum.io/rpc \
  -ethKeystorePath /path/to/keystore

# NaaP env
LIVEPEER_CLI_URL=http://localhost:7935
LIVEPEER_AI_URL=http://localhost:9935
```

Contract addresses (Arbitrum One, chain ID 42161):
| Contract | Address |
|----------|---------|
| BondingManager | `0x35Bcf3c30594191d53231E4FF333E8A770453e40` |
| RoundsManager | `0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f` |
| LPT Token | `0x289ba1701C2F088cf0faf8B3705246331cB8A839` |

### Testnet (Arbitrum Sepolia)

For development/testing:

```bash
# go-livepeer  
livepeer -gateway -network arbitrum-one-sepolia \
  -ethUrl https://sepolia-rollup.arbitrum.io/rpc \
  -ethKeystorePath /path/to/test-keystore
```

### Without a Node (Mock Mode)

If you don't have a go-livepeer node running, the services will start but return errors for Livepeer-specific operations. Other platform features continue to work normally.

```bash
# livepeer-svc will start but node queries will fail gracefully
# The /healthz endpoint will still return 200
LIVEPEER_CLI_URL=http://localhost:7935  # nothing listening = graceful failures
```

---

## 7. Advanced: BYOC (Bring Your Own Capability)

Plugins can register custom pipeline capabilities with the pipeline-gateway:

```typescript
// Register a custom pipeline from your plugin backend
const response = await fetch('http://localhost:4020/api/v1/pipelines/byoc/capabilities', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'my-custom-pipeline',
    type: 'batch',
    endpoint: 'http://localhost:4050/process',
    healthEndpoint: 'http://localhost:4050/health',
    models: [
      { id: 'my-model-v1', name: 'My Custom Model' }
    ],
    metadata: {
      provider: 'my-plugin',
      description: 'Custom image processing pipeline'
    }
  })
});
```

Once registered, the pipeline becomes available through the standard `usePipeline()` hook:

```typescript
const { execute, result } = usePipeline('my-custom-pipeline');
```

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `livepeer-svc` returns 500 on `/node/status` | go-livepeer not running or CLI URL wrong | Check `LIVEPEER_CLI_URL` points to a running node's CLI port |
| `pipeline-gateway` can't discover pipelines | AI gateway not accessible | Verify `LIVEPEER_AI_URL` and that go-livepeer is running with `-gateway` flag |
| `useLivepeerNode()` shows disconnected | livepeer-svc not started or not proxied | Ensure livepeer-svc is running and the API gateway routes `/api/v1/livepeer/*` correctly |
| Staking transactions fail | Wrong network or no ETH for gas | Ensure wallet is connected to Arbitrum (chain ID 42161) and has ETH for gas |
| BYOC health checks failing | Registered endpoint is down | Check that the BYOC endpoint responds to GET requests at the health URL |

### Useful debugging commands

```bash
# Check if go-livepeer CLI is accessible
curl http://localhost:7935/status

# Check orchestrator list from go-livepeer directly
curl http://localhost:7935/registeredOrchestrators

# Check AI capabilities
curl http://localhost:9935/capabilities

# Check pipeline-gateway discovered pipelines
curl http://localhost:4020/api/v1/pipelines/pipelines

# Check livepeer-svc node status
curl http://localhost:4010/api/v1/livepeer/node/status
```
