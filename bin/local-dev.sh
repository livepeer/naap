#!/bin/bash

# ╔════════════════════════════════════════════════════════════════╗
# ║  DEPRECATED — This script uses pnpm and an older setup flow.  ║
# ║  NaaP now uses npm as its package manager.                     ║
# ║                                                                ║
# ║  Use instead:                                                  ║
# ║    ./bin/start.sh        # Start the platform (setup is auto)  ║
# ║    ./bin/stop.sh         # Stop the platform                   ║
# ╚════════════════════════════════════════════════════════════════╝

echo "WARNING: This script is DEPRECATED. Use ./bin/start.sh instead."
exit 1

set -e

echo "=== NaaP Local Development Setup ==="
echo ""

# Change to project root
cd "$(dirname "$0")/.."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "Error: Docker is not running. Please start Docker and try again."
  exit 1
fi

# Start unified database via docker-compose
echo "Starting unified PostgreSQL database..."
docker-compose up -d database

# Wait for database
echo "Waiting for database..."
until docker exec naap-db pg_isready -U postgres > /dev/null 2>&1; do
  printf "."
  sleep 1
done
echo ""
echo "Database ready!"

# Setup environment file if not exists
if [ ! -f "apps/web-next/.env.local" ]; then
  echo "Creating .env.local..."
  cat > apps/web-next/.env.local << 'EOF'
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="development-secret-change-in-production"
EOF
  echo ".env.local created"
fi

# Generate Prisma client and push schema
echo "Setting up unified database schema..."
cd packages/database
npx prisma generate
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" npx prisma db push --accept-data-loss
cd ../..

# Install dependencies
echo "Installing dependencies..."
pnpm install

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Start developing:"
echo "  ./bin/start.sh start --all"
echo ""
echo "Database:"
echo "  URL: postgresql://postgres:postgres@localhost:5432/naap"
echo "  Studio: cd packages/database && npx prisma studio"
