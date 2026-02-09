# NAAP Generalized Shell Services

## Overview

The NAAP platform provides a set of generalized services that plugins can use without reimplementing common functionality. These services follow SOLID principles and provide consistent APIs across all plugins.

## Available Services

### 1. Notification Service

Display toast notifications to users.

```typescript
import { useNotify } from '@naap/plugin-sdk';

function MyComponent() {
  const notify = useNotify();
  
  const handleSave = async () => {
    try {
      await saveData();
      notify.success('Data saved successfully');
    } catch (error) {
      notify.error('Failed to save data');
    }
  };
  
  return <button onClick={handleSave}>Save</button>;
}
```

**API:**
- `notify.success(message, options?)` - Show success notification
- `notify.error(message, options?)` - Show error notification
- `notify.info(message, options?)` - Show info notification
- `notify.warning(message, options?)` - Show warning notification
- `notify.dismiss(id)` - Dismiss notification by ID
- `notify.dismissAll()` - Dismiss all notifications

### 2. Auth Service

Access authentication and user information.

```typescript
import { useAuth } from '@naap/plugin-sdk';

function MyComponent() {
  const auth = useAuth();
  
  if (!auth.isAuthenticated()) {
    return <p>Please connect your wallet</p>;
  }
  
  const user = auth.getUser();
  return <p>Welcome, {user?.displayName}</p>;
}
```

**API:**
- `auth.getUser()` - Get current user
- `auth.getToken()` - Get auth token (async)
- `auth.isAuthenticated()` - Check if user is authenticated
- `auth.hasRole(role)` - Check if user has a role
- `auth.hasPermission(resource, action)` - Check permission
- `auth.onAuthStateChange(callback)` - Listen for auth changes

### 3. Permission Service

Fine-grained authorization checks.

```typescript
import { usePermissions, usePermission } from '@naap/plugin-sdk';

function MyComponent() {
  const canEdit = usePermission('gateway', 'update');
  const permissions = usePermissions();
  
  if (!canEdit) {
    return <p>You don't have permission to edit gateways</p>;
  }
  
  return <EditGatewayForm />;
}
```

**API:**
- `permissions.can(resource, action)` - Check if user can perform action
- `permissions.getPermissions()` - Get all user permissions
- `permissions.require(resource, action)` - Throws if not authorized

### 4. Integration Services

Access AI, Storage, and Email services.

```typescript
import { useAI, useStorage, useEmail } from '@naap/plugin-sdk';

function MyComponent() {
  const ai = useAI();
  const storage = useStorage();
  const email = useEmail();
  
  const handleAnalyze = async () => {
    // Use AI
    const result = await ai.complete('Analyze this data...');
    
    // Upload result
    const { url } = await storage.upload(
      new Blob([result.content]),
      'analysis/report.txt'
    );
    
    // Send notification email
    await email.send(
      { email: 'user@example.com' },
      'Analysis Complete',
      `Your analysis is ready: ${url}`
    );
  };
}
```

### 5. Logger Service

Structured logging with context.

```typescript
import { useLogger } from '@naap/plugin-sdk';

function MyComponent() {
  const logger = useLogger('GatewayManager');
  
  const handleAction = () => {
    logger.info('Action started', { gatewayId: '123' });
    
    try {
      // ...
      logger.info('Action completed');
    } catch (error) {
      logger.error('Action failed', error);
    }
  };
}
```

**API:**
- `logger.debug(message, meta?)` - Debug log
- `logger.info(message, meta?)` - Info log
- `logger.warn(message, meta?)` - Warning log
- `logger.error(message, error?, meta?)` - Error log
- `logger.child(context)` - Create child logger with context

### 6. Event Bus

Inter-plugin communication.

```typescript
import { useEvents } from '@naap/plugin-sdk';

function MyComponent() {
  const eventBus = useEvents();
  
  useEffect(() => {
    // Subscribe to events
    const unsubscribe = eventBus.on('gateway:updated', (data) => {
      console.log('Gateway updated:', data);
    });
    
    return unsubscribe;
  }, [eventBus]);
  
  const handleUpdate = () => {
    // Emit event
    eventBus.emit('gateway:updated', { id: '123', status: 'active' });
  };
}
```

### 7. Theme Service

Access and control theme settings.

```typescript
import { useThemeService } from '@naap/plugin-sdk';

function MyComponent() {
  const theme = useThemeService();
  
  return (
    <div style={{ background: theme.colors.background }}>
      <p>Current mode: {theme.mode}</p>
      <button onClick={theme.toggle}>Toggle Theme</button>
    </div>
  );
}
```

## Shared UI Components

The `@naap/ui` package provides pre-built, themeable components:

```typescript
import { 
  Card,
  Badge,
  SearchInput,
  FilterBar,
  DataTable,
  EmptyState,
  LoadingState,
  Modal,
  Tabs,
  Toggle,
  Tooltip,
  ConfirmDialog,
} from '@naap/ui';
```

### SearchInput

```tsx
<SearchInput
  value={search}
  onChange={setSearch}
  placeholder="Search gateways..."
  debounceMs={300}
/>
```

### FilterBar

```tsx
<FilterBar
  options={[
    { value: 'all', label: 'All', count: 10 },
    { value: 'active', label: 'Active', count: 7 },
    { value: 'inactive', label: 'Inactive', count: 3 },
  ]}
  value={filter}
  onChange={setFilter}
/>
```

### DataTable

```tsx
<DataTable
  data={gateways}
  columns={[
    { key: 'name', header: 'Name', sortable: true },
    { key: 'status', header: 'Status', render: (g) => <Badge>{g.status}</Badge> },
  ]}
  keyAccessor={(g) => g.id}
  onRowClick={(g) => navigate(`/gateways/${g.id}`)}
/>
```

### EmptyState

```tsx
<EmptyState
  icon={Inbox}
  title="No gateways found"
  description="Add your first gateway to get started"
  action={{ label: 'Add Gateway', onClick: handleAdd }}
/>
```

### Modal

```tsx
<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Edit Gateway"
>
  <form>...</form>
</Modal>
```

### ConfirmDialog

```tsx
<ConfirmDialog
  isOpen={isConfirmOpen}
  onClose={() => setIsConfirmOpen(false)}
  onConfirm={handleDelete}
  title="Delete Gateway?"
  message="This action cannot be undone."
  confirmText="Delete"
  variant="danger"
/>
```

## API Keys & Secrets

Plugins access integrations through a unified API key system. Users configure API keys once in the shell settings, and they're automatically available to permitted plugins.

### Requesting Integration Access

In your `plugin.json`:

```json
{
  "name": "my-plugin",
  "integrations": {
    "required": ["openai"],
    "optional": ["aws-s3", "sendgrid"]
  }
}
```

### Using Integrations

```typescript
import { useIntegrations } from '@naap/plugin-sdk';

function MyComponent() {
  const integrations = useIntegrations();
  
  // Check if configured
  if (!integrations.isConfigured('ai')) {
    return <p>Please configure AI integration in settings</p>;
  }
  
  // Use the integration
  const result = await integrations.ai.complete('...');
}
```

## Error Handling

Use the built-in error boundary for graceful error handling:

```tsx
import { PluginErrorBoundary } from '@naap/plugin-sdk';

function App() {
  return (
    <PluginErrorBoundary pluginName="my-plugin">
      <MyPluginContent />
    </PluginErrorBoundary>
  );
}
```

## Migration from V1 to V2

If your plugin uses the legacy V1 context, you can migrate incrementally:

### Before (V1)

```typescript
import { useShell } from '@naap/plugin-sdk';

function MyComponent() {
  const shell = useShell();
  const user = shell.user();
}
```

### After (V2)

```typescript
import { useAuth, useNotify } from '@naap/plugin-sdk';

function MyComponent() {
  const auth = useAuth();
  const notify = useNotify();
  
  const user = auth.getUser();
  notify.success('Welcome!');
}
```

## Best Practices

1. **Use SDK hooks** instead of direct fetch calls
2. **Use shared UI components** for consistent UX
3. **Use the logger** for debugging and error tracking
4. **Check permissions** before showing/enabling features
5. **Handle errors gracefully** with error boundaries
6. **Emit events** for cross-plugin communication
