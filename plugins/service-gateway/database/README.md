# Service Gateway Database Schema

The Service Gateway plugin models are defined in the unified NaaP schema at:

```
packages/database/prisma/schema.prisma
```

All models use `@@schema("plugin_service_gateway")` for PostgreSQL schema isolation.

## Models

| Model | Purpose |
|-------|---------|
| `ServiceConnector` | Upstream service definition (team-scoped) |
| `ConnectorEndpoint` | Individual route within a connector |
| `GatewayApiKey` | Consumer API keys (SHA-256 hashed) |
| `GatewayPlan` | Rate limit / quota tiers |
| `GatewayUsageRecord` | Per-request usage log |
| `GatewayHealthCheck` | Upstream health status history |

## Multi-Tenancy

Every model that is queried directly has a `teamId` column (non-nullable, indexed).
All queries must include `where: { teamId }` to enforce team isolation.
