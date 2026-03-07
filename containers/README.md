# Containers

This directory contains Docker-based services that are **logically separate from the NaaP TypeScript project**.

- **Not in npm workspaces** -- no `package.json`, not discovered by `npm install`
- **Not in Nx project graph** -- no `project.json`, not discovered by `nx run-many`
- **Not in Vercel build** -- `vercel-build.sh` only builds `plugins/` + `apps/web-next`
- **Built separately** via `docker build` or CI/CD (`.github/workflows/containers.yml`)

## Services

| Service | Purpose | Image |
|---|---|---|
| `livepeer-inference-adapter` | Bridges any HTTP inference backend to Livepeer BYOC orchestrator | `livepeer/inference-adapter` |
| `livepeer-serverless-proxy` | Wraps serverless provider APIs (fal.ai, Replicate, RunPod) behind a standard HTTP interface | `livepeer/serverless-proxy` |

## Building locally

```bash
docker build -t livepeer/inference-adapter containers/livepeer-inference-adapter
docker build -t livepeer/serverless-proxy containers/livepeer-serverless-proxy
```

## Relationship to NaaP

The `plugins/deployment-manager/` plugin references these Docker image names in generated docker-compose YAML. It does not import or build the Python code -- it only uses the published Docker images.
