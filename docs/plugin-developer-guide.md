# NAAP Plugin Developer Guide

A complete step-by-step guide for developing, testing, publishing, deploying, and updating plugins for the NAAP platform.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Scaffold a New Plugin](#step-1-scaffold-a-new-plugin)
3. [Step 2: Develop Your Plugin](#step-2-develop-your-plugin)
4. [Step 3: Test Your Plugin](#step-3-test-your-plugin)
5. [Step 4: Build and Package](#step-4-build-and-package)
6. [Step 5: Publish to Registry](#step-5-publish-to-registry)
7. [Step 6: Deploy to Production](#step-6-deploy-to-production)
8. [Step 7: Update Your Plugin](#step-7-update-your-plugin)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 20+ and **npm** 10+
- **Docker Desktop** installed and running (for local database)
- **Git** installed
- **NAAP Shell** running locally (for testing)
- **NAAP Plugin SDK** installed globally:

```bash
npm install -g @naap/plugin-sdk
```

Verify installation:

```bash
naap-plugin --version
```

---

## Step 1: Scaffold a New Plugin

### 1.1 Create Plugin Structure

By default, `naap-plugin create` scaffolds a **frontend-only** plugin — the fastest way to get started. You can upgrade to full-stack later.

```bash
# Frontend-only plugin (recommended start)
naap-plugin create my-awesome-plugin

# Full-stack with database (Prisma + Docker required)
naap-plugin create my-awesome-plugin --template full-stack

# Full-stack without database (in-memory backend, no Docker/Prisma needed)
naap-plugin create my-awesome-plugin --template full-stack --simple

# Non-interactive full-stack
naap-plugin create my-awesome-plugin \
  --template full-stack \
  --category monitoring \
  --description "Monitor system health and performance"
```

This creates:

```
my-awesome-plugin/
├── plugin.json              # Plugin manifest
├── .naap/                   # Local dev config
├── frontend/                # React micro-frontend
│   ├── src/
│   │   ├── App.tsx         # Plugin definition via createPlugin()
│   │   ├── mount.tsx       # UMD entry point (delegates to App.tsx)
│   │   ├── main.tsx        # Standalone dev entry point
│   │   ├── pages/
│   │   └── components/
│   ├── vite.config.ts
│   └── package.json
├── backend/                 # Express backend
│   ├── src/
│   │   ├── server.ts
│   │   └── routes/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── package.json
└── docs/
    ├── README.md
    └── CHANGELOG.md
```

### 1.2 Configure Plugin Manifest

Edit `plugin.json` to define your plugin:

```json
{
  "$schema": "https://plugins.naap.io/schema/plugin.json",
  "name": "my-awesome-plugin",
  "displayName": "My Awesome Plugin",
  "version": "1.0.0",
  "description": "Monitor system health and performance",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "category": "monitoring",
  
  "frontend": {
    "entry": "./frontend/dist/production/my-awesome-plugin.js",
    "devPort": 3010,
    "routes": ["/my-plugin", "/my-plugin/*"],
    "navigation": {
      "label": "My Plugin",
      "icon": "Activity",
      "order": 50
    }
  },
  
  "backend": {
    "entry": "./backend/dist/server.js",
    "devPort": 4010,
    "port": 4100,
    "healthCheck": "/healthz",
    "apiPrefix": "/api/v1/my-plugin"
  },
  
  "database": {
    "type": "postgresql",
    "schema": "./backend/prisma/schema.prisma"
  }
}
```

### 1.3 Install Dependencies

```bash
cd my-awesome-plugin

# Install root dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install backend dependencies
cd backend && npm install && cd ..
```

---

## Step 2: Develop Your Plugin

### 2.1 Start Development Servers

```bash
# Start frontend (port 3010) and backend (port 4010) with hot reload
naap-plugin dev

# Or specify a custom shell URL
naap-plugin dev --shell http://localhost:3000
```

This will:
- Start frontend dev server with HMR on port 3010
- Start backend dev server with watch mode on port 4010
- Connect to the unified PostgreSQL database (localhost:5432/naap)
- Register your plugin with the shell for testing

### 2.2 Develop Frontend

Edit `frontend/src/App.tsx` using the canonical `createPlugin()` pattern:

```typescript
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { MyPluginPage } from './pages/MyPluginPage';

const MyApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<MyPluginPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'my-awesome-plugin',
  version: '1.0.0',
  routes: ['/my-awesome-plugin', '/my-awesome-plugin/*'],
  App: MyApp,
});

export const mount = plugin.mount;
export default plugin;
```

The UMD entry `mount.tsx` delegates to this file — you rarely need to edit it.

Create your pages in `frontend/src/pages/`:

```typescript
// frontend/src/pages/MyPluginPage.tsx
import React, { useEffect, useState } from 'react';
import { useShell } from '@naap/plugin-sdk/hooks';

export function MyPluginPage() {
  const shell = useShell();
  const [data, setData] = useState([]);

  useEffect(() => {
    // Fetch data from your backend
    fetch('/api/v1/my-plugin/items')
      .then(res => res.json())
      .then(data => setData(data.items));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Plugin</h1>
      {/* Your UI here */}
    </div>
  );
}
```

### 2.3 Develop Backend

Edit `backend/src/server.ts`:

```typescript
import express from 'express';
import cors from 'cors';
import { router } from './routes/index.js';
import { prisma } from './db/client.js';

const app = express();
const PORT = process.env.PORT || 4010;

app.use(cors());
app.use(express.json());

// Health check (required)
app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'healthy',
      service: 'my-awesome-plugin',
      database: { status: 'connected' }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message 
    });
  }
});

// API routes
app.use('/api/v1/my-plugin', router);

app.listen(PORT, () => {
  console.log(`🚀 My Awesome Plugin backend running on port ${PORT}`);
});
```

Create API routes in `backend/src/routes/index.ts`:

```typescript
import { Router } from 'express';
import { prisma } from '../db/client.js';

export const router = Router();

router.get('/items', async (req, res) => {
  try {
    const items = await prisma.item.findMany();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/items', async (req, res) => {
  try {
    const item = await prisma.item.create({
      data: req.body,
    });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 2.4 Set Up Database

Edit `backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Item {
  id        String   @id @default(cuid())
  name      String
  value     Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Create and run migrations:

```bash
cd backend

# Create a new migration
npx prisma migrate dev --name init

# Generate Prisma Client
npx prisma generate
```

Create seed data in `backend/prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.item.createMany({
    data: [
      { name: 'Item 1', value: 100 },
      { name: 'Item 2', value: 200 },
    ],
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Run seed:

```bash
npx tsx prisma/seed.ts
```

### 2.5 Test in Shell

1. Ensure NAAP Shell is running: `http://localhost:3000`
2. Your plugin should appear in the sidebar
3. Click on it to load your plugin
4. Changes to frontend/backend are hot-reloaded automatically

---

## Step 3: Test Your Plugin

### 3.1 Unit Tests

Create tests in `frontend/src/__tests__/` and `backend/src/__tests__/`:

```typescript
// frontend/src/pages/__tests__/MyPluginPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MyPluginPage } from '../MyPluginPage';

describe('MyPluginPage', () => {
  it('renders correctly', () => {
    render(<MyPluginPage />);
    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });
});
```

```typescript
// backend/src/routes/__tests__/index.test.ts
import request from 'supertest';
import { app } from '../../server';

describe('GET /api/v1/my-plugin/items', () => {
  it('returns items', async () => {
    const res = await request(app)
      .get('/api/v1/my-plugin/items')
      .expect(200);
    
    expect(res.body.items).toBeInstanceOf(Array);
  });
});
```

Run tests:

```bash
# Run all tests
naap-plugin test

# Run only unit tests
naap-plugin test --unit

# Run with coverage
naap-plugin test --coverage
```

### 3.2 Integration Tests

Test your plugin with the shell:

```bash
# Start shell and your plugin in test mode
naap-plugin test --e2e
```

### 3.3 Manual Testing Checklist

- [ ] Plugin loads in shell without errors
- [ ] Navigation item appears in sidebar
- [ ] Frontend routes work correctly
- [ ] Backend API endpoints respond correctly
- [ ] Database operations work (CRUD)
- [ ] Health check endpoint returns healthy
- [ ] Error handling works gracefully
- [ ] Plugin can be enabled/disabled in Settings
- [ ] Plugin unloads cleanly when disabled

---

## Advanced Tutorials & Examples

To see how complex, production-ready plugins are built using the latest platform features, check out these deep-dives:

### Service Gateway Integration
Learn how to build a feature-rich application (using **Daydream AI Video** as the model) that securely integrates with third-party APIs without writing custom backend proxy code.
👉 [**Building an App with the Service Gateway**](./tutorial-service-gateway-app.md)

---

## Step 4: Build and Package

### 4.1 Build Your Plugin

```bash
# Build frontend and backend
naap-plugin build
```

This will:
- Build frontend → `frontend/dist/production/my-awesome-plugin.js`
- Compile backend TypeScript → `backend/dist/`
- Create Docker image for backend (optional)

### 4.2 Verify Build Output

```bash
# Check frontend build
ls -lh frontend/dist/production/my-awesome-plugin.js

# Check backend build
ls -lh backend/dist/server.js

# Test the built frontend locally
cd frontend
npm run preview -- --port 3010
```

### 4.3 Package for Distribution

```bash
# Create distributable package
naap-plugin package
```

This creates: `dist/my-awesome-plugin-1.0.0.tar.gz`

The package includes:
- `plugin.json` (manifest)
- `frontend/dist/` (built frontend)
- `backend/dist/` (compiled backend)
- `backend/prisma/` (schema and migrations)
- `docs/` (documentation)

### 4.4 Test Package Locally

```bash
# Extract and test the package
cd dist
tar -xzf my-awesome-plugin-1.0.0.tar.gz
cd my-awesome-plugin-1.0.0

# Verify structure
ls -la
```

---

## Step 5: Publish to Registry

### 5.1 Login to Registry

```bash
# Login to NAAP Plugin Registry
naap-plugin login

# Enter your credentials when prompted
# Username: your-username
# Password: your-password
# Or use token: your-api-token
```

### 5.2 Verify Plugin Manifest

Before publishing, ensure `plugin.json` is valid:

```bash
# Validate manifest
naap-plugin validate
```

### 5.3 Publish Plugin

```bash
# Publish to registry
naap-plugin publish

# Or publish with a specific tag
naap-plugin publish --tag beta
```

This will:
1. Validate the plugin manifest
2. Check version doesn't already exist
3. Upload package to registry
4. Register plugin in marketplace
5. Create release notes from CHANGELOG.md

### 5.4 Verify Publication

```bash
# Check your plugin in registry
naap-plugin info my-awesome-plugin

# List all your published plugins
naap-plugin list --author your-username
```

Visit the marketplace: `http://localhost:3000/#/marketplace` to see your plugin listed.

---

## Step 6: Deploy to Production

### 6.1 Install Plugin via Marketplace

**As a User:**
1. Navigate to Marketplace in shell
2. Search for "My Awesome Plugin"
3. Click "Install"
4. Plugin is automatically deployed

**As an Admin (CLI):**

```bash
# Install plugin from registry
naap-plugin install my-awesome-plugin

# Install specific version
naap-plugin install my-awesome-plugin@1.0.0

# Install from local package
naap-plugin install ./dist/my-awesome-plugin-1.0.0.tar.gz
```

### 6.2 Configure Plugin

After installation, configure the plugin:

1. Go to Settings → Plugins
2. Find "My Awesome Plugin"
3. Configure settings (if any)
4. Enable/disable as needed

### 6.3 Verify Deployment

```bash
# Check plugin status
naap-plugin status my-awesome-plugin

# Check backend health
curl http://localhost:4100/healthz

# Check frontend loads
curl http://localhost:3000/#/my-plugin
```

### 6.4 Monitor Plugin

```bash
# View plugin logs
naap-plugin logs my-awesome-plugin

# View backend logs
naap-plugin logs my-awesome-plugin --backend

# View frontend errors (in browser console)
```

---

## Step 7: Update Your Plugin

### 7.1 Make Changes

Make your changes to frontend, backend, or database schema.

### 7.2 Update Version

```bash
# Bump version (patch, minor, or major)
naap-plugin version patch   # 1.0.0 → 1.0.1
naap-plugin version minor   # 1.0.0 → 1.1.0
naap-plugin version major   # 1.0.0 → 2.0.0
```

This automatically:
- Updates `plugin.json` version
- Updates `package.json` versions
- Creates a git tag (if in git repo)
- Updates `CHANGELOG.md` (if exists)

### 7.3 Update CHANGELOG

Edit `docs/CHANGELOG.md`:

```markdown
## [1.0.1] - 2024-01-22

### Added
- New feature X

### Changed
- Improved performance

### Fixed
- Bug fix Y
```

### 7.4 Test Updates

```bash
# Rebuild with new version
naap-plugin build

# Test locally
naap-plugin dev
```

### 7.5 Create Database Migration (if needed)

If you changed the database schema:

```bash
cd backend

# Create migration
npx prisma migrate dev --name add_new_field

# This creates a migration file in prisma/migrations/
```

### 7.6 Publish Update

```bash
# Package new version
naap-plugin package

# Publish update
naap-plugin publish
```

### 7.7 Deploy Update

**Automatic Updates (if enabled):**
- Users with auto-update enabled will receive the update automatically

**Manual Update:**
```bash
# Update plugin
naap-plugin update my-awesome-plugin

# Update to specific version
naap-plugin update my-awesome-plugin@1.0.1
```

### 7.8 Run Migration Scripts

If your plugin has lifecycle hooks defined in `plugin.json`:

```json
{
  "lifecycle": {
    "preUpdate": "npm run db:backup",
    "postUpdate": "npm run db:migrate"
  }
}
```

These will run automatically during update.

### 7.9 Deprecate Old Versions

```bash
# Mark version as deprecated
naap-plugin deprecate --version 1.0.0 \
  --message "Please upgrade to v1.0.1 for security fixes"
```

---

## Troubleshooting

### Plugin Not Loading in Shell

**Problem:** Plugin shows loading spinner but never loads.

**Solutions:**
1. Check the UMD bundle is accessible:
   ```bash
   curl http://localhost:3010/dist/production/my-awesome-plugin.js
   ```
2. Check browser console for errors
3. Verify `plugin.json` routes match your frontend routes
4. Ensure frontend dev server is running

### Backend Not Starting

**Problem:** Backend service fails to start.

**Solutions:**
1. Check port is not in use:
   ```bash
   lsof -ti:4010
   ```
2. Verify `DATABASE_URL` is set correctly
3. Check database is running:
   ```bash
   docker ps | grep postgres
   ```
4. Run migrations:
   ```bash
   cd backend && npx prisma migrate deploy
   ```

### Database Connection Errors

**Problem:** `PrismaClientInitializationError`

**Solutions:**
1. Verify Docker is running
2. Check database credentials in `DATABASE_URL`
3. Ensure database container is healthy:
   ```bash
   docker ps
   ```
4. Reset database if needed:
   ```bash
   npx prisma migrate reset
   ```

### Build Failures

**Problem:** `naap-plugin build` fails.

**Solutions:**
1. Check TypeScript errors:
   ```bash
   cd frontend && npx tsc --noEmit
   cd ../backend && npx tsc --noEmit
   ```
2. Verify all dependencies are installed
3. Clear build cache:
   ```bash
   rm -rf frontend/dist backend/dist node_modules/.cache
   ```

### Publishing Errors

**Problem:** `naap-plugin publish` fails.

**Solutions:**
1. Verify you're logged in:
   ```bash
   naap-plugin whoami
   ```
2. Check version doesn't already exist
3. Validate manifest:
   ```bash
   naap-plugin validate
   ```
4. Check network connectivity to registry

---

## Best Practices

### Development

1. **Use TypeScript** - Always use TypeScript for type safety
2. **Follow Shell Patterns** - Use shell's UI components and theme
3. **Handle Errors** - Show user-friendly error messages
4. **Optimize Bundle** - Use code splitting and lazy loading
5. **Write Tests** - Aim for good test coverage

### Code Organization

1. **Keep It Focused** - Each plugin should do one thing well
2. **Modular Structure** - Separate concerns (pages, components, routes)
3. **Reusable Components** - Extract common UI into components
4. **API Consistency** - Follow RESTful conventions

### Versioning

1. **Semantic Versioning** - Use MAJOR.MINOR.PATCH
2. **Backward Compatibility** - Maintain API compatibility in minor/patch
3. **Breaking Changes** - Only in major versions
4. **Changelog** - Keep CHANGELOG.md up to date

### Security

1. **Validate Inputs** - Always validate user inputs
2. **Sanitize Data** - Sanitize data before database operations
3. **Use HTTPS** - Always use HTTPS in production
4. **Secrets Management** - Never commit secrets, use environment variables

### External API Calls (CORS)

**CRITICAL: Never call third-party APIs directly from browser code.**

If your plugin needs to call an external API (e.g., Livepeer, OpenAI, Stripe),
the browser will be blocked by CORS unless the external server explicitly
allows your origin. You do not control those servers' CORS headers.

**Always proxy external calls through your plugin backend:**

```
Browser  -->  Plugin Backend  -->  External API
         (same origin,            (server-to-server,
          no CORS issue)           no CORS)
```

**Use the built-in `createExternalProxy` from `@naap/plugin-server-sdk`:**

```typescript
// BACKEND: server.ts — zero-boilerplate proxy with SSRF protection
import { createPluginServer, createExternalProxy } from '@naap/plugin-server-sdk';

const { router, start } = createPluginServer({ name: 'my-plugin', port: 4020 });

router.post(
  '/my-plugin/external-proxy',
  ...createExternalProxy({
    allowedHosts: ['api.example.com', 'service.vendor.io'],
    targetUrlHeader: 'X-Target-URL',
    contentType: 'application/json',   // or 'application/sdp' for WebRTC
    forwardHeaders: {
      'Authorization': `Bearer ${process.env.EXTERNAL_API_KEY}`,
    },
    authorize: async (req) => {
      return !!(req as any).user?.id;
    },
  })
);
```

```typescript
// FRONTEND: hooks/useMyHook.ts - call the proxy, NOT the external API
import { getPluginBackendUrl } from '@naap/plugin-sdk';

const proxyUrl = getPluginBackendUrl('my-plugin', {
  apiPath: '/api/v1/my-plugin/external-proxy',
});
const response = await fetch(proxyUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Target-URL': 'https://api.example.com/endpoint',
    'Authorization': `Bearer ${authToken}`,
  },
  body: JSON.stringify(payload),
});
```

**Key rules:**
- All external API keys must live on the backend (use `forwardHeaders` — never expose in browser code)
- Always set `allowedHosts` to prevent SSRF (the proxy validates every target URL)
- Custom headers for proxy metadata (like `X-WHIP-URL`) are already declared
  in `@naap/types/http-headers` and allowed by CORS automatically
- See the full docs at `/docs/guides/external-api-proxy` and `/docs/api-reference/external-proxy`

### Performance

1. **Lazy Load** - Lazy load heavy components
2. **Optimize Queries** - Use database indexes and optimize queries
3. **Cache Strategically** - Cache expensive operations
4. **Monitor Metrics** - Track performance metrics

### Documentation

1. **README** - Keep README.md comprehensive
2. **API Docs** - Document all API endpoints
3. **Code Comments** - Comment complex logic
4. **Examples** - Provide usage examples

---

## Quick Reference

### Common Commands

```bash
# Creation
naap-plugin create my-plugin       # Frontend-only (default)
naap-plugin create my-plugin --template full-stack          # With database
naap-plugin create my-plugin --template full-stack --simple # No database

# Incremental scaffolding
naap-plugin add endpoint users --crud  # Add CRUD endpoint
naap-plugin add model Todo title:String done:Boolean  # Add Prisma model

# Development
naap-plugin dev                    # Start dev servers
naap-plugin dev --shell <url>      # Connect to custom shell

# Testing
naap-plugin test                   # Run all tests
naap-plugin test --unit            # Unit tests only
naap-plugin test --e2e             # E2E tests
naap-plugin test --coverage        # With coverage

# Building
naap-plugin build                  # Build plugin
naap-plugin package                # Create package

# Versioning
naap-plugin version patch          # Bump patch version
naap-plugin version minor          # Bump minor version
naap-plugin version major          # Bump major version

# Publishing
naap-plugin login                  # Login to registry
naap-plugin publish                # Publish plugin
naap-plugin publish --tag beta     # Publish with tag

# Installation
naap-plugin install <name>         # Install plugin
naap-plugin update <name>          # Update plugin
naap-plugin uninstall <name>       # Uninstall plugin

# Management
naap-plugin list                  # List installed plugins
naap-plugin info <name>            # Plugin info
naap-plugin status <name>          # Plugin status
naap-plugin logs <name>            # View logs
naap-plugin validate               # Validate manifest
```

### File Structure Reference

```
my-plugin/
├── plugin.json              # Plugin manifest (required)
├── .naap/
│   ├── config.json         # Local dev config
│   └── credentials.json    # Registry credentials (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Plugin definition via createPlugin()
│   │   ├── mount.tsx      # UMD entry point (delegates to App.tsx)
│   │   ├── main.tsx       # Standalone dev entry point
│   │   ├── pages/
│   │   └── components/
│   ├── vite.config.ts
│   └── package.json
├── backend/                 # (full-stack only)
│   ├── src/
│   │   ├── server.ts      # Express server
│   │   └── routes/
│   │       ├── index.ts   # Route aggregator
│   │       └── README.md  # How to add routes
│   ├── prisma/            # (omitted with --simple)
│   │   └── schema.prisma
│   └── package.json
└── docs/
    ├── README.md
    └── CHANGELOG.md
```

---

## Getting Help

- **Documentation**: [docs/plugin-development.md](./plugin-development.md)
- **Examples**: Check `plugins/` directory for reference implementations
- **GitHub Issues**: [https://github.com/naap/plugins/issues](https://github.com/naap/plugins/issues)
- **Community**: Join our Discord for support

---

**Happy Plugin Development! 🚀**
