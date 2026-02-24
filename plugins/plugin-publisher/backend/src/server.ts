import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
// @ts-ignore
import unzipper from 'unzipper';
import {
  testPlugin,
  testFrontendLoading,
  testBackendHealth,
} from './services/pluginTester.js';
import { createAuthMiddleware } from '@naap/plugin-server-sdk';

/**
 * Sanitize a path component to prevent path traversal attacks.
 * Removes path separators and parent directory references.
 */
function sanitizePathComponent(component: string): string {
  // Remove any path traversal sequences and separators
  const sanitized = component.replace(/\.\./g, '').replace(/[\/\\]/g, '');
  if (!sanitized || sanitized !== component) {
    throw new Error(`Invalid path component: ${component}`);
  }
  return sanitized;
}

/**
 * Validate that a file path is within the expected base directory.
 * Prevents path traversal attacks on multer-generated file paths.
 */
function validateFilePath(filePath: string, baseDir: string): string {
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port Configuration - Reads from plugin.json (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const PLUGIN_NAME = 'plugin-publisher';

const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4010;
const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : './uploads');
const STATIC_DIR = process.env.STATIC_DIR || (process.env.VERCEL ? '/tmp/static' : './static');
const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';
const PLUGIN_PUBLISHER_URL = process.env.PLUGIN_PUBLISHER_URL || `http://localhost:${PORT}`;

// Vercel Blob configuration
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const USE_CDN_UPLOAD = process.env.USE_CDN_UPLOAD === 'true' || !!BLOB_READ_WRITE_TOKEN;

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(STATIC_DIR, { recursive: true });
}
ensureDirectories();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));
// CORS - allowlist when set; empty = allow-all (relaxed for now)
// TODO(#92): Fail closed when empty; set CORS_ALLOWED_ORIGINS for production
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (CORS_ALLOWED_ORIGINS.length === 0 || CORS_ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(morgan('combined'));
app.use(createAuthMiddleware({
  publicPaths: ['/healthz', '/static'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Static file serving for uploaded plugins with CORS headers
app.use('/static', (req, res, next) => {
  // Ensure CORS headers for all static assets
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(STATIC_DIR));

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'plugin-publisher' });
});

// ============================================
// Validation Endpoint
// ============================================

interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push({ path: '', message: 'Manifest must be an object', value: manifest });
    return { valid: false, errors, warnings };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.name || typeof m.name !== 'string') {
    errors.push({ path: 'name', message: 'name is required and must be a string' });
  } else if (!KEBAB_CASE_REGEX.test(m.name)) {
    errors.push({ path: 'name', message: 'name must be kebab-case (e.g., "my-plugin")', value: m.name });
  }

  if (!m.displayName || typeof m.displayName !== 'string') {
    errors.push({ path: 'displayName', message: 'displayName is required and must be a string' });
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push({ path: 'version', message: 'version is required and must be a string' });
  } else if (!SEMVER_REGEX.test(m.version)) {
    errors.push({ path: 'version', message: 'version must be valid semver (e.g., "1.0.0")', value: m.version });
  }

  // Validate frontend if present
  if (m.frontend && typeof m.frontend === 'object') {
    const frontend = m.frontend as Record<string, unknown>;
    // Accept entry, devEntry, or UMD production bundle (bundleUrl/globalName)
    if (!frontend.entry && !frontend.devEntry && !frontend.bundleUrl && !frontend.globalName) {
      errors.push({ path: 'frontend.entry', message: 'frontend.entry, frontend.devEntry, or frontend.bundleUrl/globalName is required' });
    }
    if (!frontend.routes || !Array.isArray(frontend.routes) || frontend.routes.length === 0) {
      errors.push({ path: 'frontend.routes', message: 'frontend.routes must be a non-empty array' });
    }
  }

  // Validate backend if present
  if (m.backend && typeof m.backend === 'object') {
    const backend = m.backend as Record<string, unknown>;
    if (!backend.entry && !backend.devEntry) {
      errors.push({ path: 'backend.entry', message: 'backend.entry or backend.devEntry is required' });
    }
  }

  // Must have either frontend or backend
  if (!m.frontend && !m.backend) {
    errors.push({ path: '', message: 'Plugin must have at least a frontend or backend configuration' });
  }

  // Warnings for missing optional fields
  if (!m.description) {
    warnings.push({ path: 'description', message: 'description is recommended for marketplace listing' });
  }
  if (!m.author) {
    warnings.push({ path: 'author', message: 'author information is recommended' });
  }
  if (!m.license) {
    warnings.push({ path: 'license', message: 'license is recommended', suggestion: 'Consider adding "MIT" or another appropriate license' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

app.post('/api/v1/plugin-publisher/validate', (req, res) => {
  try {
    const { manifest } = req.body;
    
    if (!manifest) {
      return res.status(400).json({ error: 'manifest is required' });
    }

    const result = validateManifest(manifest);
    res.json(result);
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
});

// ============================================
// Upload Endpoint
// ============================================

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

app.post('/api/v1/plugin-publisher/upload', upload.single('plugin'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const extractDir = path.join(UPLOAD_DIR, uploadId);
    
    // Extract zip
    await fs.mkdir(extractDir, { recursive: true });
    
    const safeUploadPath = validateFilePath(req.file!.path, UPLOAD_DIR);

    await new Promise((resolve, reject) => {
      createReadStream(safeUploadPath) // lgtm[js/path-injection] validated by validateFilePath
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    // Clean up original zip
    await fs.unlink(safeUploadPath); // lgtm[js/path-injection] validated by validateFilePath

    // Find and read plugin.json
    let manifest: Record<string, unknown> | null = null;
    const manifestPath = path.join(extractDir, 'plugin.json');
    
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch {
      // Try looking in a subdirectory (common when zipping a folder)
      const entries = await fs.readdir(extractDir);
      for (const entry of entries) {
        const subPath = path.join(extractDir, entry, 'plugin.json');
        try {
          const manifestContent = await fs.readFile(subPath, 'utf-8');
          manifest = JSON.parse(manifestContent);
          break;
        } catch {
          // Continue searching
        }
      }
    }

    if (!manifest) {
      await fs.rm(extractDir, { recursive: true });
      return res.status(400).json({ error: 'plugin.json not found in uploaded archive' });
    }

    // Copy directory helper
    async function copyDir(src: string, dest: string) {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });
      
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }

    // Detect deployment type and find entry point
    let frontendUrl: string | undefined;
    let deploymentType: 'cdn' | undefined;
    let umdManifest: Record<string, unknown> | undefined;
    
    const searchDirs = [
      path.join(extractDir, 'frontend', 'dist'),
      path.join(extractDir, 'dist'),
      extractDir,
    ];

    const pluginName = (manifest as Record<string, unknown>).name as string;

    // 1. Try to find UMD production bundle first (preferred)
    const umdSearchDirs = [
      ...searchDirs.map(d => path.join(d, 'production')),
      ...searchDirs,
    ];

    for (const dir of umdSearchDirs) {
      try {
        const files = await fs.readdir(dir);
        
        // Look for UMD bundle (pluginName.hash.js pattern or manifest.json)
        const manifestFile = files.find(f => f === 'manifest.json');
        if (manifestFile) {
          try {
            const mContent = await fs.readFile(path.join(dir, manifestFile), 'utf-8');
            const prodManifest = JSON.parse(mContent);
            if (prodManifest.bundleFile || prodManifest.globalName) {
              // This is a UMD production build
              deploymentType = 'cdn';
              umdManifest = prodManifest;
              
              const staticPath = path.join(STATIC_DIR, uploadId);
              await copyDir(dir, staticPath);
              
              const bundleFile = prodManifest.bundleFile || files.find(f => f.endsWith('.js') && f.includes(pluginName));
              if (bundleFile) {
                frontendUrl = `${PLUGIN_PUBLISHER_URL}/static/${uploadId}/${bundleFile}`;
              }
              break;
            }
          } catch {
            // Not a valid production manifest
          }
        }

        // Look for UMD bundle by naming pattern
        const umdBundle = files.find(f => 
          f.endsWith('.js') && !f.endsWith('.map') && pluginName && f.includes(pluginName)
        );
        if (umdBundle) {
          const content = await fs.readFile(path.join(dir, umdBundle), 'utf-8');
          // Detect UMD format
          if (content.includes('(function') && content.includes('mount')) {
            deploymentType = 'cdn';
            
            const staticPath = path.join(STATIC_DIR, uploadId);
            await copyDir(dir, staticPath);
            frontendUrl = `${PLUGIN_PUBLISHER_URL}/static/${uploadId}/${umdBundle}`;
            break;
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Clean up extracted files (keep static copy)
    await fs.rm(extractDir, { recursive: true });

    res.json({
      frontendUrl,
      manifest,
      uploadId,
      deploymentType: deploymentType || 'unknown',
      ...(umdManifest ? { productionManifest: umdManifest } : {}),
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ============================================
// Test Plugin Loading
// ============================================

app.post('/api/v1/plugin-publisher/test', async (req, res) => {
  try {
    const { frontendUrl, backendUrl } = req.body;

    if (!frontendUrl && !backendUrl) {
      return res.status(400).json({ error: 'Either frontendUrl or backendUrl is required' });
    }

    // Use the comprehensive testing service
    const result = await testPlugin({
      frontendUrl,
      backendUrl,
      frontendTimeout: 15000, // 15 seconds for frontend
      backendTimeout: 5000, // 5 seconds for backend
    });

    res.json(result);
  } catch (error) {
    console.error('Test error:', error);
    res.json({
      success: false,
      overallErrors: [error instanceof Error ? error.message : 'Test failed'],
    });
  }
});

// Additional endpoint for frontend-only testing (backward compatible)
app.post('/api/v1/plugin-publisher/test-frontend', async (req, res) => {
  try {
    const { frontendUrl } = req.body;

    if (!frontendUrl) {
      return res.status(400).json({ error: 'frontendUrl is required' });
    }

    const result = await testFrontendLoading(frontendUrl);
    res.json(result);
  } catch (error) {
    console.error('Frontend test error:', error);
    res.json({
      success: false,
      errors: [error instanceof Error ? error.message : 'Test failed'],
    });
  }
});

// Additional endpoint for backend-only testing
app.post('/api/v1/plugin-publisher/test-backend', async (req, res) => {
  try {
    const { backendUrl } = req.body;

    if (!backendUrl) {
      return res.status(400).json({ error: 'backendUrl is required' });
    }

    const result = await testBackendHealth(backendUrl);
    res.json(result);
  } catch (error) {
    console.error('Backend test error:', error);
    res.json({
      success: false,
      errors: [error instanceof Error ? error.message : 'Test failed'],
    });
  }
});

// ============================================
// CDN Upload Service
// ============================================

interface CDNUploadResult {
  bundleUrl: string;
  stylesUrl?: string;
  bundleHash: string;
  bundleSize: number;
  deployedAt: Date;
}

/**
 * Uploads plugin assets to Vercel Blob (CDN)
 */
async function uploadToCDN(
  pluginName: string,
  version: string,
  assets: { type: string; filename: string; content: Buffer; contentType: string }[]
): Promise<CDNUploadResult> {
  if (!BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN not configured');
  }

  // Validate plugin name and version to prevent path traversal in blob paths
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(pluginName)) {
    throw new Error('Invalid plugin name');
  }
  if (!/^[\d]+\.[\d]+\.[\d]+/.test(version)) {
    throw new Error('Invalid version format');
  }

  const results: Record<string, { url: string; size: number }> = {};
  let bundleHash = '';

  for (const asset of assets) {
    const blobPath = `plugins/${pluginName}/${version}/${asset.filename}`;

    // Upload to Vercel Blob via API
    const response = await fetch(`https://blob.vercel-storage.com/${blobPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${BLOB_READ_WRITE_TOKEN}`,
        'Content-Type': asset.contentType,
        'x-vercel-blob-cache-control-max-age': asset.type === 'manifest' ? '300' : '31536000',
      },
      body: asset.content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload ${asset.filename}: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    results[asset.type] = {
      url: result.url,
      size: asset.content.length,
    };

    // Track bundle hash
    if (asset.type === 'bundle') {
      bundleHash = createHash('sha256').update(asset.content).digest('hex').substring(0, 8);
    }
  }

  if (!results.bundle) {
    throw new Error('No bundle uploaded');
  }

  return {
    bundleUrl: results.bundle.url,
    stylesUrl: results.styles?.url,
    bundleHash,
    bundleSize: results.bundle.size,
    deployedAt: new Date(),
  };
}

/**
 * Validates a UMD bundle has the required structure
 */
function validateUMDBundleContent(content: string, pluginName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for UMD wrapper or IIFE
  if (!content.includes('(function') && !content.includes('function(')) {
    errors.push('Bundle does not appear to be a valid UMD/IIFE format');
  }

  // Check for mount function
  if (!content.includes('mount')) {
    errors.push('Bundle does not appear to export a mount function');
  }

  // Check for React external
  if (!content.includes('React') && !content.includes('window.React')) {
    errors.push('Bundle should reference React as an external dependency');
  }

  // Check bundle isn't too large
  if (content.length > 5 * 1024 * 1024) { // 5MB
    errors.push('Bundle size exceeds 5MB limit');
  }

  return { valid: errors.length === 0, errors };
}

// ============================================
// CDN Publish Endpoint
// ============================================

app.post('/api/v1/plugin-publisher/publish-cdn', upload.single('plugin'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!USE_CDN_UPLOAD) {
      return res.status(400).json({ 
        error: 'CDN publishing not enabled',
        hint: 'Set BLOB_READ_WRITE_TOKEN environment variable to enable CDN uploads',
      });
    }

    const uploadId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const extractDir = path.join(UPLOAD_DIR, uploadId);

    // Extract zip
    await fs.mkdir(extractDir, { recursive: true });

    const safeUploadPath = validateFilePath(req.file!.path, UPLOAD_DIR);

    await new Promise((resolve, reject) => {
      createReadStream(safeUploadPath) // lgtm[js/path-injection] validated by validateFilePath
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    // Clean up original zip
    await fs.unlink(safeUploadPath); // lgtm[js/path-injection] validated by validateFilePath

    // Read plugin.json manifest
    let manifest: Record<string, unknown> | null = null;
    let manifestPath = path.join(extractDir, 'plugin.json');

    if (!existsSync(manifestPath)) {
      // Check subdirectory
      const entries = await fs.readdir(extractDir);
      for (const entry of entries) {
        const subPath = path.join(extractDir, entry, 'plugin.json');
        if (existsSync(subPath)) {
          manifestPath = subPath;
          break;
        }
      }
    }

    if (existsSync(manifestPath)) {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    }

    if (!manifest || !manifest.name || !manifest.version) {
      await fs.rm(extractDir, { recursive: true });
      return res.status(400).json({ error: 'Invalid or missing plugin.json' });
    }

    const pluginName = manifest.name as string;
    const version = manifest.version as string;

    // Find and validate UMD bundle
    const bundlePaths = [
      path.join(extractDir, 'dist', 'production', `${pluginName}.*.js`),
      path.join(extractDir, 'frontend', 'dist', 'production', `${pluginName}.*.js`),
      path.join(extractDir, 'bundle.js'),
      path.join(extractDir, 'dist', 'bundle.js'),
    ];

    let bundlePath: string | undefined;
    let stylesPath: string | undefined;

    // Search for bundle files
    for (const searchPath of bundlePaths) {
      const dir = path.dirname(searchPath);
      const pattern = path.basename(searchPath);
      
      if (existsSync(dir)) {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith('.js') && !file.endsWith('.map') && file.includes(pluginName)) {
            bundlePath = path.join(dir, file);
            break;
          }
        }
        
        // Also look for CSS
        for (const file of files) {
          if (file.endsWith('.css')) {
            stylesPath = path.join(dir, file);
            break;
          }
        }
        
        if (bundlePath) break;
      }
    }

    if (!bundlePath) {
      await fs.rm(extractDir, { recursive: true });
      return res.status(400).json({
        error: 'No UMD bundle found',
        hint: 'Build your plugin with npm run build:production to generate UMD bundle',
      });
    }

    // Validate file paths are within the expected extract directory
    const resolvedExtractDir = path.resolve(extractDir);
    if (!path.resolve(bundlePath).startsWith(resolvedExtractDir + path.sep)) {
      await fs.rm(extractDir, { recursive: true });
      return res.status(400).json({ error: 'Bundle file path outside expected directory' });
    }
    if (stylesPath && !path.resolve(stylesPath).startsWith(resolvedExtractDir + path.sep)) {
      await fs.rm(extractDir, { recursive: true });
      return res.status(400).json({ error: 'Styles file path outside expected directory' });
    }

    // Read and validate bundle
    const bundleContent = await fs.readFile(bundlePath, 'utf-8');
    const validation = validateUMDBundleContent(bundleContent, pluginName);

    if (!validation.valid) {
      await fs.rm(extractDir, { recursive: true });
      return res.status(400).json({
        error: 'Invalid UMD bundle',
        validationErrors: validation.errors,
      });
    }

    // Prepare assets for upload
    const assets: { type: string; filename: string; content: Buffer; contentType: string }[] = [];

    // Bundle
    const bundleHash = createHash('sha256').update(bundleContent).digest('hex').substring(0, 8);
    const bundleFilename = `${pluginName}.${bundleHash}.js`;
    assets.push({
      type: 'bundle',
      filename: bundleFilename,
      content: Buffer.from(bundleContent),
      contentType: 'application/javascript',
    });

    // Styles (if present)
    if (stylesPath) {
      const stylesContent = await fs.readFile(stylesPath);
      const stylesHash = createHash('sha256').update(stylesContent).digest('hex').substring(0, 8);
      const stylesFilename = `${pluginName}.${stylesHash}.css`;
      assets.push({
        type: 'styles',
        filename: stylesFilename,
        content: stylesContent,
        contentType: 'text/css',
      });
    }

    // Manifest
    const productionManifest = {
      name: pluginName,
      displayName: (manifest.displayName as string) || pluginName,
      version,
      bundleFile: bundleFilename,
      stylesFile: stylesPath ? assets.find(a => a.type === 'styles')?.filename : undefined,
      globalName: `NaapPlugin${pluginName.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('')}`,
      bundleHash,
      bundleSize: Buffer.byteLength(bundleContent),
      routes: ((manifest.frontend as Record<string, unknown>)?.routes as string[]) || [],
      category: (manifest.category as string) || 'other',
      description: manifest.description as string,
      icon: manifest.icon as string,
      buildTime: new Date().toISOString(),
      nodeEnv: 'production',
    };

    assets.push({
      type: 'manifest',
      filename: 'manifest.json',
      content: Buffer.from(JSON.stringify(productionManifest, null, 2)),
      contentType: 'application/json',
    });

    // Upload to CDN
    const cdnResult = await uploadToCDN(pluginName, version, assets);

    // Clean up
    await fs.rm(extractDir, { recursive: true });

    // Register with base-svc
    try {
      await fetch(`${BASE_SVC_URL}/api/v1/registry/packages/${pluginName}/versions/${version}/cdn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        },
        body: JSON.stringify({
          bundleUrl: cdnResult.bundleUrl,
          stylesUrl: cdnResult.stylesUrl,
          bundleHash: cdnResult.bundleHash,
          bundleSize: cdnResult.bundleSize,
          deploymentType: 'cdn',
        }),
      });
    } catch (registryError) {
      console.warn('Failed to register CDN deployment with base-svc:', registryError);
      // Don't fail the request, the upload succeeded
    }

    res.json({
      success: true,
      pluginName,
      version,
      bundleUrl: cdnResult.bundleUrl,
      stylesUrl: cdnResult.stylesUrl,
      bundleHash: cdnResult.bundleHash,
      bundleSize: cdnResult.bundleSize,
      deploymentType: 'cdn',
      manifest: productionManifest,
    });
  } catch (error) {
    console.error('CDN publish error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'CDN publish failed' });
  }
});

// ============================================
// Stats Endpoint
// ============================================

app.get('/api/v1/plugin-publisher/stats/:packageName', async (req, res) => {
  try {
    const { packageName } = req.params;

    // Sanitize path parameter to prevent SSRF via path traversal
    const safePackageName = encodeURIComponent(packageName);
    // Fetch package info from base-svc
    const pkgResponse = await fetch(`${BASE_SVC_URL}/api/v1/registry/packages/${safePackageName}`);
    
    if (!pkgResponse.ok) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const pkg = await pkgResponse.json();

    // Generate mock timeline data (in production, this would come from real analytics)
    const timeline = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      timeline.push({
        date: date.toISOString().split('T')[0],
        downloads: Math.floor(Math.random() * (pkg.downloads / 30) + 1),
        installs: Math.floor(Math.random() * (pkg.downloads / 60) + 1),
      });
    }

    res.json({
      totalDownloads: pkg.downloads || 0,
      totalInstalls: Math.floor((pkg.downloads || 0) * 0.3), // Estimate
      versionsCount: pkg.versions?.length || 1,
      timeline,
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ============================================
// Publisher Stats
// ============================================

app.get('/api/v1/plugin-publisher/publisher-stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Fetch publisher's packages from base-svc
    const response = await fetch(`${BASE_SVC_URL}/api/v1/registry/packages?mine=true`, {
      headers: authHeader ? { Authorization: authHeader } : {},
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch packages' });
    }

    const data = await response.json();
    const packages = data.packages || [];

    const stats = {
      totalPlugins: packages.length,
      publishedCount: packages.filter((p: { publishStatus: string }) => p.publishStatus === 'published').length,
      totalDownloads: packages.reduce((sum: number, p: { downloads: number }) => sum + (p.downloads || 0), 0),
      avgRating: packages.length > 0
        ? packages.reduce((sum: number, p: { rating?: number }) => sum + (p.rating || 0), 0) / packages.length
        : 0,
    };

    res.json(stats);
  } catch (error) {
    console.error('Publisher stats error:', error);
    res.status(500).json({ error: 'Failed to fetch publisher stats' });
  }
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[${PLUGIN_NAME}] Backend running on port ${PORT} (from plugin.json devPort: ${pluginConfig.backend?.devPort})`);
});
