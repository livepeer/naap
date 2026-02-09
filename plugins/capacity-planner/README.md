# Capacity Planner Plugin

Coordinate GPU capacity requests between gateways and orchestrators with soft commits and deadline tracking.

## Features

- **Capacity Requests**: Create and manage GPU capacity requests
- **Soft Commits**: Track orchestrator commitments to requests
- **Deadline Tracking**: Monitor request deadlines
- **Workflow Filtering**: Filter by AI workflow type

## Installation

```bash
naap-plugin install capacity-planner
```

## API Endpoints

### GET /api/v1/capacity-planner/requests
Returns list of all capacity requests.

### GET /api/v1/capacity-planner/requests/:id
Returns details for a specific request.

## Development

```bash
cd plugins/capacity-planner
npm install
npm run dev
```

## License

MIT
