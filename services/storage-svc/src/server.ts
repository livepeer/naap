/**
 * Storage Service API
 * Provides artifact storage for plugin publishing
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { createStorageAdapter, type StorageConfig, type StorageAdapter } from './services/storage.js';

const app = express();
const PORT = process.env.PORT || 4100;

// Configure storage based on environment
const storageConfig: StorageConfig = {
  type: (process.env.STORAGE_TYPE as 'local' | 's3' | 'minio') || 'local',
  basePath: process.env.STORAGE_PATH || './storage',
  baseUrl: process.env.STORAGE_URL || `http://localhost:${PORT}/files`,
  s3: process.env.AWS_S3_BUCKET ? {
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT, // For MinIO
  } : undefined,
};

let storage: StorageAdapter;

try {
  storage = createStorageAdapter(storageConfig);
  console.log(`Storage initialized: ${storageConfig.type}`);
} catch (error) {
  console.error('Failed to initialize storage:', error);
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads (50MB limit)
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  storage: multer.memoryStorage(),
});

// File validation
const ALLOWED_EXTENSIONS = ['.js', '.json', '.css', '.map', '.woff', '.woff2', '.png', '.jpg', '.svg', '.ico'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function validateFilename(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

// Health check
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'storage-svc',
    version: '0.0.1',
    storage: storageConfig.type,
  });
});

// ============================================
// Upload Endpoints
// ============================================

/**
 * Upload a single file for a plugin version
 * POST /api/v1/storage/plugins/:name/:version
 */
app.post('/api/v1/storage/plugins/:name/:version', upload.single('file'), async (req, res) => {
  try {
    const { name, version } = req.params;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Validate file
    const filename = file.originalname;
    if (!validateFilename(filename)) {
      return res.status(400).json({ error: `Invalid file type: ${path.extname(filename)}` });
    }

    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: `File too large: max ${MAX_FILE_SIZE / 1024 / 1024}MB` });
    }

    // Generate storage path
    const storagePath = `plugins/${name}/${version}/${filename}`;
    
    // Upload
    const url = await storage.upload(file.buffer, storagePath, file.mimetype);
    
    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

    res.status(201).json({
      url,
      path: storagePath,
      size: file.size,
      contentType: file.mimetype,
      checksum,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * Upload multiple files (bundle) for a plugin version
 * POST /api/v1/storage/plugins/:name/:version/bundle
 */
app.post('/api/v1/storage/plugins/:name/:version/bundle', upload.array('files', 100), async (req, res) => {
  try {
    const { name, version } = req.params;
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const results: Array<{
      filename: string;
      url: string;
      size: number;
      checksum: string;
    }> = [];

    for (const file of files) {
      const filename = file.originalname;
      
      if (!validateFilename(filename)) {
        continue; // Skip invalid files
      }

      const storagePath = `plugins/${name}/${version}/${filename}`;
      const url = await storage.upload(file.buffer, storagePath, file.mimetype);
      const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

      results.push({
        filename,
        url,
        size: file.size,
        checksum,
      });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'No valid files in bundle' });
    }

    // Check for UMD bundle
    const hasBuild = results.some(r => r.filename.endsWith('.js'));
    
    res.status(201).json({
      uploaded: results.length,
      hasBuild,
      files: results,
      bundleUrl: `${storageConfig.baseUrl}/plugins/${name}/${version}`,
      cdnBundleUrl: hasBuild
        ? `${storageConfig.baseUrl}/plugins/${name}/${version}/${name}.js`
        : null,
    });
  } catch (error) {
    console.error('Bundle upload error:', error);
    res.status(500).json({ error: 'Bundle upload failed' });
  }
});

// ============================================
// Download / Access Endpoints
// ============================================

/**
 * Serve files from storage (for local storage)
 * GET /files/plugins/:name/:version/:filename
 */
app.get('/files/*', async (req, res) => {
  try {
    const filePath = (req.params as Record<string, string>)[0];
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }

    // Get metadata first
    const metadata = await storage.getMetadata(filePath);
    
    if (!metadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set headers
    res.setHeader('Content-Type', metadata.contentType);
    res.setHeader('Content-Length', metadata.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (metadata.etag) {
      res.setHeader('ETag', metadata.etag);
    }

    // Download and stream
    const buffer = await storage.download(filePath);
    res.send(buffer);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * Get file metadata
 * GET /api/v1/storage/plugins/:name/:version/:filename/metadata
 */
app.get('/api/v1/storage/plugins/:name/:version/:filename/metadata', async (req, res) => {
  try {
    const { name, version, filename } = req.params;
    const storagePath = `plugins/${name}/${version}/${filename}`;
    
    const metadata = await storage.getMetadata(storagePath);
    
    if (!metadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      path: storagePath,
      url: storage.getUrl(storagePath),
      ...metadata,
    });
  } catch (error) {
    console.error('Metadata error:', error);
    res.status(500).json({ error: 'Failed to get metadata' });
  }
});

/**
 * List files for a plugin version
 * GET /api/v1/storage/plugins/:name/:version
 */
app.get('/api/v1/storage/plugins/:name/:version', async (req, res) => {
  try {
    const { name, version } = req.params;
    const prefix = `plugins/${name}/${version}/`;
    
    const files = await storage.list(prefix);
    
    res.json({
      plugin: name,
      version,
      files: files.map(f => ({
        path: f,
        filename: path.basename(f),
        url: storage.getUrl(f),
      })),
    });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// ============================================
// Delete Endpoints
// ============================================

/**
 * Delete all files for a plugin version
 * DELETE /api/v1/storage/plugins/:name/:version
 */
app.delete('/api/v1/storage/plugins/:name/:version', async (req, res) => {
  try {
    const { name, version } = req.params;
    const prefix = `plugins/${name}/${version}/`;
    
    const files = await storage.list(prefix);
    
    for (const file of files) {
      await storage.delete(file);
    }

    res.json({
      deleted: files.length,
      plugin: name,
      version,
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/**
 * Delete a specific file
 * DELETE /api/v1/storage/plugins/:name/:version/:filename
 */
app.delete('/api/v1/storage/plugins/:name/:version/:filename', async (req, res) => {
  try {
    const { name, version, filename } = req.params;
    const storagePath = `plugins/${name}/${version}/${filename}`;
    
    const exists = await storage.exists(storagePath);
    
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    await storage.delete(storagePath);

    res.json({ success: true, path: storagePath });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ============================================
// CDN / Cache Endpoints
// ============================================

/**
 * Invalidate CDN cache for a plugin version
 * POST /api/v1/storage/plugins/:name/:version/invalidate
 */
app.post('/api/v1/storage/plugins/:name/:version/invalidate', async (req, res) => {
  try {
    const { name, version } = req.params;
    const prefix = `plugins/${name}/${version}/*`;
    
    // TODO: Implement CDN invalidation based on provider
    // For CloudFront: CreateInvalidation API
    // For Cloudflare: Purge Cache API
    
    console.log(`Cache invalidation requested for: ${prefix}`);
    
    res.json({
      success: true,
      message: 'Cache invalidation queued',
      pattern: prefix,
    });
  } catch (error) {
    console.error('Cache invalidation error:', error);
    res.status(500).json({ error: 'Cache invalidation failed' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🗄️  storage-svc running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   Storage: ${storageConfig.type} (${storageConfig.basePath || storageConfig.s3?.bucket})`);
});
