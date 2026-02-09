# Development Setup Guide

## Prerequisites

- **Node.js**: 18+ or 20+
- **npm**: 10+
- **Docker**: 20.10+ (for databases and Kafka)
- **Docker Compose**: 2.0+

## Initial Setup

### 1. Clone and Install

```bash
# Clone repository
git clone <repository-url>
cd NaaP

# Install dependencies
npm install
```

### 2. Start Infrastructure Services

Start all databases and Kafka:

```bash
./bin/services-start.sh
```

This will:
- Start all PostgreSQL containers
- Start Kafka and Zookeeper
- Wait for services to be ready

### 3. Setup Databases

Initialize all databases with schemas and seed data:

```bash
./bin/db-setup.sh
```

This will:
- Run migrations for all services
- Seed development data

### 4. Setup Kafka Topics

Create required Kafka topics:

```bash
./bin/kafka-setup.sh
```

### 5. Configure Environment Variables

Copy environment templates (if available):

```bash
# For each service, copy .env.example to .env
cp services/base-svc/.env.example services/base-svc/.env
# Update with your values
```

### 6. Generate Prisma Clients

Generate Prisma clients for all services:

```bash
# Base service
cd services/base-svc
npm run db:generate

# Gateway service
cd ../workflows/gateway-manager-svc
npm run db:generate

# Repeat for other services
```

### 7. Start Platform Services

Start all platform services:

```bash
./bin/start.sh --all
```

Or start specific services:

```bash
# Shell only
./bin/start.sh --shell

# Specific workflows
./bin/start.sh gateway-manager orchestrator-manager
```

## Development Workflow

### Working on a Service

1. **Start infrastructure** (if not running):
   ```bash
   ./bin/services-start.sh
   ```

2. **Start the service**:
   ```bash
   cd services/base-svc
   npm run dev
   ```

3. **Make changes** - The service will auto-reload

4. **Test changes**:
   ```bash
   # Run smoke tests
   ./bin/smoke.sh
   ```

### Database Changes

1. **Modify Prisma schema**:
   ```bash
   cd services/your-service-svc
   # Edit prisma/schema.prisma
   ```

2. **Create migration**:
   ```bash
   npm run db:migrate
   ```

3. **Generate client**:
   ```bash
   npm run db:generate
   ```

4. **Update seed script** (if needed):
   ```bash
   # Edit prisma/seed.ts
   npm run db:seed
   ```

### Adding a New Service

1. **Create service directory**:
   ```bash
   mkdir -p services/workflows/new-service-svc/src
   ```

2. **Initialize package.json**:
   ```bash
   cd services/workflows/new-service-svc
   npm init -y
   ```

3. **Add dependencies**:
   ```bash
   npm install express cors @naap/types @naap/database
   npm install -D typescript tsx prisma @types/express
   ```

4. **Create Prisma schema** (see [database.md](./database.md))

5. **Create service files**:
   - `src/server.ts` - Express server
   - `src/db/client.ts` - Database client
   - `prisma/schema.prisma` - Database schema
   - `prisma/seed.ts` - Seed script

6. **Add to Docker Compose** (see [database.md](./database.md))

7. **Update scripts**:
   - Add to `bin/start.sh` port mappings
   - Add to `bin/db-setup.sh` service list

## Environment Variables

### Service-Specific

Each service needs a `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:port/database

# Service
PORT=4000
NODE_ENV=development

# Kafka (if using)
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=service-name
KAFKA_GROUP_ID=service-group
```

### Global

Root `.env` (optional):

```bash
# Database URLs
DATABASE_URL_BASE=postgresql://...
DATABASE_URL_GATEWAY=postgresql://...

# Kafka
KAFKA_BROKERS=localhost:9092
```

## Common Tasks

### Reset a Database

```bash
./bin/db-reset.sh base-svc
```

### Run Migrations

```bash
# All services
./bin/db-migrate.sh

# Specific service
./bin/db-migrate.sh base-svc
```

### Seed Data

```bash
# All services
./bin/db-seed.sh

# Specific service
./bin/db-seed.sh base-svc
```

### View Database

```bash
# Using Prisma Studio
cd services/base-svc
npm run db:studio
```

### View Kafka Topics

```bash
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

### View Kafka Messages

```bash
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic gateway.job.created \
  --from-beginning
```

### Stop All Services

```bash
./bin/stop.sh
```

### Stop Infrastructure

```bash
docker-compose down
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -ti:3000

# Kill process
kill $(lsof -ti:3000)
```

### Database Connection Failed

1. Check Docker containers:
   ```bash
   docker-compose ps
   ```

2. Check database logs:
   ```bash
   docker-compose logs base-db
   ```

3. Verify connection string in `.env`

### Kafka Not Working

1. Check Kafka is running:
   ```bash
   docker-compose ps kafka
   ```

2. Check Kafka logs:
   ```bash
   docker-compose logs kafka
   ```

3. Verify topics exist:
   ```bash
   ./bin/kafka-setup.sh
   ```

### Prisma Client Not Found

1. Generate client:
   ```bash
   npm run db:generate
   ```

2. Check schema path in `package.json`

3. Verify Prisma is installed:
   ```bash
   npm list prisma
   ```

### Service Not Starting

1. Check service logs:
   ```bash
   cd services/your-service-svc
   npm run dev
   ```

2. Verify dependencies installed:
   ```bash
   npm install
   ```

3. Check TypeScript errors:
   ```bash
   npm run build
   ```

## Development Tips

### Hot Reload

Services use `tsx watch` for hot reload. Changes to `.ts` files will automatically restart the service.

### Database Migrations

- Always create migrations for schema changes
- Test migrations on a copy of production data
- Never modify existing migrations

### Debugging

1. **Add console logs** for debugging
2. **Use Prisma Studio** to inspect database
3. **Check service logs** in terminal
4. **Use health endpoints** to verify service status

### Testing

```bash
# Run smoke tests
./bin/smoke.sh

# Test specific endpoint
curl http://localhost:4000/healthz
```

## IDE Setup

### VS Code

Recommended extensions:
- Prisma
- ESLint
- Prettier
- Docker

### TypeScript

The project uses TypeScript with path aliases. Configure your IDE to recognize:
- `@naap/types`
- `@naap/database`
- `@naap/service-registry`
- `@naap/services/kafka`
- `@naap/services/rest-client`

## Next Steps

- Read [Database Guide](./database.md) for database architecture
- Read [Services Guide](./services.md) for service integration
- Review [Architecture](./architecture.md) for system overview
