#!/bin/bash

# NAAP Platform - Setup (DEPRECATED)
# ====================================
# Setup is now automatic. Just run:
#
#   ./bin/start.sh
#
# On a fresh clone, start.sh will automatically:
#   1. Install dependencies (npm install)
#   2. Install git hooks
#   3. Create .env files
#   4. Start Docker database
#   5. Sync Prisma schema
#   6. Build plugins
#   7. Start all services
#
# This file exists only for backward compatibility.

echo ""
echo -e "\033[1;33m[WARN]\033[0m  setup.sh is deprecated. Setup is now automatic."
echo ""
echo "  Just run:  ./bin/start.sh"
echo ""
echo "  On a fresh clone, start.sh handles everything:"
echo "    - npm install"
echo "    - .env file creation"
echo "    - Database setup + schema sync"
echo "    - Plugin builds"
echo "    - Service startup"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# If --start was passed, redirect to start.sh
for arg in "$@"; do
  case "$arg" in
    --start)
      echo -e "\033[0;34m[INFO]\033[0m  Redirecting to ./bin/start.sh..."
      exec "$SCRIPT_DIR/start.sh" "$@"
      ;;
  esac
done

echo "  To start the platform, run:  ./bin/start.sh"
echo ""
