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

**Required**: Node.js 18+, Git, Docker (running)

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

## Step 2: Start Development (30 seconds)

```bash
# Start the plugin dev server with auto-registration
naap-plugin dev
```

This command:
- Starts your plugin's frontend (hot reload enabled)
- Starts your plugin's backend (if applicable)
- Opens your browser with the plugin loaded
- Auto-registers via URL parameter (no manual setup)

## Step 3: See It Running

Your browser opens to: `http://localhost:3000/#/my-plugin?dev-plugin=...`

You should see your plugin rendered in the NAAP shell!

## Development Tips

### Single-Command Dev (Shell + Plugin)

If you're developing inside the NAAP monorepo:

```bash
# Start everything in one command
naap-plugin dev --with-shell
```

### Frontend-Only Development

```bash
naap-plugin dev --frontend-only
```

### Different Shell URL

```bash
naap-plugin dev --shell http://staging.naap.io
```

### Skip Browser Launch

```bash
naap-plugin dev --no-open
```

## Quick Commands Reference

| Command | Description |
|---------|-------------|
| `naap-plugin create <name>` | Create a new plugin |
| `naap-plugin dev` | Start dev servers |
| `naap-plugin dev --with-shell` | Start shell + plugin |
| `naap-plugin build` | Build for production |
| `naap-plugin publish` | Publish to marketplace |
| `naap-plugin doctor` | Diagnose common issues |

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
# Start shell first (from NAAP root)
./bin/start.sh --shell

# Then start your plugin
naap-plugin dev
```

## Next Steps

1. Read the [Plugin Developer Guide](./plugin-developer-guide.md)
2. Explore [Example Plugins](../examples/)
3. Check the [API Reference](./API_REFERENCE.md)
4. Join the [Community](https://discord.gg/naap)

---

**Need help?** Run `naap-plugin doctor` or check the [Troubleshooting Guide](./TROUBLESHOOTING.md).
