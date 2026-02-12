# Plugin Team Guide -- Self-Service Onboarding

This guide walks you through everything you need to create a plugin, register
your team, and start shipping independently. The entire onboarding process is
self-service; after one initial review from the core team, your plugin team is
fully autonomous.

## Prerequisites

- **Node.js 20** (LTS)
- **npm** (comes with Node.js)
- **Git**
- **Docker** (for the local PostgreSQL database)

Verify your setup:

```bash
node --version   # v20.x.x
npm --version    # 10.x.x
git --version    # 2.x.x
docker --version # 24.x.x or later
```

## Step 1: Scaffold Your Plugin

From the NaaP repository root:

```bash
npx naap-plugin create <your-plugin-name>
```

This generates the following structure:

```
plugins/<your-plugin-name>/
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Root component (mounted by the shell)
│   │   ├── index.ts           # UMD entry point (mount/unmount exports)
│   │   └── components/        # Your React components
│   ├── package.json
│   └── vite.config.ts         # Pre-configured UMD build
├── backend/                   # Optional -- delete if not needed
│   ├── src/
│   │   ├── index.ts           # Express server entry
│   │   └── routes/            # API routes
│   ├── package.json
│   └── prisma/
│       └── schema.prisma      # Plugin-specific database schema
└── plugin.json                # Plugin manifest (routes, ports, icons)
```

### `plugin.json` manifest

Every plugin must include a `plugin.json` at its root. This file tells the
shell how to load and display your plugin:

```json
{
  "name": "your-plugin-name",
  "displayName": "Your Plugin",
  "version": "1.0.0",
  "description": "Brief description of what your plugin does.",
  "icon": "LayoutDashboard",
  "routes": ["/your-plugin"],
  "backendPort": 4010,
  "permissions": ["read:network"]
}
```

## Step 2: Develop Locally

Start the platform with your plugin:

```bash
# Fastest: shell + your plugin backend (~6s)
./bin/start.sh <your-plugin-name>

# With frontend HMR (hot module replacement):
./bin/start.sh dev <your-plugin-name>
```

This starts:
- The Next.js shell on `http://localhost:3000`
- Core services (base-svc, plugin-server)
- Your plugin backend (if it exists)
- Your plugin frontend (loaded via CDN bundle, or HMR in dev mode)

Your plugin is accessible at `http://localhost:3000/<your-route>`.

### Frontend development

- Use `@naap/plugin-sdk` hooks for authentication, configuration, and
  inter-plugin communication.
- Your frontend is built as a UMD bundle by Vite. The shell loads it at
  runtime via the plugin server.
- Shared UI components are available from `@naap/ui`.

### Backend development

- Your backend is a standalone Express server with its own Prisma schema.
- Each plugin backend gets an isolated PostgreSQL schema (e.g.,
  `your_plugin_name`).
- Use `@naap/plugin-utils` for authentication middleware and API helpers.

## Step 3: Register Your Team

Once your plugin is working locally, register your team so you can merge
PRs autonomously.

### 3.1 Add a CODEOWNERS entry

Open the `CODEOWNERS` file at the repository root and add a line for your
plugin:

```
/plugins/<your-plugin-name>/    @livepeer/<your-team-name>
```

This ensures that PRs touching your plugin directory are automatically
assigned to your team for review.

### 3.2 Add a labeler entry

Open `.github/labeler.yml` and add an entry so PRs are auto-labeled:

```yaml
plugin/<your-plugin-name>:
  - changed-files:
      - any-glob-to-any-file: 'plugins/<your-plugin-name>/**'
```

### 3.3 Open a PR

Open a single PR with both changes above, targeting the `main` branch.
A core maintainer will review it once. After merge, your team is autonomous.

## Step 4: Daily Workflow

Your day-to-day development workflow:

1. **Branch from `main`:**
   ```bash
   git checkout main && git pull
   git checkout -b feat/<your-team>/<description>
   ```

2. **Start developing (~6 seconds):**
   ```bash
   # Recommended: auto-detects your changed plugins
   ./bin/start.sh

   # Or explicitly start your plugin
   ./bin/start.sh <your-plugin-name>
   ```

3. **Make changes** in `plugins/<your-plugin-name>/`.
   Your plugin is auto-rebuilt on next start.

4. **Quick restart** after changes:
   ```bash
   ./bin/stop.sh && ./bin/start.sh                # ~8s total
   ```

5. **Commit using conventional commits:**
   ```bash
   git commit -m "feat(plugin/<your-plugin-name>): add network stats view"
   ```

6. **Open a PR against `main`:**
   - The labeler bot auto-labels it (e.g., `plugin/<your-plugin-name>`).
   - CODEOWNERS auto-assigns your team as reviewers.
   - Copilot and CodeRabbit provide automated code review.
   - CI runs your plugin's tests.
   - A Vercel preview URL is generated for testing.

7. **Your team reviews and approves.**

8. **Merge queue merges automatically** once approved and CI passes.

9. **Production deploys automatically** after merge to `main`.

## Step 5: Your Team's Responsibilities

As an autonomous plugin team, you are responsible for:

- **Review PRs within 24 hours.** The review SLA bot will send reminders
  if a PR goes unreviewed.
- **Keep your plugin building.** The health dashboard checks all plugins
  daily. If your build breaks, you will be notified.
- **Follow conventional commits.** CI enforces this. Non-conforming commits
  will fail the linter.
- **Stay within your directory.** Do not modify code outside
  `plugins/<your-plugin-name>/`. If you need changes to shared packages or
  the shell, open an issue or RFC.

## Plugin Architecture

Understanding how plugins work in NaaP:

### Loading model

1. Plugins are built as **UMD bundles** by Vite (`plugin-build` package).
2. The **plugin server** hosts the bundles at
   `/cdn/plugins/<name>/<version>/<name>.js`.
3. The **shell** fetches the plugin manifest from the registry and loads the
   UMD bundle at runtime using a dynamic script tag.
4. The bundle exports `mount(container, context)` and `unmount(container)`
   functions.

### ShellContext

When the shell mounts your plugin, it passes a `ShellContext` object
containing:

- `user` -- the authenticated user
- `team` -- the current team context
- `navigate(path)` -- client-side navigation
- `eventBus` -- publish/subscribe for inter-plugin communication
- `apiClient` -- pre-configured HTTP client with auth headers
- `config` -- plugin-specific configuration

Access these via SDK hooks:

```tsx
import { useShellContext, useEventBus } from '@naap/plugin-sdk';

function MyComponent() {
  const { user, team } = useShellContext();
  const { emit, on } = useEventBus();
  // ...
}
```

### Lifecycle

| Event | What happens |
|---|---|
| Shell loads | Fetches plugin registry, determines which plugins to load |
| Plugin mount | Shell creates a container div and calls `mount(container, context)` |
| Route change | Shell unmounts the current plugin and mounts the next one |
| Plugin unmount | Shell calls `unmount(container)` -- clean up subscriptions and timers |

## FAQ

**Can I use a different frontend framework (Vue, Svelte, etc.)?**

The UMD contract only requires `mount` and `unmount` functions. In theory,
any framework works. In practice, the SDK hooks and shared UI library are
React-only, so using React is strongly recommended.

**Can I add npm dependencies to my plugin?**

Yes. Your plugin has its own `package.json`. Add whatever you need. Be
mindful of bundle size since the UMD bundle is loaded at runtime.

**What if I need a database table?**

Add it to your plugin's Prisma schema in `backend/prisma/schema.prisma`.
Your schema is isolated to its own PostgreSQL schema namespace. Run
`cd packages/database && npx prisma db push` to apply changes.

**What if I need to change a shared package?**

Open an issue or RFC describing what you need. If the change is small and
non-breaking, a PR with tests is usually approved quickly.

**How do I communicate with another plugin?**

Use the event bus (`useEventBus` from `@naap/plugin-sdk`). Never import
directly from another plugin's code.

**How do I get help?**

Open a GitHub Discussion. The community and core team are responsive to
questions.
