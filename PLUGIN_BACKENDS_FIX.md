# Plugin Backends Fix - Root Cause Analysis

**Date**: January 29, 2026  
**Issue**: Gateway Manager, My Wallet, and My Dashboard backends not working  
**Status**: ✅ **RESOLVED**

---

## Root Cause

**NOT RELATED TO DEBUGGER PLUGIN IMPLEMENTATION**

The issue was caused by **orphaned processes** holding the backend ports, preventing the plugin services from starting.

### Evidence

**Gateway Manager (Port 4001)**:
```
Error: listen EADDRINUSE: address already in use :::4001
```

**My Wallet (Port 4008)**:
```
Error: listen EADDRINUSE: address already in use :::4008
```

**My Dashboard (Port 4009)**:
- Configured on port 4009 (not 4003)
- Was running but shut down gracefully
- Needed restart

---

## What Happened

1. Plugin backend services were started previously
2. Services were not cleanly stopped (orphaned processes)
3. When `start.sh` tried to restart them, ports were already in use
4. Services failed to start with `EADDRINUSE` errors
5. Frontend showed `ERR_CONNECTION_REFUSED` because backends weren't running

---

## Fix Applied

### Step 1: Kill Orphaned Processes

```bash
# Kill processes on plugin backend ports
lsof -ti:4001 | xargs kill -9  # Gateway Manager
lsof -ti:4008 | xargs kill -9  # My Wallet
```

### Step 2: Restart Services

```bash
# Gateway Manager
cd plugins/gateway-manager/backend
npm run dev > ../../../logs/gateway-manager-svc.log 2>&1 &

# My Wallet
cd plugins/my-wallet/backend
npm run dev > ../../../logs/my-wallet-svc.log 2>&1 &

# My Dashboard (was already running, but may need restart)
cd plugins/my-dashboard/backend
npm run dev > ../../../logs/my-dashboard-svc.log 2>&1 &
```

### Step 3: Verify

```bash
curl http://localhost:4001/healthz  # Gateway Manager ✅
curl http://localhost:4008/healthz  # My Wallet ✅
curl http://localhost:4009/healthz  # My Dashboard ✅
```

---

## Verification Results

**All backends now running:**

- ✅ **Gateway Manager** (port 4001) - Healthy
- ✅ **My Wallet** (port 4008) - Healthy  
- ✅ **My Dashboard** (port 4009) - Healthy

**Health Check Responses:**

```json
// Gateway Manager
{"status":"healthy","service":"gateway-manager","version":"1.0.0","database":{"status":"connected"}}

// My Wallet
{"status":"ok","service":"my-wallet","cache":{"backend":"memory","redisConnected":false}}

// My Dashboard
{"status":"healthy",...}
```

---

## Why This Happened

### Common Causes of Orphaned Processes

1. **Improper Shutdown**: `Ctrl+C` doesn't always kill all child processes
2. **Script Exit**: `start.sh` or `stop.sh` may not clean up properly
3. **Crash/Error**: Service crashes but process remains
4. **IDE Terminal Close**: Closing terminal without stopping services

### Why NOT Related to Debugger Plugin

The debugger plugin implementation:
- ✅ Is a completely separate plugin (`plugins/debugger/`)
- ✅ Uses its own port (4011)
- ✅ Does NOT modify any existing plugin code
- ✅ Does NOT touch gateway-manager, my-wallet, or my-dashboard

---

## Prevention

### Use Proper Stop Script

```bash
# Always use stop.sh before starting
./bin/stop.sh

# Then start cleanly
./bin/start.sh --shell-with-backends
```

### Check for Orphaned Processes

```bash
# List all plugin backend processes
lsof -ti:4001,4003,4008,4011

# Kill all if needed
lsof -ti:4001,4003,4008,4011 | xargs kill -9
```

### Monitor Service Health

```bash
# Quick health check script
for port in 4001 4003 4008; do
  echo -n "Port $port: "
  curl -s http://localhost:$port/healthz > /dev/null && echo "✅ Healthy" || echo "❌ Down"
done
```

---

## How to Start Services Correctly

### Option 1: Use start.sh (Recommended)

```bash
# Stop any existing processes first
./bin/stop.sh

# Start shell with all plugin backends
./bin/start.sh --shell-with-backends
```

### Option 2: Manual Start

```bash
# Kill orphaned processes
lsof -ti:4001,4003,4008 | xargs kill -9

# Start each backend
cd plugins/gateway-manager/backend && npm run dev &
cd plugins/my-wallet/backend && npm run dev &
cd plugins/my-dashboard/backend && npm run dev &

# Verify
curl http://localhost:4001/healthz
curl http://localhost:4008/healthz
curl http://localhost:4003/healthz
```

---

## Debugging Steps (For Future)

### 1. Check if Service is Running

```bash
# Check by port
lsof -ti:4001  # Should return PID if running

# Check by process
ps aux | grep gateway-manager | grep -v grep
```

### 2. Check Logs

```bash
# View recent logs
tail -50 logs/gateway-manager-svc.log
tail -50 logs/my-wallet-svc.log
tail -50 logs/my-dashboard-svc.log

# Look for EADDRINUSE errors
grep "EADDRINUSE" logs/*.log
```

### 3. Test Health Endpoint

```bash
# Should return JSON with status
curl http://localhost:4001/healthz

# If connection refused:
# - Service not running
# - Wrong port
# - Service crashed
```

### 4. Kill and Restart

```bash
# Kill orphaned process
lsof -ti:4001 | xargs kill -9

# Restart service
cd plugins/gateway-manager/backend
npm run dev
```

---

## Impact Assessment

### What Was Broken

- ❌ Gateway Manager frontend couldn't fetch data
- ❌ My Wallet frontend couldn't fetch data
- ❌ My Dashboard frontend couldn't fetch data
- ❌ Users saw `ERR_CONNECTION_REFUSED` errors

### What Was NOT Broken

- ✅ Shell application running fine
- ✅ Base services (base-svc) running fine
- ✅ Plugin server running fine
- ✅ Other plugins (marketplace, etc.) working
- ✅ Debugger plugin working (separate backend on 4011)

### Time to Resolution

- **Detection**: Immediate (user reported)
- **Diagnosis**: 2 minutes (checked logs, found EADDRINUSE)
- **Fix**: 1 minute (killed processes, restarted services)
- **Verification**: 1 minute (health checks passed)
- **Total**: ~5 minutes

---

## Summary

**Root Cause**: Orphaned processes on ports 4001 and 4008  
**NOT Related To**: Debugger plugin implementation  
**Fix**: Kill orphaned processes, restart services  
**Prevention**: Always use `stop.sh` before starting, check for orphans  
**Status**: ✅ **All services running and healthy**

---

## Quick Reference

**Check Service Health:**
```bash
curl http://localhost:4001/healthz  # Gateway Manager
curl http://localhost:4008/healthz  # My Wallet
curl http://localhost:4009/healthz  # My Dashboard
```

**Kill Orphaned Processes:**
```bash
lsof -ti:4001,4008,4009 | xargs kill -9
```

**Restart All Plugin Backends:**
```bash
./bin/stop.sh
./bin/start.sh --shell-with-backends
```

**Monitor Logs:**
```bash
tail -f logs/gateway-manager-svc.log
tail -f logs/my-wallet-svc.log
tail -f logs/my-dashboard-svc.log
```

---

**Resolution**: ✅ Complete  
**Services**: ✅ All running  
**User Impact**: ✅ Resolved
