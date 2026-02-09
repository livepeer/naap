# Plugin Platform Implementation Plan

## Vision: From User Stories to Production in Minutes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VIBE CODING FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   plugin.md (User Stories)                                                   │
│        │                                                                     │
│        ▼                                                                     │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│   │   AI Code   │───▶│  Automated  │───▶│   Safe      │───▶│  Live in    │ │
│   │  Generation │    │   Testing   │    │  Deployment │    │  Production │ │
│   └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘ │
│                                                                              │
│   "I want users to    Tests pass?        Blue-green         Monitoring      │
│    track expenses"    Contract valid?    Canary rollout     Auto-rollback   │
│                       Performance OK?    Health checks      Alerts          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Executive Summary

This plan implements a **production-ready plugin platform** that serves as the foundation for AI-assisted plugin development. The key insight is that **good infrastructure enables AI coding** - when deployment is safe, testing is automated, and rollback is instant, AI can iterate rapidly without fear.

### Goals
1. **Phase 1 (8 weeks)**: Production deployment infrastructure
2. **Phase 2 (6 weeks)**: Testing & preview environments
3. **Phase 3 (4 weeks)**: AI-assisted development foundation

### Total Timeline: 18 weeks (4.5 months)

---

## Architecture Overview

### Target State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PLUGIN PLATFORM                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   CLI        │  │   Portal     │  │   AI Studio  │  │   API        │    │
│  │   naap-*     │  │   Web UI     │  │   Vibe Code  │  │   REST/GQL   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │             │
│         └─────────────────┴─────────────────┴─────────────────┘             │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        CONTROL PLANE                                  │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │   │
│  │  │ Deployment │  │  Traffic   │  │   Config   │  │  Secrets   │     │   │
│  │  │  Manager   │  │  Router    │  │   Store    │  │   Vault    │     │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         DATA PLANE                                    │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │   │
│  │  │  Frontend  │  │  Backend   │  │  Database  │  │   Worker   │     │   │
│  │  │    CDN     │  │ Containers │  │   Pools    │  │   Queues   │     │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       OBSERVABILITY                                   │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │   │
│  │  │  Metrics   │  │   Logs     │  │   Traces   │  │   Alerts   │     │   │
│  │  │ Collection │  │ Aggregator │  │  Collector │  │   Engine   │     │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Production Deployment Infrastructure (8 weeks)

### Week 1-2: Deployment Manager Core

#### 1.1 Database Schema Extensions

```prisma
// Add to apps/web-next/prisma/schema.prisma

model PluginDeploymentSlot {
  id              String   @id @default(uuid())
  deploymentId    String
  deployment      PluginDeployment @relation(fields: [deploymentId], references: [id])
  slot            String   // "blue" | "green"
  version         String
  status          String   // "active" | "inactive" | "deploying" | "failed"
  trafficPercent  Int      @default(0)
  containerUrl    String?
  healthStatus    String?
  lastHealthCheck DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([deploymentId, slot])
  @@index([deploymentId])
}

model DeploymentEvent {
  id              String   @id @default(uuid())
  deploymentId    String
  type            String   // "deploy_start" | "health_check" | "traffic_shift" | "rollback" | "complete"
  fromSlot        String?
  toSlot          String?
  fromVersion     String?
  toVersion       String?
  trafficPercent  Int?
  status          String   // "success" | "failure"
  error           String?
  metadata        Json?
  createdAt       DateTime @default(now())

  @@index([deploymentId])
  @@index([createdAt])
}

model PluginMetrics {
  id              String   @id @default(uuid())
  deploymentId    String
  timestamp       DateTime @default(now())
  requestCount    Int      @default(0)
  errorCount      Int      @default(0)
  latencyP50      Float?
  latencyP95      Float?
  latencyP99      Float?
  activeUsers     Int      @default(0)
  memoryUsage     Float?
  cpuUsage        Float?

  @@index([deploymentId, timestamp])
}

model PluginAlert {
  id              String   @id @default(uuid())
  deploymentId    String
  name            String
  condition       String   // "error_rate > 0.05" | "latency_p99 > 2000"
  threshold       Float
  duration        Int      // seconds
  severity        String   // "critical" | "warning" | "info"
  channels        Json     // ["slack:#alerts", "email:ops@example.com"]
  enabled         Boolean  @default(true)
  lastTriggered   DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([deploymentId])
}
```

#### 1.2 Deployment Manager Service

```typescript
// services/deployment-manager/src/services/DeploymentManager.ts

export interface DeploymentStrategy {
  type: 'immediate' | 'blue-green' | 'canary' | 'rolling';
  canary?: {
    initialPercent: number;
    incrementPercent: number;
    intervalMinutes: number;
    successThreshold: number;
  };
  healthCheck?: {
    endpoint: string;
    intervalSeconds: number;
    timeoutSeconds: number;
    unhealthyThreshold: number;
  };
  rollback?: {
    onErrorRate: number;
    onLatencyP99: number;
    onHealthCheckFail: boolean;
  };
}

export interface DeploymentRequest {
  pluginName: string;
  version: string;
  frontendBundleUrl?: string;
  backendImage?: string;
  strategy: DeploymentStrategy;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

export class DeploymentManager {
  constructor(
    private db: PrismaClient,
    private containerOrchestrator: ContainerOrchestrator,
    private cdnManager: CDNManager,
    private metricsCollector: MetricsCollector,
    private alertEngine: AlertEngine,
  ) {}

  async deploy(request: DeploymentRequest): Promise<DeploymentResult> {
    const deployment = await this.getOrCreateDeployment(request.pluginName);

    // Determine target slot
    const activeSlot = await this.getActiveSlot(deployment.id);
    const targetSlot = activeSlot === 'blue' ? 'green' : 'blue';

    // Create deployment event
    await this.recordEvent(deployment.id, 'deploy_start', {
      fromSlot: activeSlot,
      toSlot: targetSlot,
      toVersion: request.version,
    });

    try {
      // 1. Deploy to inactive slot
      await this.deployToSlot(deployment.id, targetSlot, request);

      // 2. Run health checks
      const healthy = await this.waitForHealthy(deployment.id, targetSlot, request.strategy);
      if (!healthy) {
        throw new Error('Health checks failed');
      }

      // 3. Execute traffic shifting based on strategy
      await this.executeStrategy(deployment.id, request.strategy, activeSlot, targetSlot);

      // 4. Mark deployment complete
      await this.recordEvent(deployment.id, 'complete', {
        fromSlot: activeSlot,
        toSlot: targetSlot,
        toVersion: request.version,
        status: 'success',
      });

      return { success: true, deploymentId: deployment.id, slot: targetSlot };

    } catch (error) {
      // Auto-rollback on failure
      await this.rollback(deployment.id, activeSlot, error);
      throw error;
    }
  }

  async rollback(deploymentId: string, targetSlot?: string, error?: Error): Promise<void> {
    const activeSlot = await this.getActiveSlot(deploymentId);
    const rollbackSlot = targetSlot || (activeSlot === 'blue' ? 'green' : 'blue');

    await this.recordEvent(deploymentId, 'rollback', {
      fromSlot: activeSlot,
      toSlot: rollbackSlot,
      status: 'success',
      error: error?.message,
    });

    // Immediate traffic shift to rollback slot
    await this.shiftTraffic(deploymentId, rollbackSlot, 100);
  }

  private async executeStrategy(
    deploymentId: string,
    strategy: DeploymentStrategy,
    fromSlot: string,
    toSlot: string,
  ): Promise<void> {
    switch (strategy.type) {
      case 'immediate':
        await this.shiftTraffic(deploymentId, toSlot, 100);
        break;

      case 'blue-green':
        // Wait for manual approval or auto-approve after health checks
        await this.shiftTraffic(deploymentId, toSlot, 100);
        break;

      case 'canary':
        await this.executeCanary(deploymentId, strategy.canary!, fromSlot, toSlot);
        break;

      case 'rolling':
        await this.executeRolling(deploymentId, fromSlot, toSlot);
        break;
    }
  }

  private async executeCanary(
    deploymentId: string,
    config: NonNullable<DeploymentStrategy['canary']>,
    fromSlot: string,
    toSlot: string,
  ): Promise<void> {
    let currentPercent = config.initialPercent;

    while (currentPercent < 100) {
      // Shift traffic
      await this.shiftTraffic(deploymentId, toSlot, currentPercent);

      // Wait and measure
      await this.sleep(config.intervalMinutes * 60 * 1000);

      // Check success metrics
      const metrics = await this.metricsCollector.getMetrics(deploymentId, toSlot);
      const successRate = 1 - (metrics.errorCount / metrics.requestCount);

      if (successRate < config.successThreshold) {
        throw new Error(`Canary failed: success rate ${successRate} below threshold ${config.successThreshold}`);
      }

      // Increment
      currentPercent = Math.min(100, currentPercent + config.incrementPercent);
    }

    // Full rollout
    await this.shiftTraffic(deploymentId, toSlot, 100);
  }
}
```

#### 1.3 Container Orchestrator Interface

```typescript
// services/deployment-manager/src/services/ContainerOrchestrator.ts

export interface ContainerConfig {
  image: string;
  name: string;
  port: number;
  env: Record<string, string>;
  resources: {
    memory: string;  // "256Mi"
    cpu: string;     // "0.25"
  };
  healthCheck: {
    path: string;
    port: number;
    intervalSeconds: number;
  };
  replicas: number;
}

export interface ContainerOrchestrator {
  deploy(config: ContainerConfig): Promise<ContainerDeployment>;
  scale(deploymentName: string, replicas: number): Promise<void>;
  stop(deploymentName: string): Promise<void>;
  getStatus(deploymentName: string): Promise<ContainerStatus>;
  getLogs(deploymentName: string, options?: LogOptions): AsyncIterable<string>;
  execHealthCheck(deploymentName: string): Promise<HealthCheckResult>;
}

// Vercel-compatible implementation using Vercel Functions + Edge
export class VercelContainerOrchestrator implements ContainerOrchestrator {
  // For Vercel, we use serverless functions instead of containers
  // Backend plugins compile to Vercel Functions

  async deploy(config: ContainerConfig): Promise<ContainerDeployment> {
    // 1. Upload function code to Vercel
    // 2. Configure environment variables
    // 3. Set up routing
    // 4. Return deployment URL
  }
}

// Kubernetes implementation for self-hosted
export class KubernetesOrchestrator implements ContainerOrchestrator {
  constructor(private k8sClient: KubernetesClient) {}

  async deploy(config: ContainerConfig): Promise<ContainerDeployment> {
    // Create Kubernetes Deployment + Service
  }
}

// Docker Compose for local development
export class DockerComposeOrchestrator implements ContainerOrchestrator {
  async deploy(config: ContainerConfig): Promise<ContainerDeployment> {
    // docker-compose up with dynamic config
  }
}
```

### Week 3-4: Traffic Router & Health Monitoring

#### 3.1 Traffic Router

```typescript
// services/deployment-manager/src/services/TrafficRouter.ts

export interface TrafficRule {
  deploymentId: string;
  rules: Array<{
    slot: string;
    weight: number;  // 0-100
    conditions?: {
      headers?: Record<string, string>;  // For A/B testing
      userIds?: string[];                 // For beta testing
      percentage?: number;                // Random percentage
    };
  }>;
}

export class TrafficRouter {
  constructor(
    private db: PrismaClient,
    private cache: RedisClient,
  ) {}

  async getTargetSlot(deploymentId: string, request: IncomingRequest): Promise<string> {
    const rules = await this.getRules(deploymentId);

    // Check header-based routing first (for testing)
    if (request.headers['x-plugin-slot']) {
      return request.headers['x-plugin-slot'];
    }

    // Check user-based routing (beta users)
    const userId = request.userId;
    for (const rule of rules) {
      if (rule.conditions?.userIds?.includes(userId)) {
        return rule.slot;
      }
    }

    // Weighted random selection
    const random = Math.random() * 100;
    let cumulative = 0;

    for (const rule of rules) {
      cumulative += rule.weight;
      if (random < cumulative) {
        return rule.slot;
      }
    }

    return 'blue'; // Default
  }

  async updateWeights(deploymentId: string, slot: string, weight: number): Promise<void> {
    const otherSlot = slot === 'blue' ? 'green' : 'blue';
    const otherWeight = 100 - weight;

    await this.db.pluginDeploymentSlot.updateMany({
      where: { deploymentId },
      data: { trafficPercent: 0 },
    });

    await this.db.pluginDeploymentSlot.update({
      where: { deploymentId_slot: { deploymentId, slot } },
      data: { trafficPercent: weight },
    });

    await this.db.pluginDeploymentSlot.update({
      where: { deploymentId_slot: { deploymentId, slot: otherSlot } },
      data: { trafficPercent: otherWeight },
    });

    // Invalidate cache
    await this.cache.del(`traffic:${deploymentId}`);
  }
}
```

#### 3.2 Health Monitor

```typescript
// services/deployment-manager/src/services/HealthMonitor.ts

export class HealthMonitor {
  private checks: Map<string, NodeJS.Timer> = new Map();

  constructor(
    private db: PrismaClient,
    private alertEngine: AlertEngine,
  ) {}

  async startMonitoring(deploymentId: string, slot: string, config: HealthCheckConfig): Promise<void> {
    const key = `${deploymentId}:${slot}`;

    // Clear existing check
    if (this.checks.has(key)) {
      clearInterval(this.checks.get(key)!);
    }

    // Start new check
    const timer = setInterval(async () => {
      await this.performHealthCheck(deploymentId, slot, config);
    }, config.intervalSeconds * 1000);

    this.checks.set(key, timer);
  }

  private async performHealthCheck(
    deploymentId: string,
    slot: string,
    config: HealthCheckConfig,
  ): Promise<void> {
    const slotData = await this.db.pluginDeploymentSlot.findUnique({
      where: { deploymentId_slot: { deploymentId, slot } },
    });

    if (!slotData?.containerUrl) return;

    const startTime = Date.now();
    let status: 'healthy' | 'unhealthy' = 'unhealthy';
    let error: string | undefined;

    try {
      const response = await fetch(`${slotData.containerUrl}${config.endpoint}`, {
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'healthy' || data.status === 'ok') {
          status = 'healthy';
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    }

    const latency = Date.now() - startTime;

    // Update status
    await this.db.pluginDeploymentSlot.update({
      where: { deploymentId_slot: { deploymentId, slot } },
      data: {
        healthStatus: status,
        lastHealthCheck: new Date(),
      },
    });

    // Record metric
    await this.db.pluginMetrics.create({
      data: {
        deploymentId,
        latencyP50: latency,
        errorCount: status === 'unhealthy' ? 1 : 0,
        requestCount: 1,
      },
    });

    // Check alert conditions
    if (status === 'unhealthy') {
      await this.alertEngine.checkCondition(deploymentId, 'health_check_failed', { error });
    }
  }
}
```

### Week 5-6: CLI Commands & API

#### 5.1 Deploy Command

```typescript
// packages/plugin-sdk/cli/commands/deploy.ts

export const deployCommand = new Command('deploy')
  .description('Deploy plugin to production')
  .option('-s, --strategy <strategy>', 'Deployment strategy', 'blue-green')
  .option('--canary-percent <percent>', 'Initial canary percentage', '5')
  .option('--canary-increment <percent>', 'Canary increment percentage', '25')
  .option('--canary-interval <minutes>', 'Canary interval in minutes', '15')
  .option('--auto-rollback', 'Enable automatic rollback on failure', true)
  .option('--skip-health-check', 'Skip health checks (dangerous)')
  .option('--dry-run', 'Show what would be deployed')
  .action(async (options) => {
    const cwd = process.cwd();
    const manifest = await loadManifest(cwd);

    console.log(chalk.bold.blue(`\n🚀 Deploying ${manifest.displayName} v${manifest.version}\n`));

    // Build deployment request
    const request: DeploymentRequest = {
      pluginName: manifest.name,
      version: manifest.version,
      frontendBundleUrl: await getFrontendUrl(cwd, manifest),
      backendImage: await getBackendImage(cwd, manifest),
      strategy: buildStrategy(options),
    };

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN - Would deploy:'));
      console.log(JSON.stringify(request, null, 2));
      return;
    }

    // Execute deployment
    const spinner = ora('Starting deployment...').start();

    try {
      const client = await getDeploymentClient();
      const result = await client.deploy(request);

      spinner.succeed('Deployment initiated');

      // Stream deployment progress
      console.log(chalk.cyan('\nDeployment Progress:\n'));

      for await (const event of client.streamEvents(result.deploymentId)) {
        switch (event.type) {
          case 'health_check':
            console.log(chalk.gray(`  ✓ Health check: ${event.status}`));
            break;
          case 'traffic_shift':
            const bar = createProgressBar(event.trafficPercent);
            console.log(chalk.cyan(`  Traffic: ${bar} ${event.trafficPercent}%`));
            break;
          case 'complete':
            console.log(chalk.green.bold(`\n✓ Deployment complete!\n`));
            break;
          case 'rollback':
            console.log(chalk.red(`\n✗ Deployment failed, rolled back\n`));
            console.log(chalk.red(`  Error: ${event.error}`));
            break;
        }
      }

    } catch (error) {
      spinner.fail('Deployment failed');
      console.error(chalk.red(error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });
```

#### 5.2 Rollback Command

```typescript
// packages/plugin-sdk/cli/commands/rollback.ts

export const rollbackCommand = new Command('rollback')
  .description('Rollback to previous version')
  .option('-v, --version <version>', 'Specific version to rollback to')
  .option('--force', 'Force rollback without confirmation')
  .action(async (options) => {
    const manifest = await loadManifest(process.cwd());

    console.log(chalk.bold.yellow(`\n⚠️  Rolling back ${manifest.displayName}\n`));

    const client = await getDeploymentClient();
    const deployment = await client.getDeployment(manifest.name);

    // Show current state
    console.log('Current state:');
    console.log(`  Active slot: ${deployment.activeSlot}`);
    console.log(`  Version: ${deployment.activeVersion}`);
    console.log(`  Inactive slot: ${deployment.inactiveSlot}`);
    console.log(`  Previous version: ${deployment.inactiveVersion}`);

    if (!options.force) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Rollback to ${deployment.inactiveVersion}?`,
        default: false,
      }]);

      if (!confirm) {
        console.log(chalk.yellow('Rollback cancelled'));
        return;
      }
    }

    const spinner = ora('Rolling back...').start();

    try {
      await client.rollback(manifest.name, options.version);
      spinner.succeed(`Rolled back to ${deployment.inactiveVersion}`);
      console.log(chalk.green('\n✓ Rollback complete\n'));
    } catch (error) {
      spinner.fail('Rollback failed');
      console.error(chalk.red(error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });
```

#### 5.3 Status Command

```typescript
// packages/plugin-sdk/cli/commands/status.ts

export const statusCommand = new Command('status')
  .description('Show plugin deployment status')
  .option('-w, --watch', 'Watch for changes')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const manifest = await loadManifest(process.cwd());
    const client = await getDeploymentClient();

    const display = async () => {
      const status = await client.getStatus(manifest.name);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.clear();
      console.log(chalk.bold.blue(`\n📊 ${manifest.displayName} Status\n`));

      // Version info
      console.log(`Version: ${chalk.cyan(status.activeVersion)}`);
      console.log(`Status: ${statusBadge(status.healthStatus)}`);
      console.log(`Deployed: ${formatRelativeTime(status.deployedAt)}`);
      console.log('');

      // Metrics (last 24h)
      console.log(chalk.bold('Metrics (24h):'));
      console.log(`  Requests: ${formatNumber(status.metrics.requestCount)}`);
      console.log(`  Errors: ${status.metrics.errorCount} (${status.metrics.errorRate.toFixed(2)}%)`);
      console.log(`  Latency: p50=${status.metrics.latencyP50}ms p99=${status.metrics.latencyP99}ms`);
      console.log(`  Active Users: ${status.metrics.activeUsers}`);
      console.log('');

      // Slots
      console.log(chalk.bold('Deployment Slots:'));
      for (const slot of status.slots) {
        const active = slot.trafficPercent > 0 ? chalk.green('●') : chalk.gray('○');
        console.log(`  ${active} ${slot.name}: v${slot.version} (${slot.trafficPercent}% traffic)`);
      }
      console.log('');

      // Alerts
      if (status.activeAlerts.length > 0) {
        console.log(chalk.bold.red('Active Alerts:'));
        for (const alert of status.activeAlerts) {
          console.log(`  ⚠️  ${alert.name}: ${alert.message}`);
        }
      }
    };

    await display();

    if (options.watch) {
      setInterval(display, 5000);
    }
  });
```

### Week 7-8: Monitoring & Alerts

#### 7.1 Metrics Collector

```typescript
// services/deployment-manager/src/services/MetricsCollector.ts

export class MetricsCollector {
  constructor(
    private db: PrismaClient,
    private timeseries: TimeSeriesDB,  // InfluxDB or TimescaleDB
  ) {}

  async recordRequest(deploymentId: string, metrics: RequestMetrics): Promise<void> {
    await this.timeseries.write({
      measurement: 'plugin_requests',
      tags: {
        deployment_id: deploymentId,
        slot: metrics.slot,
        status: metrics.status.toString(),
        path: metrics.path,
      },
      fields: {
        latency: metrics.latencyMs,
        size: metrics.responseSize,
      },
      timestamp: new Date(),
    });
  }

  async getMetrics(deploymentId: string, timeRange: TimeRange): Promise<AggregatedMetrics> {
    const result = await this.timeseries.query(`
      SELECT
        COUNT(*) as request_count,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as error_count,
        PERCENTILE(latency, 0.50) as latency_p50,
        PERCENTILE(latency, 0.95) as latency_p95,
        PERCENTILE(latency, 0.99) as latency_p99,
        COUNT(DISTINCT user_id) as active_users
      FROM plugin_requests
      WHERE deployment_id = '${deploymentId}'
        AND time >= '${timeRange.start.toISOString()}'
        AND time <= '${timeRange.end.toISOString()}'
    `);

    return result[0];
  }

  async getTimeSeries(deploymentId: string, timeRange: TimeRange, interval: string): Promise<TimeSeriesData[]> {
    return await this.timeseries.query(`
      SELECT
        time_bucket('${interval}', time) as bucket,
        COUNT(*) as requests,
        AVG(latency) as avg_latency
      FROM plugin_requests
      WHERE deployment_id = '${deploymentId}'
        AND time >= '${timeRange.start.toISOString()}'
      GROUP BY bucket
      ORDER BY bucket
    `);
  }
}
```

#### 7.2 Alert Engine

```typescript
// services/deployment-manager/src/services/AlertEngine.ts

export class AlertEngine {
  constructor(
    private db: PrismaClient,
    private metricsCollector: MetricsCollector,
    private notificationService: NotificationService,
  ) {}

  async evaluateAlerts(deploymentId: string): Promise<void> {
    const alerts = await this.db.pluginAlert.findMany({
      where: { deploymentId, enabled: true },
    });

    const metrics = await this.metricsCollector.getMetrics(deploymentId, {
      start: new Date(Date.now() - 5 * 60 * 1000),  // Last 5 minutes
      end: new Date(),
    });

    for (const alert of alerts) {
      const triggered = this.evaluateCondition(alert.condition, metrics);

      if (triggered) {
        await this.triggerAlert(alert, metrics);
      }
    }
  }

  private evaluateCondition(condition: string, metrics: AggregatedMetrics): boolean {
    // Parse condition like "error_rate > 0.05" or "latency_p99 > 2000"
    const [metric, operator, threshold] = condition.split(/\s+/);
    const value = this.getMetricValue(metric, metrics);
    const thresholdNum = parseFloat(threshold);

    switch (operator) {
      case '>': return value > thresholdNum;
      case '<': return value < thresholdNum;
      case '>=': return value >= thresholdNum;
      case '<=': return value <= thresholdNum;
      case '==': return value === thresholdNum;
      default: return false;
    }
  }

  private async triggerAlert(alert: PluginAlert, metrics: AggregatedMetrics): Promise<void> {
    // Check cooldown
    if (alert.lastTriggered) {
      const cooldown = 5 * 60 * 1000; // 5 minutes
      if (Date.now() - alert.lastTriggered.getTime() < cooldown) {
        return;
      }
    }

    // Update last triggered
    await this.db.pluginAlert.update({
      where: { id: alert.id },
      data: { lastTriggered: new Date() },
    });

    // Send notifications
    const channels = alert.channels as string[];
    for (const channel of channels) {
      await this.notificationService.send(channel, {
        type: 'alert',
        severity: alert.severity,
        title: alert.name,
        message: `Alert triggered: ${alert.condition}`,
        metrics,
      });
    }
  }
}
```

#### 7.3 Logs Command

```typescript
// packages/plugin-sdk/cli/commands/logs.ts

export const logsCommand = new Command('logs')
  .description('Stream plugin logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '100')
  .option('--level <level>', 'Filter by log level (debug, info, warn, error)')
  .option('--since <duration>', 'Show logs since duration (e.g., 1h, 30m)')
  .option('--slot <slot>', 'Show logs from specific slot (blue/green)')
  .action(async (options) => {
    const manifest = await loadManifest(process.cwd());
    const client = await getDeploymentClient();

    const logOptions: LogOptions = {
      lines: parseInt(options.lines),
      level: options.level,
      since: options.since ? parseDuration(options.since) : undefined,
      slot: options.slot,
    };

    if (options.follow) {
      console.log(chalk.cyan(`Streaming logs for ${manifest.name}...\n`));

      for await (const log of client.streamLogs(manifest.name, logOptions)) {
        const levelColor = {
          debug: chalk.gray,
          info: chalk.blue,
          warn: chalk.yellow,
          error: chalk.red,
        }[log.level] || chalk.white;

        const timestamp = formatTimestamp(log.timestamp);
        console.log(`${chalk.gray(timestamp)} ${levelColor(log.level.toUpperCase().padEnd(5))} ${log.message}`);
      }
    } else {
      const logs = await client.getLogs(manifest.name, logOptions);

      for (const log of logs) {
        const levelColor = {
          debug: chalk.gray,
          info: chalk.blue,
          warn: chalk.yellow,
          error: chalk.red,
        }[log.level] || chalk.white;

        const timestamp = formatTimestamp(log.timestamp);
        console.log(`${chalk.gray(timestamp)} ${levelColor(log.level.toUpperCase().padEnd(5))} ${log.message}`);
      }
    }
  });
```

---

## Phase 2: Testing & Preview Environments (6 weeks)

### Week 9-10: Enhanced Testing Utilities

#### 9.1 renderWithShell

```typescript
// packages/plugin-sdk/src/testing/renderWithShell.tsx

import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { ShellProvider } from '../hooks/ShellProvider';
import { createMockShellContext, MockShellContextOptions } from './MockShellProvider';

export interface RenderWithShellOptions extends Omit<RenderOptions, 'wrapper'> {
  shellContext?: MockShellContextOptions;
  user?: Partial<AuthUser>;
  team?: Partial<Team>;
  permissions?: string[];
}

export function renderWithShell(
  ui: React.ReactElement,
  options: RenderWithShellOptions = {},
): RenderResult & {
  shellContext: ShellContext;
  rerender: (ui: React.ReactElement) => void;
  setUser: (user: Partial<AuthUser>) => void;
  setTeam: (team: Partial<Team>) => void;
  emitEvent: (event: string, data?: unknown) => void;
} {
  const {
    shellContext: contextOptions,
    user,
    team,
    permissions,
    ...renderOptions
  } = options;

  const mockContext = createMockShellContext({
    ...contextOptions,
    user: user ? createMockUser(user) : contextOptions?.user,
    team: team ? createMockTeam(team) : contextOptions?.team,
    permissions,
  });

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ShellProvider value={mockContext}>
      {children}
    </ShellProvider>
  );

  const result = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...result,
    shellContext: mockContext,
    rerender: (newUi: React.ReactElement) => {
      result.rerender(<Wrapper>{newUi}</Wrapper>);
    },
    setUser: (newUser: Partial<AuthUser>) => {
      Object.assign(mockContext.auth, { user: createMockUser(newUser) });
      result.rerender(<Wrapper>{ui}</Wrapper>);
    },
    setTeam: (newTeam: Partial<Team>) => {
      Object.assign(mockContext.team!, { currentTeam: createMockTeam(newTeam) });
      result.rerender(<Wrapper>{ui}</Wrapper>);
    },
    emitEvent: (event: string, data?: unknown) => {
      mockContext.eventBus.emit(event, data);
    },
  };
}
```

#### 9.2 Mock Factories

```typescript
// packages/plugin-sdk/src/testing/factories.ts

import { faker } from '@faker-js/faker';

export function createMockUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    displayName: faker.person.fullName(),
    avatar: faker.image.avatar(),
    roles: ['user'],
    permissions: [],
    ...overrides,
  };
}

export function createMockTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    slug: faker.helpers.slugify(faker.company.name()).toLowerCase(),
    description: faker.company.catchPhrase(),
    avatarUrl: faker.image.url(),
    memberCount: faker.number.int({ min: 1, max: 50 }),
    ...overrides,
  };
}

export function createMockTeamMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    teamId: faker.string.uuid(),
    role: faker.helpers.arrayElement(['owner', 'admin', 'member', 'viewer']),
    joinedAt: faker.date.past(),
    ...overrides,
  };
}

export function createMockPlugin(overrides: Partial<PluginManifest> = {}): PluginManifest {
  const name = faker.helpers.slugify(faker.commerce.productName()).toLowerCase();
  return {
    name,
    displayName: faker.commerce.productName(),
    version: faker.system.semver(),
    description: faker.commerce.productDescription(),
    category: faker.helpers.arrayElement(['analytics', 'monitoring', 'social', 'developer']),
    ...overrides,
  };
}

export function createMockApiResponse<T>(data: T, overrides: Partial<ApiResponse<T>> = {}): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
    },
    ...overrides,
  };
}
```

#### 9.3 Event Simulation

```typescript
// packages/plugin-sdk/src/testing/events.ts

export function createEventSimulator(context: ShellContext) {
  return {
    // Auth events
    login: (user?: Partial<AuthUser>) => {
      const mockUser = user ? createMockUser(user) : createMockUser();
      context.eventBus.emit('auth:login', { user: mockUser });
      return mockUser;
    },

    logout: () => {
      context.eventBus.emit('auth:logout', {});
    },

    // Team events
    switchTeam: (team?: Partial<Team>) => {
      const mockTeam = team ? createMockTeam(team) : createMockTeam();
      context.eventBus.emit('team:change', { teamId: mockTeam.id, team: mockTeam });
      return mockTeam;
    },

    leaveTeam: () => {
      context.eventBus.emit('team:change', { teamId: null, team: null });
    },

    // Plugin events
    pluginLoaded: (pluginName: string) => {
      context.eventBus.emit('plugin:loaded', { pluginName });
    },

    pluginError: (pluginName: string, error: Error) => {
      context.eventBus.emit('plugin:error', { pluginName, error });
    },

    // Data events
    dataUpdated: (resource: string, data?: unknown) => {
      context.eventBus.emit('data:updated', { resource, data });
    },

    // Custom events
    emit: (event: string, data?: unknown) => {
      context.eventBus.emit(event, data);
    },

    // Wait for event
    waitFor: (event: string, timeout = 5000): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeout);

        context.eventBus.once(event, (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    },
  };
}
```

### Week 11-12: Preview Environments

#### 11.1 Preview Service

```typescript
// services/preview-service/src/PreviewService.ts

export interface PreviewEnvironment {
  id: string;
  pluginName: string;
  branch: string;
  prNumber?: number;
  url: string;
  shellUrl: string;
  status: 'creating' | 'ready' | 'error' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

export class PreviewService {
  constructor(
    private db: PrismaClient,
    private containerOrchestrator: ContainerOrchestrator,
    private cdnManager: CDNManager,
  ) {}

  async createPreview(request: CreatePreviewRequest): Promise<PreviewEnvironment> {
    const previewId = generatePreviewId(request.pluginName, request.branch);

    // Create preview record
    const preview = await this.db.previewEnvironment.create({
      data: {
        id: previewId,
        pluginName: request.pluginName,
        branch: request.branch,
        prNumber: request.prNumber,
        status: 'creating',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    try {
      // 1. Build and upload frontend to preview CDN path
      const frontendUrl = await this.cdnManager.uploadPreview(
        previewId,
        request.frontendBundle,
      );

      // 2. Deploy backend to preview namespace (if applicable)
      let backendUrl: string | undefined;
      if (request.backendImage) {
        const deployment = await this.containerOrchestrator.deploy({
          name: `preview-${previewId}`,
          image: request.backendImage,
          namespace: 'previews',
          resources: { memory: '256Mi', cpu: '0.25' },
        });
        backendUrl = deployment.url;
      }

      // 3. Create preview shell instance or configure existing shell
      const shellUrl = await this.configurePreviewShell(previewId, {
        frontendUrl,
        backendUrl,
        pluginName: request.pluginName,
      });

      // 4. Update preview record
      await this.db.previewEnvironment.update({
        where: { id: previewId },
        data: {
          status: 'ready',
          url: `https://preview-${previewId}.plugins.naap.io`,
          shellUrl,
        },
      });

      return await this.db.previewEnvironment.findUnique({
        where: { id: previewId },
      }) as PreviewEnvironment;

    } catch (error) {
      await this.db.previewEnvironment.update({
        where: { id: previewId },
        data: { status: 'error' },
      });
      throw error;
    }
  }

  async deletePreview(previewId: string): Promise<void> {
    const preview = await this.db.previewEnvironment.findUnique({
      where: { id: previewId },
    });

    if (!preview) return;

    // Cleanup resources
    await this.cdnManager.deletePreview(previewId);
    await this.containerOrchestrator.stop(`preview-${previewId}`);

    await this.db.previewEnvironment.delete({
      where: { id: previewId },
    });
  }
}
```

#### 11.2 GitHub Action for Previews

```yaml
# .github/workflows/preview.yml (auto-generated in scaffold)
name: Plugin Preview

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: naap-plugin build

      - name: Create Preview
        id: preview
        uses: naap/plugin-preview-action@v1
        with:
          token: ${{ secrets.NAAP_PREVIEW_TOKEN }}

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const preview = '${{ steps.preview.outputs.url }}';
            const shell = '${{ steps.preview.outputs.shell_url }}';
            const expires = '${{ steps.preview.outputs.expires_at }}';

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## 🔗 Preview Environment Ready

              | Resource | URL |
              |----------|-----|
              | Plugin Preview | [${preview}](${preview}) |
              | Shell with Plugin | [${shell}](${shell}) |

              > Preview expires: ${expires}

              ---
              *Powered by NAAP Plugin Platform*`
            });
```

#### 11.3 Preview CLI Command

```typescript
// packages/plugin-sdk/cli/commands/preview.ts

export const previewCommand = new Command('preview')
  .description('Create a preview environment')
  .option('--branch <branch>', 'Branch name')
  .option('--pr <number>', 'PR number')
  .option('--ttl <days>', 'Time to live in days', '7')
  .action(async (options) => {
    const manifest = await loadManifest(process.cwd());

    console.log(chalk.bold.blue(`\n🔗 Creating preview for ${manifest.displayName}\n`));

    // Build first
    const buildSpinner = ora('Building plugin...').start();
    await exec('naap-plugin', ['build']);
    buildSpinner.succeed('Build complete');

    // Create preview
    const previewSpinner = ora('Creating preview environment...').start();

    try {
      const client = await getPreviewClient();
      const preview = await client.create({
        pluginName: manifest.name,
        branch: options.branch || await getCurrentBranch(),
        prNumber: options.pr ? parseInt(options.pr) : undefined,
        ttlDays: parseInt(options.ttl),
        frontendBundle: await readFrontendBundle(),
        backendImage: manifest.backend ? await getBackendImage() : undefined,
      });

      previewSpinner.succeed('Preview created');

      console.log(chalk.green('\n✓ Preview environment ready!\n'));
      console.log(`Plugin: ${chalk.cyan(preview.url)}`);
      console.log(`Shell:  ${chalk.cyan(preview.shellUrl)}`);
      console.log(`Expires: ${chalk.gray(formatDate(preview.expiresAt))}`);
      console.log('');

      // Generate QR code for mobile testing
      const qr = await generateQRCode(preview.shellUrl);
      console.log(qr);

    } catch (error) {
      previewSpinner.fail('Preview creation failed');
      console.error(chalk.red(error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });
```

### Week 13-14: CI/CD Integration

#### 13.1 CI Test Templates

```typescript
// packages/plugin-sdk/cli/commands/ci.ts

export const ciCommand = new Command('ci')
  .description('CI/CD utilities')
  .addCommand(
    new Command('setup')
      .description('Setup CI/CD configuration')
      .option('--provider <provider>', 'CI provider (github, gitlab, circleci)', 'github')
      .action(async (options) => {
        const manifest = await loadManifest(process.cwd());

        switch (options.provider) {
          case 'github':
            await setupGitHubActions(manifest);
            break;
          case 'gitlab':
            await setupGitLabCI(manifest);
            break;
          case 'circleci':
            await setupCircleCI(manifest);
            break;
        }

        console.log(chalk.green(`\n✓ CI/CD configuration created for ${options.provider}\n`));
      })
  );

async function setupGitHubActions(manifest: PluginManifest): Promise<void> {
  const workflowsDir = '.github/workflows';
  await fs.ensureDir(workflowsDir);

  // CI workflow
  await fs.writeFile(path.join(workflowsDir, 'ci.yml'), `
name: Plugin CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: naap-plugin validate

  test:
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: naap-plugin test --coverage
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: naap-plugin build
      - uses: actions/upload-artifact@v4
        with:
          name: plugin-bundle
          path: |
            frontend/dist
            backend/dist
`);

  // Preview workflow
  await fs.writeFile(path.join(workflowsDir, 'preview.yml'), `
name: Preview

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: naap-plugin build
      - uses: naap/preview-action@v1
        id: preview
        with:
          token: \${{ secrets.NAAP_TOKEN }}
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🔗 Preview: \${{ steps.preview.outputs.url }}'
            });
`);

  // Deploy workflow
  await fs.writeFile(path.join(workflowsDir, 'deploy.yml'), `
name: Deploy

on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: naap-plugin build
      - run: naap-plugin publish
        env:
          NAAP_TOKEN: \${{ secrets.NAAP_TOKEN }}
      - run: naap-plugin deploy --strategy canary
        env:
          NAAP_TOKEN: \${{ secrets.NAAP_TOKEN }}
`);
}
```

---

## Phase 3: AI-Assisted Development (4 weeks)

### Week 15-16: Plugin Specification Format

#### 15.1 plugin.md Schema

```markdown
# plugin.md - AI-Readable Plugin Specification

## Plugin: Expense Tracker

### Description
A plugin for teams to track and manage expenses with approval workflows.

### User Stories

#### US-1: Create Expense
As a team member, I want to submit an expense with receipt upload,
so that I can get reimbursed for work-related purchases.

**Acceptance Criteria:**
- [ ] Form with amount, category, description, date
- [ ] Receipt image upload (JPG, PNG, PDF)
- [ ] Auto-extract amount from receipt using AI
- [ ] Save as draft or submit for approval

#### US-2: Approve Expenses
As a team admin, I want to review and approve/reject expenses,
so that I can control team spending.

**Acceptance Criteria:**
- [ ] List of pending expenses
- [ ] Approve with one click
- [ ] Reject with reason
- [ ] Bulk approve/reject

#### US-3: Expense Dashboard
As a team owner, I want to see expense analytics,
so that I can understand spending patterns.

**Acceptance Criteria:**
- [ ] Total spend by month
- [ ] Breakdown by category (pie chart)
- [ ] Top spenders list
- [ ] Export to CSV

### Data Model

```
Expense {
  id: UUID
  amount: Decimal
  currency: String (USD, EUR, etc.)
  category: Enum (travel, meals, supplies, software, other)
  description: String
  receiptUrl: String?
  status: Enum (draft, pending, approved, rejected)
  submittedBy: User
  reviewedBy: User?
  reviewedAt: DateTime?
  createdAt: DateTime
}
```

### Permissions
- team:member - Create own expenses, view own expenses
- team:admin - View all expenses, approve/reject
- team:owner - All permissions + analytics + export

### Integrations
- Storage: Receipt uploads (required)
- AI: Receipt OCR (optional)
- Email: Notifications (optional)

### Settings
- approvalThreshold: Number (expenses above this require approval)
- allowedCategories: String[] (restrict categories)
- requireReceipt: Boolean (require receipt for all expenses)
```

#### 15.2 Spec Parser

```typescript
// packages/plugin-sdk/src/ai/SpecParser.ts

export interface PluginSpec {
  name: string;
  displayName: string;
  description: string;
  userStories: UserStory[];
  dataModel: DataModel[];
  permissions: Permission[];
  integrations: Integration[];
  settings: Setting[];
}

export interface UserStory {
  id: string;
  title: string;
  asA: string;      // Role
  iWant: string;    // Action
  soThat: string;   // Benefit
  acceptanceCriteria: string[];
}

export class SpecParser {
  parse(markdown: string): PluginSpec {
    const sections = this.extractSections(markdown);

    return {
      name: this.extractPluginName(sections),
      displayName: this.extractDisplayName(sections),
      description: this.extractDescription(sections),
      userStories: this.parseUserStories(sections['User Stories']),
      dataModel: this.parseDataModel(sections['Data Model']),
      permissions: this.parsePermissions(sections['Permissions']),
      integrations: this.parseIntegrations(sections['Integrations']),
      settings: this.parseSettings(sections['Settings']),
    };
  }

  private parseUserStories(section: string): UserStory[] {
    const stories: UserStory[] = [];
    const storyRegex = /#### (US-\d+): (.+)\n([\s\S]*?)(?=####|$)/g;

    let match;
    while ((match = storyRegex.exec(section)) !== null) {
      const [, id, title, content] = match;

      // Parse "As a... I want... So that..." format
      const asAMatch = content.match(/As a[n]? (.+?),/i);
      const iWantMatch = content.match(/I want (.+?),/i);
      const soThatMatch = content.match(/so that (.+?)\./i);

      // Parse acceptance criteria
      const criteriaMatch = content.match(/\[[ x]\] (.+)/g) || [];
      const criteria = criteriaMatch.map(c => c.replace(/\[[ x]\] /, ''));

      stories.push({
        id,
        title,
        asA: asAMatch?.[1] || 'user',
        iWant: iWantMatch?.[1] || title,
        soThat: soThatMatch?.[1] || 'I can achieve my goal',
        acceptanceCriteria: criteria,
      });
    }

    return stories;
  }
}
```

### Week 17-18: AI Code Generation

#### 17.1 Code Generator

```typescript
// packages/plugin-sdk/src/ai/CodeGenerator.ts

export class CodeGenerator {
  constructor(
    private llm: LLMClient,  // Claude API
    private specParser: SpecParser,
  ) {}

  async generatePlugin(specMarkdown: string): Promise<GeneratedPlugin> {
    const spec = this.specParser.parse(specMarkdown);

    // Generate in parallel where possible
    const [
      manifest,
      dataModel,
      frontend,
      backend,
      tests,
    ] = await Promise.all([
      this.generateManifest(spec),
      this.generateDataModel(spec),
      this.generateFrontend(spec),
      this.generateBackend(spec),
      this.generateTests(spec),
    ]);

    return {
      manifest,
      dataModel,
      frontend,
      backend,
      tests,
    };
  }

  private async generateFrontend(spec: PluginSpec): Promise<GeneratedFiles> {
    const files: GeneratedFiles = {};

    // Generate pages from user stories
    for (const story of spec.userStories) {
      const pageCode = await this.llm.complete({
        system: FRONTEND_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Generate a React component for this user story:

Title: ${story.title}
As a: ${story.asA}
I want: ${story.iWant}
So that: ${story.soThat}

Acceptance Criteria:
${story.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Data Model:
${JSON.stringify(spec.dataModel, null, 2)}

Use these shell hooks: useAuth, useTeam, useNotify, useApiClient
Use Tailwind CSS for styling.
Use lucide-react for icons.
`,
        }],
      });

      const pageName = this.storyToPageName(story);
      files[`src/pages/${pageName}.tsx`] = pageCode;
    }

    // Generate App.tsx with routing
    files['src/App.tsx'] = await this.generateAppRouter(spec);

    // Generate mount.tsx
    files['src/mount.tsx'] = this.generateMountFile(spec);

    return files;
  }

  private async generateBackend(spec: PluginSpec): Promise<GeneratedFiles> {
    const files: GeneratedFiles = {};

    // Generate Prisma schema
    files['prisma/schema.prisma'] = this.generatePrismaSchema(spec.dataModel);

    // Generate API routes
    for (const model of spec.dataModel) {
      const routeCode = await this.llm.complete({
        system: BACKEND_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Generate Express.js CRUD routes for:

Model: ${model.name}
Fields: ${JSON.stringify(model.fields, null, 2)}

Permissions required:
${spec.permissions.map(p => `- ${p.role}: ${p.actions.join(', ')}`).join('\n')}

Include:
- Input validation with zod
- Error handling
- Permission checks
- Prisma queries
`,
        }],
      });

      files[`src/routes/${model.name.toLowerCase()}.ts`] = routeCode;
    }

    // Generate server.ts
    files['src/server.ts'] = this.generateServerFile(spec);

    return files;
  }

  private async generateTests(spec: PluginSpec): Promise<GeneratedFiles> {
    const files: GeneratedFiles = {};

    // Generate tests for each user story
    for (const story of spec.userStories) {
      const testCode = await this.llm.complete({
        system: TEST_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Generate tests for this user story:

${story.title}

Acceptance Criteria:
${story.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Use:
- @testing-library/react
- @naap/plugin-sdk/testing (renderWithShell, createMockUser, etc.)
- vitest

Generate tests that verify each acceptance criterion.
`,
        }],
      });

      const testName = this.storyToTestName(story);
      files[`tests/${testName}.test.tsx`] = testCode;
    }

    // Generate contract tests
    files['tests/contract.test.ts'] = this.generateContractTests(spec);

    return files;
  }
}
```

#### 17.2 AI Generate Command

```typescript
// packages/plugin-sdk/cli/commands/generate.ts

export const generateCommand = new Command('generate')
  .description('Generate plugin from specification')
  .argument('<spec>', 'Path to plugin.md specification file')
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('--dry-run', 'Show what would be generated without writing files')
  .option('--interactive', 'Review and approve each generated file')
  .action(async (specPath, options) => {
    console.log(chalk.bold.blue(`\n🤖 AI Plugin Generator\n`));

    // Read spec
    const specContent = await fs.readFile(specPath, 'utf-8');
    console.log(chalk.gray(`Read specification from ${specPath}`));

    // Parse spec
    const parser = new SpecParser();
    const spec = parser.parse(specContent);

    console.log(chalk.cyan(`\nPlugin: ${spec.displayName}`));
    console.log(chalk.gray(`  ${spec.userStories.length} user stories`));
    console.log(chalk.gray(`  ${spec.dataModel.length} data models`));
    console.log(chalk.gray(`  ${spec.integrations.length} integrations`));
    console.log('');

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN - Would generate:'));
      // Show file list
      return;
    }

    // Generate code
    const spinner = ora('Generating code with AI...').start();

    try {
      const generator = new CodeGenerator(getLLMClient(), parser);
      const result = await generator.generatePlugin(specContent);

      spinner.succeed('Code generated');

      // Write files
      const writeSpinner = ora('Writing files...').start();

      const allFiles = {
        'plugin.json': JSON.stringify(result.manifest, null, 2),
        ...prefixPaths('frontend/', result.frontend),
        ...prefixPaths('backend/', result.backend),
        ...prefixPaths('', result.tests),
      };

      for (const [filePath, content] of Object.entries(allFiles)) {
        const fullPath = path.join(options.output, filePath);

        if (options.interactive) {
          console.log(chalk.cyan(`\n--- ${filePath} ---`));
          console.log(content.slice(0, 500) + (content.length > 500 ? '...' : ''));

          const { approve } = await inquirer.prompt([{
            type: 'confirm',
            name: 'approve',
            message: 'Write this file?',
            default: true,
          }]);

          if (!approve) continue;
        }

        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content);
      }

      writeSpinner.succeed(`Written ${Object.keys(allFiles).length} files`);

      console.log(chalk.green('\n✓ Plugin generated successfully!\n'));
      console.log('Next steps:');
      console.log(chalk.cyan('  cd ' + options.output));
      console.log(chalk.cyan('  npm install'));
      console.log(chalk.cyan('  naap-plugin dev'));
      console.log('');

    } catch (error) {
      spinner.fail('Generation failed');
      console.error(chalk.red(error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });
```

#### 17.3 Iterate Command

```typescript
// packages/plugin-sdk/cli/commands/iterate.ts

export const iterateCommand = new Command('iterate')
  .description('Iterate on plugin with AI assistance')
  .argument('<instruction>', 'What to change or add')
  .option('--file <file>', 'Specific file to modify')
  .option('--story <id>', 'User story to implement/modify')
  .action(async (instruction, options) => {
    console.log(chalk.bold.blue(`\n🔄 AI Plugin Iterator\n`));

    const manifest = await loadManifest(process.cwd());
    const spec = await loadSpec(process.cwd());

    console.log(chalk.cyan(`Instruction: "${instruction}"`));
    console.log('');

    const spinner = ora('Analyzing codebase...').start();

    try {
      const generator = new CodeGenerator(getLLMClient(), new SpecParser());

      // Read current code context
      const context = await readRelevantFiles(options.file, options.story);

      spinner.text = 'Generating changes...';

      const changes = await generator.iterate({
        instruction,
        spec,
        currentCode: context,
        targetFile: options.file,
        targetStory: options.story,
      });

      spinner.succeed('Changes generated');

      // Show diff
      console.log(chalk.cyan('\nProposed changes:\n'));

      for (const change of changes) {
        console.log(chalk.bold(change.file));
        console.log(formatDiff(change.diff));
        console.log('');
      }

      const { apply } = await inquirer.prompt([{
        type: 'confirm',
        name: 'apply',
        message: 'Apply these changes?',
        default: true,
      }]);

      if (apply) {
        for (const change of changes) {
          await fs.writeFile(change.file, change.newContent);
        }
        console.log(chalk.green('\n✓ Changes applied\n'));
      }

    } catch (error) {
      spinner.fail('Iteration failed');
      console.error(chalk.red(error instanceof Error ? error.message : error));
      process.exit(1);
    }
  });
```

---

## How This Enables Vibe Coding

### The Complete Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          VIBE CODING WORKFLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. DESCRIBE (User)                                                          │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ # plugin.md                                                      │     │
│     │                                                                  │     │
│     │ ## User Stories                                                  │     │
│     │ - As a user, I want to track my expenses...                     │     │
│     │ - As an admin, I want to approve expenses...                    │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                         │                                    │
│                                         ▼                                    │
│  2. GENERATE (AI)                                                            │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ $ naap-plugin generate plugin.md                                │     │
│     │                                                                  │     │
│     │ 🤖 Generating frontend components...                            │     │
│     │ 🤖 Generating backend routes...                                 │     │
│     │ 🤖 Generating tests...                                          │     │
│     │ ✓ Generated 24 files                                            │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                         │                                    │
│                                         ▼                                    │
│  3. VALIDATE (Automated)                                                     │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ $ naap-plugin test                                              │     │
│     │                                                                  │     │
│     │ ✓ Contract tests (5/5)                                          │     │
│     │ ✓ Unit tests (47/47)                                            │     │
│     │ ✓ Integration tests (12/12)                                     │     │
│     │ ✓ All user story criteria met                                   │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                         │                                    │
│                                         ▼                                    │
│  4. PREVIEW (Automated)                                                      │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ $ naap-plugin preview                                           │     │
│     │                                                                  │     │
│     │ 🔗 Preview: https://preview-abc123.plugins.naap.io              │     │
│     │ Share this link to test!                                        │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                         │                                    │
│                                         ▼                                    │
│  5. ITERATE (User + AI)                                                      │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ $ naap-plugin iterate "Add export to PDF feature"               │     │
│     │                                                                  │     │
│     │ 🤖 Analyzing codebase...                                        │     │
│     │ 🤖 Generating changes...                                        │     │
│     │ ✓ 3 files modified                                              │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                         │                                    │
│                                         ▼                                    │
│  6. DEPLOY (Automated with Safety)                                           │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ $ naap-plugin deploy --strategy canary                          │     │
│     │                                                                  │     │
│     │ 🚀 Deploying expense-tracker@1.0.0                              │     │
│     │ ✓ Health checks passing                                         │     │
│     │ Traffic: [████░░░░░░░░░░░░░░░░] 5%                              │     │
│     │ Traffic: [████████░░░░░░░░░░░░] 25%                             │     │
│     │ Traffic: [████████████████████] 100%                            │     │
│     │ ✓ Deployment complete!                                          │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                         │                                    │
│                                         ▼                                    │
│  7. MONITOR (Automated)                                                      │
│     ┌─────────────────────────────────────────────────────────────────┐     │
│     │ $ naap-plugin status --watch                                    │     │
│     │                                                                  │     │
│     │ 📊 expense-tracker Status                                       │     │
│     │ Version: 1.0.0 ✓ Healthy                                        │     │
│     │ Requests: 1,234 | Errors: 0.01% | p99: 45ms                     │     │
│     │                                                                  │     │
│     │ [Auto-rollback on error rate > 5%]                              │     │
│     └─────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Foundation Enables AI-First Development

1. **Strong Contracts** - The SDK defines clear interfaces that AI can target
2. **Automated Testing** - AI-generated code is validated before deployment
3. **Safe Deployment** - Blue-green + canary means AI mistakes are caught early
4. **Auto-Rollback** - If AI code has issues, system automatically reverts
5. **Observability** - Problems surface quickly through monitoring
6. **Iterative Refinement** - Easy to say "change X" and have AI update code

### The Key Insight

> **AI is fearless when deployment is safe.**

When there's:
- Automated testing that catches bugs
- Preview environments for validation
- Canary deployments that limit blast radius
- Auto-rollback that reverts failures
- Monitoring that surfaces issues

...then AI can iterate rapidly. Generate, test, deploy, learn, repeat.

---

## Implementation Timeline

```
Week 1-2:   Deployment Manager Core + Database Schema
Week 3-4:   Traffic Router + Health Monitoring
Week 5-6:   CLI Commands (deploy, rollback, status, logs)
Week 7-8:   Metrics Collection + Alert Engine
Week 9-10:  Testing Utilities (renderWithShell, factories)
Week 11-12: Preview Environments
Week 13-14: CI/CD Integration
Week 15-16: Plugin Spec Format + Parser
Week 17-18: AI Code Generation + Iterate Command
```

### Resource Requirements

| Phase | Engineers | Duration | Focus |
|-------|-----------|----------|-------|
| Phase 1 | 2-3 | 8 weeks | Backend infrastructure |
| Phase 2 | 1-2 | 6 weeks | Testing & DevX |
| Phase 3 | 2 | 4 weeks | AI integration |

### Dependencies

- **Vercel**: For CDN, serverless functions, blob storage
- **PostgreSQL**: For control plane data
- **Redis**: For caching and real-time updates
- **TimescaleDB/InfluxDB**: For metrics (optional, can use PostgreSQL)
- **Claude API**: For AI code generation

---

## Success Metrics

### Phase 1 Success
- [ ] Deploy a plugin with blue-green in < 5 minutes
- [ ] Auto-rollback on > 5% error rate
- [ ] Real-time deployment status visible in CLI
- [ ] Logs streamable via `naap logs`

### Phase 2 Success
- [ ] `renderWithShell()` used in 80% of plugin tests
- [ ] Preview environments created for every PR
- [ ] Time to first test run < 30 seconds

### Phase 3 Success
- [ ] Generate working plugin from spec in < 5 minutes
- [ ] AI-generated code passes all tests on first try 70% of time
- [ ] Iterate command successfully modifies code 90% of time

### Overall Platform Success
- [ ] Time from user story to production: < 30 minutes
- [ ] Plugin deployment success rate: > 99%
- [ ] Mean time to rollback: < 60 seconds
- [ ] Developer satisfaction: > 4.5/5

---

## Conclusion

This plan creates a **production-grade plugin platform** that naturally evolves into an **AI-first development experience**. The key is that robust infrastructure (safe deployments, automated testing, monitoring) is prerequisite for AI to move fast without breaking things.

The end state is a system where users describe what they want in plain language, and the platform handles everything else - from code generation to production deployment to ongoing monitoring.

**From user stories to production, automatically.**
