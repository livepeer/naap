# How to Add a New Connector Type

This guide walks through adding a new upstream service connector to the Service Gateway, from configuration to testing to production launch.

---

## Step 1: Analyze the Upstream API

Before creating any files, document:

- **Base URL**: e.g. `https://api.newservice.com`
- **Authentication method**: bearer token, API key header, basic auth, query param, AWS SigV4, or other
- **Endpoints you need**: list the HTTP methods + paths
- **Request format**: JSON, form-encoded, binary, or custom
- **Response format**: JSON, streaming SSE, binary
- **Rate limits**: upstream limits you should respect
- **Special behaviors**: streaming, WebRTC, pagination, etc.

---

## Step 2: Choose Transform Strategies

Match each requirement to an existing strategy:

| Requirement | Strategy | Notes |
|-------------|----------|-------|
| JSON body passthrough | `passthrough` | Default, works for most APIs |
| Form-encoded body | `form-encode` | Stripe, Twilio style |
| Binary upload | `binary` | File uploads, S3 objects |
| Template body wrapping | `template` | Reshape consumer body for upstream |
| Bearer token auth | `bearer` | Most common |
| HTTP header auth | `header` | Supabase, Pinecone style |
| Basic auth | `basic` | ClickHouse, Twilio style |
| Query param auth | `query` | Gemini style |
| AWS S3 signing | `aws-s3` | S3-compatible storage |
| No auth | `none` | Public APIs |
| JSON response wrapping | `envelope` | Default (`responseBodyTransform: "envelope"`) |
| Raw passthrough | `raw` | `responseBodyTransform: "raw"` |
| SSE streaming | `streaming` | `responseBodyTransform: "streaming"` |
| Field restructuring | `field-map` | `responseBodyTransform: "field-map"` |
| No response transform | `none` | `responseBodyTransform: "none"` (default) |

If no existing strategy fits, create a new one per the [adding transforms guide](./adding-transforms.md).

---

## Step 3: Create the Connector JSON

Create `plugins/service-gateway/connectors/{slug}.json`:

```json
{
  "$schema": "./connector-template.schema.json",
  "id": "my-service",
  "name": "My Service API",
  "description": "Description of the service",
  "icon": "🔧",
  "category": "category",
  "connector": {
    "slug": "my-service",
    "displayName": "My Service API",
    "description": "Description of the service",
    "category": "category",
    "upstreamBaseUrl": "https://api.myservice.com",
    "allowedHosts": ["api.myservice.com"],
    "defaultTimeout": 30000,
    "authType": "bearer",
    "authConfig": { "tokenRef": "token" },
    "secretRefs": ["token"],
    "streamingEnabled": false,
    "responseWrapper": true,
    "tags": ["my-service"]
  },
  "endpoints": [
    {
      "name": "create-resource",
      "description": "Create a new resource",
      "method": "POST",
      "path": "/resources",
      "upstreamPath": "/v1/resources",
      "rateLimit": 60,
      "timeout": 10000
    },
    {
      "name": "get-resource",
      "description": "Get a resource by ID",
      "method": "GET",
      "path": "/resources/:id",
      "upstreamPath": "/v1/resources/:id",
      "rateLimit": 100,
      "timeout": 5000
    }
  ],
  "envKey": "MY_SERVICE_API_KEY"
}
```

---

## Step 4: Create a Seed Script

Create `bin/seed-my-service.ts`:

```typescript
import { prisma } from '../packages/database';

async function main() {
  const connector = await prisma.serviceConnector.upsert({
    where: { teamId_slug: { teamId: 'system', slug: 'my-service' } },
    create: {
      slug: 'my-service',
      displayName: 'My Service API',
      // ... full connector config from JSON
      status: 'published',
      visibility: 'public',
      createdBy: 'seed',
    },
    update: {},
  });

  // Create endpoints...

  console.log('Seeded my-service connector:', connector.id);
}

main().catch(console.error);
```

---

## Step 5: Test Locally

1. Run the seed script: `npx tsx bin/seed-my-service.ts`
2. Store the upstream secret: call the admin secrets API
3. Make a test request through the gateway:

```bash
curl -X POST http://localhost:3000/api/v1/gw/my-service/resources \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'
```

4. Verify:
   - Correct upstream URL constructed
   - Auth credentials injected (check upstream logs or use a request inspector)
   - Response envelope/raw format matches expectations
   - Usage record created in database

---

## Step 6: Production Readiness Checklist

Before launching:

- [ ] Connector `allowedHosts` explicitly lists upstream hostnames
- [ ] All POST/PUT/PATCH endpoints have `bodyTransform` set correctly
- [ ] `upstreamContentType` set correctly for form-encoded endpoints
- [ ] Rate limits configured per endpoint
- [ ] Timeouts configured (default 30s, adjust for slow endpoints)
- [ ] `responseWrapper` set correctly (true for NaaP plugins, false for raw APIs)
- [ ] `streamingEnabled` set if SSE endpoints exist
- [ ] Error mapping configured for known upstream error codes
- [ ] Health check path configured
- [ ] Secret rotation plan documented
- [ ] Usage dashboard reviewed after initial deployment

---

## Step 7: Add to Connector Catalog

Update `plugins/service-gateway/docs/connector-catalog.md` with the new connector's details.

---

## Common Patterns

### Form-encoded APIs (Stripe, Twilio)

```json
{
  "upstreamContentType": "application/x-www-form-urlencoded",
  "bodyTransform": "form-encode"
}
```

### Binary upload APIs (S3, Vercel Blob)

```json
{
  "bodyTransform": "binary"
}
```

### Streaming LLM APIs (OpenAI, Gemini)

Set on connector level:
```json
{
  "streamingEnabled": true
}
```

### Public APIs (no auth)

```json
{
  "authType": "none",
  "secretRefs": []
}
```
