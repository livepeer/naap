# NAAP Plugin Troubleshooting Guide

This guide helps you diagnose and fix common issues with NAAP plugin development.

## Quick Diagnostic

Run the built-in diagnostic tool first:

```bash
naap-plugin doctor
```

This will check your environment and suggest fixes for common issues.

---

## Common Issues

### Plugin Won't Load

**Symptoms:**
- Plugin doesn't appear in sidebar
- "Workflow Unavailable" error
- Console shows module loading errors

**Solutions:**

1. **Check dev server is running:**
   ```bash
   naap-plugin dev
   ```

2. **Verify the plugin bundle URL is accessible:**
   ```bash
   curl http://localhost:3010/production/my-plugin.js
   ```

3. **Check browser console for errors:**
   - Open DevTools (F12)
   - Look for network errors or CORS issues

4. **Clear browser cache:**
   - Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
   - Clear localStorage: `localStorage.clear()`

5. **Check plugin.json routes match:**
   ```json
   {
     "frontend": {
       "routes": ["/my-plugin", "/my-plugin/*"]
     }
   }
   ```

### Type Errors in SDK

**Symptoms:**
- TypeScript compilation errors
- "Cannot find module '@naap/plugin-sdk'" errors
- Type mismatch errors

**Solutions:**

1. **Check SDK version:**
   ```bash
   npm list @naap/plugin-sdk
   ```

2. **Update to latest SDK:**
   ```bash
   npm update @naap/plugin-sdk
   ```

3. **Regenerate node_modules:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **Check tsconfig.json settings:**
   ```json
   {
     "compilerOptions": {
       "moduleResolution": "bundler",
       "esModuleInterop": true
     }
   }
   ```

5. **For duplicate type errors:**
   - Ensure you're importing from `@naap/plugin-sdk`
   - Don't re-declare SDK types in your code

### API Errors

**Symptoms:**
- 401 Unauthorized errors
- 403 Forbidden errors
- CSRF_INVALID errors

**Solutions:**

1. **Check authentication:**
   ```tsx
   const auth = useAuthService();
   console.log('User:', auth.getUser());
   console.log('Token:', await auth.getToken());
   ```

2. **CSRF errors - SDK auto-includes tokens:**
   ```tsx
   // Use the SDK's API client (includes CSRF automatically)
   const api = useApiClient({ pluginName: 'my-plugin' });
   await api.post('/data', { value: 123 });
   ```

3. **For manual fetch calls:**
   ```tsx
   const getHeaders = useAuthHeaders();
   const headers = await getHeaders();
   await fetch('/api/endpoint', { headers, method: 'POST', body: ... });
   ```

4. **Check if backend is running:**
   ```bash
   curl http://localhost:4010/healthz
   ```

### CSP Violations

**Symptoms:**
- Console shows Content-Security-Policy errors
- Scripts or styles not loading
- External resources blocked

**Solutions:**

1. **Check CSP report (admin only):**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/csp-report
   ```

2. **Common violations and fixes:**

   | Violation | Fix |
   |-----------|-----|
   | `script-src 'unsafe-inline'` | Move inline scripts to external files |
   | `connect-src` blocked | Add allowed URLs to nginx CSP config |
   | `img-src` blocked | Use data: URIs or add domains to CSP |

3. **During development, CSP is in report-only mode:**
   - Violations are logged but not enforced
   - Fix violations before Phase 4 production release

### Build Failures

**Symptoms:**
- `naap-plugin build` fails
- UMD build errors
- Bundle too large warnings

**Solutions:**

1. **Check vite.config.ts UMD build config:**
   ```typescript
   build: {
     lib: {
       entry: './src/App.tsx',
       name: 'my-plugin',
       formats: ['umd'],
       fileName: () => 'production/my-plugin.js',
     },
     rollupOptions: {
       external: ['react', 'react-dom'],
     },
   }
   ```

2. **For "module not found" errors:**
   ```bash
   npm install
   npm run build
   ```

3. **For bundle size warnings:**
   - Check for large dependencies
   - Use dynamic imports for heavy components
   - Enable tree shaking in vite.config.ts

4. **Clean build:**
   ```bash
   rm -rf dist node_modules/.vite
   npm run build
   ```

### Navigation Issues

**Symptoms:**
- Links not working
- Routing errors
- Page refreshes instead of navigating

**Solutions:**

1. **Use SDK navigation:**
   ```tsx
   const navigate = useNavigate();
   
   // Correct
   navigate('/my-plugin/details');
   
   // Wrong - causes full page reload
   window.location.href = '/my-plugin/details';
   ```

2. **Check route definitions in plugin.json:**
   ```json
   {
     "frontend": {
       "routes": ["/my-plugin", "/my-plugin/*"]
     }
   }
   ```

3. **For nested routes, use relative paths:**
   ```tsx
   // In component at /my-plugin
   navigate('/my-plugin/settings'); // Go to settings
   ```

### Plugin State Issues

**Symptoms:**
- State resets unexpectedly
- Context values undefined
- Multiple renders

**Solutions:**

1. **Ensure ShellProvider wraps your app:**
   ```tsx
   export function mount(container, context) {
     root.render(
       <ShellProvider value={context}>
         <App />
       </ShellProvider>
     );
   }
   ```

2. **Check hook usage is inside provider:**
   ```tsx
   // Wrong - hook outside provider
   const auth = useAuthService();
   root.render(<App auth={auth} />);
   
   // Correct - hook inside provider
   function App() {
     const auth = useAuthService();
     return <div>{auth.getUser()?.displayName}</div>;
   }
   ```

3. **For context undefined errors:**
   - Verify ShellProvider is at the top of your component tree
   - Check that context is passed correctly from mount()

### Team/Tenant Issues

**Symptoms:**
- Wrong team context
- Plugins showing for wrong team
- Configuration not loading

**Solutions:**

1. **Check team context:**
   ```tsx
   const { currentTeam, isTeamContext } = useTeam();
   console.log('In team:', currentTeam?.name);
   console.log('Is team context:', isTeamContext);
   ```

2. **Switch team context:**
   ```tsx
   const { setCurrentTeam } = useTeam();
   await setCurrentTeam(teamId);
   ```

3. **Check team permissions:**
   ```tsx
   const hasAccess = useTeamPermission('plugins.use');
   if (!hasAccess) {
     return <AccessDenied />;
   }
   ```

---

## Development Environment Issues

### Ports Already in Use

```bash
# Find process using port
lsof -i :3010

# Kill process
kill -9 <PID>

# Or use different port
naap-plugin dev --port 3011
```

### Docker Issues

```bash
# Check Docker is running
docker ps

# Start the unified database
docker-compose up -d database

# Push schema if tables are missing
cd packages/database && npx prisma db push
```

### Hot Reload Not Working

1. **Check Vite dev server is running:**
   - Look for "Local: http://localhost:3010" in terminal

2. **Try restarting the dev server:**
   ```bash
   # Stop current server (Ctrl+C)
   naap-plugin dev
   ```

3. **Clear Vite cache:**
   ```bash
   rm -rf node_modules/.vite
   ```

---

## Performance Issues

### Slow Plugin Loading

1. **Check bundle size:**
   ```bash
   naap-plugin build
   # Look for size warnings
   ```

2. **Enable code splitting:**
   ```tsx
   // Use dynamic imports for heavy components
   const HeavyComponent = lazy(() => import('./HeavyComponent'));
   ```

3. **Check for unnecessary re-renders:**
   ```tsx
   // Use React DevTools Profiler
   // Wrap components with React.memo if needed
   ```

### Memory Leaks

1. **Clean up effects:**
   ```tsx
   useEffect(() => {
     const subscription = api.subscribe();
     return () => subscription.unsubscribe(); // Cleanup!
   }, []);
   ```

2. **Check for event listener leaks:**
   ```tsx
   useEffect(() => {
     const handler = () => { ... };
     window.addEventListener('resize', handler);
     return () => window.removeEventListener('resize', handler);
   }, []);
   ```

---

## Getting Help

### Debug Information

When reporting issues, include:

1. **Run doctor and share output:**
   ```bash
   naap-plugin doctor --verbose
   ```

2. **Include browser console errors**

3. **Share relevant plugin.json sections**

4. **Include package versions:**
   ```bash
   npm list @naap/plugin-sdk
   node --version
   ```

### Resources

- [QUICKSTART.md](./QUICKSTART.md) - Getting started guide
- [Plugin Security Model](./PLUGIN_SECURITY_MODEL.md) - Security documentation
- [API Reference](../packages/plugin-sdk/API_REFERENCE.md) - SDK API docs

### Community

- GitHub Issues: Report bugs and feature requests
- Discord: Real-time help from the community
- Email: support@naap.io for enterprise support
