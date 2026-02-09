# NAAP Production-Ready Transformation Plan

## Vision

Transform NAAP into a production-ready platform with:
- **One unified plugin API** (no V1/V2 confusion)
- **Simple, elegant SDK** that developers love
- **Consistent, secure backend** that scales
- **Type-safe everything** from end to end

---

## Phase Overview

| Phase | Focus | Duration | Risk Level |
|-------|-------|----------|------------|
| **Phase 1** | Security Hardening | 3-4 days | CRITICAL |
| **Phase 2** | Unified Context & State | 4-5 days | HIGH |
| **Phase 3** | Type System Consolidation | 3-4 days | HIGH |
| **Phase 4** | SDK Simplification | 3-4 days | MEDIUM |
| **Phase 5** | Backend Cleanup | 3-4 days | MEDIUM |
| **Phase 6** | Plugin Interface Polish | 2-3 days | LOW |
| **Phase 7** | Testing & Documentation | 2-3 days | LOW |

**Total Estimate: 20-27 days**

---

# PHASE 1: Security Hardening (CRITICAL)

## 1.1 Fix Path Traversal in Plugin Server

**File:** `services/plugin-server/src/server.ts`

**Current (VULNERABLE):**
```typescript
app.use('/plugins/:pluginName', (req, res, next) => {
  const pluginName = req.params.pluginName;
  const pluginDistPath = path.join(PLUGINS_DIR, pluginName, 'frontend', 'dist');
  express.static(pluginDistPath)(req, res, next);
});
```

**Fixed:**
```typescript
// Add validation middleware
function validatePluginName(req: Request, res: Response, next: NextFunction) {
  const { pluginName } = req.params;

  // Strict validation: lowercase letters, numbers, hyphens only
  if (!/^[a-z][a-z0-9-]*$/.test(pluginName) || pluginName.length > 50) {
    return res.status(400).json({ error: 'Invalid plugin name' });
  }

  // Additional safety: resolve and verify path is within PLUGINS_DIR
  const resolved = path.resolve(PLUGINS_DIR, pluginName);
  if (!resolved.startsWith(path.resolve(PLUGINS_DIR))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  next();
}

app.use('/plugins/:pluginName', validatePluginName, (req, res, next) => {
  // ... safe to proceed
});
```

## 1.2 Upgrade Password Hashing

**File:** `services/base-svc/src/services/auth.ts`

**Current (WEAK):**
```typescript
crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512')
```

**Fixed:**
```typescript
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Support legacy PBKDF2 hashes during migration
  if (hash.includes(':')) {
    const valid = await verifyLegacyPassword(password, hash);
    // TODO: Rehash with bcrypt on successful login
    return valid;
  }
  return bcrypt.compare(password, hash);
}
```

## 1.3 Remove Secrets from HTTP Headers

**File:** `services/base-svc/src/middleware/tenantContext.ts`

**Current (DANGEROUS):**
```typescript
req.headers['x-tenant-config'] = JSON.stringify(req.tenant.config);
```

**Fixed:**
```typescript
// Create secure config that NEVER includes secrets
interface SafeTenantConfig {
  tenantId: string;
  features: string[];
  limits: Record<string, number>;
  // NO secrets, NO API keys
}

function getSafeTenantConfig(tenant: Tenant): SafeTenantConfig {
  return {
    tenantId: tenant.id,
    features: tenant.features || [],
    limits: tenant.limits || {},
  };
}

// Pass only safe config
req.headers['x-tenant-config'] = JSON.stringify(getSafeTenantConfig(req.tenant));

// Secrets accessed via secure vault service only
// Plugins must call shell.secrets.get('key') which validates permissions
```

## 1.4 Fix Plugin Permission Query

**File:** `services/base-svc/src/services/permissions.ts`

**Current (BROKEN):**
```typescript
const access = await db.teamMemberPluginAccess.findUnique({
  where: {
    memberId_pluginInstallId: {
      memberId: userId,  // WRONG: userId is not TeamMember ID
      pluginInstallId: installId,
    },
  },
});
```

**Fixed:**
```typescript
async function checkPluginAccess(
  userId: string,
  teamId: string,
  pluginInstallId: string
): Promise<boolean> {
  // First get the team member record
  const member = await db.teamMember.findUnique({
    where: {
      userId_teamId: { userId, teamId },
    },
  });

  if (!member) return false;

  // Now check plugin access with correct member ID
  const access = await db.teamMemberPluginAccess.findUnique({
    where: {
      memberId_pluginInstallId: {
        memberId: member.id,  // CORRECT: TeamMember ID
        pluginInstallId,
      },
    },
  });

  return access !== null;
}
```

## 1.5 CORS Hardening

**File:** `services/plugin-server/src/server.ts`

**Fixed:**
```typescript
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://app.naap.io', 'https://naap.io']
  : ['http://localhost:3000', 'http://localhost:3100'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  maxAge: 86400,
}));
```

## 1.6 Add Security Headers

**File:** `services/base-svc/src/middleware/security.ts` (NEW)

```typescript
import helmet from 'helmet';

export function securityMiddleware() {
  return [
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // For remote plugins
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'wss:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
    }),

    // Request ID for tracing
    (req, res, next) => {
      req.id = req.headers['x-request-id'] || crypto.randomUUID();
      res.setHeader('x-request-id', req.id);
      next();
    },
  ];
}
```

---

# PHASE 2: Unified Context & State Management

## 2.1 Delete V1 Context System

**Files to DELETE:**
- `apps/shell-web/src/context/ShellContext.tsx` (if exists, legacy V1)
- `apps/shell-web/src/utils/contextAdapter.ts` (250+ lines of V1↔V2 bridge)

**Files to MODIFY:**
- Remove all V1 imports from `WorkflowLoader.tsx`
- Remove V1 compatibility from `PluginContext.tsx`

## 2.2 Create Single Unified Auth System

**File:** `apps/shell-web/src/context/AuthContext.tsx` (REWRITE)

```typescript
/**
 * Unified Authentication Context
 *
 * SINGLE SOURCE OF TRUTH for:
 * - User identity
 * - Session management
 * - Token storage
 * - Permission checks
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  roles: string[];
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: 'google' | 'github') => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
}

export type AuthContextValue = AuthState & AuthActions;

// Storage keys (single location)
const STORAGE_KEYS = {
  TOKEN: 'naap_auth_token',
  USER: 'naap_auth_user',
  EXPIRES: 'naap_session_expires',
} as const;

// Context
const AuthContext = createContext<AuthContextValue | null>(null);

// Provider
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize from storage
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    const userJson = localStorage.getItem(STORAGE_KEYS.USER);
    const expires = localStorage.getItem(STORAGE_KEYS.EXPIRES);

    if (token && userJson && expires) {
      const expiresAt = new Date(expires);
      if (expiresAt > new Date()) {
        try {
          const user = JSON.parse(userJson);
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
          scheduleRefresh(expiresAt);
          return;
        } catch {
          clearStorage();
        }
      } else {
        clearStorage();
      }
    }

    setState(s => ({ ...s, isLoading: false }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  function clearStorage() {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.EXPIRES);
  }

  function saveSession(token: string, user: User, expiresAt: Date) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEYS.EXPIRES, expiresAt.toISOString());
  }

  function scheduleRefresh(expiresAt: Date) {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    // Refresh 5 minutes before expiry
    const refreshTime = expiresAt.getTime() - Date.now() - 5 * 60 * 1000;
    if (refreshTime > 0) {
      refreshTimerRef.current = setTimeout(() => {
        refreshSession();
      }, refreshTime);
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const response = await fetch('/api/v1/base/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Login failed');
      }

      const { token, user, expiresAt } = await response.json();
      const expires = new Date(expiresAt);

      saveSession(token, user, expires);
      scheduleRefresh(expires);

      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
      if (token) {
        await fetch('/api/v1/base/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      clearStorage();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    if (!token) return;

    try {
      const response = await fetch('/api/v1/base/auth/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const { token: newToken, expiresAt } = await response.json();
        const expires = new Date(expiresAt);

        localStorage.setItem(STORAGE_KEYS.TOKEN, newToken);
        localStorage.setItem(STORAGE_KEYS.EXPIRES, expires.toISOString());
        scheduleRefresh(expires);
      } else {
        await logout();
      }
    } catch {
      await logout();
    }
  }, [logout]);

  const loginWithOAuth = useCallback((provider: 'google' | 'github') => {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `/api/v1/base/auth/oauth/${provider}?returnUrl=${returnUrl}`;
  }, []);

  const hasRole = useCallback((role: string): boolean => {
    if (!state.user) return false;
    if (state.user.roles.includes('system:root')) return true;
    if (state.user.roles.includes('system:admin') && !role.startsWith('system:root')) return true;
    return state.user.roles.includes(role);
  }, [state.user]);

  const hasPermission = useCallback((permission: string): boolean => {
    // For now, map permissions to roles
    // TODO: Implement proper permission system
    return hasRole(permission);
  }, [hasRole]);

  const value: AuthContextValue = {
    ...state,
    login,
    loginWithOAuth,
    logout,
    refreshSession,
    hasRole,
    hasPermission,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// Helper to get token for API calls
export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.TOKEN);
}
```

## 2.3 Create Unified Team Context

**File:** `apps/shell-web/src/context/TeamContext.tsx` (NEW)

```typescript
/**
 * Unified Team Context
 *
 * SINGLE SOURCE OF TRUTH for:
 * - Current team
 * - Team membership
 * - Team switching
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export interface Team {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

export interface TeamContextValue {
  // State
  currentTeam: Team | null;
  currentMember: TeamMember | null;
  teams: Team[];
  isLoading: boolean;
  isPersonalWorkspace: boolean;

  // Actions
  switchTeam: (teamId: string | null) => Promise<void>;
  refreshTeams: () => Promise<void>;
}

const STORAGE_KEY = 'naap_current_team';
const TeamContext = createContext<TeamContextValue | null>(null);

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();

  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentMember, setCurrentMember] = useState<TeamMember | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load teams when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadTeams();
    } else {
      setTeams([]);
      setCurrentTeam(null);
      setCurrentMember(null);
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  async function loadTeams() {
    setIsLoading(true);
    try {
      const response = await fetch('/api/v1/base/teams', {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });

      if (response.ok) {
        const data = await response.json();
        setTeams(data.teams);

        // Restore previous team selection
        const savedTeamId = localStorage.getItem(STORAGE_KEY);
        if (savedTeamId) {
          const team = data.teams.find((t: Team) => t.id === savedTeamId);
          if (team) {
            await switchToTeam(team);
            return;
          }
        }
      }
    } catch (error) {
      console.error('Failed to load teams:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function switchToTeam(team: Team | null) {
    if (team) {
      // Load member info
      try {
        const response = await fetch(`/api/v1/base/teams/${team.id}/member/me`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        });

        if (response.ok) {
          const member = await response.json();
          setCurrentMember(member);
        }
      } catch {
        // Ignore - member info is optional
      }

      setCurrentTeam(team);
      localStorage.setItem(STORAGE_KEY, team.id);
    } else {
      setCurrentTeam(null);
      setCurrentMember(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const switchTeam = useCallback(async (teamId: string | null) => {
    if (teamId === null) {
      await switchToTeam(null);
      return;
    }

    const team = teams.find(t => t.id === teamId);
    if (team) {
      await switchToTeam(team);
    }
  }, [teams]);

  const refreshTeams = useCallback(async () => {
    await loadTeams();
  }, []);

  const value: TeamContextValue = {
    currentTeam,
    currentMember,
    teams,
    isLoading,
    isPersonalWorkspace: currentTeam === null,
    switchTeam,
    refreshTeams,
  };

  return (
    <TeamContext.Provider value={value}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam(): TeamContextValue {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeam must be used within TeamProvider');
  }
  return context;
}

function getAuthToken(): string {
  return localStorage.getItem('naap_auth_token') || '';
}
```

## 2.4 Create Unified Shell Context (For Plugins)

**File:** `apps/shell-web/src/context/ShellContext.tsx` (REWRITE)

```typescript
/**
 * Shell Context - The ONLY context plugins receive
 *
 * This is the stable API contract between shell and plugins.
 * Changes here are BREAKING CHANGES for all plugins.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useAuth, User } from './AuthContext';
import { useTeam, Team, TeamMember } from './TeamContext';
import { useNotifications } from './NotificationContext';
import { useTheme } from './ThemeContext';
import { getEventBus, EventBus } from '../services/EventBus';

// ===========================================
// SHELL CONTEXT INTERFACE (Plugin API)
// ===========================================

export interface ShellContext {
  // Version for compatibility checks
  readonly version: string;

  // User & Auth
  readonly user: User | null;
  readonly isAuthenticated: boolean;
  hasRole(role: string): boolean;
  hasPermission(permission: string): boolean;
  logout(): Promise<void>;

  // Team
  readonly team: Team | null;
  readonly teamMember: TeamMember | null;
  readonly isPersonalWorkspace: boolean;

  // Navigation
  navigate(path: string): void;

  // Notifications
  notify: {
    success(message: string, options?: NotifyOptions): void;
    error(message: string, options?: NotifyOptions): void;
    warning(message: string, options?: NotifyOptions): void;
    info(message: string, options?: NotifyOptions): void;
  };

  // Theme
  readonly theme: 'light' | 'dark';
  setTheme(theme: 'light' | 'dark'): void;

  // Events
  readonly events: EventBus;

  // API helpers
  api: {
    fetch(path: string, options?: RequestInit): Promise<Response>;
    getHeaders(): Record<string, string>;
  };
}

export interface NotifyOptions {
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// ===========================================
// IMPLEMENTATION
// ===========================================

const ShellContextInternal = createContext<ShellContext | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const teamCtx = useTeam();
  const notifications = useNotifications();
  const themeCtx = useTheme();
  const eventBus = useMemo(() => getEventBus(), []);

  const shell = useMemo<ShellContext>(() => ({
    version: '2.0.0',

    // User & Auth
    user: auth.user,
    isAuthenticated: auth.isAuthenticated,
    hasRole: auth.hasRole,
    hasPermission: auth.hasPermission,
    logout: auth.logout,

    // Team
    team: teamCtx.currentTeam,
    teamMember: teamCtx.currentMember,
    isPersonalWorkspace: teamCtx.isPersonalWorkspace,

    // Navigation
    navigate: (path: string) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },

    // Notifications
    notify: {
      success: (message, options) => notifications.show({ type: 'success', message, ...options }),
      error: (message, options) => notifications.show({ type: 'error', message, ...options }),
      warning: (message, options) => notifications.show({ type: 'warning', message, ...options }),
      info: (message, options) => notifications.show({ type: 'info', message, ...options }),
    },

    // Theme
    theme: themeCtx.theme,
    setTheme: themeCtx.setTheme,

    // Events
    events: eventBus,

    // API helpers
    api: {
      fetch: async (path: string, options: RequestInit = {}) => {
        const token = localStorage.getItem('naap_auth_token');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        };

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        if (teamCtx.currentTeam) {
          headers['X-Team-ID'] = teamCtx.currentTeam.id;
        }

        return fetch(path, { ...options, headers });
      },

      getHeaders: () => {
        const headers: Record<string, string> = {};
        const token = localStorage.getItem('naap_auth_token');

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        if (teamCtx.currentTeam) {
          headers['X-Team-ID'] = teamCtx.currentTeam.id;
        }

        return headers;
      },
    },
  }), [auth, teamCtx, notifications, themeCtx, eventBus]);

  return (
    <ShellContextInternal.Provider value={shell}>
      {children}
    </ShellContextInternal.Provider>
  );
}

export function useShell(): ShellContext {
  const context = useContext(ShellContextInternal);
  if (!context) {
    throw new Error('useShell must be used within ShellProvider');
  }
  return context;
}

// Export for WorkflowLoader
export { ShellContextInternal };
```

## 2.5 Simplified Event Bus

**File:** `apps/shell-web/src/services/EventBus.ts` (REWRITE)

```typescript
/**
 * Type-safe Event Bus
 *
 * ONE implementation, used everywhere.
 */

// Define ALL possible events here
export interface ShellEvents {
  // Auth events
  'auth:login': { userId: string };
  'auth:logout': void;

  // Team events
  'team:changed': { teamId: string | null };
  'team:created': { teamId: string; name: string };

  // Plugin events
  'plugin:installed': { pluginId: string; name: string };
  'plugin:uninstalled': { pluginId: string; name: string };
  'plugin:loaded': { name: string; loadTime: number };
  'plugin:error': { name: string; error: string };

  // Theme events
  'theme:changed': { theme: 'light' | 'dark' };

  // Custom events (plugins can emit these)
  [key: `custom:${string}`]: unknown;
}

export type EventName = keyof ShellEvents;

type EventCallback<T> = (data: T) => void;

export interface EventBus {
  emit<K extends EventName>(event: K, data: ShellEvents[K]): void;
  on<K extends EventName>(event: K, callback: EventCallback<ShellEvents[K]>): () => void;
  off<K extends EventName>(event: K, callback: EventCallback<ShellEvents[K]>): void;
  once<K extends EventName>(event: K, callback: EventCallback<ShellEvents[K]>): () => void;
}

class EventBusImpl implements EventBus {
  private listeners = new Map<string, Set<EventCallback<any>>>();

  emit<K extends EventName>(event: K, data: ShellEvents[K]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data);
        } catch (error) {
          console.error(`Event handler error for "${event}":`, error);
        }
      });
    }
  }

  on<K extends EventName>(event: K, callback: EventCallback<ShellEvents[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  off<K extends EventName>(event: K, callback: EventCallback<ShellEvents[K]>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  once<K extends EventName>(event: K, callback: EventCallback<ShellEvents[K]>): () => void {
    const wrapper = (data: ShellEvents[K]) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }
}

// Singleton
let instance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBusImpl();
  }
  return instance;
}

// For testing
export function resetEventBus(): void {
  instance = null;
}
```

---

# PHASE 3: Type System Consolidation

## 3.1 Single Source of Truth for Types

**File:** `packages/types/src/index.ts` (REWRITE)

```typescript
/**
 * @naap/types
 *
 * THE ONLY place types are defined.
 * All other packages import from here.
 */

// Core types
export * from './user';
export * from './team';
export * from './plugin';
export * from './events';
export * from './api';

// Re-export for convenience
export type { ShellContext } from './shell';
```

## 3.2 User Types

**File:** `packages/types/src/user.ts` (NEW)

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}
```

## 3.3 Team Types

**File:** `packages/types/src/team.ts` (NEW)

```typescript
export interface Team {
  id: string;
  name: string;
  slug: string;
  description?: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamMember {
  id: string;
  userId: string;
  teamId: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  expiresAt: string;
}
```

## 3.4 Plugin Types (Simplified)

**File:** `packages/types/src/plugin.ts` (REWRITE)

```typescript
/**
 * Plugin Type Definitions
 *
 * Keep it SIMPLE. A plugin is:
 * - A manifest (metadata)
 * - A mount function (entry point)
 * - Optional lifecycle hooks
 */

import type { ShellContext } from './shell';

// ===========================================
// PLUGIN MANIFEST
// ===========================================

export interface PluginManifest {
  // Identity
  name: string;           // kebab-case, unique
  displayName: string;
  version: string;        // semver
  description: string;

  // Author
  author: {
    name: string;
    email?: string;
    url?: string;
  };

  // Categories
  category: PluginCategory;
  keywords?: string[];

  // Shell requirements
  shell: {
    minVersion: string;
    maxVersion?: string;
  };

  // Frontend configuration
  frontend: {
    routes: string[];       // e.g., ['/dashboard', '/dashboard/*']
    entry: string;          // Path to remoteEntry.js
    navigation?: {
      label: string;
      icon: string;         // Lucide icon name
      order: number;
      group?: string;
    };
  };

  // Optional backend
  backend?: {
    entry: string;
    port: number;
    healthCheck: string;
    apiPrefix: string;
  };

  // Dependencies
  dependencies?: {
    plugins?: Record<string, string>;  // name -> version range
    integrations?: string[];           // required integrations
  };

  // Permissions required
  permissions?: PluginPermission[];

  // Configuration schema
  config?: {
    schema: Record<string, ConfigField>;
    defaults?: Record<string, unknown>;
  };
}

export type PluginCategory =
  | 'analytics'
  | 'monitoring'
  | 'infrastructure'
  | 'development'
  | 'productivity'
  | 'integration'
  | 'security'
  | 'other';

export type PluginPermission =
  | 'navigation'
  | 'notifications'
  | 'theme'
  | 'storage'
  | 'api'
  | 'secrets';

export interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: { label: string; value: string | number }[];  // for select
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

// ===========================================
// PLUGIN MODULE (What the plugin exports)
// ===========================================

export interface PluginModule {
  /**
   * Mount the plugin into the DOM
   * @param container - The DOM element to mount into
   * @param shell - The shell context with all APIs
   * @returns Cleanup function to call on unmount
   */
  mount(container: HTMLElement, shell: ShellContext): (() => void) | void;

  /**
   * Optional: Called before mount for any setup
   */
  init?(shell: ShellContext): Promise<void>;

  /**
   * Optional: Get plugin info at runtime
   */
  getManifest?(): PluginManifest;
}

// ===========================================
// PLUGIN STATUS
// ===========================================

export type PluginStatus =
  | 'available'       // In marketplace, not installed
  | 'installing'      // Currently being installed
  | 'installed'       // Installed, ready to use
  | 'enabled'         // Active for this user/team
  | 'disabled'        // Installed but disabled
  | 'error'           // Has an error
  | 'updating'        // Being updated
  | 'uninstalling';   // Being removed

export interface PluginHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'failed' | 'loading';
  loadTime?: number;
  lastError?: string;
  errorCount: number;
}

// ===========================================
// VALIDATION
// ===========================================

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// Validation constants (SINGLE SOURCE OF TRUTH)
export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const PLUGIN_NAME_MAX_LENGTH = 50;
export const PLUGIN_DISPLAY_NAME_MAX_LENGTH = 100;
export const PLUGIN_DESCRIPTION_MAX_LENGTH = 500;

export const VALID_CATEGORIES: PluginCategory[] = [
  'analytics',
  'monitoring',
  'infrastructure',
  'development',
  'productivity',
  'integration',
  'security',
  'other',
];

export const RESERVED_NAMES = [
  'shell',
  'core',
  'system',
  'admin',
  'api',
  'auth',
  'naap',
];

export const VALID_ICONS = [
  'Activity', 'BarChart', 'Box', 'Briefcase', 'Cloud', 'Code', 'Cog',
  'Cpu', 'Database', 'FileText', 'Folder', 'Globe', 'Grid', 'Home',
  'Key', 'Layers', 'Layout', 'LayoutDashboard', 'Link', 'Lock', 'Mail',
  'Map', 'Monitor', 'Package', 'PieChart', 'Play', 'Plug', 'Radio',
  'Server', 'Settings', 'Shield', 'ShoppingBag', 'Star', 'Terminal',
  'Tool', 'Upload', 'User', 'Users', 'Wallet', 'Zap',
];
```

## 3.5 Shell Context Type (For Plugins)

**File:** `packages/types/src/shell.ts` (NEW)

```typescript
import type { User } from './user';
import type { Team, TeamMember } from './team';
import type { ShellEvents } from './events';

/**
 * The Shell Context interface that plugins receive.
 * This is the stable API contract.
 */
export interface ShellContext {
  // Version
  readonly version: string;

  // User & Auth
  readonly user: User | null;
  readonly isAuthenticated: boolean;
  hasRole(role: string): boolean;
  hasPermission(permission: string): boolean;
  logout(): Promise<void>;

  // Team
  readonly team: Team | null;
  readonly teamMember: TeamMember | null;
  readonly isPersonalWorkspace: boolean;

  // Navigation
  navigate(path: string): void;

  // Notifications
  notify: {
    success(message: string, options?: NotifyOptions): void;
    error(message: string, options?: NotifyOptions): void;
    warning(message: string, options?: NotifyOptions): void;
    info(message: string, options?: NotifyOptions): void;
  };

  // Theme
  readonly theme: 'light' | 'dark';
  setTheme(theme: 'light' | 'dark'): void;

  // Events
  readonly events: EventBus<ShellEvents>;

  // API helpers
  api: {
    fetch(path: string, options?: RequestInit): Promise<Response>;
    getHeaders(): Record<string, string>;
  };
}

export interface NotifyOptions {
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface EventBus<Events extends Record<string, unknown>> {
  emit<K extends keyof Events>(event: K, data: Events[K]): void;
  on<K extends keyof Events>(event: K, callback: (data: Events[K]) => void): () => void;
  off<K extends keyof Events>(event: K, callback: (data: Events[K]) => void): void;
  once<K extends keyof Events>(event: K, callback: (data: Events[K]) => void): () => void;
}
```

---

# PHASE 4: SDK Simplification

## 4.1 New SDK Structure

```
packages/plugin-sdk/
├── src/
│   ├── index.ts           # Main exports
│   ├── hooks/
│   │   └── index.ts       # useShell only
│   ├── utils/
│   │   ├── validation.ts  # Manifest validation
│   │   └── testing.ts     # Test utilities
│   └── types.ts           # Re-export from @naap/types
├── package.json
└── README.md
```

## 4.2 SDK Main Entry

**File:** `packages/plugin-sdk/src/index.ts`

```typescript
/**
 * NAAP Plugin SDK
 *
 * Everything a plugin developer needs.
 */

// The only hook plugins need
export { useShell } from './hooks';

// Types (re-exported from @naap/types)
export type {
  ShellContext,
  PluginManifest,
  PluginModule,
  PluginCategory,
  PluginPermission,
  User,
  Team,
  TeamMember,
  NotifyOptions,
} from '@naap/types';

// Utilities
export { validateManifest, createManifest } from './utils/validation';
export { createTestShell, createTestPlugin } from './utils/testing';

// Constants
export {
  PLUGIN_NAME_PATTERN,
  VALID_CATEGORIES,
  VALID_ICONS,
  RESERVED_NAMES,
} from '@naap/types';
```

## 4.3 Single Hook

**File:** `packages/plugin-sdk/src/hooks/index.ts`

```typescript
import { useContext, createContext } from 'react';
import type { ShellContext } from '@naap/types';

// Context provided by shell
const ShellContext = createContext<ShellContext | null>(null);

/**
 * The ONLY hook plugins need.
 * Returns the shell context with all APIs.
 *
 * @example
 * ```tsx
 * function MyPlugin() {
 *   const shell = useShell();
 *
 *   return (
 *     <div>
 *       <h1>Hello, {shell.user?.name}</h1>
 *       <button onClick={() => shell.notify.success('Clicked!')}>
 *         Click me
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useShell(): ShellContext {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error(
      'useShell must be used within a plugin mounted by the shell. ' +
      'If you are testing, use createTestShell() from @naap/plugin-sdk'
    );
  }
  return context;
}

// Export context for shell to use
export { ShellContext };
```

## 4.4 Validation Utility

**File:** `packages/plugin-sdk/src/utils/validation.ts`

```typescript
import type { PluginManifest, ValidationResult, ValidationError } from '@naap/types';
import {
  PLUGIN_NAME_PATTERN,
  PLUGIN_NAME_MAX_LENGTH,
  VALID_CATEGORIES,
  VALID_ICONS,
  RESERVED_NAMES,
} from '@naap/types';

/**
 * Validate a plugin manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'manifest', message: 'Manifest must be an object', severity: 'error' }],
      warnings: [],
    };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.name || typeof m.name !== 'string') {
    errors.push({ field: 'name', message: 'Name is required', severity: 'error' });
  } else {
    if (!PLUGIN_NAME_PATTERN.test(m.name)) {
      errors.push({ field: 'name', message: 'Name must be kebab-case (e.g., my-plugin)', severity: 'error' });
    }
    if (m.name.length > PLUGIN_NAME_MAX_LENGTH) {
      errors.push({ field: 'name', message: `Name must be ${PLUGIN_NAME_MAX_LENGTH} characters or less`, severity: 'error' });
    }
    if (RESERVED_NAMES.includes(m.name)) {
      errors.push({ field: 'name', message: `"${m.name}" is a reserved name`, severity: 'error' });
    }
  }

  if (!m.displayName || typeof m.displayName !== 'string') {
    errors.push({ field: 'displayName', message: 'Display name is required', severity: 'error' });
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push({ field: 'version', message: 'Version is required', severity: 'error' });
  } else if (!/^\d+\.\d+\.\d+/.test(m.version)) {
    errors.push({ field: 'version', message: 'Version must be semver (e.g., 1.0.0)', severity: 'error' });
  }

  if (!m.category || !VALID_CATEGORIES.includes(m.category as any)) {
    errors.push({ field: 'category', message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}`, severity: 'error' });
  }

  // Frontend validation
  const frontend = m.frontend as Record<string, unknown> | undefined;
  if (!frontend) {
    errors.push({ field: 'frontend', message: 'Frontend configuration is required', severity: 'error' });
  } else {
    if (!frontend.routes || !Array.isArray(frontend.routes) || frontend.routes.length === 0) {
      errors.push({ field: 'frontend.routes', message: 'At least one route is required', severity: 'error' });
    }
    if (!frontend.entry || typeof frontend.entry !== 'string') {
      errors.push({ field: 'frontend.entry', message: 'Frontend entry point is required', severity: 'error' });
    }

    const nav = frontend.navigation as Record<string, unknown> | undefined;
    if (nav?.icon && !VALID_ICONS.includes(nav.icon as string)) {
      warnings.push({ field: 'frontend.navigation.icon', message: `Unknown icon "${nav.icon}"`, severity: 'warning' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create a minimal valid manifest
 */
export function createManifest(overrides: Partial<PluginManifest>): PluginManifest {
  return {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
    description: 'A NAAP plugin',
    author: { name: 'Developer' },
    category: 'other',
    shell: { minVersion: '2.0.0' },
    frontend: {
      routes: ['/my-plugin'],
      entry: './dist/remoteEntry.js',
    },
    ...overrides,
  };
}
```

## 4.5 Testing Utilities

**File:** `packages/plugin-sdk/src/utils/testing.ts`

```typescript
import type { ShellContext, User, Team } from '@naap/types';

/**
 * Create a mock shell context for testing
 */
export function createTestShell(overrides: Partial<ShellContext> = {}): ShellContext {
  const events = createMockEventBus();

  return {
    version: '2.0.0',
    user: null,
    isAuthenticated: false,
    hasRole: () => false,
    hasPermission: () => false,
    logout: async () => {},
    team: null,
    teamMember: null,
    isPersonalWorkspace: true,
    navigate: jest.fn(),
    notify: {
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      info: jest.fn(),
    },
    theme: 'dark',
    setTheme: jest.fn(),
    events,
    api: {
      fetch: jest.fn().mockResolvedValue(new Response()),
      getHeaders: () => ({}),
    },
    ...overrides,
  };
}

/**
 * Create a mock shell with an authenticated user
 */
export function createAuthenticatedShell(user: Partial<User> = {}): ShellContext {
  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['user'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...user,
  };

  return createTestShell({
    user: mockUser,
    isAuthenticated: true,
    hasRole: (role) => mockUser.roles.includes(role),
  });
}

/**
 * Create a mock shell with team context
 */
export function createTeamShell(team: Partial<Team> = {}): ShellContext {
  const mockTeam: Team = {
    id: 'team-1',
    name: 'Test Team',
    slug: 'test-team',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...team,
  };

  return createAuthenticatedShell({
    team: mockTeam,
    isPersonalWorkspace: false,
  } as any);
}

function createMockEventBus() {
  const listeners = new Map<string, Set<Function>>();

  return {
    emit: jest.fn((event, data) => {
      listeners.get(event)?.forEach(cb => cb(data));
    }),
    on: jest.fn((event, callback) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
      return () => listeners.get(event)?.delete(callback);
    }),
    off: jest.fn((event, callback) => {
      listeners.get(event)?.delete(callback);
    }),
    once: jest.fn((event, callback) => {
      const wrapper = (data: unknown) => {
        listeners.get(event)?.delete(wrapper);
        callback(data);
      };
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(wrapper);
      return () => listeners.get(event)?.delete(wrapper);
    }),
  };
}

/**
 * Helper to wrap a plugin component for testing
 */
export function createTestPlugin(
  Component: React.ComponentType,
  shell: ShellContext = createTestShell()
) {
  const { ShellContext } = require('../hooks');
  const React = require('react');

  return function TestWrapper() {
    return React.createElement(
      ShellContext.Provider,
      { value: shell },
      React.createElement(Component)
    );
  };
}
```

---

# PHASE 5: Backend Cleanup

## 5.1 Split Monolithic Server

**New Structure:**
```
services/base-svc/src/
├── server.ts              # Minimal bootstrap only
├── app.ts                 # Express app configuration
├── routes/
│   ├── index.ts           # Route aggregator
│   ├── auth.ts            # /api/v1/base/auth/*
│   ├── users.ts           # /api/v1/base/users/*
│   ├── teams.ts           # /api/v1/base/teams/*
│   ├── plugins.ts         # /api/v1/base/plugins/*
│   └── admin.ts           # /api/v1/base/admin/*
├── middleware/
│   ├── index.ts
│   ├── auth.ts
│   ├── validation.ts
│   ├── error-handler.ts
│   ├── request-id.ts
│   └── rate-limit.ts
├── services/              # Business logic (existing)
├── validators/            # Request validation schemas
│   ├── auth.ts
│   ├── team.ts
│   └── plugin.ts
└── db/                    # Database (existing)
```

## 5.2 Request Validation with Zod

**File:** `services/base-svc/src/validators/team.ts`

```typescript
import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(50),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
```

## 5.3 Validation Middleware

**File:** `services/base-svc/src/middleware/validation.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
}
```

## 5.4 Unified Error Handler

**File:** `services/base-svc/src/middleware/error-handler.ts`

```typescript
import { Request, Response, NextFunction } from 'express';

// Error types
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

// Error handler middleware
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log error with request ID
  console.error(`[${req.id}] Error:`, error);

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      requestId: req.id,
    });
  }

  // Don't leak internal errors
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    requestId: req.id,
  });
}
```

## 5.5 Redis Rate Limiting

**File:** `services/base-svc/src/middleware/rate-limit.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export function rateLimit(config: RateLimitConfig) {
  const { windowMs, max, keyPrefix = 'rl' } = config;
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.user?.id || req.ip;
    const key = `${keyPrefix}:${identifier}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, windowSec);
      }

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later',
          },
        });
      }

      next();
    } catch (error) {
      // On Redis failure, allow request but log
      console.error('Rate limit error:', error);
      next();
    }
  };
}

// Presets
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,
  keyPrefix: 'rl:api',
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  keyPrefix: 'rl:auth',
});
```

## 5.6 Database Enum Constraints

**File:** `services/base-svc/prisma/schema.prisma` (additions)

```prisma
// Add enums for type safety
enum TeamRole {
  owner
  admin
  member
  viewer
}

enum PluginStatus {
  available
  installing
  installed
  enabled
  disabled
  error
  updating
  uninstalling
}

enum DeploymentStatus {
  pending
  deploying
  running
  failed
  stopped
}

// Update models to use enums
model TeamMember {
  id        String   @id @default(uuid())
  teamId    String
  userId    String
  role      TeamRole @default(member)  // Now type-safe!
  joinedAt  DateTime @default(now())

  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, teamId])
}

model PluginInstallation {
  id        String       @id @default(uuid())
  packageId String
  status    PluginStatus @default(installed)  // Now type-safe!

  // ... rest of fields
}
```

---

# PHASE 6: Plugin Interface Polish

## 6.1 Simplified WorkflowLoader

**File:** `apps/shell-web/src/components/WorkflowLoader.tsx` (REWRITE)

```typescript
/**
 * WorkflowLoader - Loads and mounts plugins
 *
 * Simplified to just:
 * 1. Load the remote module
 * 2. Call mount() with shell context
 * 3. Handle errors
 */

import React, { useEffect, useRef, useState } from 'react';
import { useShell } from '../context/ShellContext';
import { usePlugins } from '../context/PluginContext';
import { loadRemoteModule } from '../utils/moduleLoader';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import type { PluginModule } from '@naap/types';

interface WorkflowLoaderProps {
  pluginName: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'error'; message: string };

export function WorkflowLoader({ pluginName }: WorkflowLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const unmountRef = useRef<(() => void) | null>(null);
  const shell = useShell();
  const { plugins } = usePlugins();

  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const plugin = plugins.find(p => p.name === pluginName);

  useEffect(() => {
    if (!plugin || !containerRef.current) return;

    let mounted = true;

    async function load() {
      setState({ status: 'loading' });

      try {
        const module = await loadRemoteModule(plugin.name, plugin.remoteUrl) as PluginModule;

        if (!mounted) return;

        // Optional init hook
        if (module.init) {
          await module.init(shell);
        }

        if (!mounted) return;

        // Mount the plugin
        const cleanup = module.mount(containerRef.current!, shell);
        if (typeof cleanup === 'function') {
          unmountRef.current = cleanup;
        }

        setState({ status: 'loaded' });

        shell.events.emit('plugin:loaded', {
          name: plugin.name,
          loadTime: performance.now(),
        });

      } catch (error) {
        if (!mounted) return;

        const message = error instanceof Error ? error.message : 'Failed to load plugin';
        setState({ status: 'error', message });

        shell.events.emit('plugin:error', {
          name: plugin.name,
          error: message,
        });
      }
    }

    load();

    return () => {
      mounted = false;
      if (unmountRef.current) {
        unmountRef.current();
        unmountRef.current = null;
      }
    };
  }, [plugin, shell]);

  if (!plugin) {
    return (
      <ErrorState
        title="Plugin Not Found"
        message={`Plugin "${pluginName}" is not installed or not available.`}
      />
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Plugin Error"
        message={state.message}
        onRetry={() => setState({ status: 'loading' })}
      />
    );
  }

  return (
    <div className="relative min-h-[400px]">
      {state.status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg-primary/80 z-10">
          <Loader2 className="w-8 h-8 animate-spin text-accent-blue" />
          <p className="text-text-secondary text-sm">
            Loading {plugin.displayName}...
          </p>
        </div>
      )}
      <div ref={containerRef} className="plugin-container" />
    </div>
  );
}

function ErrorState({
  title,
  message,
  onRetry
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-8">
      <div className="w-16 h-16 rounded-full bg-accent-amber/10 flex items-center justify-center">
        <AlertTriangle size={32} className="text-accent-amber" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-text-primary mb-2">{title}</h3>
        <p className="text-text-secondary text-sm max-w-md">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-xl text-sm font-bold hover:bg-accent-blue/90 transition-all"
        >
          <RefreshCw size={16} />
          Retry
        </button>
      )}
    </div>
  );
}
```

## 6.2 Plugin Template

**File:** `templates/plugin/src/App.tsx`

```typescript
/**
 * Example NAAP Plugin
 *
 * This is a minimal example showing the plugin API.
 */

import React from 'react';
import { useShell } from '@naap/plugin-sdk';

export default function App() {
  const shell = useShell();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">
        Hello, {shell.user?.name || 'Guest'}!
      </h1>

      <div className="space-y-4">
        {/* Show notifications */}
        <button
          onClick={() => shell.notify.success('It works!')}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Show Success
        </button>

        {/* Navigate */}
        <button
          onClick={() => shell.navigate('/settings')}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Go to Settings
        </button>

        {/* API call */}
        <button
          onClick={async () => {
            const res = await shell.api.fetch('/api/v1/base/user/profile');
            const data = await res.json();
            console.log('Profile:', data);
          }}
          className="px-4 py-2 bg-purple-500 text-white rounded"
        >
          Fetch Profile
        </button>

        {/* Theme */}
        <button
          onClick={() => shell.setTheme(shell.theme === 'dark' ? 'light' : 'dark')}
          className="px-4 py-2 bg-gray-500 text-white rounded"
        >
          Toggle Theme (current: {shell.theme})
        </button>
      </div>

      {/* Team info */}
      {shell.team && (
        <div className="mt-6 p-4 bg-gray-100 dark:bg-gray-800 rounded">
          <h2 className="font-bold">Current Team</h2>
          <p>{shell.team.name}</p>
        </div>
      )}
    </div>
  );
}
```

## 6.3 Plugin Entry Point

**File:** `templates/plugin/src/index.ts`

```typescript
import type { PluginModule, ShellContext } from '@naap/plugin-sdk';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ShellContext as ShellProvider } from '@naap/plugin-sdk';

let root: ReturnType<typeof createRoot> | null = null;

const plugin: PluginModule = {
  mount(container: HTMLElement, shell: ShellContext) {
    root = createRoot(container);
    root.render(
      React.createElement(
        ShellProvider.Provider,
        { value: shell },
        React.createElement(App)
      )
    );

    return () => {
      root?.unmount();
      root = null;
    };
  },
};

export default plugin;
```

---

# PHASE 7: Testing & Documentation

## 7.1 Test Coverage Requirements

| Area | Target Coverage |
|------|-----------------|
| Auth Context | 90% |
| Team Context | 90% |
| Shell Context | 85% |
| Plugin SDK | 90% |
| WorkflowLoader | 85% |
| Backend Routes | 80% |
| Backend Services | 80% |

## 7.2 Documentation Structure

```
docs/
├── getting-started/
│   ├── installation.md
│   ├── first-plugin.md
│   └── deployment.md
├── guides/
│   ├── plugin-development.md
│   ├── shell-api.md
│   ├── testing.md
│   └── best-practices.md
├── api-reference/
│   ├── shell-context.md
│   ├── plugin-manifest.md
│   ├── events.md
│   └── rest-api.md
└── architecture/
    ├── overview.md
    ├── security.md
    └── scaling.md
```

## 7.3 API Reference Example

**File:** `docs/api-reference/shell-context.md`

```markdown
# Shell Context API

The `ShellContext` is passed to every plugin and provides access to all shell functionality.

## Getting the Context

```tsx
import { useShell } from '@naap/plugin-sdk';

function MyComponent() {
  const shell = useShell();
  // ...
}
```

## Properties

### `version`
- Type: `string`
- Description: Shell version for compatibility checks

### `user`
- Type: `User | null`
- Description: Current authenticated user, or null if not logged in

### `isAuthenticated`
- Type: `boolean`
- Description: Whether a user is logged in

### `team`
- Type: `Team | null`
- Description: Current team context, or null for personal workspace

## Methods

### `hasRole(role: string): boolean`
Check if the user has a specific role.

```tsx
if (shell.hasRole('admin')) {
  // Show admin features
}
```

### `navigate(path: string): void`
Navigate to a different route.

```tsx
shell.navigate('/settings');
```

### `notify.success(message: string, options?: NotifyOptions): void`
Show a success notification.

```tsx
shell.notify.success('Changes saved!');
shell.notify.success('Created!', {
  duration: 5000,
  action: {
    label: 'View',
    onClick: () => shell.navigate('/items/123'),
  },
});
```

## Events

### Subscribing to Events

```tsx
useEffect(() => {
  const unsubscribe = shell.events.on('team:changed', (data) => {
    console.log('Team changed to:', data.teamId);
  });

  return unsubscribe;
}, [shell.events]);
```

### Available Events

| Event | Data | Description |
|-------|------|-------------|
| `auth:login` | `{ userId }` | User logged in |
| `auth:logout` | `void` | User logged out |
| `team:changed` | `{ teamId }` | Team context changed |
| `plugin:installed` | `{ pluginId, name }` | Plugin installed |
| `theme:changed` | `{ theme }` | Theme changed |
```

---

# Migration Checklist

## Before Starting
- [ ] Create feature branch: `git checkout -b refactor/production-ready`
- [ ] Backup database
- [ ] Notify team of breaking changes

## Phase 1: Security
- [ ] Fix path traversal in plugin-server
- [ ] Upgrade password hashing
- [ ] Remove secrets from headers
- [ ] Fix plugin permission query
- [ ] Add CORS restrictions
- [ ] Add security headers

## Phase 2: Context
- [ ] Delete V1 context files
- [ ] Implement unified AuthContext
- [ ] Implement unified TeamContext
- [ ] Implement unified ShellContext
- [ ] Update App.tsx provider tree
- [ ] Test auth flow end-to-end
- [ ] Test team switching

## Phase 3: Types
- [ ] Create @naap/types structure
- [ ] Move all types to single package
- [ ] Update imports across codebase
- [ ] Run TypeScript compilation
- [ ] Fix any type errors

## Phase 4: SDK
- [ ] Simplify SDK structure
- [ ] Export only necessary APIs
- [ ] Create testing utilities
- [ ] Update SDK documentation
- [ ] Test with example plugin

## Phase 5: Backend
- [ ] Split server.ts
- [ ] Add request validation (Zod)
- [ ] Implement error handler
- [ ] Add Redis rate limiting
- [ ] Update Prisma enums
- [ ] Run all backend tests

## Phase 6: Polish
- [ ] Simplify WorkflowLoader
- [ ] Update all existing plugins
- [ ] Create plugin template
- [ ] Test all plugins load correctly

## Phase 7: Documentation
- [ ] Write getting started guide
- [ ] Write API reference
- [ ] Write migration guide
- [ ] Update README files
- [ ] Create CHANGELOG

## Final
- [ ] Run full test suite
- [ ] Performance test (load 10 plugins)
- [ ] Security audit
- [ ] Create release PR
- [ ] Deploy to staging
- [ ] Deploy to production

---

# Success Criteria

The refactoring is complete when:

1. **Security**: All CRITICAL vulnerabilities fixed, security headers in place
2. **Simplicity**: Plugin developers only need `useShell()` hook
3. **Consistency**: Single type definitions, single event bus, single auth system
4. **Performance**: Page load < 2s, plugin load < 500ms
5. **Reliability**: 90%+ test coverage on critical paths
6. **Documentation**: Complete API docs, getting started guide, examples

---

*This plan represents a comprehensive overhaul. Execute phases sequentially, with code review between each phase.*
