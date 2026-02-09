/**
 * Debug Console Types
 *
 * Types for the plugin debug terminal feature that allows users
 * to view plugin logs, errors, and health status in real-time.
 */

/**
 * Log level for filtering and styling
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Source of the log entry
 */
export type LogSource = 'backend' | 'frontend' | 'console' | 'system';

/**
 * Single log entry in the debug console
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  plugin: string;
  message: string;
  metadata?: Record<string, unknown>;
  source: LogSource;
  /** Stack trace for errors */
  stack?: string;
}

/**
 * Debug console state
 */
export interface DebugState {
  isOpen: boolean;
  height: number;
  activeTab: string | null;
  tabs: string[];
  logs: Map<string, LogEntry[]>;
  filters: DebugFilters;
}

/**
 * Log filtering options
 */
export interface DebugFilters {
  level: LogLevel | 'all';
  search: string;
  source: LogSource | 'all';
}

/**
 * Debug console commands
 */
export type DebugCommand =
  | { type: 'open'; plugin: string }
  | { type: 'close'; plugin: string }
  | { type: 'clear'; plugin?: string }
  | { type: 'level'; level: LogLevel | 'all' }
  | { type: 'restart'; plugin: string }
  | { type: 'health' }
  | { type: 'export'; plugin?: string }
  | { type: 'help' };

/**
 * Command parser result
 */
export interface ParsedCommand {
  command: DebugCommand | null;
  error?: string;
}

/**
 * WebSocket message types for debug streaming
 */
export type DebugWSMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'log'
  | 'logs_batch'
  | 'health_update'
  | 'error'
  | 'connected';

/**
 * WebSocket message for debug streaming
 */
export interface DebugWSMessage {
  type: DebugWSMessageType;
  plugin?: string;
  data?: LogEntry | LogEntry[] | PluginHealthUpdate | string;
  timestamp: string;
}

/**
 * Plugin health update from backend
 */
export interface PluginHealthUpdate {
  plugin: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  uptime?: number;
  lastError?: string;
  lastErrorTime?: string;
  metrics?: {
    requestsPerMinute?: number;
    errorRate?: number;
    avgResponseTime?: number;
  };
}

/**
 * User debug access settings
 */
export interface UserDebugSettings {
  debugEnabled: boolean;
  updatedAt: string;
  updatedBy?: string;
}

/**
 * Debug console configuration
 */
export interface DebugConsoleConfig {
  /** Maximum log entries per plugin */
  maxLogsPerPlugin: number;
  /** Default panel height in pixels */
  defaultHeight: number;
  /** Minimum panel height */
  minHeight: number;
  /** Maximum panel height */
  maxHeight: number;
  /** Auto-scroll new logs */
  autoScroll: boolean;
  /** Show timestamps */
  showTimestamps: boolean;
  /** Timestamp format: 'relative' or 'absolute' */
  timestampFormat: 'relative' | 'absolute';
}

/**
 * Default debug console configuration
 */
export const DEFAULT_DEBUG_CONFIG: DebugConsoleConfig = {
  maxLogsPerPlugin: 1000,
  defaultHeight: 300,
  minHeight: 150,
  maxHeight: 600,
  autoScroll: true,
  showTimestamps: true,
  timestampFormat: 'relative',
};

/**
 * Parse a command string into a DebugCommand
 */
export function parseDebugCommand(input: string): ParsedCommand {
  const trimmed = input.trim().toLowerCase();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0];
  const arg = parts[1];

  switch (cmd) {
    case 'open':
      if (!arg) return { command: null, error: 'Usage: open <plugin-name>' };
      return { command: { type: 'open', plugin: arg } };

    case 'close':
      if (!arg) return { command: null, error: 'Usage: close <plugin-name>' };
      return { command: { type: 'close', plugin: arg } };

    case 'clear':
      return { command: { type: 'clear', plugin: arg } };

    case 'level':
      if (!arg || !['all', 'debug', 'info', 'warn', 'error'].includes(arg)) {
        return { command: null, error: 'Usage: level <all|debug|info|warn|error>' };
      }
      return { command: { type: 'level', level: arg as LogLevel | 'all' } };

    case 'restart':
      if (!arg) return { command: null, error: 'Usage: restart <plugin-name>' };
      return { command: { type: 'restart', plugin: arg } };

    case 'health':
      return { command: { type: 'health' } };

    case 'export':
      return { command: { type: 'export', plugin: arg } };

    case 'help':
    case '?':
      return { command: { type: 'help' } };

    default:
      // Treat unknown command as plugin name to open
      if (cmd) {
        return { command: { type: 'open', plugin: cmd } };
      }
      return { command: null };
  }
}

/**
 * Format a log entry for display
 */
export function formatLogMessage(entry: LogEntry, config?: Partial<DebugConsoleConfig>): string {
  const cfg = { ...DEFAULT_DEBUG_CONFIG, ...config };

  let timestamp = '';
  if (cfg.showTimestamps) {
    const date = new Date(entry.timestamp);
    if (cfg.timestampFormat === 'relative') {
      const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) timestamp = `${seconds}s ago`;
      else if (seconds < 3600) timestamp = `${Math.floor(seconds / 60)}m ago`;
      else timestamp = `${Math.floor(seconds / 3600)}h ago`;
    } else {
      timestamp = date.toLocaleTimeString();
    }
  }

  const level = entry.level.toUpperCase().padEnd(5);
  return `[${timestamp}] ${level} ${entry.message}`;
}

/**
 * Get CSS class for log level
 */
export function getLogLevelClass(level: LogLevel): string {
  switch (level) {
    case 'error': return 'text-accent-rose';
    case 'warn': return 'text-accent-amber';
    case 'info': return 'text-accent-blue';
    case 'debug': return 'text-text-secondary';
    default: return 'text-text-primary';
  }
}

/**
 * Help text for debug console commands
 */
export const DEBUG_HELP_TEXT = `
Available commands:
  open <plugin>     Open a tab for the specified plugin
  close <plugin>    Close the plugin's tab
  clear [plugin]    Clear logs (current tab or specified plugin)
  level <level>     Filter logs: all, debug, info, warn, error
  restart <plugin>  Restart the specified plugin
  health            Show health status for all plugins
  export [plugin]   Export logs as JSON file
  help              Show this help message

Tip: Type a plugin name directly to open its tab.
`.trim();
