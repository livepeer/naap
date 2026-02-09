/**
 * Tokens & Webhooks Routes
 *
 * API endpoints for API token management (both API-token-authenticated
 * and JWT-session-authenticated), and GitHub webhook configuration.
 */

import { Router, Request, Response } from 'express';
import type { AuditLogInput } from '../services/lifecycle';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface TokensWebhooksRouteDeps {
  db: any;
  lifecycleService: {
    audit: (input: AuditLogInput) => Promise<unknown>;
  };
  getUserIdFromRequest: (req: Request) => Promise<string | null>;
  generateApiToken: () => { token: string; hash: string; prefix: string };
  hashToken: (token: string) => string;
  requireToken: any;
  verifyGitHubWebhook: () => any;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createTokensWebhooksRoutes(deps: TokensWebhooksRouteDeps) {
  const { db, lifecycleService, getUserIdFromRequest, generateApiToken, hashToken, requireToken, verifyGitHubWebhook } = deps;
  const router = Router();

  // ==========================================================================
  // API Token Management (API-token authenticated)
  // ==========================================================================

  /** POST /registry/tokens - create a new token */
  router.post('/registry/tokens', requireToken('admin'), async (req: any, res: Response) => {
    try {
      const { name, scopes, expiresInDays } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      const validScopes = ['read', 'publish', 'admin'];
      const requestedScopes = scopes || ['read', 'publish'];
      for (const scope of requestedScopes) {
        if (!validScopes.includes(scope)) return res.status(400).json({ error: `Invalid scope: ${scope}` });
      }

      const { token, hash, prefix } = generateApiToken();
      const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

      const apiToken = await db.apiToken.create({
        data: { name, tokenHash: hash, tokenPrefix: prefix, publisherId: req.publisher!.id, scopes: requestedScopes, expiresAt },
      });

      await lifecycleService.audit({
        action: 'token.create', resource: 'apiToken', resourceId: apiToken.id,
        userId: req.publisher!.id, details: { name, scopes: requestedScopes },
      });

      res.status(201).json({
        id: apiToken.id, name: apiToken.name, token, prefix: apiToken.tokenPrefix,
        scopes: apiToken.scopes, expiresAt: apiToken.expiresAt,
        warning: 'Save this token - it will not be shown again!',
      });
    } catch (error) {
      console.error('Create token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /registry/tokens - list tokens for authenticated publisher */
  router.get('/registry/tokens', requireToken('read'), async (req: any, res: Response) => {
    try {
      const tokens = await db.apiToken.findMany({
        where: { publisherId: req.publisher!.id, revokedAt: null },
        select: { id: true, name: true, tokenPrefix: true, scopes: true, expiresAt: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ tokens });
    } catch (error) {
      console.error('List tokens error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /registry/tokens/:id - revoke a token */
  router.delete('/registry/tokens/:id', requireToken('admin'), async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const token = await db.apiToken.findUnique({ where: { id } });
      if (!token) return res.status(404).json({ error: 'Token not found' });
      if (token.publisherId !== req.publisher!.id) return res.status(403).json({ error: 'You do not own this token' });
      if (token.id === req.token!.id) return res.status(400).json({ error: 'Cannot revoke the token currently in use' });

      await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });

      await lifecycleService.audit({
        action: 'token.revoke', resource: 'apiToken', resourceId: id, userId: req.publisher!.id,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Revoke token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // JWT-based Token Management (for browser/UI users)
  // ==========================================================================

  /** POST /registry/user/tokens - create API token using JWT session */
  router.post('/registry/user/tokens', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(401).json({ error: 'User not found' });

      const { name, scopes, expiresInDays } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      const validScopes = ['read', 'publish', 'admin'];
      const requestedScopes = scopes || ['read', 'publish'];
      for (const scope of requestedScopes) {
        if (!validScopes.includes(scope)) return res.status(400).json({ error: `Invalid scope: ${scope}` });
      }

      let publisher = await db.publisher.findFirst({ where: { email: user.email || undefined } });
      if (!publisher) {
        const publisherName = user.displayName || user.email?.split('@')[0] || `user-${userId.slice(0, 8)}`;
        publisher = await db.publisher.create({
          data: {
            name: publisherName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
            displayName: user.displayName || publisherName, email: user.email, avatarUrl: user.avatarUrl,
          },
        });
      }

      const { token, hash, prefix } = generateApiToken();
      const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

      const apiToken = await db.apiToken.create({
        data: { name, tokenHash: hash, tokenPrefix: prefix, publisherId: publisher.id, scopes: requestedScopes, expiresAt },
      });

      await lifecycleService.audit({
        action: 'token.create', resource: 'apiToken', resourceId: apiToken.id,
        userId, details: { name, scopes: requestedScopes },
      });

      res.status(201).json({
        token,
        tokenInfo: {
          id: apiToken.id, name: apiToken.name, tokenPrefix: apiToken.tokenPrefix,
          scopes: apiToken.scopes, expiresAt: apiToken.expiresAt, createdAt: apiToken.createdAt,
        },
        warning: 'Save this token - it will not be shown again!',
      });
    } catch (error) {
      console.error('User create token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /registry/user/tokens - list tokens using JWT session */
  router.get('/registry/user/tokens', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(401).json({ error: 'User not found' });

      const publisher = await db.publisher.findFirst({ where: { email: user.email || undefined } });
      if (!publisher) return res.json({ tokens: [] });

      const tokens = await db.apiToken.findMany({
        where: { publisherId: publisher.id, revokedAt: null },
        select: { id: true, name: true, tokenPrefix: true, scopes: true, expiresAt: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ tokens });
    } catch (error) {
      console.error('User list tokens error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /registry/user/tokens/:id - revoke token using JWT session */
  router.delete('/registry/user/tokens/:id', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(401).json({ error: 'User not found' });

      const publisher = await db.publisher.findFirst({ where: { email: user.email || undefined } });
      if (!publisher) return res.status(404).json({ error: 'Publisher not found' });

      const { id } = req.params;
      const tokenRecord = await db.apiToken.findUnique({ where: { id } });
      if (!tokenRecord) return res.status(404).json({ error: 'Token not found' });
      if (tokenRecord.publisherId !== publisher.id) return res.status(403).json({ error: 'You do not own this token' });

      await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });

      await lifecycleService.audit({
        action: 'token.revoke', resource: 'apiToken', resourceId: id,
        userId, details: { name: tokenRecord.name },
      });

      res.json({ success: true });
    } catch (error) {
      console.error('User revoke token error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Webhooks
  // ==========================================================================

  /** POST /registry/webhooks/github/configure - configure GitHub webhook secret */
  router.post('/registry/webhooks/github/configure', requireToken('admin'), async (req: any, res: Response) => {
    try {
      const { secret } = req.body;
      if (!secret || secret.length < 20) {
        return res.status(400).json({ error: 'secret must be at least 20 characters' });
      }

      const secretHash = hashToken(secret);

      await db.webhookSecret.upsert({
        where: { publisherId_provider: { publisherId: req.publisher!.id, provider: 'github' } },
        update: { secretHash, enabled: true },
        create: { publisherId: req.publisher!.id, provider: 'github', secretHash },
      });

      res.json({ success: true, message: 'GitHub webhook secret configured' });
    } catch (error) {
      console.error('Configure webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /registry/webhooks/github - GitHub webhook handler */
  router.post('/registry/webhooks/github', verifyGitHubWebhook(), async (req: any, res: Response) => {
    try {
      const event = req.githubEvent;
      const pkg = req.package;
      const delivery = req.githubDelivery;

      console.log(`GitHub webhook received: ${event} for ${pkg.name} (delivery: ${delivery})`);

      if (event === 'release') {
        const { action, release } = req.body;
        if (action === 'published') {
          const tagName = release.tag_name.replace(/^v/, '');

          await db.pluginVersion.upsert({
            where: { packageId_version: { packageId: pkg.id, version: tagName } },
            update: { releaseNotes: release.body },
            create: { packageId: pkg.id, version: tagName, manifest: { version: tagName }, releaseNotes: release.body },
          });

          await lifecycleService.audit({
            action: 'webhook.release', resource: 'plugin', resourceId: pkg.name,
            details: { version: tagName, releaseUrl: release.html_url, author: release.author?.login },
          });

          return res.json({ success: true, message: `Release ${tagName} received for ${pkg.name}` });
        }
      }

      if (event === 'push') {
        const ref = req.body.ref;
        if (ref.startsWith('refs/tags/')) {
          const tag = ref.replace('refs/tags/', '');
          console.log(`Tag push detected: ${tag}`);
        }
      }

      res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      console.error('Webhook handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
