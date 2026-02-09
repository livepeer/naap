# Prisma Architecture Issue - Root Cause Analysis & Prevention

**Date**: January 29, 2026  
**Issue**: Gateway Manager 500 Error (and other plugin backends)  
**Status**: ✅ RESOLVED  

---

## 🔴 **Problem Summary**

**Symptoms:**
```
Failed to load resource: HTTP 500 (Internal Server Error)
POST http://localhost:4001/api/v1/gateway-manager/gateways
```

**Error in Logs:**
```
Prisma Client could not locate the Query Engine for runtime "darwin-arm64".
This happened because Prisma Client was generated for "darwin", 
but the actual deployment required "darwin-arm64".
```

**Impact:**
- Gateway-manager plugin completely broken (500 errors)
- Potentially affects: my-wallet, my-dashboard (any plugin using Prisma)
- Prevents database operations across all affected plugins

---

## 🔍 **Root Cause Analysis**

### What Happened

**1. Architecture Mismatch**
- System: Apple Silicon (darwin-arm64)
- Prisma Client: Compiled for Intel (darwin)
- Query Engine Binary: Missing arm64 version

**2. Configuration Error**
All Prisma schemas lacked the `binaryTargets` configuration:

```prisma
# BEFORE (WRONG)
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/client"
}

# AFTER (CORRECT)
generator client {
  provider      = "prisma-client-js"
  output        = "../src/generated/client"
  binaryTargets = ["native", "darwin-arm64"]  # ← MISSING
}
```

**3. Why It Happened**
- Prisma schemas created without considering Apple Silicon
- No architecture-specific build configuration
- Prisma client generated on different architecture
- Or: Project moved between Intel and ARM Macs

### Why This Is Critical

**Database Operations Fail:**
- All `prisma.model.findMany()` calls → 500 error
- All `prisma.model.create()` calls → 500 error
- All database queries → complete failure

**Plugin Impact:**
```
✗ gateway-manager → Cannot fetch gateways
✗ my-wallet → Cannot fetch connections
✗ my-dashboard → Cannot fetch dashboard data
✓ base-svc → Fixed first (login works)
```

---

## ✅ **Solution Applied**

### Services Fixed

**1. Base Service** (`services/base-svc`)
- Updated `prisma/schema.prisma`
- Regenerated Prisma client
- Restarted service
- ✅ **Result**: Login working, database healthy

**2. Gateway Manager** (`plugins/gateway-manager/backend`)
- Updated `prisma/schema.prisma`
- Regenerated Prisma client
- Restarted service
- ✅ **Result**: API returning gateway data

**3. My Wallet** (`plugins/my-wallet/backend`)
- Updated `prisma/schema.prisma`
- Regenerated Prisma client
- ✅ **Status**: Ready (restart when needed)

**4. My Dashboard** (`plugins/my-dashboard/backend`)
- Updated `prisma/schema.prisma`
- Regenerated Prisma client
- ✅ **Status**: Ready (restart when needed)

### Fix Commands

```bash
# For each service/plugin with Prisma:

# 1. Update schema.prisma
# Add: binaryTargets = ["native", "darwin-arm64"]

# 2. Regenerate Prisma client
cd <service-or-plugin>/backend
npx prisma generate

# 3. Restart service
kill <PID>
npm run dev &
```

---

## 🛡️ **Prevention Strategy**

### 1. **Standard Prisma Configuration Template**

Create a standard template for all Prisma schemas:

```prisma
// REQUIRED: Multi-architecture support
generator client {
  provider      = "prisma-client-js"
  output        = "../src/generated/client"
  binaryTargets = [
    "native",         // Current platform
    "darwin-arm64",   // Apple Silicon
    "darwin",         // Intel Mac
    "linux-musl",     // Alpine Linux (Docker)
    "debian-openssl-3.0.x"  // Debian/Ubuntu
  ]
}
```

**Benefits:**
- ✅ Works on Apple Silicon
- ✅ Works on Intel Macs
- ✅ Works in Docker containers
- ✅ Works on Linux servers
- ✅ No rebuild needed when moving between platforms

### 2. **Project Setup Documentation**

Add to `README.md` or setup guide:

```markdown
## Initial Setup (Apple Silicon / M1/M2/M3)

After cloning, regenerate Prisma clients:

\`\`\`bash
# Base service
cd services/base-svc && npx prisma generate

# Plugin backends (if using)
cd plugins/gateway-manager/backend && npx prisma generate
cd plugins/my-wallet/backend && npx prisma generate
cd plugins/my-dashboard/backend && npx prisma generate
\`\`\`
```

### 3. **Automated Check Script**

Create `bin/check-prisma.sh`:

```bash
#!/bin/bash

echo "Checking Prisma configurations..."

SCHEMAS=$(find . -name "schema.prisma" -not -path "*/node_modules/*")

for schema in $SCHEMAS; do
  if ! grep -q "darwin-arm64" "$schema"; then
    echo "⚠️  Missing darwin-arm64: $schema"
  else
    echo "✓ $schema"
  fi
done
```

### 4. **Pre-commit Hook**

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Check all Prisma schemas have proper binaryTargets

SCHEMAS=$(git diff --cached --name-only | grep "schema.prisma")

for schema in $SCHEMAS; do
  if ! grep -q "binaryTargets.*darwin-arm64" "$schema"; then
    echo "ERROR: $schema missing darwin-arm64 binaryTarget"
    exit 1
  fi
done
```

### 5. **CI/CD Validation**

Add to GitHub Actions / CI pipeline:

```yaml
- name: Validate Prisma Configurations
  run: |
    for schema in $(find . -name "schema.prisma"); do
      if ! grep -q "darwin-arm64" "$schema"; then
        echo "::error::Missing darwin-arm64 in $schema"
        exit 1
      fi
    done
```

### 6. **Documentation in Plugin Template**

When creating new plugins with Prisma, include this note:

```typescript
/**
 * IMPORTANT: Prisma Configuration for Apple Silicon
 * 
 * If you're on Apple Silicon (M1/M2/M3), ensure your schema.prisma includes:
 * 
 * generator client {
 *   provider      = "prisma-client-js"
 *   binaryTargets = ["native", "darwin-arm64"]
 * }
 * 
 * After any schema changes, run:
 *   npx prisma generate
 *   npm run dev
 */
```

---

## 📊 **Affected Services Matrix**

| Service/Plugin | Has Prisma | Fixed | Status |
|----------------|------------|-------|--------|
| base-svc | ✅ Yes | ✅ Yes | 🟢 Running |
| gateway-manager | ✅ Yes | ✅ Yes | 🟢 Running |
| my-wallet | ✅ Yes | ✅ Yes | 🟡 Needs restart |
| my-dashboard | ✅ Yes | ✅ Yes | 🟡 Needs restart |
| community | ❌ No | N/A | 🟢 Not affected |
| marketplace | ❌ No | N/A | 🟢 Not affected |
| orchestrator-manager | ❌ No | N/A | 🟢 Not affected |
| capacity-planner | ❌ No | N/A | 🟢 Not affected |
| network-analytics | ❌ No | N/A | 🟢 Not affected |
| developer-api | ❌ No | N/A | 🟢 Not affected |
| plugin-publisher | ❌ No | N/A | 🟢 Not affected |

---

## 🎯 **Testing Verification**

### Before Fix
```bash
curl http://localhost:4001/api/v1/gateway-manager/gateways
# → {"error":"Internal server error"}
```

### After Fix
```bash
curl http://localhost:4001/api/v1/gateway-manager/gateways
# → {"gateways":[...], "total":3, "limit":100, "offset":0}
```

**Frontend:**
- ✅ Gateway Manager loads successfully
- ✅ Gateways displayed in UI
- ✅ No console errors
- ✅ Data fetched from backend

---

## 🔄 **Migration Path for Existing Plugins**

If creating new plugins or fixing existing ones:

```bash
# 1. Update schema.prisma (add binaryTargets)

# 2. Regenerate Prisma client
npx prisma generate

# 3. Verify generation
ls src/generated/client/libquery_engine-darwin-arm64.dylib.node
# Should exist now

# 4. Restart service
npm run dev

# 5. Test
curl http://localhost:<port>/health
```

---

## 📝 **Lessons Learned**

### What Went Wrong
1. ❌ No multi-architecture consideration in initial setup
2. ❌ No validation of Prisma configurations
3. ❌ No clear documentation about Apple Silicon requirements
4. ❌ Silent failure until runtime (database operations)

### What Went Right
1. ✅ Error messages from Prisma were clear and actionable
2. ✅ Fix was straightforward once identified
3. ✅ Systematic approach fixed all affected services
4. ✅ No data loss or corruption

### Best Practices Established
1. ✅ Always include multiple `binaryTargets` in Prisma schemas
2. ✅ Document architecture-specific requirements
3. ✅ Add validation scripts for critical configurations
4. ✅ Test on multiple architectures before deployment
5. ✅ Regenerate Prisma clients after cloning/moving projects

---

## 🚀 **Action Items**

### Completed ✅
- [x] Fixed base-svc Prisma configuration
- [x] Fixed gateway-manager Prisma configuration
- [x] Fixed my-wallet Prisma configuration
- [x] Fixed my-dashboard Prisma configuration
- [x] Verified gateway-manager working

### Recommended 📋
- [ ] Add Prisma check script to `bin/`
- [ ] Update main README with architecture notes
- [ ] Create plugin development guide with Prisma template
- [ ] Add pre-commit hook for Prisma validation
- [ ] Document in architecture.md
- [ ] Create onboarding checklist for new developers

---

## 🎓 **For Future Reference**

**Prisma Binary Targets Reference:**
```
darwin           - Intel Mac
darwin-arm64     - Apple Silicon (M1/M2/M3)
linux-musl       - Alpine Linux (lightweight Docker)
debian-openssl-* - Debian/Ubuntu servers
rhel-openssl-*   - Red Hat/CentOS
windows          - Windows systems
```

**When to Regenerate:**
- After changing `schema.prisma`
- After `npm install` (if Prisma version changes)
- After cloning project on new machine
- After switching between architectures
- If seeing "Query Engine not found" errors

---

## ✅ **Summary**

**Problem**: Prisma clients missing ARM64 binaries  
**Root Cause**: Missing `binaryTargets` configuration  
**Impact**: All database operations failed (500 errors)  
**Solution**: Add `binaryTargets = ["native", "darwin-arm64"]`  
**Prevention**: Multi-architecture support by default  
**Status**: ✅ Resolved for all affected services

This is **NOT related to SDK improvements** - it's a pre-existing configuration issue that surfaced when services restarted with the new code.
