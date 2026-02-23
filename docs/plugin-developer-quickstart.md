# Plugin Developer Quick Start

A quick reference guide for common plugin development tasks.

## 🚀 Quick Commands

```bash
# Create new plugin (frontend-only by default)
naap-plugin create my-plugin

# Create with full-stack (no database)
naap-plugin create my-plugin --template full-stack --simple

# Create with full-stack (with database)
naap-plugin create my-plugin --template full-stack

# Add a backend endpoint incrementally
naap-plugin add endpoint users --crud

# Add a Prisma model (monorepo only)
naap-plugin add model Todo title:String done:Boolean

# Start development
naap-plugin dev

# Run tests
naap-plugin test

# Build
naap-plugin build

# Package
naap-plugin package

# Publish
naap-plugin publish

# Update version
naap-plugin version patch|minor|major
```

## 📋 Development Workflow

### 1. Create & Setup
```bash
# Start with frontend-only (recommended)
naap-plugin create my-plugin
cd my-plugin

# Or full-stack without database setup
naap-plugin create my-plugin --template full-stack --simple
cd my-plugin
```

### 2. Develop
```bash
# Start dev servers
naap-plugin dev

# Edit files:
# - frontend/src/App.tsx (uses createPlugin() — the canonical mount pattern)
# - frontend/src/mount.tsx (UMD entry, delegates to App.tsx — rarely needs editing)
# - frontend/src/pages/*.tsx
# - backend/src/server.ts
# - backend/src/routes/*.ts
```

### 3. Database
```bash
cd backend

# Create migration
npx prisma migrate dev --name init

# Generate client
npx prisma generate

# Seed data
npx tsx prisma/seed.ts
```

### 4. Test
```bash
# Unit tests
naap-plugin test --unit

# E2E tests
naap-plugin test --e2e

# With coverage
naap-plugin test --coverage
```

### 5. Build & Publish
```bash
# Build
naap-plugin build

# Package
naap-plugin package

# Login (first time)
naap-plugin login

# Publish
naap-plugin publish
```

### 6. Update
```bash
# Bump version
naap-plugin version patch

# Update CHANGELOG.md
# Rebuild & republish
naap-plugin build && naap-plugin package && naap-plugin publish
```

## 🔧 Essential Files

### `plugin.json` (Required)
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "frontend": {
    "devPort": 3010,
    "routes": ["/my-plugin", "/my-plugin/*"]
  },
  "backend": {
    "devPort": 4010,
    "port": 4100,
    "apiPrefix": "/api/v1/my-plugin"
  }
}
```

### `frontend/src/App.tsx` (Required)
```typescript
import { createPlugin } from '@naap/plugin-sdk';
import YourApp from './pages/YourApp';

const plugin = createPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  routes: ['/my-plugin', '/my-plugin/*'],
  App: YourApp,
});

export const mount = plugin.mount;
export default plugin;
```

### `backend/src/server.ts` (Required)
```typescript
import express from 'express';

const app = express();
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.json({ status: 'healthy' });
});

app.use('/api/v1/my-plugin', router);

app.listen(process.env.PORT || 4010);
```

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Plugin not loading | Check the UMD bundle (`production/<plugin-name>.js`) is accessible |
| Backend won't start | Check port availability, DATABASE_URL |
| Database errors | Verify Docker is running, run migrations |
| Build fails | Check TypeScript errors, clear cache |
| Publish fails | Verify login, check version doesn't exist |

## 📚 More Information

- **Full Guide**: [plugin-developer-guide.md](./plugin-developer-guide.md)
- **Architecture**: [plugin-development.md](./plugin-development.md)
- **Examples**: Check `plugins/` directory
