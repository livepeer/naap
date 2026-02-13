# Network Analytics Plugin

Real-time network performance metrics, charts, and leaderboards for the AI compute network.

## Features

- **Analytics Dashboard**: View network-wide performance metrics
- **Charts**: Jobs processed, latency, and utilization charts
- **Leaderboard**: Top performing orchestrators by earnings and jobs
- **Time Range Filters**: View data over 24h, 7d, or 30d

## Installation

```bash
naap-plugin install network-analytics
```

## API Endpoints

### GET /api/v1/network-analytics/stats
Returns network-wide statistics.

### GET /api/v1/network-analytics/capabilities
Returns pipeline capability data.

### GET /api/v1/network-analytics/jobs
Returns recent job data.

## Development

```bash
cd plugins/network-analytics
npm install
npm run dev
```

## License

MIT
