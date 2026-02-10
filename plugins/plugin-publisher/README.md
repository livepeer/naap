# Plugin Publisher

Publish, validate, and manage your plugins in the NAAP marketplace.

## Features

- **Publish Wizard**: Step-by-step wizard to publish plugins from local folders, GitHub, or DockerHub
- **Plugin Validation**: Validate plugin manifests before publishing
- **API Token Management**: Create and manage API tokens for CI/CD integration
- **My Plugins**: View and manage all your published plugins
- **Stats Dashboard**: Track downloads and installations over time
- **GitHub Integration**: Auto-publish on GitHub releases
- **Pricing Configuration**: Set plugins as free or paid (coming soon)

## Getting Started

### Prerequisites

- Node.js 20+
- A NAAP account with publisher permissions

### Development

```bash
# Install dependencies
cd plugins/plugin-publisher/frontend && npm install
cd plugins/plugin-publisher/backend && npm install

# Start frontend dev server
cd plugins/plugin-publisher/frontend && npm run dev

# Start backend dev server
cd plugins/plugin-publisher/backend && npm run dev
```

### Creating an API Token

1. Navigate to Plugin Publisher > API Tokens
2. Click "Create Token"
3. Select scopes (read, publish, admin)
4. Copy and save the token securely

### Publishing a Plugin

#### From Local Folder

1. Build your plugin: `npm run build`
2. Navigate to Plugin Publisher > Publish
3. Select "Local Upload"
4. Upload your built plugin bundle and optional Docker image
5. Review validation results
6. Confirm and publish

#### From GitHub

1. Navigate to Plugin Publisher > Settings
2. Configure GitHub webhook
3. Create a GitHub release with tag matching semver (e.g., `v1.0.0`)
4. Plugin will auto-publish

## API Reference

### Validation

```bash
curl -X POST http://localhost:4009/api/v1/plugin-publisher/validate \
  -H "Content-Type: application/json" \
  -d '{"manifest": {...}}'
```

### Upload

```bash
curl -X POST http://localhost:4009/api/v1/plugin-publisher/upload \
  -H "Authorization: Bearer <token>" \
  -F "plugin=@plugin.zip"
```

### Stats

```bash
curl http://localhost:4009/api/v1/plugin-publisher/stats/my-plugin \
  -H "Authorization: Bearer <token>"
```

## License

MIT
