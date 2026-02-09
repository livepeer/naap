/**
 * Storage Service Abstraction
 * Supports multiple backends: S3, Local filesystem, MinIO
 */

export interface StorageAdapter {
  /**
   * Upload a file to storage
   */
  upload(file: Buffer, path: string, contentType?: string): Promise<string>;
  
  /**
   * Download a file from storage
   */
  download(path: string): Promise<Buffer>;
  
  /**
   * Delete a file from storage
   */
  delete(path: string): Promise<void>;
  
  /**
   * Get public URL for a file
   */
  getUrl(path: string): string;
  
  /**
   * Check if a file exists
   */
  exists(path: string): Promise<boolean>;
  
  /**
   * List files in a directory
   */
  list(prefix: string): Promise<string[]>;
  
  /**
   * Get file metadata
   */
  getMetadata(path: string): Promise<FileMetadata | null>;
}

export interface FileMetadata {
  size: number;
  contentType: string;
  lastModified: Date;
  etag?: string;
}

export interface StorageConfig {
  type: 'local' | 's3' | 'minio';
  basePath?: string;
  baseUrl?: string;
  s3?: {
    bucket: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string; // For MinIO
  };
}

/**
 * Create a storage adapter based on configuration
 */
export function createStorageAdapter(config: StorageConfig): StorageAdapter {
  switch (config.type) {
    case 's3':
    case 'minio':
      // S3 adapter will be imported dynamically to avoid errors when not configured
      return createS3Adapter(config);
    case 'local':
    default:
      return createLocalAdapter(config);
  }
}

// ============================================
// Local Filesystem Adapter
// ============================================

import fs from 'fs/promises';
import path from 'path';
import { lookup } from 'mime-types';

function createLocalAdapter(config: StorageConfig): StorageAdapter {
  const basePath = config.basePath || './storage';
  const baseUrl = config.baseUrl || 'http://localhost:4100/files';

  return {
    async upload(file: Buffer, filePath: string, contentType?: string): Promise<string> {
      const fullPath = path.join(basePath, filePath);
      const dir = path.dirname(fullPath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, file);
      
      // Store metadata in a sidecar file
      const metadata: FileMetadata = {
        size: file.length,
        contentType: contentType || lookup(filePath) || 'application/octet-stream',
        lastModified: new Date(),
      };
      await fs.writeFile(`${fullPath}.meta.json`, JSON.stringify(metadata));
      
      return this.getUrl(filePath);
    },

    async download(filePath: string): Promise<Buffer> {
      const fullPath = path.join(basePath, filePath);
      return fs.readFile(fullPath);
    },

    async delete(filePath: string): Promise<void> {
      const fullPath = path.join(basePath, filePath);
      await fs.unlink(fullPath).catch(() => {});
      await fs.unlink(`${fullPath}.meta.json`).catch(() => {});
    },

    getUrl(filePath: string): string {
      return `${baseUrl}/${filePath}`;
    },

    async exists(filePath: string): Promise<boolean> {
      const fullPath = path.join(basePath, filePath);
      try {
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    async list(prefix: string): Promise<string[]> {
      const fullPath = path.join(basePath, prefix);
      try {
        const entries = await fs.readdir(fullPath, { recursive: true });
        return entries
          .filter(e => !e.endsWith('.meta.json'))
          .map(e => path.join(prefix, e.toString()));
      } catch {
        return [];
      }
    },

    async getMetadata(filePath: string): Promise<FileMetadata | null> {
      const metaPath = path.join(basePath, `${filePath}.meta.json`);
      try {
        const data = await fs.readFile(metaPath, 'utf-8');
        return JSON.parse(data);
      } catch {
        // Try to get basic metadata from file stats
        try {
          const stats = await fs.stat(path.join(basePath, filePath));
          return {
            size: stats.size,
            contentType: lookup(filePath) || 'application/octet-stream',
            lastModified: stats.mtime,
          };
        } catch {
          return null;
        }
      }
    },
  };
}

// ============================================
// S3/MinIO Adapter
// ============================================

import { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

function createS3Adapter(config: StorageConfig): StorageAdapter {
  if (!config.s3) {
    throw new Error('S3 configuration required');
  }

  const { bucket, region, accessKeyId, secretAccessKey, endpoint } = config.s3;
  
  const s3Client = new S3Client({
    region,
    endpoint: endpoint, // For MinIO
    credentials: accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey,
    } : undefined,
    forcePathStyle: !!endpoint, // Required for MinIO
  });

  const baseUrl = config.baseUrl || 
    (endpoint ? `${endpoint}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`);

  return {
    async upload(file: Buffer, filePath: string, contentType?: string): Promise<string> {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: filePath,
        Body: file,
        ContentType: contentType || lookup(filePath) || 'application/octet-stream',
      });

      await s3Client.send(command);
      return this.getUrl(filePath);
    },

    async download(filePath: string): Promise<Buffer> {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: filePath,
      });

      const response = await s3Client.send(command);
      
      if (!response.Body) {
        throw new Error('Empty response body');
      }

      // Convert readable stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async delete(filePath: string): Promise<void> {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: filePath,
      });

      await s3Client.send(command);
    },

    getUrl(filePath: string): string {
      return `${baseUrl}/${filePath}`;
    },

    async exists(filePath: string): Promise<boolean> {
      try {
        const command = new HeadObjectCommand({
          Bucket: bucket,
          Key: filePath,
        });
        await s3Client.send(command);
        return true;
      } catch {
        return false;
      }
    },

    async list(prefix: string): Promise<string[]> {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      });

      const response = await s3Client.send(command);
      return (response.Contents || []).map(obj => obj.Key!).filter(Boolean);
    },

    async getMetadata(filePath: string): Promise<FileMetadata | null> {
      try {
        const command = new HeadObjectCommand({
          Bucket: bucket,
          Key: filePath,
        });
        const response = await s3Client.send(command);
        
        return {
          size: response.ContentLength || 0,
          contentType: response.ContentType || 'application/octet-stream',
          lastModified: response.LastModified || new Date(),
          etag: response.ETag,
        };
      } catch {
        return null;
      }
    },
  };
}
