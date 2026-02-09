/**
 * Vercel Blob Storage Integration
 *
 * Provides file storage capabilities using Vercel Blob for production
 * and local filesystem for development.
 */

import { put, del, list, head, type PutBlobResult } from '@vercel/blob';

export interface FileMetadata {
  size: number;
  contentType: string;
  lastModified: Date;
  etag?: string;
  url: string;
}

export interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  addRandomSuffix?: boolean;
  access?: 'public';
}

export interface StorageAdapter {
  upload(file: Buffer | Blob | File | ArrayBuffer, path: string, options?: UploadOptions): Promise<FileMetadata>;
  delete(url: string): Promise<void>;
  exists(url: string): Promise<boolean>;
  getMetadata(url: string): Promise<FileMetadata | null>;
  list(prefix?: string): Promise<FileMetadata[]>;
}

/**
 * Vercel Blob Storage Adapter
 */
export class VercelBlobAdapter implements StorageAdapter {
  async upload(
    file: Buffer | Blob | File | ArrayBuffer,
    path: string,
    options: UploadOptions = {}
  ): Promise<FileMetadata> {
    const result = await put(path, file, {
      access: options.access || 'public',
      contentType: options.contentType,
      cacheControlMaxAge: options.cacheControl ? parseInt(options.cacheControl) : 31536000, // 1 year default
      addRandomSuffix: options.addRandomSuffix ?? true,
    });

    return this.blobResultToMetadata(result);
  }

  async delete(url: string): Promise<void> {
    await del(url);
  }

  async exists(url: string): Promise<boolean> {
    try {
      const blob = await head(url);
      return !!blob;
    } catch {
      return false;
    }
  }

  async getMetadata(url: string): Promise<FileMetadata | null> {
    try {
      const blob = await head(url);
      return {
        size: blob.size,
        contentType: blob.contentType,
        lastModified: blob.uploadedAt,
        url: blob.url,
      };
    } catch {
      return null;
    }
  }

  async list(prefix?: string): Promise<FileMetadata[]> {
    const result = await list({ prefix });
    return result.blobs.map(blob => ({
      size: blob.size,
      contentType: 'application/octet-stream', // Not available in list result
      lastModified: blob.uploadedAt,
      url: blob.url,
    }));
  }

  private blobResultToMetadata(result: PutBlobResult): FileMetadata {
    return {
      size: 0, // Not available in put result
      contentType: result.contentType,
      lastModified: new Date(),
      url: result.url,
    };
  }
}

/**
 * Local Storage Adapter for Development
 * Uses the local API endpoint to store files
 */
export class LocalStorageAdapter implements StorageAdapter {
  private baseUrl: string;

  constructor(baseUrl = '/api/v1/storage') {
    this.baseUrl = baseUrl;
  }

  async upload(
    file: Buffer | Blob | File | ArrayBuffer,
    path: string,
    options: UploadOptions = {}
  ): Promise<FileMetadata> {
    const formData = new FormData();

    // Convert to Blob if needed
    let blob: Blob;
    if (file instanceof Blob) {
      blob = file;
    } else if (file instanceof ArrayBuffer) {
      blob = new Blob([file], { type: options.contentType });
    } else {
      blob = new Blob([file], { type: options.contentType });
    }

    formData.append('file', blob, path);
    if (options.contentType) {
      formData.append('contentType', options.contentType);
    }

    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      size: result.size || 0,
      contentType: result.contentType || options.contentType || 'application/octet-stream',
      lastModified: new Date(result.lastModified || Date.now()),
      url: result.url,
    };
  }

  async delete(url: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.statusText}`);
    }
  }

  async exists(url: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/metadata?url=${encodeURIComponent(url)}`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getMetadata(url: string): Promise<FileMetadata | null> {
    try {
      const response = await fetch(`${this.baseUrl}/metadata?url=${encodeURIComponent(url)}`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async list(prefix?: string): Promise<FileMetadata[]> {
    const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const response = await fetch(`${this.baseUrl}/list${params}`);

    if (!response.ok) {
      return [];
    }

    const result = await response.json();
    return result.files || [];
  }
}

/**
 * Create storage adapter based on environment
 */
export function createStorageAdapter(): StorageAdapter {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (blobToken) {
    return new VercelBlobAdapter();
  }

  // Fall back to local storage for development
  console.log('[Storage] Using local storage adapter (no BLOB_READ_WRITE_TOKEN)');
  return new LocalStorageAdapter();
}

// Singleton instance
let storageInstance: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!storageInstance) {
    storageInstance = createStorageAdapter();
  }
  return storageInstance;
}
