# Plugin Publishing Guide

This guide covers how to publish NAAP plugins to the registry with GitHub Actions integration.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setting Up Publishing](#setting-up-publishing)
3. [GitHub Actions Integration](#github-actions-integration)
4. [Manual Publishing](#manual-publishing)
5. [Docker Hub Integration](#docker-hub-integration)
6. [Security Scanning](#security-scanning)
7. [Version Management](#version-management)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

Before publishing, ensure you have:

- A valid `plugin.json` manifest
- A built frontend UMD bundle (`production/<plugin-name>.js`)
- A NAAP registry account and API token
- (Optional) Docker Hub or ghcr.io account for backend images

## Setting Up Publishing

### 1. Create a Publisher Account

```bash
# Create a publisher account
curl -X POST https://plugins.naap.io/api/v1/registry/publishers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-org",
    "displayName": "My Organization",
    "email": "team@example.com",
    "githubOrg": "my-org"
  }'
```

**Save the returned API token** - it won't be shown again!

### 2. Configure Local Token

```bash
# Store token locally
naap-plugin github token --set
# Enter your token when prompted

# Or set environment variable
export NAAP_REGISTRY_TOKEN=naap_xxxxxxxxxxxx
```

### 3. Verify Setup

```bash
naap-plugin github verify
```

## GitHub Actions Integration

The recommended way to publish is via GitHub Actions on release.

### Quick Setup

```bash
# Run in your plugin directory
naap-plugin github setup
```

This creates `.github/workflows/publish-plugin.yml`.

### Add GitHub Secrets

In your GitHub repository, go to **Settings → Secrets and variables → Actions**, and add:

| Secret | Description |
|--------|-------------|
| `NAAP_REGISTRY_TOKEN` | Your NAAP registry API token |
| `NAAP_REGISTRY_URL` | (Optional) Registry URL if self-hosted |

### Trigger Publishing

Publishing happens automatically when you create a GitHub release:

```bash
# Create and push a tag
git tag v1.0.0
git push --tags

# Then create a release from the tag on GitHub
```

### Workflow Structure

```yaml
name: Publish Plugin

on:
  release:
    types: [published]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build

  publish:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Publish to NAAP
        env:
          NAAP_REGISTRY_TOKEN: ${{ secrets.NAAP_REGISTRY_TOKEN }}
        run: naap-plugin publish --from-github
```

## Manual Publishing

For local development or debugging:

### 1. Build Your Plugin

```bash
# Build frontend
cd frontend
npm run build

# (Optional) Build backend Docker image
cd ../backend
docker build -t my-plugin-backend:1.0.0 .
```

### 2. Package and Publish

```bash
# Package the plugin
naap-plugin package

# Publish with dry-run first
naap-plugin publish --dry-run

# Publish for real
naap-plugin publish
```

### 3. Verify Publication

```bash
# Check in registry
curl https://plugins.naap.io/api/v1/registry/packages/my-plugin
```

## Docker Hub Integration

For plugins with backend services:

### 1. Configure Docker Credentials

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Or Docker Hub
docker login -u USERNAME
```

### 2. Build and Push Image

```bash
# Build
docker build -t ghcr.io/my-org/my-plugin-backend:1.0.0 backend/

# Push
docker push ghcr.io/my-org/my-plugin-backend:1.0.0
```

### 3. Publish with Image Reference

```bash
naap-plugin publish --backend-image ghcr.io/my-org/my-plugin-backend:1.0.0
```

### Automated Docker Builds

The GitHub Actions workflow handles Docker builds automatically:

```yaml
docker:
  runs-on: ubuntu-latest
  steps:
    - uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - uses: docker/build-push-action@v5
      with:
        context: backend
        push: true
        tags: ghcr.io/${{ github.repository }}-backend:${{ github.ref_name }}
```

## Security Scanning

The registry performs security checks before accepting publishes.

### Pre-Publish Checks

1. **Manifest Validation**
   - Valid name, version, and required fields
   - Correct route patterns
   - Valid semver version

2. **Dependency Scanning**
   - Known malicious packages
   - Critical vulnerabilities (blocking)
   - High vulnerabilities (warning)

3. **Docker Image Verification**
   - Image exists and is accessible
   - Required labels present
   - Size limits

### Running Local Security Scan

```bash
# Run npm audit
npm audit --json > audit.json

# The publish command includes security checks
naap-plugin publish --verify
```

### Bypassing Security (Not Recommended)

For emergency situations only:

```bash
# Skip security checks (requires admin token)
naap-plugin publish --skip-security
```

## Version Management

### Semantic Versioning

All plugins must use [semver](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features, backward compatible
- **PATCH** (1.0.0 → 1.0.1): Bug fixes

### Pre-release Versions

```bash
# Publish a beta version
naap-plugin version 1.1.0-beta.1
naap-plugin publish --tag beta
```

Pre-release versions:
- Don't show as "latest" in marketplace
- Must be explicitly installed: `naap-plugin install my-plugin@1.1.0-beta.1`

### Version Bumping

```bash
# Bump patch version (1.0.0 → 1.0.1)
naap-plugin version patch

# Bump minor version (1.0.0 → 1.1.0)
naap-plugin version minor

# Bump major version (1.0.0 → 2.0.0)
naap-plugin version major
```

### Deprecating Versions

```bash
# Deprecate with message
naap-plugin deprecate 1.0.0 --message "Use 2.0.0 instead"

# Un-deprecate
naap-plugin deprecate 1.0.0 --undo
```

## Troubleshooting

### Common Issues

#### "Not authenticated"

```bash
# Check token
naap-plugin github token --show

# Re-set token
naap-plugin github token --set
```

#### "Version already exists"

Bump your version before publishing:

```bash
naap-plugin version patch
naap-plugin publish
```

#### "Manifest validation failed"

Check your `plugin.json`:

```bash
# Validate manifest
naap-plugin validate

# Common issues:
# - name must be lowercase, no spaces
# - version must be valid semver
# - routes must start with /
```

#### "Frontend artifacts not found"

Ensure you've built the frontend:

```bash
cd frontend
npm run build
ls dist/production/my-plugin.js  # Should exist
```

#### "Docker image not found"

Verify the image is pushed and accessible:

```bash
# Check if image exists
docker manifest inspect ghcr.io/my-org/my-plugin:1.0.0

# Ensure you're logged in
docker login ghcr.io
```

### Debug Mode

Enable verbose logging:

```bash
DEBUG=naap:* naap-plugin publish
```

### Getting Help

- [GitHub Discussions](https://github.com/naap-platform/naap/discussions)
- [Discord Community](https://discord.gg/naap)
- [Documentation](https://docs.naap.io)

## Best Practices

### 1. Use Changesets

Keep a `CHANGELOG.md` for each release:

```markdown
## [1.1.0] - 2026-01-15

### Added
- New feature X

### Fixed
- Bug in feature Y
```

### 2. Test Before Publishing

```bash
# Full validation
naap-plugin publish --verify

# Test in dev environment
naap-plugin dev
```

### 3. Use Pre-releases

For significant changes, publish beta versions first:

```bash
naap-plugin version 2.0.0-beta.1
naap-plugin publish --tag beta
```

### 4. Monitor After Publishing

Check the marketplace for your plugin and verify:
- Frontend loads correctly
- Backend container starts
- Database migrations run

### 5. Secure Your Tokens

- Never commit tokens to git
- Rotate tokens periodically
- Use separate tokens for CI/CD and local development
- Limit token scopes where possible
