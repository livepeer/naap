/**
 * Plugin Testing Service
 * 
 * Provides comprehensive testing for plugin builds:
 * - UMD bundle validation
 * - Backend health check validation
 * - Performance benchmarking
 */

/**
 * Validate that a URL is safe for server-side requests (SSRF protection).
 * Blocks requests to private/internal networks and non-http(s) protocols.
 */
function validateExternalUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    return { valid: false, error: 'Requests to private/internal networks are not allowed' };
  }

  return { valid: true };
}

export interface FrontendTestResult {
  success: boolean;
  loadTime: number;
  size: number;
  bundleValid: boolean;
  globalName: string | null;
  errors: string[];
  warnings: string[];
}

export interface BackendTestResult {
  success: boolean;
  healthy: boolean;
  responseTime: number;
  status: string;
  version?: string;
  endpoints?: string[];
  errors: string[];
}

export interface PluginTestResult {
  success: boolean;
  frontend?: FrontendTestResult;
  backend?: BackendTestResult;
  overallErrors: string[];
}

/**
 * Test frontend UMD bundle loading
 */
export async function testFrontendLoading(
  bundleUrl: string,
  timeout: number = 10000
): Promise<FrontendTestResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const startTime = Date.now();

  try {
    const urlCheck = validateExternalUrl(bundleUrl);
    if (!urlCheck.valid) {
      return {
        success: false,
        loadTime: 0,
        size: 0,
        bundleValid: false,
        globalName: null,
        errors: [urlCheck.error || 'Invalid URL'],
        warnings: [],
      };
    }

    // Fetch the UMD bundle with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(bundleUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        loadTime: Date.now() - startTime,
        size: 0,
        bundleValid: false,
        globalName: null,
        errors: [`HTTP error: ${response.status} ${response.statusText}`],
        warnings: [],
      };
    }

    const content = await response.text();
    const loadTime = Date.now() - startTime;

    // Validate UMD bundle structure
    const validation = validateUMDBundleContent(content);

    if (!validation.valid) {
      errors.push(...validation.errors);
    }
    warnings.push(...validation.warnings);

    return {
      success: validation.valid,
      loadTime,
      size: content.length,
      bundleValid: validation.valid,
      globalName: validation.globalName,
      errors,
      warnings,
    };
  } catch (error) {
    const loadTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errors.push(`Request timed out after ${timeout}ms`);
      } else {
        errors.push(error.message);
      }
    } else {
      errors.push('Unknown error occurred');
    }

    return {
      success: false,
      loadTime,
      size: 0,
      bundleValid: false,
      globalName: null,
      errors,
      warnings: [],
    };
  }
}

/**
 * Validate UMD bundle content
 */
function validateUMDBundleContent(content: string): {
  valid: boolean;
  globalName: string | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  let globalName: string | null = null;

  // Check for empty content
  if (!content || content.trim().length === 0) {
    errors.push('Bundle file is empty');
    return { valid: false, globalName, errors, warnings };
  }

  // Check for UMD wrapper patterns
  const hasUMDWrapper =
    content.includes('typeof exports') ||
    content.includes('typeof define') ||
    content.includes('factory(global') ||
    content.includes('.mount') ||
    content.includes('NaapPlugin');

  if (!hasUMDWrapper) {
    errors.push('File does not appear to be a valid UMD bundle');
    return { valid: false, globalName, errors, warnings };
  }

  // Extract global name (NaapPlugin*)
  const globalNameMatch = content.match(/(?:global|window)\["?(NaapPlugin[A-Za-z]+)"?\]/);
  if (globalNameMatch) {
    globalName = globalNameMatch[1];
  }

  // Check for mount function (required for UMD plugins)
  const hasMount = content.includes('.mount') || content.includes('mount:');
  if (!hasMount) {
    warnings.push('Bundle may not export a mount function - plugin may fail to render');
  }

  // Warn if React is bundled (should be externalized)
  if (content.includes('react-dom') && content.includes('createElement') && content.length > 200 * 1024) {
    warnings.push('React appears to be bundled - should be externalized for smaller bundle size');
  }

  // Size warning
  if (content.length > 500 * 1024) {
    warnings.push(`Bundle is large (${(content.length / 1024).toFixed(1)}KB) - may impact load time`);
  }

  return {
    valid: errors.length === 0,
    globalName,
    errors,
    warnings,
  };
}

/**
 * Test backend health
 */
export async function testBackendHealth(
  backendUrl: string,
  timeout: number = 5000
): Promise<BackendTestResult> {
  const errors: string[] = [];
  const startTime = Date.now();

  const urlCheck = validateExternalUrl(backendUrl);
  if (!urlCheck.valid) {
    return {
      success: false,
      healthy: false,
      responseTime: 0,
      status: 'error',
      errors: [urlCheck.error || 'Invalid URL'],
    };
  }

  // Normalize URL to health endpoint
  let healthUrl = backendUrl;
  if (!healthUrl.endsWith('/healthz') && !healthUrl.includes('/health')) {
    healthUrl = healthUrl.replace(/\/$/, '') + '/healthz';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(healthUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return {
        success: false,
        healthy: false,
        responseTime,
        status: `HTTP ${response.status}`,
        errors: [`Health check failed: ${response.status} ${response.statusText}`],
      };
    }

    // Try to parse JSON response
    let data: { status?: string; version?: string; endpoints?: string[] } = {};
    try {
      data = await response.json();
    } catch {
      // Non-JSON response is OK if status was 200
    }

    // Determine if healthy - only true if status explicitly says ok/healthy, 
    // or if no status but response was OK
    const healthy = 
      data.status === 'ok' || 
      data.status === 'healthy' || 
      (!data.status && response.ok);

    return {
      success: true,
      healthy,
      responseTime,
      status: data.status || 'ok',
      version: data.version,
      endpoints: data.endpoints,
      errors: [],
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errors.push(`Health check timed out after ${timeout}ms`);
      } else if (error.message.includes('ECONNREFUSED')) {
        errors.push('Backend not running (connection refused)');
      } else {
        errors.push(error.message);
      }
    } else {
      errors.push('Unknown error during health check');
    }

    return {
      success: false,
      healthy: false,
      responseTime,
      status: 'error',
      errors,
    };
  }
}

/**
 * Test complete plugin (frontend + backend)
 */
export async function testPlugin(options: {
  frontendUrl?: string;
  backendUrl?: string;
  frontendTimeout?: number;
  backendTimeout?: number;
}): Promise<PluginTestResult> {
  const {
    frontendUrl,
    backendUrl,
    frontendTimeout = 10000,
    backendTimeout = 5000,
  } = options;

  const overallErrors: string[] = [];
  let frontendResult: FrontendTestResult | undefined;
  let backendResult: BackendTestResult | undefined;

  // Test frontend if URL provided
  if (frontendUrl) {
    frontendResult = await testFrontendLoading(frontendUrl, frontendTimeout);
    if (!frontendResult.success) {
      overallErrors.push(...frontendResult.errors.map(e => `Frontend: ${e}`));
    }
  }

  // Test backend if URL provided
  if (backendUrl) {
    backendResult = await testBackendHealth(backendUrl, backendTimeout);
    if (!backendResult.success || !backendResult.healthy) {
      overallErrors.push(...backendResult.errors.map(e => `Backend: ${e}`));
    }
  }

  // Determine overall success
  const success =
    (!frontendUrl || (frontendResult?.success ?? false)) &&
    (!backendUrl || (backendResult?.healthy ?? false));

  return {
    success,
    frontend: frontendResult,
    backend: backendResult,
    overallErrors,
  };
}
