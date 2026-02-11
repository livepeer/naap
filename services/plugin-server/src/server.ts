/**
 * Plugin Asset Server
 *
 * Serves all plugin frontend assets from a single server.
 * This eliminates the need to run 10+ individual dev servers.
 *
 * URL Pattern:
 *   /plugins/{plugin-name}/{any-asset}
 *
 * Maps to:
 *   /plugins/{plugin-name}/frontend/dist/{any-asset}
 * 
 * Authentication:
 *   - Public plugins are accessible without authentication
 *   - Private plugins require a valid Bearer token
 *   - In development mode, authentication can be bypassed
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ============================================
// Authentication Configuration
// ============================================

interface AuthenticatedRequest extends Request {
  userId?: string;
  isAuthenticated?: boolean;
}

// Base service URL for token validation
const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';

// Skip authentication in development mode unless explicitly required
const REQUIRE_AUTH = process.env.REQUIRE_PLUGIN_AUTH === 'true';

// Public plugins that don't require authentication
const PUBLIC_PLUGINS = new Set<string>();

/**
 * Load public plugins from manifest or configuration
 */
function loadPublicPlugins(pluginsDir: string): void {
  try {
    const plugins = fs.readdirSync(pluginsDir)
      .filter(name => fs.statSync(path.join(pluginsDir, name)).isDirectory());
    
    for (const name of plugins) {
      const manifestPath = path.join(pluginsDir, name, 'plugin.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          // Mark as public if manifest says so or if it's a core plugin
          if (manifest.public === true || manifest.visibility === 'public') {
            PUBLIC_PLUGINS.add(name);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Verify authentication token with base service
 */
async function verifyToken(token: string): Promise<{ valid: boolean; userId?: string; error?: string }> {
  try {
    const response = await fetch(`${BASE_SVC_URL}/api/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { valid: false, error: `Token validation failed: ${response.status}` };
    }

    const data = await response.json();
    return { valid: true, userId: data.userId };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Token validation failed' 
    };
  }
}

/**
 * Check if user has access to a specific plugin
 */
async function checkPluginAccess(userId: string, pluginName: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${BASE_SVC_URL}/api/v1/base/plugins/${pluginName}/access?userId=${userId}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.hasAccess === true;
  } catch {
    // In case of error, allow access in development, deny in production
    return process.env.NODE_ENV !== 'production';
  }
}

/**
 * Authentication middleware for plugin assets
 */
function authMiddleware(pluginsDir: string) {
  // Load public plugins on startup
  loadPublicPlugins(pluginsDir);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const pluginName = req.params.pluginName;

    // Skip auth for health check and plugin listing
    if (!pluginName) {
      return next();
    }

    // Skip auth for public plugins
    if (PUBLIC_PLUGINS.has(pluginName)) {
      req.isAuthenticated = false;
      return next();
    }

    // Skip auth in development if not required
    if (!REQUIRE_AUTH && process.env.NODE_ENV !== 'production') {
      req.isAuthenticated = false;
      return next();
    }

    // Check for Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid Bearer token',
      });
    }

    const token = authHeader.substring(7);

    // Verify token
    const verification = await verifyToken(token);
    if (!verification.valid) {
      return res.status(401).json({
        error: 'Invalid token',
        message: verification.error || 'Token verification failed',
      });
    }

    req.userId = verification.userId;
    req.isAuthenticated = true;

    // Check plugin access
    if (verification.userId) {
      const hasAccess = await checkPluginAccess(verification.userId, pluginName);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: `You do not have access to plugin: ${pluginName}`,
        });
      }
    }

    next();
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PLUGIN_SERVER_PORT || 3100;

// Root directory of the monorepo
const ROOT_DIR = path.resolve(__dirname, '../../..');
const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins');

// CORS configuration - validate origins against allowlist
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (CORS_ALLOWED_ORIGINS.length === 0 || CORS_ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Permissions Policy headers - allow camera/microphone for plugins that need them
// NOTE: Do NOT set Permissions-Policy header here - let the browser default handle it
// Setting it explicitly can sometimes cause issues with cross-origin iframes
// The parent page's iframe allow attribute controls delegation

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${sanitizeForLog(req.method)} ${sanitizeForLog(req.path)}`);
    next();
  });
}

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'plugin-server',
    version: '0.0.1',
    timestamp: new Date().toISOString(),
  });
});

// List available plugins
app.get('/plugins', (_req: Request, res: Response) => {
  try {
    const plugins = fs.readdirSync(PLUGINS_DIR)
      .filter(name => {
        const pluginPath = path.join(PLUGINS_DIR, name);
        return fs.statSync(pluginPath).isDirectory();
      })
      .map(name => {
        const distPath = path.join(PLUGINS_DIR, name, 'frontend', 'dist');
        const assetsPath = path.join(distPath, 'assets');
        const productionDir = path.join(distPath, 'production');
        const hasBuild = fs.existsSync(productionDir) && fs.readdirSync(productionDir).some(f => f.endsWith('.js'));

        // Read plugin.json if available
        let manifest = null;
        const manifestPath = path.join(PLUGINS_DIR, name, 'plugin.json');
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          } catch {
            // Ignore parse errors
          }
        }

        return {
          name,
          displayName: manifest?.displayName || name,
          version: manifest?.version || 'unknown',
          built: hasBuild,
          bundleUrl: hasBuild
            ? `/cdn/plugins/${name}/1.0.0/${name}.js`
            : null,
        };
      });

    res.json({
      count: plugins.length,
      built: plugins.filter(p => p.built).length,
      plugins,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list plugins' });
  }
});

// Apply authentication middleware to plugin routes
app.use('/plugins/:pluginName', authMiddleware(PLUGINS_DIR));

// Special handler for index.html - rewrites asset paths to work from nested path
app.get('/plugins/:pluginName/index.html', (req: AuthenticatedRequest, res: Response) => {
  const pluginName = req.params.pluginName;
  const pluginDistPath = path.join(PLUGINS_DIR, pluginName, 'frontend', 'dist');
  const indexPath = path.join(pluginDistPath, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return res.status(404).json({
      error: 'Plugin not found',
      plugin: pluginName,
      message: `No index.html found at ${indexPath}`,
    });
  }

  // Read and rewrite the index.html to use correct base path
  let html = fs.readFileSync(indexPath, 'utf-8');
  
  // Rewrite asset paths from /assets/* to /plugins/{pluginName}/assets/*
  // This handles both src and href attributes
  const basePath = `/plugins/${pluginName}`;
  html = html.replace(/src="\/assets\//g, `src="${basePath}/assets/`);
  html = html.replace(/href="\/assets\//g, `href="${basePath}/assets/`);
  html = html.replace(/src='\/assets\//g, `src='${basePath}/assets/`);
  html = html.replace(/href='\/assets\//g, `href='${basePath}/assets/`);
  
  // Also handle vite.svg or other root-level assets
  html = html.replace(/href="\/vite\.svg"/g, `href="${basePath}/vite.svg"`);
  html = html.replace(/href='\/vite\.svg'/g, `href='${basePath}/vite.svg'`);

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Serve plugin assets
// Route: /plugins/:pluginName/* -> plugins/:pluginName/frontend/dist/*
app.use('/plugins/:pluginName', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const pluginName = req.params.pluginName;
  const pluginDistPath = path.join(PLUGINS_DIR, pluginName, 'frontend', 'dist');

  // Check if plugin exists
  if (!fs.existsSync(pluginDistPath)) {
    return res.status(404).json({
      error: 'Plugin not found',
      plugin: pluginName,
      message: `No built frontend found at ${pluginDistPath}`,
    });
  }

  // Set correct MIME types for JavaScript modules
  const requestedPath = req.path;
  if (requestedPath.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript');
  } else if (requestedPath.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css');
  }

  // Serve static files from the plugin's dist directory
  express.static(pluginDistPath, {
    // Enable caching in production
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    // Set correct headers for ES modules
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      }
    },
  })(req, res, next);
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested resource was not found',
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Plugin server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🔌 Plugin Asset Server running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   Plugins: http://localhost:${PORT}/plugins`);
  console.log(`   Assets: http://localhost:${PORT}/plugins/{name}/production/{name}.js`);
  console.log(`   Serving from: ${PLUGINS_DIR}`);

  // List available plugins
  try {
    const plugins = fs.readdirSync(PLUGINS_DIR)
      .filter(name => fs.statSync(path.join(PLUGINS_DIR, name)).isDirectory());

    const builtPlugins = plugins.filter(name => {
      const productionDir = path.join(PLUGINS_DIR, name, 'frontend', 'dist', 'production');
      return fs.existsSync(productionDir) && fs.readdirSync(productionDir).some(f => f.endsWith('.js'));
    });

    console.log(`   Found ${plugins.length} plugins (${builtPlugins.length} built)`);
    if (builtPlugins.length < plugins.length) {
      const notBuilt = plugins.filter(p => !builtPlugins.includes(p));
      console.log(`   Not built: ${notBuilt.join(', ')}`);
    }
  } catch {
    // Ignore errors listing plugins
  }
});
