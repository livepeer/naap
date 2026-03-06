# SSH Bridge Deploy Action

Deploy to remote machines via NaaP's SSH Bridge connector from GitHub Actions CD workflows.

## Usage

```yaml
- name: Deploy to server
  uses: ./.github/actions/ssh-bridge-deploy
  with:
    naap-url: ${{ vars.NAAP_URL }}
    api-key: ${{ secrets.NAAP_GW_API_KEY }}
    host: ${{ vars.DEPLOY_HOST }}
    username: deploy
    script: |
      #!/bin/bash
      set -euo pipefail
      docker pull myapp:latest
      docker stop myapp || true && docker rm myapp || true
      docker run -d --name myapp -p 8080:8080 myapp:latest
      curl -sf http://localhost:8080/health
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `naap-url` | Yes | — | NaaP gateway URL |
| `api-key` | Yes | — | Gateway API key (`gw_xxx`) |
| `host` | Yes | — | Target SSH host |
| `port` | No | `22` | SSH port |
| `username` | Yes | — | SSH user |
| `script` | Yes | — | Bash deployment script |
| `env` | No | `{}` | JSON env vars for the script |
| `timeout` | No | `1800000` | Timeout (ms) |
| `poll-interval` | No | `15` | Poll interval (seconds) |
| `working-directory` | No | `/tmp` | Remote working directory |
| `environment` | No | `production` | GitHub Deployment environment |
| `create-deployment` | No | `true` | Use GitHub Deployments API |

## Outputs

| Output | Description |
|--------|-------------|
| `job-id` | SSH Bridge job ID |
| `exit-code` | Script exit code |
| `duration` | Total time in seconds |

## Setup

1. Admin configures SSH Bridge connector in NaaP Gateway
2. Admin creates a gateway API key for CI/CD
3. Add GitHub secrets and variables:
   - Secret: `NAAP_GW_API_KEY` = your gateway API key
   - Variable: `NAAP_URL` = `https://naap.dev`
   - Variable: `DEPLOY_HOST` = target machine IP
4. Add the workflow to `.github/workflows/`
5. Push to trigger

## Examples

See `.github/workflows/examples/` for complete workflow examples:
- `cd-docker-service.yml` — Generic Docker deploy
- `cd-huggingface-model.yml` — HuggingFace model + inference server
- `cd-docker-compose.yml` — Docker Compose multi-container
