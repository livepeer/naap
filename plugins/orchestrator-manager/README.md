# Orchestrator Manager Plugin

Manage GPU compute orchestrators on the network with real-time monitoring, performance metrics, and fleet management.

## Features

- **Orchestrator Overview**: View all GPU orchestrators on the network
- **Real-time Monitoring**: Track load, success rate, and earnings
- **GPU Specifications**: View GPU types, VRAM, CUDA versions
- **Pipeline Support**: See supported AI pipelines per orchestrator
- **Region Tracking**: Monitor orchestrators by geographic region

## Installation

```bash
naap-plugin install orchestrator-manager
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `refreshInterval` | number | 30 | Metrics refresh interval in seconds |

## API Endpoints

### GET /api/v1/orchestrator-manager/orchestrators
Returns list of all orchestrators.

### GET /api/v1/orchestrator-manager/orchestrators/:id
Returns details for a specific orchestrator.

## Development

```bash
cd plugins/orchestrator-manager
npm install
npm run dev
```

## License

MIT
