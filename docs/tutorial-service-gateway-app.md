# Tutorial: Building an App with the Service Gateway

This tutorial demonstrates how to build a feature-rich NAAP application powered by external services using the **Service Gateway**. We will use the **Daydream AI Video** plugin as our reference example.

The Service Gateway allows you to expose third-party REST APIs (like Livepeer, OpenAI, or Daydream) as managed, team-scoped endpoints within NAAP, handling authentication, rate limiting, and secret management automatically.

---

## 1. Architecture Overview

When using the Service Gateway, your application architecture shifts from managing raw API keys in the browser to using a secure, governed proxy.

### Traditional Approach (Unsafe)
```
Browser (Plugin) ──▶ Third-Party API (e.g., api.daydream.live)
                 ▲
                 └─ Exposure of API Key in client code
                 └─ CORS issues
```

### Service Gateway Approach (Secure)
```
Browser (Plugin) ──▶ NAAP Service Gateway ──▶ Third-Party API
                 ▲                        ▲
                 └─ JWT Auth (NaaP)       └─ API Key (Managed & Encrypted)
                 └─ Managed CORS          └─ Request Transformation
```

---

## 2. Step-by-Step: Building Daydream AI Video

### Step 1: Provision the Service Connector
Before writing any code, we must register the upstream service with the Gateway.

1.  **Define the Connector**: In the Service Gateway admin UI (or via seed scripts), create a `daydream` connector.
    *   **Upstream Base URL**: `https://api.daydream.live`
    *   **Visibility**: `public` (so all users can access the endpoint)
2.  **Add Endpoints**: Map the specific upstream routes you need.
    *   `POST /streams` ──▶ `POST /v1/streams`
    *   `PATCH /streams/:id` ──▶ `PATCH /v1/streams/:id`
3.  **Configure Secrets**: Add a secret reference (e.g., `DAYDREAM_API_KEY`) to the connector. This key is stored encrypted in NAAP and injected into the `Authorization` header by the gateway at request time.

### Step 2: Create the Plugin
Scaffold a new plugin using the NAAP CLI:

```bash
naap-plugin create daydream-video
```

### Step 3: Configure the Frontend API Client
The plugin doesn't need its own backend for API proxying; it uses the shared Service Gateway. Update your API helper to target the gateway:

```typescript
// examples/daydream-video/frontend/src/lib/api.ts

const GW_BASE = '/api/v1/gw/daydream'; // Base path for our connector

export async function createStream(params: { prompt: string }) {
  const response = await fetch(`${GW_BASE}/streams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // No API key here! Auth is handled by the Shell's JWT
    },
    body: JSON.stringify({
      pipeline: 'streamdiffusion',
      params: {
        model_id: 'stabilityai/sdxl-turbo',
        prompt: params.prompt
      },
    }),
  });
  return response.json();
}
```

---

## 3. Important Code Snippets

### Request Transformation (Upstream Mapping)
The Gateway allows you to transform requests to match upstream expectations. In the `daydream` example, we wrap the plugin's flat parameters into the nested structure required by the Daydream API.

```typescript
// How the plugin sends it:
{ "prompt": "neon anime" }

// How the Gateway transforms it (or how the plugin adapts):
{
  "pipeline": "streamdiffusion",
  "params": {
    "prompt": "neon anime"
  }
}
```

### Handling WebRTC (WHIP)
For low-latency video, the `daydream-video` plugin uses a dedicated WHIP proxy route. This bypasses standard JSON transformation to handle SDP handshakes:

```typescript
// apps/web-next/src/app/api/v1/gw/daydream-whip/route.ts
// Proxies WebRTC SDP to the upstream host provided by the Gateway
const response = await fetch(whipUrl, {
  method: 'POST',
  body: sdp, // Raw SDP text
  headers: {
    'Content-Type': 'application/sdp',
    'Authorization': `Bearer ${upstreamKey}`
  }
});
```

---

## 4. Why Use the Service Gateway?

Building plugins with the Service Gateway provides three major advantages:

### 1. Zero-Boilerplate Security
You don't need to write a custom Express backend just to hide an API key. The Gateway handles encryption, decryption, and injection of credentials in a secure server-side environment.

### 2. High Observability
Every request made through the gateway is logged. You get out-of-the-box dashboards for:
*   **Requests Over Time**: Monitor your app's usage.
*   **Latency Distribution**: Track upstream performance.
*   **Error Rates**: Quickly identify if a third-party service is down.

### 3. Usage Governance
Manage costs and access across your team:
*   **API Keys**: Issue individual keys to different parts of your app.
*   **Quotas**: Set daily or monthly limits on expensive AI services.
*   **Rate Limiting**: Protect upstream services from being overwhelmed.

---

## Conclusion

By leveraging the Service Gateway, the Daydream AI Video plugin remains a lightweight, frontend-focused application while delivering powerful, secure, and low-latency AI video capabilities. It eliminates the need for redundant backend code and provides institutional-grade management for third-party services.

For more details, see the [Service Gateway Reference](../plugins/service-gateway/README.md).
