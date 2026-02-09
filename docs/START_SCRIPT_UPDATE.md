# Start Script Update - `--shell-with-backends` Option

**Date:** January 29, 2026  
**Status:** ✅ Complete

---

## What Was Added

### New Option: `--shell-with-backends`

**Command:**
```bash
./bin/start.sh --shell-with-backends
```

**Alias:** Can also use `--with-backends`

---

## What It Does

Starts the shell application along with **all plugin backend services**, but uses the unified plugin-server for frontend assets (faster than `--all`).

**Starts:**
1. ✅ base-svc (port 4000)
2. ✅ plugin-server (port 3100)
3. ✅ health-monitor
4. ✅ shell-web (port 3000)
5. ✅ **All plugin backends:**
   - gateway-manager-svc (port 4001)
   - marketplace-svc (port 4005)
   - developer-api-svc (port 4006)
   - capacity-planner-svc (port 4007)
   - my-wallet-svc (port 4008)
   - my-dashboard-svc (port 4009)
   - plugin-publisher-svc (port 4010)
   - orchestrator-manager-svc (port 4002)
   - network-analytics-svc (port 4003)
   - community-svc (port 4004)

**Doesn't Start:**
- ❌ Individual plugin frontend dev servers (uses unified plugin-server instead)

---

## Why This Is Useful

### Before This Update

**Problem:**
- Default `./bin/start.sh` only started core services
- Plugin backends weren't running
- Plugins like Gateway Manager and My Wallet failed with `ERR_CONNECTION_REFUSED`
- Had to manually start each backend service

### After This Update

**Solution:**
```bash
# One command starts everything you need
./bin/start.sh --shell-with-backends
```

- ✅ All backends start automatically
- ✅ Faster than `--all` (uses unified plugin-server)
- ✅ Perfect for plugin testing
- ✅ No manual service management needed

---

## Comparison of Options

| Command | Shell | Base-svc | Plugin Backends | Plugin Frontends | Use Case |
|---------|-------|----------|-----------------|------------------|----------|
| `./bin/start.sh` | ✅ | ✅ | ❌ | Unified server | UI dev only |
| `./bin/start.sh --shell-with-backends` | ✅ | ✅ | ✅ All | Unified server | Plugin testing ⭐ |
| `./bin/start.sh --all` | ✅ | ✅ | ✅ All | Separate servers | Full system |
| `./bin/start.sh gateway-manager` | ✅ | ✅ | ✅ Selected | Selected | Specific plugin |

---

## When to Use Each Option

### 1. Default (`./bin/start.sh`)
**Use when:**
- Working on shell UI only
- Don't need plugin backends
- Want fastest startup

**Startup time:** ~5 seconds

---

### 2. Shell with Backends (`./bin/start.sh --shell-with-backends`) ⭐ **NEW**
**Use when:**
- Testing plugins with backend APIs
- Full plugin functionality testing
- Developing plugin backends
- **This is what you need for Gateway Manager, My Wallet, etc.**

**Startup time:** ~15 seconds

---

### 3. All Services (`./bin/start.sh --all`)
**Use when:**
- Testing plugin frontend hot-reload
- Verifying plugin builds
- Full system integration testing

**Startup time:** ~30 seconds

---

## Implementation Details

### Code Changes

**File:** `bin/start.sh`

**Added Functions:**
1. `start_shell_with_backends()` - Starts shell + all backends
2. `print_summary_shell_with_backends()` - Shows backend URLs

**Modified:**
- Help text to include new option
- Case statement to handle `--shell-with-backends` and `--with-backends`

**Lines changed:** ~80 lines added

---

## Example Output

```bash
$ ./bin/start.sh --shell-with-backends

[INFO] Starting shell with all plugin backends...

=== Core Services ===
[INFO] Starting base-svc on port 4000...
[OK] Base Service: http://localhost:4000/healthz
[INFO] Starting plugin-server on port 3100...
[OK] Plugin Server: http://localhost:3100/plugins
[INFO] Starting health monitor for plugin-server...
[OK] Health monitor running (PID: 12345)
[INFO] Starting shell-web on port 3000...
[OK] Shell: http://localhost:3000

=== Plugin Backends ===
[INFO] Starting Gateway Manager backend on port 4001...
[OK] Gateway Manager Backend: http://localhost:4001/healthz
[INFO] Starting My Wallet backend on port 4008...
[OK] My Wallet Backend: http://localhost:4008/healthz
[INFO] Starting My Dashboard backend on port 4009...
[OK] My Dashboard Backend: http://localhost:4009/healthz
...

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
  Plugin Marketplace:       http://localhost:4005/healthz
  ...

To stop: ./bin/stop.sh
================================================
```

---

## Testing

### Verified Working

✅ All plugin backends start correctly  
✅ Help text shows new option  
✅ Summary displays all backend URLs  
✅ Alias `--with-backends` works  
✅ Stop script properly kills all processes  

### Manual Test Steps

```bash
# 1. Stop existing services
./bin/stop.sh

# 2. Start with new option
./bin/start.sh --shell-with-backends

# 3. Wait 15 seconds

# 4. Verify backends
curl http://localhost:4001/healthz  # Gateway Manager
curl http://localhost:4008/healthz  # My Wallet
curl http://localhost:4009/healthz  # My Dashboard

# 5. Open browser
open http://localhost:3000

# 6. Test plugins
# - Gateway Manager should load
# - My Wallet should load
# - No ERR_CONNECTION_REFUSED errors
```

---

## Documentation Created

1. ✅ `START_OPTIONS_GUIDE.md` - Full reference guide
2. ✅ `QUICK_START.md` - Quick reference
3. ✅ `docs/START_SCRIPT_UPDATE.md` - This file
4. ✅ Updated help text in `bin/start.sh`

---

## Benefits

### For Development
- ✅ Single command to start all needed services
- ✅ Consistent backend availability
- ✅ No manual service management
- ✅ Faster than `--all` option

### For Testing
- ✅ All plugin backends ready
- ✅ Easy integration testing
- ✅ Reliable service startup
- ✅ Clear status output

### For Onboarding
- ✅ New developers understand what's running
- ✅ Clear documentation
- ✅ Easy to remember command
- ✅ Predictable behavior

---

## Backward Compatibility

✅ **No breaking changes**

- Default behavior unchanged (`./bin/start.sh` still starts shell only)
- All existing options still work
- Can be adopted gradually
- Aliases provided for convenience

---

## Future Enhancements

Possible improvements:
1. Add `--shell-with-backends gateway-manager my-wallet` for selective backends
2. Add health check waiting before showing summary
3. Add option to skip health-monitor
4. Add `--quick` flag to skip health checks

---

## Summary

**Added:** `--shell-with-backends` option to `bin/start.sh`

**Purpose:** Start shell + all plugin backends in one command

**Use case:** Plugin testing and development

**Commands:**
```bash
# New way (with backends)
./bin/start.sh --shell-with-backends

# Old way (no backends)
./bin/start.sh
```

**Result:** Gateway Manager, My Wallet, and all plugins now work out of the box! ✅

---

**Status:** ✅ Complete and tested  
**Ready for:** Immediate use  
**Documentation:** Complete
