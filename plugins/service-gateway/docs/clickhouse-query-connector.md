# ClickHouse Query Connector

Connect NaaP to any ClickHouse instance via its [HTTP query interface](https://clickhouse.com/docs/interfaces/http). Proxy SQL queries through the Service Gateway with authentication, rate limiting, caching, and SELECT-only enforcement.

---

## Prerequisites

- A running ClickHouse instance (Cloud or self-hosted) with HTTPS enabled
- Your instance URL (e.g. `https://xxxx.us-east-2.aws.clickhouse.cloud:8443`)
- A ClickHouse username and password (or API key)

Verify your instance is reachable:

```bash
curl --user 'default:YOUR_PASSWORD' \
  --data-binary 'SELECT 1' \
  https://your-instance.clickhouse.cloud:8443
```

You should get `1` back.

---

## Quick Start

### 1. Create a connector from the template

Navigate to **Service Gateway > New Connector** in the NaaP UI. Select the **ClickHouse Query API** template from the database category.

The template pre-fills:

| Field | Value |
|-------|-------|
| Auth type | `basic` (HTTP Basic Authentication) |
| Secret refs | `username`, `password` |
| Health check | `/ping` |
| Endpoints | `/network_prices`, `/query`, `/ping`, `/tables` |

Update the **Upstream Base URL** to your ClickHouse instance URL if different from the default.

### 2. Configure secrets

Go to the **Secrets** tab on your connector and set:

| Secret | Value |
|--------|-------|
| `username` | Your ClickHouse username (e.g. `default`) |
| `password` | Your ClickHouse password or API key |

### 3. Publish

Click **Publish** to make the connector live.

### 4. Test

```bash
# Get a JWT token
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@livepeer.org","password":"livepeer"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

# Health check
curl http://localhost:3000/api/v1/gw/clickhouse-query/ping \
  -H "Authorization: Bearer $TOKEN"
# => Ok.

# List tables
curl http://localhost:3000/api/v1/gw/clickhouse-query/tables \
  -H "Authorization: Bearer $TOKEN"

# Dynamic query
curl -X POST http://localhost:3000/api/v1/gw/clickhouse-query/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/plain" \
  -d "SELECT 1 FORMAT JSON"

# Pre-configured network prices endpoint
curl -X POST http://localhost:3000/api/v1/gw/clickhouse-query/network_prices \
  -H "Authorization: Bearer $TOKEN"
```

---

## Endpoint Reference

### `GET /ping`

Health check. Returns `Ok.` if ClickHouse is reachable. Cached for 5 seconds.

### `GET /tables`

Lists all tables in the default database. Uses the ClickHouse `SHOW TABLES FORMAT JSON` query via URL parameter. Cached for 60 seconds.

### `POST /query` (dynamic)

Execute any SELECT query. The consumer sends raw SQL as the POST body.

**Safety enforcement:**
- `bodyPattern`: only queries starting with `SELECT` are allowed
- `bodyBlacklist`: `DROP`, `DELETE`, `INSERT`, `UPDATE`, `ALTER`, `CREATE`, `TRUNCATE` are blocked

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/gw/clickhouse-query/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/plain" \
  -d "SELECT count() FROM my_database.my_table FORMAT JSON"
```

Always append `FORMAT JSON` to get structured output.

### `POST /network_prices` (static)

A pre-configured query endpoint. The SQL is baked into the connector config — consumers just call the endpoint with no body required. Cached for 60 seconds.

---

## Adding Custom Static Query Endpoints

You can add new endpoints with pre-configured SQL queries. This is useful for exposing specific analytics without giving consumers access to arbitrary SQL.

### Via the Admin UI

1. Open your connector's detail page
2. Click **Add Endpoint**
3. Configure:

| Field | Value |
|-------|-------|
| Name | `my-metric` |
| Method | `POST` |
| Path | `/my_metric` |
| Upstream Path | `/` |
| Content Type | `text/plain` |
| Body Transform | `static` |
| Static Body | Your SQL query (include `FORMAT JSON` at the end) |
| Cache TTL | `60` (seconds, adjust as needed) |

### Via the connector template JSON

Add an entry to the `endpoints` array in `clickhouse-query.json`:

```json
{
  "name": "my-metric",
  "description": "My custom metric query",
  "method": "POST",
  "path": "/my_metric",
  "upstreamPath": "/",
  "upstreamContentType": "text/plain",
  "bodyTransform": "static",
  "upstreamStaticBody": "SELECT count() AS total FROM my_db.my_table FORMAT JSON",
  "timeout": 30000,
  "cacheTtl": 60
}
```

---

## Dashboard Visualization Example

The `/network_prices` endpoint returns orchestrator capability pricing data that can power dashboard widgets. Here is how to integrate it.

### Response Shape

```json
{
  "success": true,
  "data": {
    "meta": [
      { "name": "timestamp", "type": "String" },
      { "name": "address", "type": "String" },
      { "name": "orch_uri", "type": "String" },
      { "name": "capability", "type": "Int64" },
      { "name": "constraint", "type": "String" },
      { "name": "price", "type": "Int64" },
      { "name": "pixels_per_unit", "type": "Int64" }
    ],
    "data": [
      {
        "timestamp": "1771537561462",
        "address": "0x74a7839094b7f723b2C1C915e88928F49dFdc21f",
        "orch_uri": "https://ai.livepeer-utopia.xyz:8935",
        "capability": "35",
        "constraint": "streamdiffusion-sdxl",
        "price": "2578",
        "pixels_per_unit": "1"
      }
    ],
    "rows": 31,
    "statistics": { "elapsed": 0.05, "rows_read": 5000, "bytes_read": 12345 }
  }
}
```

### Fetch from a Dashboard Plugin

```typescript
async function fetchNetworkPrices(token: string): Promise<NetworkPrice[]> {
  const res = await fetch('/api/v1/gw/clickhouse-query/network_prices', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Query failed');
  return json.data.data;
}

interface NetworkPrice {
  timestamp: string;
  address: string;
  orch_uri: string;
  capability: string;
  constraint: string;
  price: string;
  pixels_per_unit: string;
}
```

### Render a Pricing Table

```tsx
function NetworkPricesTable({ data }: { data: NetworkPrice[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Orchestrator</th>
          <th>Capability</th>
          <th>Model</th>
          <th>Price/Unit</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            <td title={row.address}>
              {row.address.slice(0, 8)}...{row.address.slice(-4)}
            </td>
            <td>{row.capability}</td>
            <td>{row.constraint}</td>
            <td>{Number(row.price).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Build a Price Distribution Chart

Use the data to build a bar chart showing price distribution by capability:

```typescript
function aggregatePricesByCapability(data: NetworkPrice[]) {
  const groups = new Map<string, { total: number; count: number }>();
  for (const row of data) {
    const key = `${row.capability}:${row.constraint}`;
    const existing = groups.get(key) || { total: 0, count: 0 };
    existing.total += Number(row.price);
    existing.count += 1;
    groups.set(key, existing);
  }
  return Array.from(groups.entries()).map(([key, { total, count }]) => ({
    label: key.split(':')[1] || `capability-${key.split(':')[0]}`,
    avgPrice: Math.round(total / count),
    count,
  }));
}
```

Pass this to any charting library (Recharts, Chart.js, etc.) as bar chart data with `label` on the x-axis and `avgPrice` on the y-axis.

---

## Security Considerations

- **HTTPS only**: ClickHouse Cloud endpoints use HTTPS (port 8443). Never connect over plain HTTP with credentials.
- **SELECT-only**: The dynamic `/query` endpoint enforces SELECT-only via regex pattern matching and keyword blacklisting.
- **Secrets**: Credentials are encrypted at rest in the NaaP secret vault (AES-256-GCM). Raw values are never exposed via the admin API.
- **Rate limiting**: Configure per-endpoint rate limits to avoid overwhelming your ClickHouse instance.
- **Caching**: Use `cacheTtl` on read-heavy endpoints to reduce upstream load. The `/network_prices` endpoint caches for 60 seconds by default.
