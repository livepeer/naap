# Quick Manual Testing Guide

**After Auth & Team State Fixes**

---

## ✅ What Was Fixed

1. **Blocker #3**: Auth state duplication eliminated
2. **Blocker #4**: Team state synchronization fixed

---

## 🧪 Quick Test (5 minutes)

### Test 1: Login/Logout

1. Open http://localhost:3000
2. Login with: `user@example.com` / `password123`
3. Verify user name in top-right
4. Open browser console (F12)
5. Check for errors → Should be none
6. Logout
7. Verify redirect to login page

**Expected:** No errors, smooth login/logout

---

### Test 2: All Plugins Load

1. After login, check sidebar
2. Should see 9 plugins:
   - My Wallet
   - My Dashboard
   - Plugin Marketplace
   - Gateway Manager
   - Orchestrator Manager
   - Capacity Planner
   - Community Hub
   - Developer API Manager
   - Network Analytics
   - Plugin Publisher

3. Click each plugin
4. Verify it loads without errors

**Expected:** All 9 plugins work

---

### Test 3: Team Switching

1. Click "Create Team" (if not exists)
2. Create team: "Test Team"
3. Use team selector to switch to "Test Team"
4. Verify sidebar shows "Team: Test Team"
5. Open Marketplace plugin
6. Verify context shows team name
7. Switch back to "Personal Workspace"
8. Verify context changes

**Expected:** Smooth team switching, no errors

---

### Test 4: Marketplace Team Context

1. In Personal Workspace:
   - Open Marketplace
   - Try installing a plugin
   - Note: "Installing in Personal Workspace"

2. Switch to Team:
   - Open Marketplace
   - Try installing a different plugin
   - Note: "Installing for Team: [Team Name]"

3. Switch back to Personal
   - Verify personal plugins visible
   - Verify team plugins NOT visible

**Expected:** Correct context separation

---

## 🔍 What to Check in Console

### Good Signs ✅
```
✅ Loaded 9 plugins (0 dev, 9 prod) - personalized
✅ Team context changed: Team-ID or Personal Workspace
✅ No "AuthService" or "circular sync" warnings
```

### Bad Signs ❌
```
❌ "Auth state desync"
❌ "Team state stale"
❌ "Cannot read property 'user' of undefined"
❌ Multiple rapid plugin refreshes (indicates loop)
```

---

## 🐛 Known Non-Issues

### These are NORMAL and can be ignored:

1. **404 on /api/v1/network/stats**
   - Expected - endpoint doesn't exist yet
   - Doesn't break anything

2. **"Failed to load resource" for plugin routes**
   - Normal during initial load
   - Should disappear after plugins load

3. **EADDRINUSE in logs**
   - From restart attempts
   - Service is actually running fine

---

## 🆘 If Something Breaks

### Auth Not Working
```bash
# Check AuthContext is being used
grep -n "useAuth.*from.*AuthContext" apps/shell-web/src/context/ShellContext.tsx

# Should show import on line 13
```

### Team Switching Broken
```bash
# Check TeamContextManager emits events
grep -n "team:id-changed" apps/shell-web/src/services/TeamContextManager.ts

# Should show emit call ~line 112
```

### Plugins Not Loading
```bash
# Check services
curl http://localhost:4000/healthz
curl http://localhost:4000/api/v1/base/plugins/personalized | jq '.plugins | length'

# Should return 9
```

---

## 📋 Quick Verification Checklist

Run this in terminal:
```bash
cd /Users/qiang.han/Documents/mycodespace/NaaP
bash bin/test-auth-team-fixes.sh
```

All checks should show ✓ (green checkmarks).

---

## 🎉 Success Criteria

If all tests above pass:
- ✅ Blockers #3 and #4 are RESOLVED
- ✅ Platform is more secure and reliable
- ✅ Ready to proceed with Blockers #1 and #2

---

**Testing Time:** ~5 minutes  
**Confidence Level:** High ✅  
**Ready for Next Phase:** Yes 🚀
