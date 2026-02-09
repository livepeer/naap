# NAAP Platform Startup Scripts

This directory contains executable scripts for managing the NAAP Platform development environment.

## Quick Start

```bash
# Start shell app only (default)
./bin/start.sh

# Start everything
./bin/start.sh --all

# Stop all services
./bin/stop.sh
```

## Available Scripts

### `start.sh` - Start Platform Services

Starts the NAAP Platform services (shell, base service, and plugins).

#### Usage

```bash
# Start shell app + base service only (default)
./bin/start.sh
# or
./bin/start.sh --shell

# Start all services (shell + all plugins)
./bin/start.sh --all

# Start only plugin frontends + backends
./bin/start.sh --plugins

# Start only backend services
./bin/start.sh --services

# Start only frontends
./bin/start.sh --frontends

# Start specific plugins
./bin/start.sh gateway-manager my-wallet

# List all available plugins
./bin/start.sh --list

# Show help
./bin/start.sh --help
```

#### What It Does

1. Reads plugin configurations from `plugins/*/plugin.json`
2. Starts backend services on their configured ports
3. Starts frontend applications on their configured ports
4. Tracks process IDs in `.pids` file for cleanup
5. Displays a summary of running services with URLs

#### Port Assignments

**Core Services:**
- Shell Frontend: `3000`
- Base Service: `4000`

**Plugins (read from plugin.json):**

| Plugin | Frontend Port | Backend Port |
|--------|---------------|--------------|
| Gateway Manager | 3001 | 4001 |
| Orchestrator Manager | 3002 | 4002 |
| Capacity Planner | 3003 | 4003 |
| Network Analytics | 3004 | 4004 |
| Marketplace | 3005 | 4005 |
| Community | 3006 | 4006 |
| Developer API | 3007 | 4007 |
| My Wallet | 3008 | 4008 |
| My Dashboard | 3009 | 4009 |
| Plugin Publisher | 3010 | 4010 |

---

### `stop.sh` - Stop All Services

Stops all running NAAP Platform services gracefully.

```bash
./bin/stop.sh
```

#### What It Does

1. Reads process IDs from `.pids` file
2. Sends termination signal to each process
3. Cleans up orphaned processes on platform ports (3000-3010, 4000-4010)
4. Removes the `.pids` file

---

### `build-plugins.sh` - Build All Plugins

Builds all plugin frontends and backends for production.

```bash
# Build all plugins
./bin/build-plugins.sh

# Build only frontends
./bin/build-plugins.sh --frontend-only

# Build only backends
./bin/build-plugins.sh --backend-only

# Build specific plugins
./bin/build-plugins.sh gateway-manager my-wallet
```

#### What It Does

1. Iterates through all plugins in `plugins/` directory
2. Installs dependencies if needed
3. Builds frontend (generates UMD bundle for CDN deployment)
4. Builds backend (compiles TypeScript)
5. Generates Prisma client if database schema exists

---

### `smoke.sh` - Run Smoke Tests

Verifies that all platform services are healthy and responding correctly.

```bash
./bin/smoke.sh
```

#### What It Tests

1. **Core Services:**
   - Base service health endpoint
   - Shell frontend

2. **Plugin Services:**
   - Backend health endpoints for each plugin
   - Frontend UMD bundle availability

3. **API Endpoints:**
   - Authentication API
   - Plugin registry API
   - Marketplace packages API

---

### `services-start.sh` - Start Infrastructure

Starts Docker containers for databases and Kafka.

```bash
./bin/services-start.sh
```

#### What It Starts

- PostgreSQL database containers
- Zookeeper and Kafka

---

### `db-*.sh` - Database Scripts

Database management utilities:

```bash
# Setup databases
./bin/db-setup.sh

# Run migrations
./bin/db-migrate.sh

# Seed databases
./bin/db-seed.sh

# Reset databases
./bin/db-reset.sh
```

---

## Development Workflow

### First Time Setup

```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure (databases, Kafka)
./bin/services-start.sh

# 3. Setup and seed databases
./bin/db-setup.sh
./bin/db-seed.sh

# 4. Start the platform
./bin/start.sh --all

# 5. Verify everything is running
./bin/smoke.sh

# 6. Access the shell at http://localhost:3000
```

### Daily Development

```bash
# Start just what you need
./bin/start.sh                    # Shell only
./bin/start.sh gateway-manager    # Shell + specific plugin

# Work on your feature...

# Run tests
./bin/smoke.sh

# Stop when done
./bin/stop.sh
```

### Plugin Development

When developing a plugin, you can use the Plugin CLI:

```bash
# Navigate to plugin directory
cd plugins/my-plugin

# Start dev servers
npx naap-plugin dev

# Build for production
npx naap-plugin build

# Package for deployment
npx naap-plugin package
```

Or use the bin scripts:

```bash
# Start shell + your plugin
./bin/start.sh my-plugin

# Build your plugin
./bin/build-plugins.sh my-plugin
```

---

## Using npm Scripts

The root `package.json` includes convenience scripts:

```bash
# Start all services
npm start

# Start shell only
npm run dev

# Build all plugins
npm run build:plugins

# Run smoke tests
npm run smoke
```

---

## Troubleshooting

### Port Already in Use

```bash
# Stop all services (cleans up orphaned processes)
./bin/stop.sh

# Or manually check/kill a port
lsof -ti:3000 | xargs kill
```

### Services Not Starting

1. **Check dependencies:**
   ```bash
   npm install
   ```

2. **Check logs:**
   ```bash
   cat logs/shell-web.log
   cat logs/gateway-manager-svc.log
   ```

3. **Run service directly:**
   ```bash
   cd apps/shell-web && npm run dev
   cd plugins/gateway-manager/frontend && npm run dev
   ```

### Plugin Not Loading

1. **Check if built:**
   ```bash
   ls plugins/my-plugin/frontend/dist/production/my-plugin.js
   ```

2. **Build if missing:**
   ```bash
   ./bin/build-plugins.sh my-plugin
   ```

3. **Check plugin registry:**
   ```bash
   curl http://localhost:4000/api/v1/plugins
   ```

### Database Issues

```bash
# Reset and reseed database
./bin/db-reset.sh
./bin/db-seed.sh
```

---

## File Structure

```
bin/
├── README.md           # This file
├── start.sh            # Start platform services
├── stop.sh             # Stop all services
├── build-plugins.sh    # Build all plugins
├── smoke.sh            # Smoke test script
├── services-start.sh   # Start infrastructure
├── db-setup.sh         # Setup databases
├── db-migrate.sh       # Run migrations
├── db-seed.sh          # Seed databases
├── db-reset.sh         # Reset databases
└── kafka-setup.sh      # Setup Kafka topics
```

---

## Adding a New Plugin

When adding a new plugin:

1. **Create plugin structure:**
   ```bash
   npx naap-plugin create my-new-plugin
   ```

2. **Register in database:**
   - Add to `services/base-svc/prisma/seed.ts`

3. **Scripts automatically discover:**
   - `start.sh` reads port from `plugin.json`
   - `build-plugins.sh` includes new plugin
   - `smoke.sh` tests new plugin

---

## CI/CD Integration

```yaml
# Example GitHub Actions workflow
jobs:
  test:
    steps:
      - name: Install dependencies
        run: npm install
      
      - name: Start infrastructure
        run: docker-compose up -d
      
      - name: Start platform
        run: ./bin/start.sh --all
      
      - name: Wait for services
        run: sleep 15
      
      - name: Run smoke tests
        run: ./bin/smoke.sh
      
      - name: Stop platform
        if: always()
        run: ./bin/stop.sh
```

---

## Requirements

- **Bash** 3.2+ (macOS default)
- **Node.js** 18+ or 20+
- **npm** (comes with Node.js)
- **Docker** (for databases and Kafka)
- **curl** (for smoke tests)
- **lsof** (for port cleanup)
