/**
 * Plugin Cache
 *
 * IndexedDB-based caching for plugin bundles to reduce CDN requests
 * and enable offline-first loading.
 */

/**
 * Cached plugin bundle entry
 */
export interface CachedBundle {
  /** Plugin name */
  name: string;

  /** Bundle URL */
  url: string;

  /** Content hash for validation */
  hash: string;

  /** Bundle content (JavaScript code) */
  content: string;

  /** Styles content (CSS, optional) */
  styles?: string;

  /** Cached timestamp */
  cachedAt: number;

  /** TTL in milliseconds */
  ttl: number;

  /** Bundle size in bytes */
  size: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitCount: number;
  missCount: number;
  oldestEntry?: number;
  newestEntry?: number;
}

const DB_NAME = 'naap-plugin-cache';
const DB_VERSION = 1;
const STORE_NAME = 'bundles';
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB

let db: IDBDatabase | null = null;
let cacheStats: CacheStats = {
  totalEntries: 0,
  totalSize: 0,
  hitCount: 0,
  missCount: 0,
};

/**
 * Opens the IndexedDB database
 */
async function openDatabase(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open plugin cache database'));
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create bundles store
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('hash', 'hash', { unique: false });
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
    };
  });
}

/**
 * Gets a cached bundle
 */
export async function getCachedBundle(url: string): Promise<CachedBundle | null> {
  try {
    const database = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onerror = () => {
        cacheStats.missCount++;
        reject(new Error('Failed to get cached bundle'));
      };

      request.onsuccess = () => {
        const entry = request.result as CachedBundle | undefined;

        if (!entry) {
          cacheStats.missCount++;
          resolve(null);
          return;
        }

        // Check if expired
        if (Date.now() > entry.cachedAt + entry.ttl) {
          cacheStats.missCount++;
          // Delete expired entry asynchronously
          deleteCachedBundle(url).catch(() => {});
          resolve(null);
          return;
        }

        cacheStats.hitCount++;
        resolve(entry);
      };
    });
  } catch (error) {
    console.warn('Cache get error:', error);
    cacheStats.missCount++;
    return null;
  }
}

/**
 * Stores a bundle in cache
 */
export async function setCachedBundle(entry: Omit<CachedBundle, 'cachedAt' | 'size'>): Promise<void> {
  try {
    // Check and enforce cache size limit
    await enforceCacheLimit();

    const database = await openDatabase();
    const size = (entry.content?.length || 0) + (entry.styles?.length || 0);

    const cachedEntry: CachedBundle = {
      ...entry,
      cachedAt: Date.now(),
      size,
    };

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(cachedEntry);

      request.onerror = () => reject(new Error('Failed to cache bundle'));
      request.onsuccess = () => {
        cacheStats.totalEntries++;
        cacheStats.totalSize += size;
        resolve();
      };
    });
  } catch (error) {
    console.warn('Cache set error:', error);
  }
}

/**
 * Deletes a cached bundle
 */
export async function deleteCachedBundle(url: string): Promise<void> {
  try {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(url);

      request.onerror = () => reject(new Error('Failed to delete cached bundle'));
      request.onsuccess = () => {
        cacheStats.totalEntries = Math.max(0, cacheStats.totalEntries - 1);
        resolve();
      };
    });
  } catch (error) {
    console.warn('Cache delete error:', error);
  }
}

/**
 * Clears all cached bundles
 */
export async function clearPluginCache(): Promise<void> {
  try {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(new Error('Failed to clear cache'));
      request.onsuccess = () => {
        cacheStats = {
          totalEntries: 0,
          totalSize: 0,
          hitCount: 0,
          missCount: 0,
        };
        resolve();
      };
    });
  } catch (error) {
    console.warn('Cache clear error:', error);
  }
}

/**
 * Gets cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(new Error('Failed to get cache stats'));
      request.onsuccess = () => {
        const entries = request.result as CachedBundle[];
        
        let totalSize = 0;
        let oldestEntry: number | undefined;
        let newestEntry: number | undefined;

        for (const entry of entries) {
          totalSize += entry.size;
          
          if (!oldestEntry || entry.cachedAt < oldestEntry) {
            oldestEntry = entry.cachedAt;
          }
          if (!newestEntry || entry.cachedAt > newestEntry) {
            newestEntry = entry.cachedAt;
          }
        }

        resolve({
          ...cacheStats,
          totalEntries: entries.length,
          totalSize,
          oldestEntry,
          newestEntry,
        });
      };
    });
  } catch (error) {
    console.warn('Cache stats error:', error);
    return cacheStats;
  }
}

/**
 * Enforces cache size limit by removing oldest entries
 */
async function enforceCacheLimit(): Promise<void> {
  try {
    const stats = await getCacheStats();
    
    if (stats.totalSize <= MAX_CACHE_SIZE) {
      return;
    }

    const database = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('cachedAt');
      const request = index.openCursor();

      let removedSize = 0;
      const targetRemoval = stats.totalSize - MAX_CACHE_SIZE * 0.8; // Remove 20% more to avoid frequent cleanups

      request.onerror = () => reject(new Error('Failed to enforce cache limit'));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        
        if (cursor && removedSize < targetRemoval) {
          const entry = cursor.value as CachedBundle;
          removedSize += entry.size;
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (error) {
    console.warn('Cache limit enforcement error:', error);
  }
}

/**
 * Validates a cached bundle against an expected hash
 */
export async function validateCachedBundle(
  url: string,
  expectedHash: string
): Promise<boolean> {
  const cached = await getCachedBundle(url);
  if (!cached) return false;
  return cached.hash === expectedHash;
}

/**
 * Gets or fetches a bundle with caching
 */
export async function getOrFetchBundle(
  url: string,
  hash: string,
  name: string,
  ttl: number = DEFAULT_TTL
): Promise<{ content: string; styles?: string; fromCache: boolean }> {
  // Try cache first
  const cached = await getCachedBundle(url);
  if (cached && cached.hash === hash) {
    return {
      content: cached.content,
      styles: cached.styles,
      fromCache: true,
    };
  }

  // Fetch from CDN
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: ${response.status}`);
  }

  const content = await response.text();

  // Cache the result
  await setCachedBundle({
    name,
    url,
    hash,
    content,
    ttl,
  });

  return { content, fromCache: false };
}

/**
 * Prefetches a bundle into cache
 */
export async function prefetchBundle(
  url: string,
  hash: string,
  name: string
): Promise<void> {
  // Don't fetch if already cached with same hash
  if (await validateCachedBundle(url, hash)) {
    return;
  }

  try {
    await getOrFetchBundle(url, hash, name);
  } catch (error) {
    console.warn(`Prefetch failed for ${name}:`, error);
  }
}
