# Plugin Marketplace

Discover, install, and manage plugins to extend your NAAP experience.

## Features

- **Plugin Discovery**: Browse and search available plugins
- **Installation**: One-click plugin installation
- **Categories**: Filter by plugin category
- **Ratings & Downloads**: See popularity metrics

## Installation

```bash
naap-plugin install marketplace
```

## API Endpoints

### GET /api/v1/marketplace/assets
Returns list of marketplace assets.

### GET /api/v1/marketplace/assets/:id
Returns details for a specific asset.

## Development

```bash
cd plugins/marketplace
npm install
npm run dev
```

## License

MIT
