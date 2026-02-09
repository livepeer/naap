/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --only base-svc
 *   pm2 reload ecosystem.config.cjs
 *   pm2 stop ecosystem.config.cjs
 *
 * For development: Use ./bin/start.sh instead
 * For production: Use this file with PM2
 */

module.exports = {
  apps: [
    // Core Services
    {
      name: 'base-svc',
      script: 'dist/server.js',
      cwd: './services/base-svc',
      instances: 'max',  // Use all CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
      },
      max_memory_restart: '500M',
      kill_timeout: 30000,  // 30s for graceful shutdown
      wait_ready: true,
      listen_timeout: 10000,
      error_file: './logs/base-svc-error.log',
      out_file: './logs/base-svc-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'plugin-server',
      script: 'dist/server.js',
      cwd: './services/plugin-server',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
      max_memory_restart: '256M',
      error_file: './logs/plugin-server-error.log',
      out_file: './logs/plugin-server-out.log',
      merge_logs: true,
    },

    // Plugin Backends
    {
      name: 'my-wallet-svc',
      script: 'dist/server.js',
      cwd: './plugins/my-wallet/backend',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4008,
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
      },
      max_memory_restart: '300M',
      kill_timeout: 30000,
      error_file: './logs/my-wallet-svc-error.log',
      out_file: './logs/my-wallet-svc-out.log',
      merge_logs: true,
    },
    {
      name: 'my-dashboard-svc',
      script: 'dist/server.js',
      cwd: './plugins/my-dashboard/backend',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4009,
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
      },
      max_memory_restart: '300M',
      kill_timeout: 30000,
      error_file: './logs/my-dashboard-svc-error.log',
      out_file: './logs/my-dashboard-svc-out.log',
      merge_logs: true,
    },
  ],
};
