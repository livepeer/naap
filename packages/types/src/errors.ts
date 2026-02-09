/**
 * Structured Error Types for Plugin System
 *
 * Provides typed errors for better error handling, debugging, and monitoring.
 */

/**
 * Base error class for all plugin-related errors
 */
export class PluginError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

/**
 * Error thrown when plugin loading fails
 */
export class PluginLoadError extends PluginError {
  public readonly pluginName: string;
  public readonly remoteUrl: string;
  public readonly underlyingCause?: Error;

  constructor(
    pluginName: string,
    remoteUrl: string,
    message: string,
    underlyingCause?: Error
  ) {
    super(message, 'PLUGIN_LOAD_ERROR', {
      pluginName,
      remoteUrl,
      cause: underlyingCause?.message,
    });
    this.name = 'PluginLoadError';
    this.pluginName = pluginName;
    this.remoteUrl = remoteUrl;
    this.underlyingCause = underlyingCause;
  }
}

/**
 * Error thrown when plugin configuration is invalid
 */
export class PluginConfigError extends PluginError {
  public readonly pluginName: string;
  public readonly configKey?: string;
  public readonly expectedType?: string;
  public readonly actualValue?: unknown;

  constructor(
    pluginName: string,
    message: string,
    details?: {
      configKey?: string;
      expectedType?: string;
      actualValue?: unknown;
    }
  ) {
    super(message, 'PLUGIN_CONFIG_ERROR', {
      pluginName,
      ...details,
    });
    this.name = 'PluginConfigError';
    this.pluginName = pluginName;
    this.configKey = details?.configKey;
    this.expectedType = details?.expectedType;
    this.actualValue = details?.actualValue;
  }
}

/**
 * Error thrown when plugin manifest validation fails
 * Named differently from the ManifestValidationError interface in plugin.ts
 * to avoid naming conflicts
 */
export class ManifestValidationException extends PluginError {
  public readonly pluginName?: string;
  public readonly validationErrors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;

  constructor(
    message: string,
    validationErrors: Array<{
      field: string;
      message: string;
      severity: 'error' | 'warning';
    }>,
    pluginName?: string
  ) {
    super(message, 'MANIFEST_VALIDATION_ERROR', {
      pluginName,
      errorCount: validationErrors.filter(e => e.severity === 'error').length,
      warningCount: validationErrors.filter(e => e.severity === 'warning').length,
    });
    this.name = 'ManifestValidationException';
    this.pluginName = pluginName;
    this.validationErrors = validationErrors;
  }
}

/**
 * Error thrown when team permission check fails
 */
export class TeamPermissionError extends PluginError {
  public readonly teamId: string;
  public readonly userId: string;
  public readonly requiredPermission: string;
  public readonly userRole?: string;

  constructor(
    teamId: string,
    userId: string,
    requiredPermission: string,
    userRole?: string
  ) {
    super(
      `Permission denied: user lacks '${requiredPermission}' permission`,
      'TEAM_PERMISSION_ERROR',
      { teamId, userId, requiredPermission, userRole }
    );
    this.name = 'TeamPermissionError';
    this.teamId = teamId;
    this.userId = userId;
    this.requiredPermission = requiredPermission;
    this.userRole = userRole;
  }
}

/**
 * Error thrown when team membership validation fails
 */
export class TeamMembershipError extends PluginError {
  public readonly teamId: string;
  public readonly userId: string;

  constructor(teamId: string, userId: string, message?: string) {
    super(
      message || 'User is not a member of this team',
      'TEAM_MEMBERSHIP_ERROR',
      { teamId, userId }
    );
    this.name = 'TeamMembershipError';
    this.teamId = teamId;
    this.userId = userId;
  }
}

/**
 * Error thrown when plugin installation fails
 */
export class PluginInstallError extends PluginError {
  public readonly packageName: string;
  public readonly teamId?: string;
  public readonly phase: 'validation' | 'deployment' | 'access_grant' | 'rollback';
  public readonly underlyingCause?: Error;

  constructor(
    packageName: string,
    phase: 'validation' | 'deployment' | 'access_grant' | 'rollback',
    message: string,
    teamId?: string,
    underlyingCause?: Error
  ) {
    super(message, 'PLUGIN_INSTALL_ERROR', {
      packageName,
      teamId,
      phase,
      cause: underlyingCause?.message,
    });
    this.name = 'PluginInstallError';
    this.packageName = packageName;
    this.teamId = teamId;
    this.phase = phase;
    this.underlyingCause = underlyingCause;
  }
}

/**
 * Error thrown when plugin uninstallation fails
 */
export class PluginUninstallError extends PluginError {
  public readonly installId: string;
  public readonly reason: 'not_found' | 'core_plugin' | 'permission_denied' | 'cleanup_failed';

  constructor(
    installId: string,
    reason: 'not_found' | 'core_plugin' | 'permission_denied' | 'cleanup_failed',
    message: string
  ) {
    super(message, 'PLUGIN_UNINSTALL_ERROR', { installId, reason });
    this.name = 'PluginUninstallError';
    this.installId = installId;
    this.reason = reason;
  }
}

/**
 * Error thrown when deployment operations fail
 */
export class DeploymentError extends PluginError {
  public readonly deploymentId?: string;
  public readonly packageId?: string;
  public readonly operation: 'create' | 'start' | 'stop' | 'cleanup' | 'upgrade';

  constructor(
    operation: 'create' | 'start' | 'stop' | 'cleanup' | 'upgrade',
    message: string,
    details?: { deploymentId?: string; packageId?: string }
  ) {
    super(message, 'DEPLOYMENT_ERROR', { operation, ...details });
    this.name = 'DeploymentError';
    this.deploymentId = details?.deploymentId;
    this.packageId = details?.packageId;
    this.operation = operation;
  }
}

/**
 * Error thrown when circuit breaker trips
 */
export class CircuitBreakerError extends PluginError {
  public readonly pluginName: string;
  public readonly failureCount: number;
  public readonly cooldownUntil: Date;

  constructor(pluginName: string, failureCount: number, cooldownUntil: Date) {
    super(
      `Plugin '${pluginName}' circuit breaker tripped after ${failureCount} failures`,
      'CIRCUIT_BREAKER_ERROR',
      { pluginName, failureCount, cooldownUntil: cooldownUntil.toISOString() }
    );
    this.name = 'CircuitBreakerError';
    this.pluginName = pluginName;
    this.failureCount = failureCount;
    this.cooldownUntil = cooldownUntil;
  }
}

/**
 * Error thrown when API request fails after retries
 */
export class ApiRequestError extends PluginError {
  public readonly url: string;
  public readonly method: string;
  public readonly statusCode?: number;
  public readonly attemptCount: number;

  constructor(
    url: string,
    method: string,
    message: string,
    attemptCount: number,
    statusCode?: number
  ) {
    super(message, 'API_REQUEST_ERROR', {
      url,
      method,
      statusCode,
      attemptCount,
    });
    this.name = 'ApiRequestError';
    this.url = url;
    this.method = method;
    this.statusCode = statusCode;
    this.attemptCount = attemptCount;
  }
}

/**
 * Error thrown when URL validation fails for security reasons
 */
export class SecurityError extends PluginError {
  public readonly reason: 'invalid_url' | 'untrusted_origin' | 'csrf_mismatch' | 'invalid_team_context';

  constructor(
    reason: 'invalid_url' | 'untrusted_origin' | 'csrf_mismatch' | 'invalid_team_context',
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'SECURITY_ERROR', { reason, ...details });
    this.name = 'SecurityError';
    this.reason = reason;
  }
}

/**
 * Type guard to check if an error is a PluginError
 */
export function isPluginError(error: unknown): error is PluginError {
  return error instanceof PluginError;
}

/**
 * Extract error details for logging/reporting
 */
export function extractErrorDetails(error: unknown): {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  stack?: string;
} {
  if (isPluginError(error)) {
    return {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}
