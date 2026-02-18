/**
 * Hello World Plugin
 * 
 * A minimal example demonstrating how to use shell services via SDK hooks:
 * - User authentication (useAuthService)
 * - Theme service (useThemeService)
 * - Notifications (useNotify)
 * - Event bus (useEvents)
 * - Navigation (useNavigate)
 * - Capabilities (useCapabilities)
 */

import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { 
  createPlugin,
  useAuthService, 
  useNotify, 
  useEvents, 
  useThemeService, 
  useNavigate,
  useCapabilities,
} from '@naap/plugin-sdk';
import { Hand, Sun, Moon, Bell, User, Zap, CheckCircle } from 'lucide-react';

// Main page component using SDK hooks
export const HelloPage: React.FC = () => {
  // Use SDK hooks for shell services
  const auth = useAuthService();
  const notify = useNotify();
  const events = useEvents();
  const theme = useThemeService();
  const navigate = useNavigate();
  const capabilities = useCapabilities();

  // Get user from auth service
  const user = auth.getUser();
  const isAuthenticated = auth.isAuthenticated();
  const [isDark, setIsDark] = React.useState(theme.mode === 'dark');

  // Subscribe to theme changes
  React.useEffect(() => {
    const unsubscribe = theme.onChange?.((mode) => {
      setIsDark(mode === 'dark');
    });
    return () => unsubscribe?.();
  }, [theme]);

  // Show notification using the notify service
  const showNotification = (type: 'success' | 'info' | 'error') => {
    const messages = {
      success: 'Action completed successfully!',
      info: 'This is an informational message.',
      error: 'Something went wrong!',
    };
    notify[type](messages[type]);
  };

  // Emit custom event via event bus
  const emitCustomEvent = () => {
    events.emit('plugin:data-updated' as any, { 
      plugin: 'hello-world',
      timestamp: Date.now() 
    });
    showNotification('info');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-blue to-accent-emerald flex items-center justify-center">
          <Hand className="w-8 h-8 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Hello World Plugin</h1>
          <p className="text-text-secondary">A minimal example demonstrating shell services</p>
        </div>
      </div>

      {/* User Info Card */}
      <div className="bg-bg-secondary border border-white/10 rounded-2xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <User size={20} />
          User Information
        </h2>
        {isAuthenticated && user ? (
          <div className="space-y-2">
            <p className="text-text-secondary">
              <span className="text-text-tertiary">ID:</span>{' '}
              <span className="font-mono">{user.id}</span>
            </p>
            {user.walletAddress && (
              <p className="text-text-secondary">
                <span className="text-text-tertiary">Wallet:</span>{' '}
                <span className="font-mono">{user.walletAddress}</span>
              </p>
            )}
            {user.displayName && (
              <p className="text-text-secondary">
                <span className="text-text-tertiary">Display Name:</span>{' '}
                {user.displayName}
              </p>
            )}
            <div className="mt-2 px-3 py-1.5 bg-accent-emerald/20 text-accent-emerald rounded-lg inline-block text-sm">
              Authenticated
            </div>
          </div>
        ) : (
          <div className="text-text-tertiary">
            <p>Not authenticated. Please log in to see your information.</p>
            <button
              onClick={() => navigate('/login')}
              className="mt-3 px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg text-sm transition-colors"
            >
              Go to Login
            </button>
          </div>
        )}
      </div>

      {/* Capabilities Card */}
      <div className="bg-bg-secondary border border-white/10 rounded-2xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <CheckCircle size={20} />
          Available Capabilities
        </h2>
        <div className="flex flex-wrap gap-2">
          {['ai', 'storage', 'email', 'payments', 'notifications', 'teams'].map((cap) => (
            <div 
              key={cap}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                capabilities.has(cap) 
                  ? 'bg-accent-emerald/20 text-accent-emerald' 
                  : 'bg-white/5 text-text-tertiary'
              }`}
            >
              {cap}: {capabilities.has(cap) ? '✓' : '✗'}
            </div>
          ))}
        </div>
        <p className="mt-3 text-text-tertiary text-sm">
          Use <code className="bg-white/5 px-1 rounded">useCapabilities()</code> to check available features.
        </p>
      </div>

      {/* Theme Card */}
      <div className="bg-bg-secondary border border-white/10 rounded-2xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          {isDark ? <Moon size={20} /> : <Sun size={20} />}
          Theme Toggle
        </h2>
        <p className="text-text-secondary mb-4">
          Current theme: <span className="font-mono">{isDark ? 'Dark' : 'Light'}</span>
        </p>
        <p className="text-text-tertiary text-sm">
          Note: Theme toggling is managed by the shell. This plugin demonstrates reading theme state.
        </p>
      </div>

      {/* Notifications Card */}
      <div className="bg-bg-secondary border border-white/10 rounded-2xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Bell size={20} />
          Notifications
        </h2>
        <p className="text-text-secondary mb-4">
          Click buttons to trigger shell notifications via the event bus:
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => showNotification('success')}
            className="px-4 py-2 bg-accent-emerald hover:bg-accent-emerald/80 text-white rounded-lg text-sm transition-colors"
          >
            Success
          </button>
          <button
            onClick={() => showNotification('info')}
            className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg text-sm transition-colors"
          >
            Info
          </button>
          <button
            onClick={() => showNotification('error')}
            className="px-4 py-2 bg-red-500 hover:bg-red-500/80 text-white rounded-lg text-sm transition-colors"
          >
            Error
          </button>
        </div>
      </div>

      {/* Event Bus Card */}
      <div className="bg-bg-secondary border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Zap size={20} />
          Event Bus
        </h2>
        <p className="text-text-secondary mb-4">
          Emit a custom event that other plugins can listen to:
        </p>
        <button
          onClick={emitCustomEvent}
          className="px-4 py-2 bg-accent-amber hover:bg-accent-amber/80 text-black rounded-lg text-sm transition-colors"
        >
          Emit Custom Event
        </button>
        <p className="mt-3 text-text-tertiary text-sm">
          Open browser console to see event emissions.
        </p>
      </div>

      {/* Code Example */}
      <div className="mt-8 p-6 bg-bg-tertiary rounded-2xl border border-white/10">
        <h3 className="text-sm font-semibold text-text-secondary mb-3">Example: Using SDK Hooks (Recommended)</h3>
        <pre className="text-xs text-text-tertiary overflow-x-auto font-mono">
{`// Import hooks from @naap/plugin-sdk
import { 
  useAuthService, 
  useNotify, 
  useNavigate,
  useCapabilities,
  useApiClient,
} from '@naap/plugin-sdk';

// In your component:
function MyComponent() {
  const auth = useAuthService();
  const notify = useNotify();
  const navigate = useNavigate();
  const capabilities = useCapabilities();
  const api = useApiClient({ pluginName: 'my-plugin' });

  // Get current user
  const user = auth.getUser();
  const isAuth = auth.isAuthenticated();

  // Get auth token
  const token = await auth.getToken();

  // Navigate to another route
  navigate('/settings');

  // Show notifications
  notify.success('Hello!');
  notify.error('Something went wrong');

  // Check capabilities before using features
  if (capabilities.has('ai')) {
    // Use AI features
  }

  // Make API calls with auto auth/CSRF
  const data = await api.get('/api/v1/my-data');
}`}
        </pre>
      </div>
    </div>
  );
};

const HelloWorldApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<HelloPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'hello-world',
  version: '1.0.0',
  routes: ['/hello', '/hello/*'],
  App: HelloWorldApp,
});

export const mount = plugin.mount;
export default plugin;
