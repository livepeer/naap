# Plugin Loading Debug Guide

## Issue: Some plugins not showing in sidebar

### Debug Steps

1. **Open browser at http://localhost:3000**
2. **Open DevTools Console (F12)**
3. **Look for these logs:**
   ```
   DynamicRoutes render: {loading: false, error: null, pluginCount: X, plugins: Array(X)}
   ```
   
4. **Check what pluginCount shows:**
   - If `pluginCount: 0` → Plugins aren't loading from backend
   - If `pluginCount: 9` → All plugins loaded
   - If `pluginCount: 3` (or less than 9) → Some plugins filtered out

5. **Check for validation errors:**
   ```
   console.log(plugins.filter(p => !p.routes || p.routes.length === 0))
   ```

### Expected Console Output

```javascript
// When working correctly:
DynamicRoutes render: {
  loading: false, 
  error: null, 
  pluginCount: 9, 
  plugins: [
    'capacityPlanner',
    'community',
    'developerApi',
    'gatewayManager',
    'marketplace',
    'myDashboard',
    'myWallet',
    'orchestratorManager',
    'pluginPublisher'
  ]
}
```

### Common Issues

**Issue 1: Empty routes array**
- **Symptom**: Plugin has `routes: []` in database
- **Effect**: Plugin doesn't appear in sidebar (no routing)
- **Fix**: Update database with correct routes

**Issue 2: UMD bundle missing**
- **Symptom**: Plugin script fails to load from CDN
- **Effect**: Plugin loads but crashes
- **Fix**: Build plugin frontend

**Issue 3: Validation filtering**
- **Symptom**: Plugin fails `validateAndSanitizePlugins`
- **Effect**: Silently filtered out
- **Fix**: Check validation logic

### Quick Test

Run in browser console:
```javascript
// Fetch raw plugin data
fetch('http://localhost:4000/api/v1/base/plugins/personalized')
  .then(r => r.json())
  .then(data => {
    console.log('Total plugins from API:', data.plugins.length);
    console.log('Plugins:', data.plugins.map(p => ({
      name: p.name,
      enabled: p.enabled,
      routes: p.routes
    })));
  });
```

### Manual Plugin Reload

```javascript
// Force plugin context to reload
window.location.reload();
```
