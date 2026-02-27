# Service Gateway — Production Hardening Guide

This document describes all security, performance, and scalability measures implemented in the Service Gateway, along with operational guidance for production deployments.

---

## Security Measures

### 1. Encryption at Rest (AES-256-GCM + scrypt KDF)

Connector secrets are encrypted with AES-256-GCM before storage. The encryption key is derived from the `GATEWAY_ENCRYPTION_KEY` environment variable using `crypto.scryptSync` with a fixed salt, producing a 256-bit key.

**Configuration:**
- Set `GATEWAY_ENCRYPTION_KEY` to a strong passphrase (32+ characters recommended).
- Rotate by re-encrypting all secrets after changing the key.

### 2. SSRF Protection

All upstream requests pass through `validateHost()`, which:
- Blocks private/internal IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, fc00:, fe80:, ::1, localhost).
- Enforces an allowedHosts whitelist per connector (supports wildcard `*.example.com`).
- Wildcard matching prevents subdomain bypass (`evil.example.com.attacker.com` is rejected).

### 3. IP Allowlisting with CIDR Support

API keys support `allowedIPs` with both plain IPs and CIDR notation (e.g. `10.0.0.0/24`). Validation occurs at key creation (Zod schema) and at runtime via `matchIPAllowlist()`.

### 4. API Key Brute-Force Protection

Failed API key authentication attempts are rate-limited per source IP:
- **Threshold:** 10 failed attempts within 60 seconds.
- **Block duration:** 300 seconds (5 minutes).
- Uses Redis-backed distributed rate limiter with in-memory fallback.
- Returns identical 401 responses regardless of failure reason to prevent timing side-channels.

### 5. Team Membership Verification

The `getAdminContext()` guard verifies team membership via `prisma.teamMember` or team ownership (`prisma.team.ownerId`) before granting team-scoped access. This prevents privilege escalation via spoofed `x-team-id` headers.

### 6. Auth Secret Presence Validation

All auth strategies (bearer, basic, header, query) validate that referenced secrets are resolved before injecting credentials. When secrets are missing:
- A warning is logged: `[gateway] auth: secret "..." not resolved for connector "..."`.
- An `X-Gateway-Warning: missing-auth-secret` header is added to the upstream request for debugging.
- The request still proceeds to avoid breaking existing flows.

### 7. Audit Logging

All administrative actions (connector create/update/delete, secret set/delete, key create/revoke/rotate) are recorded via `logAudit()` to the `auditLog` table, capturing userId, action, resourceId, and request metadata.

### 8. Input Validation

- Connector and endpoint schemas use Zod with strict types.
- `authConfig` uses a union schema matching the auth type (bearer, basic, header, query, aws-s3).
- `bodySchema` enforces object shape (`z.record(z.unknown())`).
- `allowedIPs` entries are validated as valid IPv4/IPv6/CIDR format.

---

## Performance Optimizations

### 1. Response Clone Elimination

Response bodies are only cloned and buffered when caching is active (GET + 2xx + `cacheTtl > 0`). Otherwise, `responseBytes` is estimated from the `Content-Length` header, eliminating memory duplication for non-cached responses.

### 2. Circuit Breaker

A per-connector circuit breaker prevents cascading failures:

| State     | Behavior                                     |
|-----------|----------------------------------------------|
| CLOSED    | Normal operation; failures are counted.      |
| OPEN      | Requests immediately return 503; lasts 30s.  |
| HALF_OPEN | One probe request allowed; success resets.   |

**Thresholds:**
- 5 consecutive failures trigger OPEN state.
- 30-second cooldown before HALF_OPEN probe.
- Successful response resets to CLOSED.

### 3. Two-Level Config Cache (L1 + L2)

Connector resolution uses a two-level cache:

| Level | Backend   | TTL  | Scope        |
|-------|-----------|------|--------------|
| L1    | In-memory | 60s  | Per-process  |
| L2    | Redis     | 120s | Shared       |

On miss: L1 → L2 → Database. Cache invalidation clears both levels on admin updates.

### 4. Redis-Backed Quota Enforcement

Daily and monthly quotas use Redis atomic `INCR` + `EXPIRE` for O(1) enforcement. Falls back to database `COUNT` queries when Redis is unavailable.

### 5. Bounded Rate Limiter Cache

The per-key rate limiter cache has a 256-entry LRU cap to prevent unbounded memory growth under high-cardinality key patterns.

---

## Scalability

### 1. Batched Usage Writes

Usage records are buffered in memory and flushed to the database in batches:

| Trigger              | Value |
|----------------------|-------|
| Batch size           | 50    |
| Flush interval       | 5s    |
| Backpressure limit   | 500   |

Uses `prisma.gatewayUsageRecord.createMany()` for efficient bulk inserts. The `after()` API ensures the serverless function stays alive until writes complete.

### 2. Scope Abstraction

A centralized `Scope` module (`scope.ts`) eliminates duplicated `personal:` prefix logic across authorization, resolution, admin guards, and team-guard modules. This prevents scope-related bugs during future changes.

---

## Operational Requirements

### Redis

Redis is recommended for production deployments. Without Redis, the following features fall back to per-process in-memory stores:

- Rate limiting (not distributed across instances)
- Quota enforcement (uses DB COUNT queries)
- L2 config cache (disabled; only L1 applies)
- Brute-force protection (per-process only)

**Minimum version:** Redis 6.0+
**Configuration:** Set `REDIS_URL` environment variable.

### Environment Variables

| Variable                 | Required | Description                              |
|--------------------------|----------|------------------------------------------|
| `GATEWAY_ENCRYPTION_KEY` | Yes      | Passphrase for secret encryption (32+ chars) |
| `REDIS_URL`              | No       | Redis connection URL for distributed features |
| `VERCEL_REGION`          | No       | Populated automatically on Vercel        |

### Database

Requires the following Prisma models:
- `ServiceConnector`, `ConnectorEndpoint`
- `GatewayApiKey`, `GatewayPlan`
- `GatewayUsageRecord`, `AuditLog`
- `TeamMember`, `Team`

---

## Production Readiness Checklist

- [ ] `GATEWAY_ENCRYPTION_KEY` is set to a strong, unique value
- [ ] `REDIS_URL` is configured for distributed rate limiting and caching
- [ ] All connector secrets are encrypted (not stored in plaintext)
- [ ] Connector `allowedHosts` are configured to prevent SSRF
- [ ] API keys have appropriate `allowedIPs` and `allowedEndpoints` restrictions
- [ ] Connector templates with `YOUR_*` placeholder URLs have been configured
- [ ] Rate limit plans are created and assigned to API keys
- [ ] Audit logging is enabled and monitored
- [ ] Circuit breaker behavior is understood (503 responses during upstream outages)
- [ ] Usage buffer flush interval is acceptable for reporting latency (up to 5s)
- [ ] Database connection pool is sized for expected throughput
- [ ] Monitoring is configured for `[gateway]` log prefixed warnings/errors
