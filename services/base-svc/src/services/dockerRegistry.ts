/**
 * Docker Registry Client
 * Supports Docker Hub, GitHub Container Registry (ghcr.io), and private registries
 */

export interface RegistryConfig {
  type: 'dockerhub' | 'ghcr' | 'private';
  url?: string;
  username?: string;
  password?: string; // Token or password
}

export interface ImageInfo {
  name: string;
  tag: string;
  digest: string;
  size: number;
  platform?: string;
  created: Date;
  labels?: Record<string, string>;
}

export interface ImageManifest {
  schemaVersion: number;
  mediaType: string;
  config: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers: Array<{
    mediaType: string;
    size: number;
    digest: string;
  }>;
}

const REGISTRY_URLS = {
  dockerhub: 'https://registry-1.docker.io/v2',
  ghcr: 'https://ghcr.io/v2',
} as const;

const AUTH_URLS = {
  dockerhub: 'https://auth.docker.io/token',
  ghcr: 'https://ghcr.io/token',
} as const;

/**
 * Create a Docker registry client
 */
export function createDockerRegistryClient(config: RegistryConfig) {
  const { type, username, password } = config;
  const registryUrl = config.url || REGISTRY_URLS[type as keyof typeof REGISTRY_URLS];

  let authToken: string | null = null;
  let tokenExpiry: Date | null = null;

  /**
   * Get authentication token for registry access
   */
  async function getAuthToken(repository: string, actions = 'pull'): Promise<string> {
    // Check if we have a valid cached token
    if (authToken && tokenExpiry && new Date() < tokenExpiry) {
      return authToken;
    }

    let tokenUrl: string;
    let scope = `repository:${repository}:${actions}`;

    if (type === 'dockerhub') {
      tokenUrl = `${AUTH_URLS.dockerhub}?service=registry.docker.io&scope=${scope}`;
    } else if (type === 'ghcr') {
      tokenUrl = `${AUTH_URLS.ghcr}?service=ghcr.io&scope=${scope}`;
    } else {
      // Private registry - try basic auth
      if (username && password) {
        return Buffer.from(`${username}:${password}`).toString('base64');
      }
      throw new Error('Credentials required for private registry');
    }

    const headers: Record<string, string> = {};
    if (username && password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    const response = await fetch(tokenUrl, { headers });
    
    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const data = await response.json();
    authToken = data.token || data.access_token;
    
    // Token typically expires in 5 minutes
    tokenExpiry = new Date(Date.now() + 4 * 60 * 1000);
    
    return authToken!;
  }

  /**
   * Make authenticated request to registry
   */
  async function registryRequest(
    path: string,
    repository: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = await getAuthToken(repository);
    
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    
    // Accept manifest types
    if (path.includes('/manifests/')) {
      headers.set('Accept', [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.oci.image.index.v1+json',
      ].join(', '));
    }

    return fetch(`${registryUrl}${path}`, {
      ...options,
      headers,
    });
  }

  return {
    /**
     * Check if an image exists
     */
    async imageExists(imageName: string, tag: string = 'latest'): Promise<boolean> {
      try {
        const repository = normalizeRepository(imageName, type);
        const response = await registryRequest(
          `/${repository}/manifests/${tag}`,
          repository,
          { method: 'HEAD' }
        );
        return response.ok;
      } catch {
        return false;
      }
    },

    /**
     * Get image manifest
     */
    async getManifest(imageName: string, tag: string = 'latest'): Promise<ImageManifest | null> {
      try {
        const repository = normalizeRepository(imageName, type);
        const response = await registryRequest(
          `/${repository}/manifests/${tag}`,
          repository
        );

        if (!response.ok) {
          return null;
        }

        return response.json();
      } catch {
        return null;
      }
    },

    /**
     * Get image info with digest
     */
    async getImageInfo(imageName: string, tag: string = 'latest'): Promise<ImageInfo | null> {
      try {
        const repository = normalizeRepository(imageName, type);
        const response = await registryRequest(
          `/${repository}/manifests/${tag}`,
          repository
        );

        if (!response.ok) {
          return null;
        }

        const manifest = await response.json();
        const digest = response.headers.get('docker-content-digest') || '';

        // Calculate total size
        let totalSize = manifest.config?.size || 0;
        if (manifest.layers) {
          totalSize += manifest.layers.reduce((sum: number, layer: { size: number }) => sum + layer.size, 0);
        }

        // Get config blob for labels and created date
        let labels: Record<string, string> = {};
        let created = new Date();

        if (manifest.config?.digest) {
          try {
            const configResponse = await registryRequest(
              `/${repository}/blobs/${manifest.config.digest}`,
              repository
            );
            if (configResponse.ok) {
              const config = await configResponse.json();
              labels = config.config?.Labels || {};
              created = new Date(config.created || Date.now());
            }
          } catch {
            // Ignore config fetch errors
          }
        }

        return {
          name: imageName,
          tag,
          digest,
          size: totalSize,
          created,
          labels,
        };
      } catch (error) {
        console.error('Error getting image info:', error);
        return null;
      }
    },

    /**
     * List tags for an image
     */
    async listTags(imageName: string): Promise<string[]> {
      try {
        const repository = normalizeRepository(imageName, type);
        const response = await registryRequest(
          `/${repository}/tags/list`,
          repository
        );

        if (!response.ok) {
          return [];
        }

        const data = await response.json();
        return data.tags || [];
      } catch {
        return [];
      }
    },

    /**
     * Verify image meets requirements
     */
    async verifyImage(
      imageName: string,
      tag: string,
      requirements?: {
        maxSize?: number; // bytes
        requiredLabels?: string[];
      }
    ): Promise<{ valid: boolean; errors: string[] }> {
      const errors: string[] = [];

      const info = await this.getImageInfo(imageName, tag);
      
      if (!info) {
        return { valid: false, errors: ['Image not found or inaccessible'] };
      }

      if (requirements?.maxSize && info.size > requirements.maxSize) {
        errors.push(`Image size (${formatBytes(info.size)}) exceeds limit (${formatBytes(requirements.maxSize)})`);
      }

      if (requirements?.requiredLabels) {
        for (const label of requirements.requiredLabels) {
          if (!info.labels?.[label]) {
            errors.push(`Missing required label: ${label}`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    },

    /**
     * Get full image reference
     */
    getImageReference(imageName: string, tag: string = 'latest'): string {
      const repository = normalizeRepository(imageName, type);
      
      if (type === 'dockerhub') {
        return `${repository}:${tag}`;
      } else if (type === 'ghcr') {
        return `ghcr.io/${repository}:${tag}`;
      } else {
        const registryHost = new URL(registryUrl).host;
        return `${registryHost}/${repository}:${tag}`;
      }
    },
  };
}

/**
 * Normalize repository name for different registries
 */
function normalizeRepository(name: string, type: string): string {
  // Remove registry prefix if present
  name = name.replace(/^(docker\.io|ghcr\.io)\//, '');
  
  // For Docker Hub, add 'library/' prefix for official images
  if (type === 'dockerhub' && !name.includes('/')) {
    return `library/${name}`;
  }
  
  return name;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Default clients
export const dockerHubClient = createDockerRegistryClient({
  type: 'dockerhub',
  username: process.env.DOCKER_USERNAME,
  password: process.env.DOCKER_TOKEN,
});

export const ghcrClient = createDockerRegistryClient({
  type: 'ghcr',
  username: process.env.GITHUB_USERNAME,
  password: process.env.GITHUB_TOKEN,
});
