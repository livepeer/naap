# NAAP Platform Start Options Guide

## Quick Reference

### Most Common Commands

```bash
# Start shell only (fastest, for UI development)
./bin/start.sh

# Start shell + all plugin backends (for plugin testing)
./bin/start.sh --shell-with-backends

# Start everything (all services)
./bin/start.sh --all
```

---

## All Available Options

### 1. **Default (Shell Only)** - `./bin/start.sh`
**Use for:** UI development, quick starts

**Starts:**
- ✅ base-svc (port 4000)
- ✅ plugin-server (port 3100)
- ✅ shell-web (port 3000)
- ✅ health-monitor

**Plugin frontends:** Served from unified plugin-server (pre-built)  
**Plugin backends:** ❌ Not started

**When to use:**
- Frontend development only
- Quick UI testing
- You don't need plugin backends

---

### 2. **Shell with Backends** - `./bin/start.sh --shell-with-backends` ⭐ **NEW**
**Use for:** Full plugin testing with backends

**Starts:**
- ✅ base-svc (port 4000)
- ✅ plugin-server (port 3100)
- ✅ shell-web (port 3000)
- ✅ health-monitor
- ✅ **All plugin backends** (gateway-manager, my-wallet, etc.)

**Plugin frontends:** Served from unified plugin-server (pre-built)  
**Plugin backends:** ✅ All running (ports 4001-4010)

**When to use:**
- Testing plugins that need backend APIs
- Full plugin development
- Integration testing
- **After fixing the issue you just reported** ✅

**Example output:**
```
================================================
NAAP Platform - Shell + Plugin Backends
================================================

Frontend:
  Shell: http://localhost:3000

Core Backend:
  Base Service: http://localhost:4000/healthz
  Plugin Server: http://localhost:3100/plugins

Plugin Backends:
  Gateway Manager:          http://localhost:4001/healthz
  My Wallet:                http://localhost:4008/healthz
  My Dashboard:             http://localhost:4009/healthz
  Marketplace:              http://localhost:4005/healthz
  ...
```

---

### 3. **All Services** - `./bin/start.sh --all`
**Use for:** Complete system testing

**Starts:**
- ✅ base-svc
- ✅ shell-web
- ✅ All plugin frontends (separate dev servers)
- ✅ All plugin backends

**When to use:**
- Full system testing
- Development mode with plugin hot-reload
- Testing plugin frontend builds

**Note:** Uses more resources (each plugin has its own dev server)

---

### 4. **Specific Plugins** - `./bin/start.sh <plugin-name> [<plugin-name>...]`
**Use for:** Testing specific plugins only

**Example:**
```bash
./bin/start.sh gateway-manager my-wallet
```

**Starts:**
- ✅ base-svc
- ✅ shell-web
- ✅ Gateway Manager (frontend + backend)
- ✅ My Wallet (frontend + backend)

**When to use:**
- Working on specific plugins
- Selective testing
- Lower resource usage

---

### 5. **Only Backends** - `./bin/start.sh --services`
**Use for:** Backend development

**Starts:**
- ✅ base-svc
- ✅ All plugin backends

**When to use:**
- Backend-only development
- API testing
- Database work

---

### 6. **Only Frontends** - `./bin/start.sh --frontends`
**Use for:** Frontend development (rarely used)

**Starts:**
- ✅ shell-web
- ✅ All plugin frontends (separate dev servers)

**When to use:**
- Frontend-only work
- UI testing without backends

---

## Comparison Table

| Option | Shell | Base-svc | Plugin Server | Plugin FEs | Plugin BEs | Use Case |
|--------|-------|----------|---------------|------------|------------|----------|
| `(default)` | ✅ | ✅ | ✅ | Unified | ❌ | UI dev |
| `--shell-with-backends` | ✅ | ✅ | ✅ | Unified | ✅ | Plugin testing |
| `--all` | ✅ | ✅ | ❌ | Separate | ✅ | Full system |
| `--services` | ❌ | ✅ | ❌ | ❌ | ✅ | Backend dev |
| `--frontends` | ✅ | ❌ | ❌ | Separate | ❌ | Frontend dev |
| `<plugin-name>` | ✅ | ✅ | ❌ | Selected | Selected | Specific plugin |

---

## Common Workflows

### 1. Daily Development (UI work)
```bash
# Start shell only
./bin/start.sh

# Open http://localhost:3000
# Work on shell-web code
# Hot reload works automatically
```

### 2. Plugin Testing (Backend needed)
```bash
# Start shell + all backends
./bin/start.sh --shell-with-backends

# Wait for all backends to start (~10-15 seconds)
# Open http://localhost:3000
# Test plugins like Gateway Manager, My Wallet
```

### 3. Working on Specific Plugin
```bash
# Start just the plugin you need
./bin/start.sh gateway-manager

# Or multiple plugins
./bin/start.sh gateway-manager my-wallet my-dashboard
```

### 4. Quick Testing (No backend needed)
```bash
# Just the shell
./bin/start.sh

# Test UI, navigation, shell features only
```

---

## Troubleshooting

### Plugin Backend Not Responding

**Problem:** `ERR_CONNECTION_REFUSED` on plugin backend

**Solution:**
```bash
# Use --shell-with-backends
./bin/start.sh --shell-with-backends
```

### Port Already in Use

**Problem:** `EADDRINUSE` error

**Solution:**
```bash
# Stop all services first
./bin/stop.sh

# Then start again
./bin/start.sh --shell-with-backends
```

### Slow Startup

**Problem:** Takes long to start

**If you don't need backends:**
```bash
./bin/start.sh  # Default, fastest
```

**If you need backends:**
```bash
# Start specific ones only
./bin/start.sh gateway-manager my-wallet
```

---

## Quick Tips

1. **Default is fastest:** Just `./bin/start.sh` for most UI work

2. **Use --shell-with-backends when:** You need to test plugins that make backend API calls

3. **Stop services:** Always `./bin/stop.sh` before restarting

4. **Check what's running:**
   ```bash
   cat .pids
   ```

5. **View logs:**
   ```bash
   tail -f logs/gateway-manager-svc.log
   tail -f logs/my-wallet-svc.log
   tail -f logs/shell-web.log
   ```

---

## Summary

**For your current issue (Gateway Manager, My Wallet not loading):**

```bash
# Stop everything
./bin/stop.sh

# Start shell with all backends
./bin/start.sh --shell-with-backends

# Wait 10-15 seconds for backends to start
# Refresh browser at http://localhost:3000
```

This ensures all plugin backends are running when you start the shell!
