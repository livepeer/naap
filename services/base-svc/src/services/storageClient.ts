/**
 * Storage Service Client
 * Integrates with storage-svc for plugin artifact storage
 */

import FormData from 'form-data';

export interface StorageClientConfig {
  baseUrl: string;
  timeout?: number;
}

export interface UploadResult {
  url: string;
  path: string;
  size: number;
  contentType: string;
  checksum: string;
}

export interface BundleUploadResult {
  uploaded: number;
  hasBuild: boolean;
  files: Array<{
    filename: string;
    url: string;
    size: number;
    checksum: string;
  }>;
  bundleUrl: string;
  cdnBundleUrl: string | null;
}

export interface FileInfo {
  path: string;
  filename: string;
  url: string;
}

export function createStorageClient(config: StorageClientConfig) {
  const { baseUrl, timeout = 60000 } = config;

  return {
    /**
     * Upload a single file
     */
    async uploadFile(
      pluginName: string,
      version: string,
      filename: string,
      data: Buffer,
      contentType?: string
    ): Promise<UploadResult> {
      const form = new FormData();
      form.append('file', data, {
        filename,
        contentType: contentType || 'application/octet-stream',
      });

      const response = await fetch(
        `${baseUrl}/api/v1/storage/plugins/${pluginName}/${version}`,
        {
          method: 'POST',
          body: form as any,
          signal: AbortSignal.timeout(timeout),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Upload failed: ${error}`);
      }

      return response.json();
    },

    /**
     * Upload multiple files as a bundle
     */
    async uploadBundle(
      pluginName: string,
      version: string,
      files: Array<{ filename: string; data: Buffer; contentType?: string }>
    ): Promise<BundleUploadResult> {
      const form = new FormData();
      
      for (const file of files) {
        form.append('files', file.data, {
          filename: file.filename,
          contentType: file.contentType || 'application/octet-stream',
        });
      }

      const response = await fetch(
        `${baseUrl}/api/v1/storage/plugins/${pluginName}/${version}/bundle`,
        {
          method: 'POST',
          body: form as any,
          signal: AbortSignal.timeout(timeout),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Bundle upload failed: ${error}`);
      }

      return response.json();
    },

    /**
     * List files for a plugin version
     */
    async listFiles(pluginName: string, version: string): Promise<FileInfo[]> {
      const response = await fetch(
        `${baseUrl}/api/v1/storage/plugins/${pluginName}/${version}`,
        { signal: AbortSignal.timeout(timeout) }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error('Failed to list files');
      }

      const data = await response.json();
      return data.files;
    },

    /**
     * Delete all files for a plugin version
     */
    async deleteVersion(pluginName: string, version: string): Promise<number> {
      const response = await fetch(
        `${baseUrl}/api/v1/storage/plugins/${pluginName}/${version}`,
        {
          method: 'DELETE',
          signal: AbortSignal.timeout(timeout),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete version');
      }

      const data = await response.json();
      return data.deleted;
    },

    /**
     * Invalidate CDN cache for a plugin version
     */
    async invalidateCache(pluginName: string, version: string): Promise<void> {
      const response = await fetch(
        `${baseUrl}/api/v1/storage/plugins/${pluginName}/${version}/invalidate`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(timeout),
        }
      );

      if (!response.ok) {
        console.warn('Cache invalidation failed, continuing anyway');
      }
    },

    /**
     * Check if a plugin version has artifacts
     */
    async hasArtifacts(pluginName: string, version: string): Promise<boolean> {
      const files = await this.listFiles(pluginName, version);
      return files.length > 0;
    },

    /**
     * Get the CDN bundle URL for a plugin version
     */
    getBundleUrl(pluginName: string, version: string): string {
      return `${baseUrl}/files/plugins/${pluginName}/${version}/${pluginName}.js`;
    },

    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl}/healthz`, {
          signal: AbortSignal.timeout(5000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

// Default storage client instance
const STORAGE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:4100';
export const storageClient = createStorageClient({ baseUrl: STORAGE_URL });
