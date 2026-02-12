# My Dashboard Plugin

Embed Metabase dashboards with interactive analytics within the NAAP shell application.

## Features

- **Dashboard Gallery**: View all available dashboards in a grid layout
- **Interactive Embedding**: Full Metabase interactivity (filters, drill-down, explore)
- **User Preferences**: Pin/unpin and reorder your favorite dashboards
- **Admin Configuration**: Manage Metabase connection and default dashboards
- **Theme Integration**: Matches the shell app's design system

## Requirements

- **Metabase Pro or Enterprise** for interactive embedding
- Metabase embedding enabled in Admin settings

## Installation

1. Install the plugin from the marketplace
2. Configure Metabase connection in plugin settings
3. Add dashboards via the admin UI

## Configuration

### Metabase Setup

1. Go to Metabase Admin > Embedding
2. Enable "Interactive embedding"
3. Copy the "Embedding secret key"
4. Paste the key in the plugin settings

### Plugin Settings

| Setting | Description |
|---------|-------------|
| Metabase URL | Your Metabase instance URL |
| Secret Key | Embedding secret key from Metabase |
| Token Expiry | JWT token lifetime in seconds |
| Interactive Mode | Enable full Metabase interactivity |

## RBAC Roles

| Role | Permissions |
|------|-------------|
| `my-dashboard:admin` | Full access, configure settings, manage dashboards |
| `my-dashboard:user` | View dashboards, manage personal preferences |

## Development

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend && npm install && npm run dev
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/my-dashboard/dashboards` | GET | List dashboards |
| `/api/v1/my-dashboard/dashboards` | POST | Add dashboard (admin) |
| `/api/v1/my-dashboard/embed/:id` | GET | Get signed embed URL |
| `/api/v1/my-dashboard/preferences` | GET/PUT | User preferences |
| `/api/v1/my-dashboard/config` | GET/PUT | Plugin config (admin) |

## License

MIT
