# Service Integration Guide

## Overview

NaaP plugin backends are **Express.js** servers (for local development) with corresponding **Next.js API route handlers** for production (Vercel). Plugins can also integrate with external APIs using the server SDK.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Plugin Backend Layer                      │
│                                                       │
│  Local Dev:    Express.js servers (ports 4001-4012)  │
│  Production:   Next.js API Route Handlers            │
│                                                       │
│  Both use:                                            │
│  ┌────────────────────┐  ┌────────────────────────┐  │
│  │  @naap/database    │  │  @naap/plugin-server-  │  │
│  │  (Prisma client)   │  │  sdk (middleware)       │  │
│  └────────────────────┘  └────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Plugin Backend Structure

```
plugins/my-plugin/backend/
├── src/
│   ├── server.ts          # Express entry point
│   ├── db/
│   │   └── client.ts      # Re-exports prisma from @naap/database
│   └── routes/
│       ├── index.ts       # Route aggregator
│       └── items.ts       # Feature routes
├── .env                   # DATABASE_URL, PORT
└── package.json
```

## Database Client

All plugins use the shared database client:

```typescript
// backend/src/db/client.ts
import { prisma } from '@naap/database';
export const db = prisma;
```

**Do NOT:**
- Import from `@prisma/client`
- Call `new PrismaClient()`
- Create a `prisma/schema.prisma` in your plugin

## API Response Format

All API responses use a standard envelope:

```typescript
// Success
res.json({ success: true, data: { items }, meta: { page, limit, total } });

// Error
res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Item not found' } });
```

## External API Integration

Plugins can proxy calls to external APIs using the server SDK:

```typescript
import { createExternalProxy } from '@naap/plugin-server-sdk';

const proxy = createExternalProxy({
  baseURL: process.env.EXTERNAL_API_URL,
  timeout: 30000,
  auth: {
    type: 'bearer',
    token: process.env.EXTERNAL_API_TOKEN,
  },
});
```

See the [External API Proxy guide](/docs/guides/external-api-proxy) for details.

## Health Checks

Every plugin backend must expose a health endpoint:

```typescript
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'my-plugin',
    timestamp: new Date().toISOString(),
  });
});
```

## Authentication

The shell proxy forwards authentication headers:

| Header | Description |
|---|---|
| `x-user-id` | Current user's ID |
| `x-user-email` | Current user's email |
| `x-team-id` | Current team's ID |
| `x-request-id` | Unique request identifier |
| `authorization` | Bearer token |

## Best Practices

1. **Always use the API envelope format** — `{ success, data, meta?, error? }`
2. **Import from `@naap/database`** — never create local Prisma instances
3. **Use `getPluginBackendUrl()`** on the frontend — never hardcode ports
4. **Implement health checks** — required for the platform monitor
5. **Handle errors gracefully** — return proper HTTP status codes with error details
