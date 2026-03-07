import express from 'express';
import { ProviderAdapterRegistry } from './services/ProviderAdapterRegistry.js';
import { DeploymentOrchestrator } from './services/DeploymentOrchestrator.js';
import { AuditService } from './services/AuditService.js';
import { TemplateRegistry } from './services/TemplateRegistry.js';
import { HealthMonitorService } from './services/HealthMonitorService.js';
import { VersionCheckerService } from './services/VersionCheckerService.js';
import { RunPodAdapter } from './adapters/RunPodAdapter.js';
import { SshBridgeAdapter } from './adapters/SshBridgeAdapter.js';
import { FalAdapter } from './adapters/FalAdapter.js';
import { BasetenAdapter } from './adapters/BasetenAdapter.js';
import { ModalAdapter } from './adapters/ModalAdapter.js';
import { ReplicateAdapter } from './adapters/ReplicateAdapter.js';
import { SshComposeAdapter } from './adapters/SshComposeAdapter.js';
import { createProvidersRouter } from './routes/providers.js';
import { createDeploymentsRouter } from './routes/deployments.js';
import { createTemplatesRouter } from './routes/templates.js';
import { createHealthRouter } from './routes/health.js';
import { createAuditRouter } from './routes/audit.js';
import { setAuthContext } from './lib/providerFetch.js';
import { PrismaDeploymentStore } from './store/PrismaDeploymentStore.js';
import { InMemoryDeploymentStore } from './store/InMemoryDeploymentStore.js';
import type { IDeploymentStore } from './store/IDeploymentStore.js';
import { CostEstimationService } from './services/CostEstimationService.js';
import { createCostRouter } from './routes/cost.js';
import { createCredentialsRouter } from './routes/credentials.js';

const PORT = parseInt(process.env.PORT || '4117', 10);
const API_PREFIX = '/api/v1/deployment-manager';

const registry = new ProviderAdapterRegistry();
registry.register(new RunPodAdapter());
registry.register(new SshBridgeAdapter());
registry.register(new FalAdapter());
registry.register(new BasetenAdapter());
registry.register(new ModalAdapter());
registry.register(new ReplicateAdapter());
registry.register(new SshComposeAdapter());

const audit = new AuditService();
const templateRegistry = new TemplateRegistry();

let store: IDeploymentStore;
try {
  store = new PrismaDeploymentStore();
  console.log('[deployment-manager] Using Prisma persistent storage');
} catch {
  store = new InMemoryDeploymentStore();
  console.log('[deployment-manager] Using in-memory storage (no database available)');
}

const orchestrator = new DeploymentOrchestrator(registry, audit, store);
const healthMonitor = new HealthMonitorService(registry, orchestrator, {
  intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10),
  degradedThresholdMs: parseInt(process.env.HEALTH_DEGRADED_THRESHOLD || '5000', 10),
  failureThreshold: parseInt(process.env.HEALTH_FAILURE_THRESHOLD || '3', 10),
});
const versionChecker = new VersionCheckerService(
  orchestrator,
  templateRegistry,
  parseInt(process.env.VERSION_CHECK_INTERVAL || '1800000', 10),
);

const costService = new CostEstimationService(registry);

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  setAuthContext({
    authorization: req.headers.authorization,
    cookie: req.headers.cookie,
    teamId: req.headers['x-team-id'] as string | undefined,
  });
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'deployment-manager',
    version: '2.0.0',
    uptime: process.uptime(),
    providers: registry.listSlugs(),
  });
});

app.use(`${API_PREFIX}/providers`, createProvidersRouter(registry));
app.use(`${API_PREFIX}/deployments`, createDeploymentsRouter(orchestrator, registry));
app.use(`${API_PREFIX}/templates`, createTemplatesRouter(templateRegistry));
app.use(`${API_PREFIX}/health`, createHealthRouter(healthMonitor, orchestrator));
app.use(`${API_PREFIX}/audit`, createAuditRouter(audit));
app.use(`${API_PREFIX}/cost`, createCostRouter(costService));
app.use(`${API_PREFIX}/credentials`, createCredentialsRouter(registry));

app.get(`${API_PREFIX}/status`, async (_req, res) => {
  const all = await orchestrator.list();
  const counts = {
    total: all.length,
    online: all.filter((d) => d.status === 'ONLINE').length,
    failed: all.filter((d) => d.status === 'FAILED').length,
    deploying: all.filter((d) => ['PENDING', 'DEPLOYING', 'VALIDATING'].includes(d.status)).length,
    updating: all.filter((d) => d.status === 'UPDATING').length,
    destroyed: all.filter((d) => d.status === 'DESTROYED').length,
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
