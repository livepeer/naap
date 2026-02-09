# NAAP Plugin Development Guide

This guide covers everything you need to know to develop, test, and publish plugins for the NAAP platform.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Plugin Architecture](#plugin-architecture)
3. [Creating a Plugin](#creating-a-plugin)
4. [Development Workflow](#development-workflow)
5. [Plugin Manifest](#plugin-manifest)
6. [Frontend Development](#frontend-development)
7. [Backend Development](#backend-development)
8. [Database Integration](#database-integration)
9. [Using Integrations](#using-integrations)
10. [Testing](#testing)
11. [Building and Packaging](#building-and-packaging)
12. [Publishing](#publishing)
13. [Version Management](#version-management)
14. [Best Practices](#best-practices)

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Docker (for local database and infrastructure testing)
- Git

### Install the Plugin SDK

```bash
npm install -g @naap/plugin-sdk
```

This installs the `naap-plugin` CLI tool globally.

### Quick Start

```bash
# Create a new plugin
naap-plugin create my-awesome-plugin

# Navigate to the plugin directory
cd my-awesome-plugin

# Start development servers
naap-plugin dev
```

---

## Plugin Architecture

NAAP plugins are full-stack micro-applications that integrate with the shell application using UMD/CDN plugin loading.

```
┌─────────────────────────────────────────────────────────────┐
│                    NAAP Shell                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │ Navigation  │ │ Theme/Auth  │ │ Plugin Context          ││
│  └─────────────┘ └─────────────┘ └─────────────────────────┘│
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Router                                 ││
│  │  /gateways → Plugin A   /analytics → Plugin B           ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
          │                           │
          ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│   Plugin A      │         │   Plugin B      │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │ Frontend  │◄─┼─────────┼──│ Frontend  │  │
│  │ (React)   │  │         │  │ (React)   │  │
│  └───────────┘  │         │  └───────────┘  │
│       │         │         │       │         │
│       ▼         │         │       ▼         │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │ Backend   │  │         │  │ Backend   │  │
│  │ (Express) │  │         │  │ (Express) │  │
│  └───────────┘  │         │  └───────────┘  │
│       │         │         │       │         │
│       ▼         │         │       ▼         │
│  ┌───────────┐  │         │  ┌───────────┐  │
│  │ Database  │  │         │  │ Database  │  │
│  │(PostgreSQL)│ │         │  │(PostgreSQL)│ │
│  └───────────┘  │         │  └───────────┘  │
└─────────────────┘         └─────────────────┘
```

### Plugin Types

- **Full Stack**: Frontend + Backend + Database
- **Frontend Only**: UI components without backend
- **Backend Only**: API services without UI

---

## Creating a Plugin

### Interactive Creation

```bash
naap-plugin create my-plugin
```

The CLI will prompt you for:
- Template type (full-stack, frontend-only, backend-only)
- Category (analytics, monitoring, integration, tool, etc.)
- Description
- Author name
- Integrations to include

### Using Options

```bash
naap-plugin create my-plugin \
  --template full-stack \
  --skip-install \
  --skip-git
```

### Project Structure

```
my-plugin/
├── plugin.json                 # Plugin manifest (required)
├── .naap/
│   ├── config.json            # Local dev configuration
│   └── credentials.json       # Registry credentials (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main component with mount function
│   │   ├── pages/
│   │   └── components/
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── server.ts         # Express server
│   │   └── routes/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── package.json
├── docs/
│   ├── README.md
│   ├── CHANGELOG.md
│   └── api.md
└── .github/
    └── workflows/
        └── publish.yml        # CI/CD
```

---

## Development Workflow

### Start Development Servers

```bash
naap-plugin dev
```

This starts:
- Frontend dev server with HMR (default: port 3010)
- Backend dev server with watch mode (default: port 4010)
- Local PostgreSQL database (port 5440)

### Connect to Shell

By default, the dev command connects to `http://localhost:3000`. To connect to a different shell:

```bash
naap-plugin dev --shell http://localhost:3000
```

Or via URL parameter:
```
http://localhost:3000?dev-plugin=http://localhost:3010/dist/production/my-plugin.js
```

### Hot Module Replacement

Frontend changes are instantly reflected in the shell. Backend changes trigger an automatic server restart.

---

## Plugin Manifest

The `plugin.json` file defines your plugin's configuration:

```json
{
  "$schema": "https://plugins.naap.io/schema/plugin.json",
  "name": "my-plugin",
  "displayName": "My Awesome Plugin",
  "version": "1.0.0",
  "description": "Does amazing things",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "category": "tool",
  
  "frontend": {
    "entry": "./frontend/dist/production/my-plugin.js",
    "devPort": 3010,
    "routes": ["/my-plugin", "/my-plugin/*"],
    "navigation": {
      "label": "My Plugin",
      "icon": "Sparkles",
      "order": 50
    }
  },
  
  "backend": {
    "entry": "./backend/dist/server.js",
    "port": 4100,
    "healthCheck": "/healthz",
    "apiPrefix": "/api/v1/my-plugin"
  },
  
  "database": {
    "type": "postgresql",
    "schema": "./backend/prisma/schema.prisma"
  },
  
  "integrations": {
    "required": [],
    "optional": ["openai", "aws-s3"]
  },
  
  "permissions": {
    "shell": ["navigation", "notifications"],
    "apis": ["gateway-manager"]
  }
}
```

---

## Frontend Development

### Mount Function

Your frontend must export a `mount` function:

```typescript
// src/App.tsx
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ShellProvider } from '@naap/plugin-sdk/hooks';
import type { ShellContext } from '@naap/plugin-sdk/types';

let root: Root | null = null;

export function mount(container: HTMLElement, context: ShellContext) {
  root = createRoot(container);
  root.render(
    <ShellProvider value={context}>
      <App />
    </ShellProvider>
  );
  
  // Return unmount function
  return () => {
    if (root) {
      root.unmount();
      root = null;
    }
  };
}
```

### Using Shell Context

```typescript
import { useShell, useUser, useNavigate } from '@naap/plugin-sdk/hooks';

const MyComponent = () => {
  const shell = useShell();
  const user = useUser();
  const navigate = useNavigate();
  
  return (
    <div>
      <p>Welcome, {user?.displayName}</p>
      <button onClick={() => navigate('/dashboard')}>
        Go to Dashboard
      </button>
    </div>
  );
};
```

### Vite Configuration

```typescript
// vite.config.ts
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  pluginName: 'myPlugin',
});
```

---

## Backend Development

### Server Setup

```typescript
// src/server.ts
import express from 'express';
import cors from 'cors';
import { router } from './routes/index.js';

const app = express();
const PORT = process.env.PORT || 4010;

app.use(cors());
app.use(express.json());

// Health check
app.get('/healthz', (req, res) => {
  res.json({ status: 'healthy' });
});

// API routes
app.use('/api/v1/my-plugin', router);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### API Routes

```typescript
// src/routes/index.ts
import { Router } from 'express';
import { prisma } from '../db/client.js';

export const router = Router();

router.get('/items', async (req, res) => {
  const items = await prisma.item.findMany();
  res.json({ items });
});

router.post('/items', async (req, res) => {
  const item = await prisma.item.create({
    data: req.body,
  });
  res.json({ item });
});
```

---

## Database Integration

### Prisma Schema

```prisma
// prisma/schema.prisma
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
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Migrations

```bash
# Create a new migration
npx prisma migrate dev --name add_items_table

# Apply migrations
npx prisma migrate deploy
```

### Seeding

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.item.createMany({
    data: [
      { name: 'Item 1' },
      { name: 'Item 2' },
    ],
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## Using Integrations

### Available Integrations

- **AI**: OpenAI, Anthropic
- **Storage**: AWS S3, GCP Storage, Azure Blob
- **Email**: SendGrid, Mailgun, SES
- **Payment**: Stripe, PayPal
- **Messaging**: Twilio

### Frontend Usage

```typescript
import { useAIIntegration } from '@naap/plugin-sdk/hooks';

const MyComponent = () => {
  const { integration, loading, error } = useAIIntegration('openai', {
    pluginName: 'my-plugin',
    authToken: context.authToken,
  });
  
  const generateText = async () => {
    if (integration) {
      const result = await integration.complete('Hello, world!');
      console.log(result);
    }
  };
};
```

### Backend Usage

```typescript
import { getIntegration } from '@naap/plugin-sdk/integrations';

// Get integration via proxy (credentials managed by shell)
const response = await fetch('http://localhost:4000/api/v1/integrations/openai/call', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Plugin-Name': 'my-plugin',
  },
  body: JSON.stringify({
    method: 'complete',
    args: ['Hello, world!'],
  }),
});
```

---

## Testing

### Run All Tests

```bash
naap-plugin test
```

### Unit Tests Only

```bash
naap-plugin test --unit
```

### E2E Tests

```bash
naap-plugin test --e2e
```

### With Coverage

```bash
naap-plugin test --coverage
```

---

## Building and Packaging

### Build

```bash
naap-plugin build
```

This builds:
- Frontend UMD bundle (production/&lt;plugin-name&gt;.js)
- Backend (compiled TypeScript)
- Docker image for backend

### Package

```bash
naap-plugin package
```

Creates a distributable tarball: `dist/my-plugin-1.0.0.tar.gz`

---

## Publishing

### Login to Registry

```bash
naap-plugin login
```

### Publish

```bash
naap-plugin publish
```

### Publish with Tag

```bash
naap-plugin publish --tag beta
```

---

## Version Management

### Bump Version

```bash
naap-plugin version patch  # 1.0.0 → 1.0.1
naap-plugin version minor  # 1.0.0 → 1.1.0
naap-plugin version major  # 1.0.0 → 2.0.0
```

### Deprecate Version

```bash
naap-plugin deprecate --version 1.0.0 --message "Please upgrade to v2.0.0"
```

---

## Best Practices

### 1. Keep Plugins Focused
Each plugin should do one thing well. Avoid feature creep.

### 2. Use Type Safety
Always use TypeScript for both frontend and backend.

### 3. Handle Errors Gracefully
Show user-friendly error messages and provide recovery options.

### 4. Optimize Bundle Size
Use code splitting and lazy loading for large components.

### 5. Document Your API
Keep API documentation up to date in `docs/api.md`.

### 6. Write Tests
Aim for good test coverage, especially for critical paths.

### 7. Follow Shell Conventions
Use the shell's theme, navigation patterns, and UI components.

### 8. Secure Your Backend
Validate all inputs and implement proper authentication.

### 9. Version Thoughtfully
Use semantic versioning and maintain backward compatibility.

### 10. Keep Dependencies Updated
Regularly update dependencies for security and performance.

---

## Getting Help

- [GitHub Issues](https://github.com/naap/plugins/issues)
- [Discord Community](https://discord.gg/naap)
- [Plugin Examples](https://github.com/naap/plugins)
