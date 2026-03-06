import express from 'express';
import { ProviderAdapterRegistry } from './services/ProviderAdapterRegistry.js';
import { DeploymentOrchestrator } from './services/DeploymentOrchestrator.js';
import { AuditService } from './services/AuditService.js';
import { ArtifactRegistry } from './services/ArtifactRegistry.js';
import { HealthMonitorService } from './services/HealthMonitorService.js';
import { VersionCheckerService } from './services/VersionCheckerService.js';
import { RunPodAdapter } from './adapters/RunPodAdapter.js';
import { SshBridgeAdapter } from './adapters/SshBridgeAdapter.js';
import { FalAdapter } from './adapters/FalAdapter.js';
import { BasetenAdapter } from './adapters/BasetenAdapter.js';
import { ModalAdapter } from './adapters/ModalAdapter.js';
import { ReplicateAdapter } from './adapters/ReplicateAdapter.js';
import { createProvidersRouter } from './routes/providers.js';
import { createDeploymentsRouter } from './routes/deployments.js';
import { createArtifactsRouter } from './routes/artifacts.js';
import { createHealthRouter } from './routes/health.js';
import { createAuditRouter } from './routes/audit.js';

const PORT = parseInt(process.env.PORT || '4117', 10);
const API_PREFIX = '/api/v1/deployment-manager';

const registry = new ProviderAdapterRegistry();
registry.register(new RunPodAdapter());
registry.register(new SshBridgeAdapter());
registry.register(new FalAdapter());
registry.register(new BasetenAdapter());
registry.register(new ModalAdapter());
registry.register(new ReplicateAdapter());

const audit = new AuditService();
const artifactRegistry = new ArtifactRegistry();
const orchestrator = new DeploymentOrchestrator(registry, audit);
const healthMonitor = new HealthMonitorService(registry, orchestrator, {
  intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10),
  degradedThresholdMs: parseInt(process.env.HEALTH_DEGRADED_THRESHOLD || '5000', 10),
  failureThreshold: parseInt(process.env.HEALTH_FAILURE_THRESHOLD || '3', 10),
});
const versionChecker = new VersionCheckerService(
  orchestrator,
  artifactRegistry,
  parseInt(process.env.VERSION_CHECK_INTERVAL || '1800000', 10),
);

const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'deployment-manager',
    version: '1.0.0',
    uptime: process.uptime(),
    providers: registry.listSlugs(),
  });
});

app.use(`${API_PREFIX}/providers`, createProvidersRouter(registry));
app.use(`${API_PREFIX}/deployments`, createDeploymentsRouter(orchestrator));
app.use(`${API_PREFIX}/artifacts`, createArtifactsRouter(artifactRegistry));
app.use(`${API_PREFIX}/health`, createHealthRouter(healthMonitor, orchestrator));
app.use(`${API_PREFIX}/audit`, createAuditRouter(audit));

app.get(`${API_PREFIX}/status`, async (_req, res) => {
  const all = await orchestrator.list();
  const counts = {
    total: all.length,
    online: all.filter((d) => d.status === 'ONLINE').length,
    degraded: all.filter((d) => d.status === 'DEGRADED').length,
    offline: all.filter((d) => d.status === 'OFFLINE').length,
    failed: all.filter((d) => d.status === 'FAILED').length,
    deploying: all.filter((d) => ['PENDING', 'PROVISIONING', 'DEPLOYING', 'VALIDATING'].includes(d.status)).length,
  };
  res.json({ status: 'ok', providers: registry.listSlugs(), deployments: counts });
});

const server = app.listen(PORT, () => {
  console.log(`[deployment-manager] Backend started on port ${PORT}`);
  console.log(`[deployment-manager] Registered providers: ${registry.listSlugs().join(', ')}`);
  healthMonitor.start();
  versionChecker.start();
});

function shutdown(signal: string) {
  console.log(`[deployment-manager] Received ${signal}, shutting down...`);
  healthMonitor.stop();
  versionChecker.stop();
  server.close(() => {
    console.log('[deployment-manager] Backend stopped');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
