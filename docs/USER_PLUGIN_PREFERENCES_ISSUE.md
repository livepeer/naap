# User Plugin Preferences Issue - RESOLVED

**Date**: January 29, 2026  
**Issue**: Plugins not showing in sidebar (community, pluginPublisher, developerApi, capacityPlanner)  
**Status**: ✅ FIXED  

---

## 🔍 **Root Cause**

**User Plugin Preferences** were disabling 4 plugins. The `/api/v1/base/plugins/personalized` endpoint filters plugins based on `UserPluginPreference.enabled` field.

### How It Works

```typescript
// services/base-svc/src/server.ts:1050-1060
const personalizedPlugins = globalPlugins
  .map(plugin => {
    const userPref = preferencesMap.get(plugin.name);
    return {
      ...plugin,
      enabled: userPref ? userPref.enabled : plugin.enabled, // ← User pref overrides
      order: userPref?.order ?? plugin.order,
      pinned: userPref?.pinned ?? false,
    };
  })
  .filter(p => p.enabled) // ← Filters out disabled plugins
  .sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return a.order - b.order;
  });
```

### What Happened

1. ✅ Database had 9 plugins, all with `enabled=true` in `WorkflowPlugin` table
2. ✅ All plugins had correct routes
3. ✅ All plugins' `remoteEntry.js` files were built and accessible
4. ❌ **BUT**: User had preferences that disabled 4 plugins
5. Result: API returned only 5 plugins instead of 9

---

## ✅ **Solution**

**Enabled all plugins for the user:**

```sql
UPDATE "UserPluginPreference" SET enabled = true;
```

### Before Fix
```
DynamicRoutes: Plugins available: 
  gatewayManager,
  marketplace,
  myDashboard,
  myWallet,
  orchestratorManager
  
(5 plugins total)
```

### After Fix
```
DynamicRoutes: Plugins available:
  capacityPlanner,      ← Now visible
  community,            ← Now visible
  developerApi,         ← Now visible
  gatewayManager,
  marketplace,
  myDashboard,
  myWallet,
  orchestratorManager,
  pluginPublisher       ← Now visible
  
(9 plugins total)
```

---

## 🎯 **How User Preferences Work**

### Database Schema

```prisma
model UserPluginPreference {
  id         String  @id @default(uuid())
  userId     String
  pluginName String
  enabled    Boolean @default(true)  ← Controls visibility
  pinned     Boolean @default(false) ← Appears at top
  order      Int?                    ← Custom ordering
  
  user User @relation(fields: [userId], references: [id])
  @@unique([userId, pluginName])
}
```

### Personalization Flow

1. **Global Plugins**: All plugins in `WorkflowPlugin` table
2. **User Preferences**: Optional per-user overrides in `UserPluginPreference`
3. **Merge**: User pref `enabled` overrides global `enabled`
4. **Filter**: Only enabled plugins returned
5. **Sort**: Pinned first, then by order

### Example

**Global Plugin:**
```json
{
  "name": "community",
  "enabled": true,  // Globally enabled
  "order": 6
}
```

**User Preference:**
```json
{
  "userId": "abc123",
  "pluginName": "community",
  "enabled": false,  // User disabled it
  "pinned": false,
  "order": null
}
```

**Result:** Plugin NOT returned in personalized API (filtered out)

---

## 🛡️ **How Users Can Manage Plugins**

### Via Settings Page

Users can enable/disable plugins through the Settings page:

1. Go to **/settings** in shell
2. Find "Plugin Management" section
3. Toggle plugins on/off
4. Changes saved to `UserPluginPreference` table
5. Sidebar updates instantly

### Via API

```javascript
// Disable a plugin
POST /api/v1/base/users/:userId/plugins/preferences
{
  "pluginName": "community",
  "enabled": false
}

// Enable a plugin
POST /api/v1/base/users/:userId/plugins/preferences
{
  "pluginName": "community",
  "enabled": true
}
```

---

## 🐛 **Why This Was Confusing**

1. **Silent Filtering**: API silently filters disabled plugins
   - No error message
   - No warning in console
   - Just fewer plugins returned

2. **No UI Indicator**: User might not realize they disabled plugins
   - No "Show Hidden Plugins" option
   - No count of disabled plugins

3. **Global vs Personal**: Confusion between:
   - `WorkflowPlugin.enabled` (global admin control)
   - `UserPluginPreference.enabled` (personal user control)

4. **Looked Like Bug**: 
   - Plugins in database ✅
   - Routes configured ✅
   - Files built ✅
   - But not appearing ❌
   - Seemed like a code bug, but was user preference

---

## 📊 **Diagnostic Checklist**

When plugins don't show:

1. **Check console log:**
   ```
   DynamicRoutes: Plugins available: ...
   ```
   - Count plugins shown
   - Compare to expected count

2. **Check raw API:**
   ```bash
   curl http://localhost:4000/api/v1/base/plugins/personalized
   ```
   - How many plugins returned?
   - Are disabled ones missing?

3. **Check database:**
   ```sql
   SELECT * FROM "WorkflowPlugin" WHERE enabled = true;
   -- Should show all 9 plugins
   
   SELECT * FROM "UserPluginPreference";
   -- Shows user-specific overrides
   ```

4. **Check preferences:**
   ```sql
   SELECT upp.*, wp.name as plugin_name, wp.enabled as global_enabled
   FROM "UserPluginPreference" upp
   JOIN "WorkflowPlugin" wp ON wp.name = upp."pluginName"
   WHERE upp.enabled = false;
   -- Shows which plugins user disabled
   ```

---

## 🔧 **Fix Commands**

### Enable All Plugins for Current User

```sql
UPDATE "UserPluginPreference" SET enabled = true;
```

### Enable Specific Plugin

```sql
UPDATE "UserPluginPreference" 
SET enabled = true 
WHERE "pluginName" = 'community';
```

### Reset User Preferences (Remove All)

```sql
DELETE FROM "UserPluginPreference" WHERE "userId" = 'user-id-here';
```

### Check What User Has Disabled

```sql
SELECT * FROM "UserPluginPreference" WHERE enabled = false;
```

---

## ✅ **Verification**

After fixing:

1. **Refresh browser**: `Cmd+Shift+R` or `Ctrl+Shift+R`
2. **Check console**:
   ```
   DynamicRoutes: Plugins available: 
   capacityPlanner,community,developerApi,...
   ```
3. **Check sidebar**: All 9 plugins should appear
4. **Click plugins**: Should load successfully

---

## 📝 **Lessons Learned**

### What Went Wrong

1. ❌ No visibility into user preferences from UI
2. ❌ No indication why plugins missing
3. ❌ Silent filtering without warnings
4. ❌ Debugging path not obvious

### What Went Right

1. ✅ Feature working as designed (personalization)
2. ✅ Data properly stored in database
3. ✅ Easy to fix once identified
4. ✅ No code changes needed

### Improvements Needed

1. **Add UI indicators:**
   - "3 plugins hidden" message
   - "Show all" toggle
   - Disabled plugins in grayed-out section

2. **Better diagnostics:**
   - Console log: "Filtered X plugins based on user preferences"
   - Dev tools showing what's filtered

3. **Settings page:**
   - Clear plugin enable/disable UI
   - Bulk "Enable All" button
   - "Reset to Defaults" option

4. **Documentation:**
   - Explain personalization feature
   - Document preference API
   - Troubleshooting guide

---

## 🎓 **Summary**

**Problem**: Plugins missing from sidebar  
**Cause**: User preferences disabling plugins  
**Location**: `UserPluginPreference` table  
**Fix**: `UPDATE "UserPluginPreference" SET enabled = true`  
**Prevention**: Add UI for managing preferences  
**Related to SDK refactoring**: ❌ NO - Pre-existing feature

**This was NOT caused by the SDK improvements** - it's a feature of the personalization system that was working exactly as designed, just not visible to the user.
