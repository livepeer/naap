# SSH Bridge Connector — Design Document

## Overview

The SSH Bridge is an HTTP microservice that wraps SSH/SFTP operations, deployed as the service-gateway plugin's backend. It enables any NaaP plugin or external CI/CD system to execute remote commands, run deployment scripts, and transfer files on remote machines — all through the standard gateway connector pattern (`/api/v1/gw/ssh-bridge/...`).

## Architecture

```
NaaP Plugin / GitHub CD
        │
        ▼  HTTP (Bearer gw_xxx)
┌──────────────────────────────┐
│  Service Gateway (Next.js)   │
│  Auth → Resolve → Policy →   │
│  Secrets → Transform → Proxy │
└──────────┬───────────────────┘
           │  HTTP (x-bridge-key)
           ▼
┌──────────────────────────────┐
│  SSH Bridge Backend (:4116)  │
│  ┌─────────┐  ┌───────────┐ │
│  │ Validator│  │ Job Store │ │
│  └────┬────┘  └─────┬─────┘ │
│       │              │       │
│  ┌────▼──────────────▼────┐  │
│  │   Connection Pool      │  │
│  └────────┬───────────────┘  │
│           │                  │
│  ┌────────▼───────────────┐  │
│  │   Audit Logger         │  │
│  └────────────────────────┘  │
└──────────┬───────────────────┘
           │  SSH / SFTP
           ▼
    Remote Machines
```

## Execution Modes

### 1. Synchronous (`POST /exec`)
For short-lived commands (< 5 min). Blocks until the command completes and returns stdout/stderr/exitCode in a single response.

### 2. Asynchronous (`POST /exec/async`)
For long-running commands (model downloads, docker builds). Returns a `jobId` immediately. The caller polls `GET /jobs/:id` for status and `GET /jobs/:id/logs` for streaming output.

### 3. Script (`POST /exec/script`)
For multi-line deployment scripts. Uploads the script to the remote `/tmp`, executes it with `bash -euo pipefail`, and returns a `jobId` for async polling. Script is cleaned up on completion.

## API Reference

### Endpoints

| Endpoint | Method | Description | Timeout |
|----------|--------|-------------|---------|
| `/healthz` | GET | Bridge health check | 5s |
| `/exec` | POST | Synchronous command execution | 300s |
| `/exec/async` | POST | Async command, returns jobId | 15s (submit) |
| `/exec/script` | POST | Upload + execute deployment script | 30s (submit) |
| `/jobs/:id` | GET | Poll async job status | 5s |
| `/jobs/:id/logs` | GET | Tail async job logs | 5s |
| `/jobs/:id` | DELETE | Cancel running async job | 15s |
| `/upload` | POST | SFTP file upload | 120s |
| `/download` | POST | SFTP file download | 60s |
| `/ls` | POST | List remote directory | 10s |
| `/connect` | POST | Test SSH connectivity | 15s |

### Request/Response Contracts

#### POST /exec
```json
// Request
{
  "host": "10.0.1.5",
  "port": 22,
  "username": "deploy",
  "command": "systemctl status my-service",
  "env": { "TERM": "xterm" },
  "timeout": 30000
}
// Response
{
  "success": true,
  "data": {
    "stdout": "● my-service.service - ...",
    "stderr": "",
    "exitCode": 0,
    "durationMs": 1234
  }
}
```

#### POST /exec/async
```json
// Request
{
  "host": "10.0.1.5",
  "port": 22,
  "username": "deploy",
  "command": "docker pull nvcr.io/nvidia/pytorch:24.01-py3",
  "env": { "DOCKER_BUILDKIT": "1" },
  "timeout": 3600000
}
// Response (immediate)
{
  "success": true,
  "data": { "jobId": "j_abc123", "status": "running" }
}
```

#### POST /exec/script
```json
// Request
{
  "host": "10.0.1.5",
  "port": 22,
  "username": "deploy",
  "script": "#!/bin/bash\nset -euo pipefail\ndocker pull ...\ndocker run ...",
  "env": { "HF_TOKEN": "hf_xxx", "MODEL_ID": "stabilityai/sdxl" },
  "timeout": 3600000,
  "workingDirectory": "/opt/deploy"
}
// Response (immediate)
{
  "success": true,
  "data": { "jobId": "j_def456", "status": "running" }
}
```

#### GET /jobs/:id
```json
// Running
{
  "success": true,
  "data": {
    "jobId": "j_abc123",
    "status": "running",
    "startedAt": "2026-03-02T10:00:00Z",
    "durationMs": 45000,
    "stdoutTail": "Downloading: 45% 3.2G/7.1G ..."
  }
}
// Completed
{
  "success": true,
  "data": {
    "jobId": "j_abc123",
    "status": "completed",
    "exitCode": 0,
    "startedAt": "2026-03-02T10:00:00Z",
    "completedAt": "2026-03-02T10:12:34Z",
    "durationMs": 754000,
    "stdout": "...",
    "stderr": ""
  }
}
```

#### GET /jobs/:id/logs
```json
// Request query: ?offset=1024&limit=4096
{
  "success": true,
  "data": {
    "jobId": "j_abc123",
    "status": "running",
    "stdout": "...latest output...",
    "offset": 1024,
    "totalBytes": 5120
  }
}
```

#### POST /upload
```json
// Request
{
  "host": "10.0.1.5",
  "port": 22,
  "username": "deploy",
  "remotePath": "/opt/app/artifact.tar.gz",
  "content": "<base64>",
  "mode": "0644"
}
// Response
{
  "success": true,
  "data": { "remotePath": "/opt/app/artifact.tar.gz", "bytesWritten": 1048576 }
}
```

#### POST /download
```json
// Request
{
  "host": "10.0.1.5",
  "port": 22,
  "username": "deploy",
  "remotePath": "/opt/app/config.yaml"
}
// Response
{
  "success": true,
  "data": { "content": "<base64>", "size": 2048 }
}
```

#### POST /ls
```json
// Request
{ "host": "10.0.1.5", "port": 22, "username": "deploy", "remotePath": "/opt/app/" }
// Response
{
  "success": true,
  "data": {
    "entries": [
      { "name": "app.jar", "type": "file", "size": 1048576, "modifiedAt": "2026-03-01T..." }
    ]
  }
}
```

#### POST /connect
```json
// Request
{ "host": "10.0.1.5", "port": 22, "username": "deploy" }
// Response
{
  "success": true,
  "data": { "serverVersion": "OpenSSH_8.9", "hostFingerprint": "SHA256:...", "latencyMs": 45 }
}
```

## Security Model

### Host Allowlisting
- `SSH_ALLOWED_HOSTS` env var: comma-separated CIDR ranges or hostnames
- All target hosts validated before SSH connection attempt
- Rejects connections to hosts not on the allowlist

### Command Sanitization
- Configurable blocklist of dangerous commands (`rm -rf /`, `mkfs`, `dd`, fork bombs)
- Shell metacharacter validation for sync exec (async/script modes use explicit bash)

### Script Sandboxing
- Scripts execute under `bash -euo pipefail` (exit on error, undefined vars, pipe failures)
- Max script size: 64KB
- Scripts uploaded to `/tmp/naap-{jobId}.sh`, cleaned up on completion
- No binary content allowed

### Credential Security
- SSH private keys stored in SecretVault (AES-256-GCM encrypted)
- Keys injected via gateway headers, never in request bodies
- Keys never logged or included in error messages

### Resource Limits
- Max 5 concurrent SSH connections per host
- Max 20 total concurrent connections
- Max 100 concurrent async jobs
- Completed job records evicted after 1 hour
- Sync command timeout: max 300s
- Async command timeout: max 1 hour
- File upload/download: max 50MB
- Request body: max 100MB

## Connection Pool Design

- Keyed by `user@host:port`
- Reuse connections within idle TTL (default 300s)
- Support password and private key authentication
- Long-lived connections for async jobs (separate lifecycle)
- Graceful drain on shutdown: cancel running jobs, close connections

## Audit Log Format

Every operation is logged as structured JSON to stdout:

```json
{
  "timestamp": "2026-03-02T10:00:00.000Z",
  "requestId": "req_abc123",
  "jobId": "j_def456",
  "actor": "team:abc123",
  "action": "exec.script",
  "targetHost": "10.0.1.5",
  "targetPort": 22,
  "username": "deploy",
  "command": "#!/bin/bash...(truncated)",
  "status": "completed",
  "exitCode": 0,
  "durationMs": 754000,
  "bytesTransferred": 0,
  "error": null
}
```

## Error Taxonomy

| Error | HTTP Status | Code | Retry |
|-------|-------------|------|-------|
| Host not in allowlist | 403 | HOST_NOT_ALLOWED | No |
| SSH auth failed | 401 | AUTH_FAILED | No |
| Connection refused | 502 | CONNECTION_FAILED | Yes |
| Command timeout | 504 | COMMAND_TIMEOUT | No |
| Job not found | 404 | JOB_NOT_FOUND | No |
| Too many jobs | 429 | JOB_LIMIT_EXCEEDED | Yes |
| Validation error | 400 | VALIDATION_ERROR | No |
| Internal error | 500 | INTERNAL_ERROR | Yes |

## GitHub CD Integration

The SSH Bridge is designed as a deployment target for GitHub Actions CD workflows.

### Setup
1. Admin configures SSH Bridge connector in NaaP Gateway
2. Admin creates a gateway API key for CI/CD use
3. Developer stores `NAAP_GW_API_KEY` as a GitHub secret
4. Developer uses the `ssh-bridge-deploy` composite action in their workflow

### Flow
```
Push → GitHub Actions → POST /exec/script (via gateway) → SSH → Remote Machine → Docker deploy
     ↳ GitHub Deployment (pending)
     ↳ Poll GET /jobs/:id every 15s
     ↳ Stream GET /jobs/:id/logs
     ↳ GitHub Deployment (success/failure)
```
