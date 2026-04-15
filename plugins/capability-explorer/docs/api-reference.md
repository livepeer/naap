# Capability Explorer API Reference

## REST Endpoints

All endpoints require authentication via Bearer token.

### GET /api/v1/capability-explorer/capabilities

List enriched capabilities with filtering, search, and pagination.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| category | string | Filter by category (llm, t2i, t2v, i2i, i2v, a2t, tts, upscale, live-video, other) |
| search | string | Text search across name, description, model IDs |
| sortBy | string | Sort field: name, gpuCount, price, latency, capacity |
| sortOrder | string | asc or desc |
| limit | number | Max results (1-100, default 50) |
| offset | number | Pagination offset (default 0) |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 10,
    "hasMore": false
  }
}
```

### GET /api/v1/capability-explorer/capabilities/:id

Get a single capability by ID with full details including models and SDK snippets.

### GET /api/v1/capability-explorer/capabilities/:id/models

Get the models for a specific capability.

### GET /api/v1/capability-explorer/categories

List available categories with counts.

### GET /api/v1/capability-explorer/filters

Get available filter options (categories and capability names from ClickHouse).

### GET /api/v1/capability-explorer/stats

Get aggregate statistics across all capabilities.

## GraphQL Endpoint

### POST /api/v1/capability-explorer/graphql

Execute GraphQL queries against the capability explorer data.

**Example Query:**
```graphql
{
  capabilities(category: "t2i", limit: 10) {
    items {
      id
      name
      category
      gpuCount
      meanPriceUsd
      sdkSnippet {
        curl
      }
    }
    total
  }
}
```

**Example with variables:**
```json
{
  "query": "query($cat: String) { capabilities(category: $cat) { items { id name } total } }",
  "variables": { "cat": "llm" }
}
```
