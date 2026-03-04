export class SSHBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'SSHBridgeError';
  }

  toJSON() {
    return {
      success: false,
      error: { code: this.code, message: this.message },
    };
  }
}

export class HostNotAllowedError extends SSHBridgeError {
  constructor(host: string) {
    super('HOST_NOT_ALLOWED', `Host "${host}" is not in the allowed hosts list`, 403);
  }
}

export class AuthenticationError extends SSHBridgeError {
  constructor(host: string) {
    super('AUTH_FAILED', `SSH authentication failed for host "${host}"`, 401);
  }
}

export class ConnectionError extends SSHBridgeError {
  constructor(host: string, detail?: string) {
    super(
      'CONNECTION_FAILED',
      `SSH connection to "${host}" failed${detail ? `: ${detail}` : ''}`,
      502,
      true,
    );
  }
}

export class CommandTimeoutError extends SSHBridgeError {
  constructor(timeoutMs: number) {
    super('COMMAND_TIMEOUT', `Command timed out after ${timeoutMs}ms`, 504);
  }
}

export class JobNotFoundError extends SSHBridgeError {
  constructor(jobId: string) {
    super('JOB_NOT_FOUND', `Job "${jobId}" not found`, 404);
  }
}

export class JobLimitExceededError extends SSHBridgeError {
  constructor(limit: number) {
    super(
      'JOB_LIMIT_EXCEEDED',
      `Maximum concurrent job limit (${limit}) reached`,
      429,
      true,
    );
  }
}

export class ValidationError extends SSHBridgeError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}
