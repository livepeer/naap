/**
 * Infrastructure API Routes
 */

import { Router, Request, Response } from 'express';
import { 
  containerOrchestrator, 
  databaseManager, 
  portAllocator, 
  healthMonitor,
  broadcast,
} from '../server.js';

export const infrastructureRouter = Router();

/**
 * Provision infrastructure for a plugin
 */
infrastructureRouter.post('/provision', async (req: Request, res: Response) => {
  const { 
    pluginName, 
    manifest, 
    migrationsPath,
    seedPath,
  } = req.body;

  if (!pluginName || !manifest) {
    return res.status(400).json({ error: 'pluginName and manifest are required' });
  }

  try {
    broadcast('provision:started', { pluginName });

    const result: Record<string, unknown> = {
      pluginName,
      status: 'provisioning',
    };

    // Allocate ports
    broadcast('provision:progress', { pluginName, step: 'Allocating ports' });
    const ports = await portAllocator.allocatePorts(pluginName);
    result.ports = ports;

    // Provision database if needed
    if (manifest.database) {
      broadcast('provision:progress', { pluginName, step: 'Creating database' });
      
      const dbInfo = await databaseManager.createDatabase({
        name: pluginName,
      });
      
      result.database = {
        ...dbInfo,
        connectionString: databaseManager.buildConnectionString(
          dbInfo.name,
          dbInfo.user,
          manifest.database.password || 'generated'
        ),
      };

      // Run migrations if provided
      if (migrationsPath && !dbInfo.exists) {
        broadcast('provision:progress', { pluginName, step: 'Running migrations' });
        await databaseManager.runMigrations(
          dbInfo.name,
          migrationsPath,
          (result.database as Record<string, string>).connectionString
        );
      }

      // Run seed if provided
      if (seedPath && !dbInfo.exists) {
        broadcast('provision:progress', { pluginName, step: 'Seeding database' });
        await databaseManager.runSeed(
          seedPath,
          (result.database as Record<string, string>).connectionString
        );
      }
    }

    // Create container if backend is defined
    if (manifest.backend) {
      broadcast('provision:progress', { pluginName, step: 'Pulling Docker image' });
      
      const imageName = manifest.backend.image || `${pluginName}-backend:${manifest.version}`;
      
      try {
        await containerOrchestrator.pullImage(imageName, (progress) => {
          broadcast('provision:progress', { pluginName, step: `Pulling image: ${progress}` });
        });
      } catch {
        // Image might be local, continue
      }

      broadcast('provision:progress', { pluginName, step: 'Creating container' });
      
      const containerId = await containerOrchestrator.createContainer({
        name: pluginName,
        image: imageName,
        port: ports.backendPort,
        env: {
          PORT: String(ports.backendPort),
          DATABASE_URL: (result.database as Record<string, string>)?.connectionString || '',
          ...manifest.backend.env,
        },
        resources: manifest.backend.resources,
      });

      result.container = {
        id: containerId,
        port: ports.backendPort,
      };

      // Add to health monitoring
      if (manifest.backend.healthCheck) {
        healthMonitor.addPlugin(
          pluginName,
          `http://localhost:${ports.backendPort}${manifest.backend.healthCheck}`
        );
      }
    }

    result.status = 'ready';
    broadcast('provision:completed', { pluginName, result });
    
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    broadcast('provision:error', { pluginName, error: errorMessage });
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Deprovision infrastructure for a plugin
 */
infrastructureRouter.delete('/deprovision/:pluginName', async (req: Request, res: Response) => {
  const { pluginName } = req.params;
  const { deleteDatabase } = req.query;

  try {
    broadcast('deprovision:started', { pluginName });

    // Stop and remove container
    await containerOrchestrator.removeContainer(pluginName);
    
    // Remove from health monitoring
    healthMonitor.removePlugin(pluginName);

    // Release ports
    portAllocator.releasePorts(pluginName);

    // Delete database if requested
    if (deleteDatabase === 'true') {
      await databaseManager.deleteDatabase(pluginName);
    }

    broadcast('deprovision:completed', { pluginName });
    res.json({ status: 'deprovisioned', pluginName });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    broadcast('deprovision:error', { pluginName, error: errorMessage });
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get infrastructure status for a plugin
 */
infrastructureRouter.get('/status/:pluginName', async (req: Request, res: Response) => {
  const { pluginName } = req.params;

  try {
    const container = await containerOrchestrator.getContainerStatus(pluginName);
    const database = await databaseManager.getDatabaseInfo(pluginName);
    const ports = portAllocator.getAllocation(pluginName);
    const health = healthMonitor.getHealth(pluginName);

    res.json({
      pluginName,
      container,
      database,
      ports,
      health,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Get container logs
 */
infrastructureRouter.get('/logs/:pluginName', async (req: Request, res: Response) => {
  const { pluginName } = req.params;
  const { tail } = req.query;

  try {
    const logs = await containerOrchestrator.getContainerLogs(
      pluginName, 
      tail ? parseInt(tail as string) : 100
    );
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Restart a plugin container
 */
infrastructureRouter.post('/restart/:pluginName', async (req: Request, res: Response) => {
  const { pluginName } = req.params;

  try {
    await containerOrchestrator.restartContainer(pluginName);
    res.json({ status: 'restarted', pluginName });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * List all plugin containers
 */
infrastructureRouter.get('/containers', async (_req: Request, res: Response) => {
  try {
    const containers = await containerOrchestrator.listPluginContainers();
    res.json({ containers });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * List all plugin databases
 */
infrastructureRouter.get('/databases', async (_req: Request, res: Response) => {
  try {
    const databases = await databaseManager.listPluginDatabases();
    res.json({ databases });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Get all port allocations
 */
infrastructureRouter.get('/ports', async (_req: Request, res: Response) => {
  try {
    const allocations = portAllocator.getAllAllocations();
    res.json({ allocations });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Get all health checks
 */
infrastructureRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const checks = healthMonitor.getAllHealth();
    res.json({ checks });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
