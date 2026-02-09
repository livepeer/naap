# Quick Start Guide

## For Your Current Issue (Plugins Not Loading)

```bash
# 1. Stop all services
./bin/stop.sh

# 2. Start shell with all plugin backends
./bin/start.sh --shell-with-backends

# 3. Wait 10-15 seconds, then open browser
# http://localhost:3000
```

This ensures Gateway Manager, My Wallet, and all plugin backends are running!

---

## Daily Use

### Just UI Development (Fast)
```bash
./bin/start.sh
```
Starts: Shell + Base Service + Plugin Server (no backends)

### Plugin Testing (With Backends)
```bash
./bin/start.sh --shell-with-backends
```
Starts: Shell + Base Service + **All Plugin Backends** ⭐ **NEW**

### Everything
```bash
./bin/start.sh --all
```
Starts: All services (uses more resources)

---

## Stop Services
```bash
./bin/stop.sh
```

---

## What Changed

**Before:** Plugins with backends (Gateway Manager, My Wallet) wouldn't load because their backends weren't running.

**Now:** Use `--shell-with-backends` to start shell + all plugin backends automatically!

**The new option starts:**
- base-svc (port 4000)
- plugin-server (port 3100)
- shell-web (port 3000)
- gateway-manager-svc (port 4001)
- my-wallet-svc (port 4008)
- my-dashboard-svc (port 4009)
- marketplace-svc (port 4005)
- All other plugin backends...

See `START_OPTIONS_GUIDE.md` for full details.
