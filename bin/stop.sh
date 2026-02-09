#!/bin/bash

# NAAP Platform - Stop Script (delegates to start.sh)
# Usage: ./bin/stop.sh [options]
#
# This is a convenience wrapper around: ./bin/start.sh stop [options]
#
# Options:
#   (no options)           Stop all services gracefully
#   --shell                Stop shell frontend only
#   --services             Stop core services only
#   --plugins              Stop all plugin backends
#   --infra                Also stop Docker containers
#   <plugin_names...>      Stop specific plugins gracefully

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/start.sh" stop "$@"
