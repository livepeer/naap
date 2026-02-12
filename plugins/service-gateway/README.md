# Service Gateway Plugin

Zero-code serverless API gateway for NaaP — expose any REST API as a managed, secure, team-scoped endpoint with authentication, rate limiting, usage tracking, and auto-generated documentation.

## Features

- **Zero-code connectors** — Configure everything through the Admin UI, no code required
- **Multi-tenant** — All data is team-scoped, complete isolation between teams
- **Dual-path authentication** — JWT for NaaP plugins, API keys for external consumers
- **Rate limiting** — Per-key rate limits via configurable plans (Redis + in-memory fallback)
- **Usage tracking** — Non-blocking per-request logging with analytics dashboard
- **Health monitoring** — Automatic upstream health checks every 5 minutes
- **SSE streaming** — Passthrough support for LLM-style streaming endpoints
- **SSRF protection** — Private IP blocking with configurable host allowlists
- **Pre-built templates** — AI/LLM, ClickHouse, Daydream — go from zero to live in 3 minutes

## Architecture

```
Consumer → Vercel Edge → Gateway Engine → Upstream Service
                           ↓
                     Resolve → Authorize → Policy → Validate → Transform → Proxy → Respond → Log
```

### Gateway Engine Pipeline

1. **Resolve** — Load connector + endpoint config from DB (cached 60s)
2. **Authorize** — Validate JWT or API key, extract team context
3. **Policy** — Rate limit + quota enforcement
4. **Validate** — Required headers, body regex, blacklist, JSON Schema
5. **Transform** — Build upstream URL, inject auth, transform body
6. **Proxy** — Send to upstream with timeout + retries
7. **Respond** — Wrap in NaaP envelope, strip sensitive headers
8. **Log** — Non-blocking usage record write

## Quick Start

### 1. Create a Connector (Admin UI)

Navigate to **Service Gateway** in the NaaP sidebar, click **+ New Connector**, and follow the 3-step wizard.

### 2. Create from Template (API)

```bash
curl -X POST /api/v1/gw/admin/templates \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "x-team-id: YOUR_TEAM_ID" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "ai-llm", "upstreamBaseUrl": "https://api.openai.com"}'
```

### 3. Create an API Key

```bash
curl -X POST /api/v1/gw/admin/keys \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "x-team-id: YOUR_TEAM_ID" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app", "connectorId": "CONNECTOR_ID"}'
```

### 4. Use the Gateway

```bash
curl -X POST /api/v1/gw/ai-llm/chat \
  -H "Authorization: Bearer gw_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## API Reference

### Gateway Engine

| Method | Path | Description |
|--------|------|-------------|
| ANY | `/api/v1/gw/:connector/:path` | Proxy to upstream service |

### Admin API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/gw/admin/connectors` | List connectors |
| POST | `/api/v1/gw/admin/connectors` | Create connector |
| GET | `/api/v1/gw/admin/connectors/:id` | Get connector detail |
| PUT | `/api/v1/gw/admin/connectors/:id` | Update connector |
| DELETE | `/api/v1/gw/admin/connectors/:id` | Archive connector |
| POST | `/api/v1/gw/admin/connectors/:id/test` | Test connectivity |
| POST | `/api/v1/gw/admin/connectors/:id/publish` | Publish connector |
| GET/POST | `/api/v1/gw/admin/connectors/:id/endpoints` | Manage endpoints |
| GET/POST | `/api/v1/gw/admin/keys` | Manage API keys |
| POST | `/api/v1/gw/admin/keys/:id/rotate` | Rotate key |
| GET/POST | `/api/v1/gw/admin/plans` | Manage rate limit plans |
| GET | `/api/v1/gw/admin/usage/summary` | Usage summary |
| GET | `/api/v1/gw/admin/usage/timeseries` | Timeseries data |
| GET | `/api/v1/gw/admin/health` | Health overview |
| POST | `/api/v1/gw/admin/health/check` | Trigger health check |
| GET/POST | `/api/v1/gw/admin/templates` | Connector templates |

## Templates

| Template | Auth | Endpoints | Use Case |
|----------|------|-----------|----------|
| AI / LLM | Bearer Token | Chat, Completions, Embeddings, Models | OpenAI, Anthropic, local LLMs |
| ClickHouse | Basic Auth | Query, Tables, Schema | Analytics queries (SELECT-only) |
| Daydream | Bearer Token | Create/Get/Update/Stop Stream | AI video generation |

## Database Schema

All models live in the `plugin_service_gateway` PostgreSQL schema:

- `ServiceConnector` — Upstream service config (team-scoped)
- `ConnectorEndpoint` — Route definitions per connector
- `GatewayApiKey` — Consumer API keys (SHA-256 hashed)
- `GatewayPlan` — Rate limit / quota tiers
- `GatewayUsageRecord` — Per-request usage logs
- `GatewayHealthCheck` — Upstream health history

## Troubleshooting

### Upstream returns 403

Check that your secrets are correctly stored. Re-enter them via the Admin UI Settings tab.

### Rate limit errors (429)

Check the assigned plan's rate limit. Upgrade the plan or reduce request frequency.

### Health check shows "down"

Verify the upstream URL and health check path. Use the "Test Connection" feature in the Admin UI.

### Connector not found (404)

Ensure the connector is **published** (not draft). Draft connectors are not accessible via the gateway engine.

## File Structure

```
plugins/service-gateway/
├── plugin.json                    # Plugin manifest
├── README.md                      # This file
├── templates/                     # Pre-built connector templates
│   ├── ai-llm.json
│   ├── clickhouse.json
│   └── daydream.json
├── database/
│   └── README.md                  # Schema documentation
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx                # Plugin entry + routing
        ├── mount.tsx              # UMD mount
        ├── hooks/
        │   └── useGatewayApi.ts   # API hooks
        ├── components/
        │   ├── TeamGuard.tsx
        │   ├── SecretField.tsx
        │   └── QuickStart.tsx
        └── pages/
            ├── ConnectorListPage.tsx
            ├── ConnectorWizardPage.tsx
            ├── ConnectorDetailPage.tsx
            ├── ApiKeysPage.tsx
            ├── PlansPage.tsx
            └── DashboardPage.tsx
```
