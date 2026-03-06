# How to Add a New Transform

This guide covers adding new body transforms, auth strategies, and response transforms to the Service Gateway.

---

## Path A: Adding a Body Transform

**Example**: adding a `yaml-to-json` body transform.

### Step 1: Create the strategy file

Create `apps/web-next/src/lib/gateway/transforms/body/yaml-to-json.ts`:

```typescript
import type { BodyTransformStrategy, BodyTransformContext } from '../types';

export const yamlToJsonTransform: BodyTransformStrategy = {
  name: 'yaml-to-json',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    if (!ctx.consumerBody) return undefined;

    try {
      // Your conversion logic here
      const parsed = parseYaml(ctx.consumerBody);
      return JSON.stringify(parsed);
    } catch {
      return ctx.consumerBody;
    }
  },
};
```

### Step 2: Register in bootstrap

Edit `apps/web-next/src/lib/gateway/transforms/index.ts`:

```typescript
import { yamlToJsonTransform } from './body/yaml-to-json';
registry.registerBody(yamlToJsonTransform);
```

### Step 3: Update validation (optional)

If you want the admin API to validate the new value, update the `bodyTransform` comment in the Prisma schema at `packages/database/prisma/schema.prisma`.

### Step 4: Write tests

Create `apps/web-next/src/lib/gateway/__tests__/transforms/body/yaml-to-json.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { yamlToJsonTransform } from '../../../transforms/body/yaml-to-json';

describe('yaml-to-json body transform', () => {
  it('converts YAML to JSON', () => {
    const result = yamlToJsonTransform.transform({
      bodyTransform: 'yaml-to-json',
      consumerBody: 'name: test\nvalue: 42',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(JSON.parse(result as string)).toEqual({ name: 'test', value: 42 });
  });

  it('falls back on invalid YAML', () => {
    const result = yamlToJsonTransform.transform({
      bodyTransform: 'yaml-to-json',
      consumerBody: ':::invalid',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe(':::invalid');
  });
});
```

### Step 5: Use it

Set `bodyTransform: "yaml-to-json"` on the relevant connector endpoint(s).

---

## Path B: Adding an Auth Strategy

**Example**: adding an `oauth2` auth strategy.

### Step 1: Create the strategy file

Create `apps/web-next/src/lib/gateway/transforms/auth/oauth2.ts`:

```typescript
import type { AuthStrategy, AuthContext } from '../types';

export const oauth2Auth: AuthStrategy = {
  name: 'oauth2',
  inject(ctx: AuthContext): void {
    const clientId = ctx.secrets[(ctx.authConfig.clientIdRef as string) || 'client_id'] || '';
    const clientSecret = ctx.secrets[(ctx.authConfig.clientSecretRef as string) || 'client_secret'] || '';

    // Token exchange logic would go here
    // For now, set basic client credentials
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    ctx.headers.set('Authorization', `Basic ${encoded}`);
  },
};
```

### Step 2: Register in bootstrap

```typescript
import { oauth2Auth } from './auth/oauth2';
registry.registerAuth(oauth2Auth);
```

### Step 3: Update Prisma schema documentation

Add `oauth2` to the `authType` comment in `ServiceConnector` model.

### Step 4: Write tests

Test that the strategy sets the correct headers for given inputs.

### Step 5: Use it

Set `authType: "oauth2"` on the connector and provide the appropriate `authConfig` and `secretRefs`.

---

## Path C: Adding a Response Transform

**Example**: adding a `csv-to-json` response transform.

### Step 1: Create the strategy file

Create `apps/web-next/src/lib/gateway/transforms/response/csv-to-json.ts`:

```typescript
import type { ResponseTransformStrategy, ResponseTransformContext } from '../types';
import { buildSafeResponseHeaders } from './shared';

export const csvToJsonResponse: ResponseTransformStrategy = {
  name: 'csv-to-json',
  async transform(ctx: ResponseTransformContext): Promise<Response> {
    const contentType = ctx.upstreamResponse.headers.get('content-type') || '';
    const responseHeaders = buildSafeResponseHeaders(ctx, 'application/json');

    if (contentType.includes('text/csv')) {
      const csvText = await ctx.upstreamResponse.text();
      const rows = parseCsv(csvText);
      return new Response(JSON.stringify(rows), {
        status: ctx.upstreamResponse.status,
        headers: responseHeaders,
      });
    }

    // Non-CSV: passthrough
    const body = await ctx.upstreamResponse.arrayBuffer();
    return new Response(body, {
      status: ctx.upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
```

### Step 2: Register in bootstrap

```typescript
import { csvToJsonResponse } from './response/csv-to-json';
registry.registerResponse(csvToJsonResponse);
```

### Step 3: Update schema

Add the value to `responseBodyTransform` comment in the Prisma schema.

### Step 4: Write tests and use it

---

## Key Rules

1. **Never modify the orchestrators** (`transform.ts`, `respond.ts`) to add new transform types.
2. **Always implement the strategy interface** exactly — same return types, same error handling patterns.
3. **Always fall back gracefully** — if parsing fails, return the original input.
4. **Register in `index.ts`** — strategies that are not registered will not be found at runtime.
5. **Write tests** — one test file per strategy, covering normal input, edge cases, and error fallback.
