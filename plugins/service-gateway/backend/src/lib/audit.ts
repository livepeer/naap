import winston from 'winston';

export interface AuditEntry {
  requestId: string;
  jobId?: string;
  actor: string;
  action: string;
  targetHost: string;
  targetPort: number;
  username: string;
  command?: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  exitCode?: number;
  durationMs?: number;
  bytesTransferred?: number;
  error?: string;
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: { service: 'ssh-bridge' },
  transports: [new winston.transports.Console()],
});

export function audit(entry: AuditEntry): void {
  const sanitized = { ...entry };
  if (sanitized.command && sanitized.command.length > 500) {
    sanitized.command = sanitized.command.slice(0, 500) + '...(truncated)';
  }
  logger.info('audit', sanitized);
}

export function logError(message: string, error?: unknown): void {
  logger.error(message, {
    error: error instanceof Error ? error.message : String(error),
  });
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  logger.info(message, meta);
}
