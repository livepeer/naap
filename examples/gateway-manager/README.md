# Gateway Manager Plugin

Manage and monitor your AI gateway infrastructure with real-time metrics, configuration management, and performance analytics.

## Features

- **Real-time Monitoring**: Live metrics for gateway performance, latency, and throughput
- **Configuration Management**: Manage gateway settings and orchestrator connections
- **Performance Analytics**: Historical data and trend analysis
- **Alerts**: Configurable alerting for performance thresholds

## Installation

### From Marketplace

1. Navigate to the Marketplace in your NAAP shell
2. Search for "Gateway Manager"
3. Click Install

### Manual Installation

```bash
naap-plugin install gateway-manager
```

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- Docker (for database)
- NAAP CLI (`npm install -g @naap/plugin-sdk`)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/naap/plugins.git
cd plugins/gateway-manager

# Install dependencies
npm install
cd frontend && npm install
cd ../backend && npm install

# Start development servers
naap-plugin dev
```

### Project Structure

```
gateway-manager/
├── plugin.json          # Plugin manifest
├── frontend/            # React frontend (UMD/CDN)
│   ├── src/
│   │   ├── App.tsx     # Main component with mount function
│   │   ├── pages/      # Page components
│   │   └── components/ # Reusable components
│   ├── vite.config.ts
│   └── package.json
├── backend/             # Express backend
│   ├── src/
│   │   ├── server.ts   # Express server
│   │   └── routes/     # API routes
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── package.json
└── docs/
    ├── CHANGELOG.md
    └── api.md
```

### Building

```bash
naap-plugin build
```

### Testing

```bash
naap-plugin test
```

### Publishing

```bash
naap-plugin version patch  # or minor/major
naap-plugin package
naap-plugin publish
```

## Configuration

The plugin supports the following configuration options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `refreshInterval` | number | 30 | Metrics refresh interval in seconds |
| `alertThreshold` | number | 90 | CPU/Memory alert threshold percentage |
| `retentionDays` | number | 30 | Metrics retention period in days |

## API Endpoints

### Gateways

- `GET /api/v1/gateway-manager/gateways` - List all gateways
- `GET /api/v1/gateway-manager/gateways/:id` - Get gateway details
- `POST /api/v1/gateway-manager/gateways` - Create gateway
- `PUT /api/v1/gateway-manager/gateways/:id` - Update gateway
- `DELETE /api/v1/gateway-manager/gateways/:id` - Delete gateway

### Metrics

- `GET /api/v1/gateway-manager/gateways/:id/metrics` - Get gateway metrics
- `GET /api/v1/gateway-manager/gateways/:id/metrics/history` - Get historical metrics

### Configuration

- `GET /api/v1/gateway-manager/gateways/:id/config` - Get gateway configuration
- `PUT /api/v1/gateway-manager/gateways/:id/config` - Update gateway configuration

## License

MIT
