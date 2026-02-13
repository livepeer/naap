# API Documentation

## Base URL

```
http://localhost:4001/api/v1/gateway-manager
```

## Authentication

All requests require a valid JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## Endpoints

### List Gateways

```http
GET /gateways
```

**Response:**
```json
{
  "gateways": [
    {
      "id": "gw-001",
      "name": "Primary Gateway",
      "address": "0x71C7...",
      "status": "Active",
      "region": "US-East",
      "metrics": {
        "cpu": 45,
        "memory": 62,
        "activeJobs": 128,
        "latencyMs": 23
      }
    }
  ]
}
```

### Get Gateway

```http
GET /gateways/:id
```

**Response:**
```json
{
  "gateway": {
    "id": "gw-001",
    "name": "Primary Gateway",
    "address": "0x71C7...",
    "status": "Active",
    "region": "US-East",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-15T12:30:00Z",
    "config": { ... },
    "metrics": { ... }
  }
}
```

### Create Gateway

```http
POST /gateways
```

**Request:**
```json
{
  "name": "New Gateway",
  "address": "0x...",
  "region": "US-West"
}
```

### Update Gateway

```http
PUT /gateways/:id
```

**Request:**
```json
{
  "name": "Updated Name",
  "status": "Maintenance"
}
```

### Delete Gateway

```http
DELETE /gateways/:id
```

### Get Gateway Metrics

```http
GET /gateways/:id/metrics
```

**Query Parameters:**
- `period`: Time period (1h, 24h, 7d, 30d)

**Response:**
```json
{
  "metrics": {
    "cpu": 45,
    "memory": 62,
    "activeJobs": 128,
    "completedJobs": 15420,
    "failedJobs": 12,
    "latencyMs": 23,
    "throughput": 1250
  }
}
```

### Get Historical Metrics

```http
GET /gateways/:id/metrics/history
```

**Query Parameters:**
- `startDate`: ISO date string
- `endDate`: ISO date string
- `interval`: Data point interval (5m, 1h, 1d)

**Response:**
```json
{
  "history": [
    {
      "timestamp": "2024-01-15T12:00:00Z",
      "cpu": 42,
      "memory": 60,
      "latencyMs": 21
    }
  ]
}
```

### Get Gateway Configuration

```http
GET /gateways/:id/config
```

**Response:**
```json
{
  "config": {
    "maxConcurrentJobs": 100,
    "timeoutMs": 30000,
    "retryAttempts": 3,
    "pipelines": ["flux", "whisper", "llama"]
  }
}
```

### Update Gateway Configuration

```http
PUT /gateways/:id/config
```

**Request:**
```json
{
  "maxConcurrentJobs": 150,
  "timeoutMs": 45000
}
```

## Error Responses

All endpoints return errors in the following format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `INTERNAL_ERROR` | 500 | Server error |
