# NAAP Plugin Developer Quickstart

Get your first plugin running in under 5 minutes.

## Prerequisites

Install these before starting:

```bash
# macOS
brew install node@20 git && brew install --cask docker && open -a Docker

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
curl -fsSL https://get.docker.com | sudo sh && sudo systemctl start docker
```

**Required**: Node.js 20+, Git, Docker (running)

## Step 1: Create Your Plugin (2 minutes)

```bash
# Install the CLI globally
npm install -g @naap/plugin-sdk

# Create a new plugin
naap-plugin create my-plugin

# Follow the prompts:
# - Choose template: full-stack (or frontend-only)
# - Enter display name: My Plugin
# - Enter description: My first NAAP plugin

# Navigate to your plugin
cd my-plugin

# Install dependencies
npm install
```

## Step 2: Start Development (6 seconds)

If you are developing inside the NAAP monorepo (recommended):

```bash
# Start shell + your plugin backend (~6s)
./bin/start.sh my-plugin

# Or with frontend hot reload (HMR):
./bin/start.sh dev my-plugin
```

If developing a standalone plugin:

```bash
naap-plugin dev
```

Both approaches start the shell, core services, and your plugin.

## Step 3: See It Running

Open **http://localhost:3000** -- your plugin appears in the sidebar.

## Daily Workflow

```bash
# Smart start: auto-detects your changes (~6s)
./bin/start.sh

# Stop when done (~2s)
./bin/stop.sh

# Quick restart
./bin/stop.sh && ./bin/start.sh
```

Smart start is the default. It detects which plugins you changed,
rebuilds only those, and starts shell + marketplace + your changed plugins.

## Quick Commands Reference

| Command | Description | Time |
|---------|-------------|------|
| `./bin/start.sh` | Smart start (default) | ~6s |
| `./bin/start.sh my-plugin` | Shell + one plugin | ~6s |
| `./bin/start.sh dev my-plugin` | Shell + plugin with HMR | ~6s |
| `./bin/stop.sh` | Stop everything | ~2s |
| `./bin/start.sh --all` | Start all plugins | ~10s |
| `./bin/start.sh status` | What is running? | instant |
| `./bin/start.sh validate` | Full health check | ~5s |
| `naap-plugin create <name>` | Scaffold a new plugin | instant |
| `naap-plugin dev` | Standalone plugin dev server | ~5s |

## File Structure

```
my-plugin/
├── plugin.json         # Plugin manifest
├── frontend/
│   ├── src/
│   │   ├── App.tsx     # Main component (mount/unmount)
│   │   └── pages/      # Route components
│   ├── vite.config.ts  # UMD/CDN build config
│   └── package.json
├── backend/            # Optional
│   ├── src/
│   │   └── server.ts   # Express server
│   └── package.json
└── tests/
    └── App.test.tsx
```

## Essential Patterns

### Using Shell Services

```tsx
import { useAuthService, useNotify, useNavigate } from '@naap/plugin-sdk';

function MyComponent() {
  const auth = useAuthService();
  const notify = useNotify();
  const navigate = useNavigate();

  const user = auth.getUser();
  
  const handleAction = () => {
    notify.success('Action completed!');
    navigate('/dashboard');
  };

  return <div>Welcome, {user?.displayName}</div>;
}
```

### Making API Calls

```tsx
import { useApiClient } from '@naap/plugin-sdk';

function DataComponent() {
  const api = useApiClient({ pluginName: 'my-plugin' });
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/items').then(res => setData(res.data));
  }, []);

  return <div>{JSON.stringify(data)}</div>;
}
```

### Error Handling

```tsx
import { useError } from '@naap/plugin-sdk';

function SafeComponent() {
  const { error, handleError, clearError } = useError();

  const riskyAction = async () => {
    try {
      await someOperation();
    } catch (e) {
      handleError(e);
    }
  };

  if (error) {
    return <ErrorDisplay error={error} onDismiss={clearError} />;
  }

  return <button onClick={riskyAction}>Do Something</button>;
}
```

## Troubleshooting

### Plugin not loading?

```bash
naap-plugin doctor
```

### Port already in use?

```bash
naap-plugin dev --port 3011
```

### Shell not running?

```bash
# Start shell + your plugin in one command (from NAAP root)
./bin/start.sh my-plugin
```

## Next Steps

1. Read the [Plugin Developer Guide](./plugin-developer-guide.md)
2. Explore [Example Plugins](../examples/)
3. Check the [API Reference](./API_REFERENCE.md)
4. Join the [Community](https://discord.gg/naap)

---

**Need help?** Run `naap-plugin doctor` or check the [Troubleshooting Guide](./TROUBLESHOOTING.md).
