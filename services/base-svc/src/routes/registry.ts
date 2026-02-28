/**
 * Registry Routes
 *
 * API endpoints for the plugin marketplace: package browsing, publishing,
 * reviews and ratings, publisher management, and package status changes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import type { AuditLogInput } from '../services/lifecycle';
import {
  discoverFromDir,
  toPluginPackageData,
  toPluginVersionData,
  toWorkflowPluginData,
  getBundleUrl,
  type DiscoveredPlugin,
} from '@naap/database/plugin-discovery';

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function createRateLimiter(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    entry.count++;
    return next();
  };
}
const apiLimiter = createRateLimiter(15 * 60 * 1000, 100);

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

interface RegistryRouteDeps {
  db: any;
  getUserIdFromRequest: (req: Request) => Promise<string | null>;
  lifecycleService: {
    audit: (input: AuditLogInput) => Promise<unknown>;
  };
  /** Auth service for session validation (JWT-based user endpoints). */
  authService: {
    validateSession: (token: string) => Promise<{ id: string; email?: string | null } | null>;
  };
  /** Middleware that validates API tokens. */
  requireToken: any;
  /** Type augmented Request from API token auth. */
  generateApiToken: () => { token: string; hash: string; prefix: string };
  /** Pre-publish verification utility. */
  verifyPublish: (options: any) => Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    checks: Array<{ name: string; passed: boolean }>;
  }>;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createRegistryRoutes(deps: RegistryRouteDeps) {
  const {
    db, getUserIdFromRequest, lifecycleService, authService,
    requireToken, generateApiToken, verifyPublish,
  } = deps;
  const router = Router();

  // ==========================================================================
  // Package Browsing
  // ==========================================================================

  /** GET /registry/packages - list packages with search and filters */
  router.get('/registry/packages', async (req: Request, res: Response) => {
    try {
      const { search, category, mine, limit = '20', offset = '0', sort = 'downloads' } = req.query;

      const where: any = { deprecated: false };
      if (category) where.category = category as string;
      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { displayName: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } },
          { keywords: { has: search as string } },
        ];
      }

      if (mine === 'true') {
        const userId = await getUserIdFromRequest(req);
        if (userId) {
          const user = await db.user.findUnique({ where: { id: userId } });
          if (user?.email) {
            const publisher = await db.publisher.findFirst({ where: { email: user.email } });
            if (publisher) {
              where.publisherId = publisher.id;
            } else {
              return res.json({ packages: [], total: 0, limit: parseInt(limit as string), offset: parseInt(offset as string) });
            }
          }
        }
      }

      const orderBy: any = {};
      if (sort === 'downloads') orderBy.downloads = 'desc';
      else if (sort === 'rating') orderBy.rating = 'desc';
      else if (sort === 'newest') orderBy.createdAt = 'desc';
      else if (sort === 'name') orderBy.name = 'asc';

      const [packages, total] = await Promise.all([
        db.pluginPackage.findMany({
          where, orderBy,
          take: parseInt(limit as string),
          skip: parseInt(offset as string),
          include: { versions: { orderBy: { publishedAt: 'desc' }, take: 1 }, _count: { select: { installations: true } } },
        }),
        db.pluginPackage.count({ where }),
      ]);

      res.json({
        packages: packages.map((p: any) => ({
          ...p,
          latestVersion: p.versions[0]?.version,
          installedCount: p._count.installations,
        })),
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });
    } catch (error) {
      console.error('Registry packages error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /registry/packages/:name - get package details */
  router.get('/registry/packages/:name', async (req: Request, res: Response) => {
    try {
      const pkg = await db.pluginPackage.findUnique({
        where: { name: req.params.name },
        include: { versions: { orderBy: { publishedAt: 'desc' } }, installations: { select: { id: true, status: true } } },
      });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });
      res.json({ package: pkg });
    } catch (error) {
      console.error('Package details error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Reviews & Ratings
  // ==========================================================================

  /** GET /registry/packages/:name/reviews - get reviews with aggregate rating */
  router.get('/registry/packages/:name/reviews', async (req: Request, res: Response) => {
    try {
      const pkg = await db.pluginPackage.findUnique({ where: { name: req.params.name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      const [reviews, totalRatings, aggResult] = await Promise.all([
        db.pluginReview.findMany({ where: { packageId: pkg.id }, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
        db.pluginReview.count({ where: { packageId: pkg.id } }),
        db.pluginReview.aggregate({ where: { packageId: pkg.id }, _avg: { rating: true } }),
      ]);

      const distributionRaw = await db.pluginReview.groupBy({
        by: ['rating'], where: { packageId: pkg.id }, _count: { rating: true },
      });
      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      distributionRaw.forEach((d: any) => { distribution[d.rating] = d._count.rating; });

      const avgRating = aggResult._avg.rating;

      res.json({
        success: true,
        data: {
          reviews: reviews.map((r: any) => ({
            id: r.id, displayName: r.displayName || 'Anonymous', rating: r.rating,
            comment: r.comment, createdAt: r.createdAt, updatedAt: r.updatedAt,
          })),
          aggregate: {
            averageRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
            totalRatings, distribution,
          },
          pagination: { page, limit, totalPages: Math.ceil(totalRatings / limit) },
        },
      });
    } catch (error) {
      console.error('Error fetching reviews:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /registry/packages/:name/reviews - submit or update a review */
  router.post('/registry/packages/:name/reviews', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
      }

      const comment = req.body.comment;
      if (comment !== undefined && comment !== null) {
        if (typeof comment !== 'string' || comment.length > 2000) {
          return res.status(400).json({ error: 'comment must be a string with max 2000 characters' });
        }
      }

      const pkg = await db.pluginPackage.findUnique({ where: { name: req.params.name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      const user = await db.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
      const displayName = user?.displayName || user?.email?.split('@')[0] || 'Anonymous';

      const review = await db.$transaction(async (tx: any) => {
        const rev = await tx.pluginReview.upsert({
          where: { packageId_userId: { packageId: pkg.id, userId } },
          create: { packageId: pkg.id, userId, rating, comment: comment || null, displayName },
          update: { rating, comment: comment || null, displayName },
        });
        const agg = await tx.pluginReview.aggregate({ where: { packageId: pkg.id }, _avg: { rating: true } });
        await tx.pluginPackage.update({ where: { id: pkg.id }, data: { rating: agg._avg.rating } });
        return rev;
      });

      res.json({
        success: true,
        data: { id: review.id, rating: review.rating, comment: review.comment, displayName: review.displayName, createdAt: review.createdAt, updatedAt: review.updatedAt },
      });
    } catch (error) {
      console.error('Error submitting review:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /registry/packages/:name/reviews - delete own review */
  router.delete('/registry/packages/:name/reviews', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const pkg = await db.pluginPackage.findUnique({ where: { name: req.params.name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      await db.$transaction(async (tx: any) => {
        await tx.pluginReview.deleteMany({ where: { packageId: pkg.id, userId } });
        const agg = await tx.pluginReview.aggregate({ where: { packageId: pkg.id }, _avg: { rating: true } });
        await tx.pluginPackage.update({ where: { id: pkg.id }, data: { rating: agg._avg.rating } });
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting review:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /registry/packages/:name/:version - get specific version */
  router.get('/registry/packages/:name/:version', async (req: Request, res: Response) => {
    try {
      const { name, version } = req.params;
      const pkg = await db.pluginPackage.findUnique({ where: { name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      const ver = await db.pluginVersion.findFirst({ where: { packageId: pkg.id, version } });
      if (!ver) return res.status(404).json({ error: 'Version not found' });

      res.json({ package: pkg, version: ver });
    } catch (error) {
      console.error('Package version error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Publish
  // ==========================================================================

  /** POST /registry/packages - publish a new package or version */
  router.post('/registry/packages', async (req: Request, res: Response) => {
    try {
      const { manifest, frontendUrl, backendImage, releaseNotes } = req.body;
      if (!manifest?.name || !manifest?.version) {
        return res.status(400).json({ error: 'manifest with name and version required' });
      }

      const pkg = await db.pluginPackage.upsert({
        where: { name: manifest.name },
        update: {
          displayName: manifest.displayName, description: manifest.description,
          category: manifest.category || 'other', author: manifest.author?.name,
          authorEmail: manifest.author?.email, repository: manifest.repository,
          license: manifest.license, keywords: manifest.keywords || [],
          icon: manifest.frontend?.navigation?.icon, publishStatus: 'published',
        },
        create: {
          name: manifest.name, displayName: manifest.displayName, description: manifest.description,
          category: manifest.category || 'other', author: manifest.author?.name,
          authorEmail: manifest.author?.email, repository: manifest.repository,
          license: manifest.license, keywords: manifest.keywords || [],
          icon: manifest.frontend?.navigation?.icon, publishStatus: 'published',
        },
      });

      const version = await db.pluginVersion.create({
        data: { packageId: pkg.id, version: manifest.version, manifest, frontendUrl, backendImage, releaseNotes },
      });

      res.status(201).json({ package: pkg, version });
    } catch (error) {
      console.error('Publish error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /registry/packages/:name/:version/deprecate - deprecate a version */
  router.post('/registry/packages/:name/:version/deprecate', async (req: Request, res: Response) => {
    try {
      const { name, version } = req.params;
      const { message } = req.body;

      const pkg = await db.pluginPackage.findUnique({ where: { name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      await db.pluginVersion.updateMany({
        where: { packageId: pkg.id, version },
        data: { deprecated: true, deprecationMsg: message },
      });

      const affectedInstallations = await db.pluginInstallation.count({ where: { packageId: pkg.id } });
      res.json({ success: true, affectedInstallations });
    } catch (error) {
      console.error('Deprecate error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /registry/packages/:name/status - update package status (API token) */
  router.patch('/registry/packages/:name/status', requireToken('publish'), async (req: any, res: Response) => {
    try {
      const { name } = req.params;
      const { status } = req.body;

      if (!['published', 'unlisted', 'deprecated', 'draft'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be: published, unlisted, deprecated, or draft' });
      }

      const pkg = await db.pluginPackage.findUnique({ where: { name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });
      if (pkg.publisherId && pkg.publisherId !== req.publisher!.id) {
        return res.status(403).json({ error: 'You do not own this package' });
      }

      const updatedPkg = await db.pluginPackage.update({ where: { name }, data: { publishStatus: status } });

      await lifecycleService.audit({
        action: 'plugin.status_change', resource: 'plugin', resourceId: name,
        userId: req.publisher!.id,
        details: { previousStatus: pkg.publishStatus, newStatus: status },
      });

      res.json({ success: true, package: updatedPkg });
    } catch (error) {
      console.error('Status update error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /registry/user/packages/:name/status - update package status (JWT) */
  router.patch('/registry/user/packages/:name/status', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required' });
      }

      const token = authHeader.substring(7);
      const user = await authService.validateSession(token);
      if (!user) return res.status(401).json({ error: 'Invalid or expired session' });

      const { name } = req.params;
      const { status } = req.body;

      if (!['published', 'unlisted', 'deprecated', 'draft'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be: published, unlisted, deprecated, or draft' });
      }

      const pkg = await db.pluginPackage.findUnique({ where: { name }, include: { publisher: true } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      const isAdmin = user.email === 'admin@livepeer.org' || user.email === 'developer@livepeer.org';
      let hasAccess = false;
      if (!pkg.publisherId) hasAccess = true;
      else if (isAdmin) hasAccess = true;
      else if (pkg.publisher && user.email && pkg.publisher.email === user.email) hasAccess = true;
      else {
        const userPublisher = await db.publisher.findFirst({ where: { email: user.email || '' } });
        if (userPublisher && pkg.publisherId === userPublisher.id) hasAccess = true;
      }

      if (!hasAccess) return res.status(403).json({ error: 'You do not own this package' });

      const updatedPkg = await db.pluginPackage.update({ where: { name }, data: { publishStatus: status } });

      await lifecycleService.audit({
        action: 'plugin.status_change', resource: 'plugin', resourceId: name,
        userId: user.id, details: { previousStatus: pkg.publishStatus, newStatus: status },
      });

      res.json({ success: true, package: updatedPkg });
    } catch (error) {
      console.error('Status update error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /registry/publishers/:id/stats - get publisher statistics */
  router.get('/registry/publishers/:id/stats', requireToken('read'), async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const packages = await db.pluginPackage.findMany({ where: { publisherId: id }, include: { versions: true } });

      const stats = {
        totalPackages: packages.length,
        publishedPackages: packages.filter((p: any) => p.publishStatus === 'published').length,
        totalDownloads: packages.reduce((sum: number, p: any) => sum + p.downloads, 0),
        totalVersions: packages.reduce((sum: number, p: any) => sum + p.versions.length, 0),
        avgRating: packages.length > 0
          ? packages.reduce((sum: number, p: any) => sum + (p.rating || 0), 0) / packages.length : 0,
        categories: [...new Set(packages.map((p: any) => p.category))],
      };

      res.json(stats);
    } catch (error) {
      console.error('Publisher stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /registry/packages/:name/:version - delete a version (unpublish) */
  router.delete('/registry/packages/:name/:version', async (req: Request, res: Response) => {
    try {
      const { name, version } = req.params;
      const pkg = await db.pluginPackage.findUnique({ where: { name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });
      await db.pluginVersion.deleteMany({ where: { packageId: pkg.id, version } });
      res.json({ success: true });
    } catch (error) {
      console.error('Unpublish error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Publisher Management
  // ==========================================================================

  /** POST /registry/publishers - create a publisher */
  router.post('/registry/publishers', async (req: Request, res: Response) => {
    try {
      const { name, displayName, email, githubOrg, githubUser, avatarUrl } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      const existing = await db.publisher.findUnique({ where: { name } });
      if (existing) return res.status(409).json({ error: 'Publisher already exists', publisher: existing });

      const publisher = await db.publisher.create({
        data: { name, displayName: displayName || name, email, githubOrg, githubUser, avatarUrl },
      });

      const { token, hash, prefix } = generateApiToken();
      await db.apiToken.create({
        data: { name: 'Initial Token', tokenHash: hash, tokenPrefix: prefix, publisherId: publisher.id, scopes: ['read', 'publish'] },
      });

      res.status(201).json({ publisher, token, warning: 'Save this token - it will not be shown again!' });
    } catch (error) {
      console.error('Create publisher error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /registry/publishers/:name - get publisher by name */
  router.get('/registry/publishers/:name', async (req: Request, res: Response) => {
    try {
      const publisher = await db.publisher.findUnique({
        where: { name: req.params.name },
        include: { packages: { select: { name: true, displayName: true, downloads: true } }, _count: { select: { tokens: true } } },
      });
      if (!publisher) return res.status(404).json({ error: 'Publisher not found' });
      res.json({ ...publisher, tokenCount: publisher._count.tokens });
    } catch (error) {
      console.error('Get publisher error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /registry/packages/:name/github - link GitHub repo */
  router.post('/registry/packages/:name/github', requireToken('publish'), async (req: any, res: Response) => {
    try {
      const { name } = req.params;
      const { githubRepo } = req.body;
      if (!githubRepo || !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) {
        return res.status(400).json({ error: 'Invalid githubRepo format (expected owner/repo)' });
      }

      const pkg = await db.pluginPackage.findUnique({ where: { name } });
      if (!pkg) return res.status(404).json({ error: 'Package not found' });
      if (pkg.publisherId && pkg.publisherId !== req.publisher?.id) {
        return res.status(403).json({ error: 'You do not own this package' });
      }

      const updated = await db.pluginPackage.update({ where: { name }, data: { githubRepo, publisherId: req.publisher?.id } });
      res.json({ package: updated });
    } catch (error) {
      console.error('Link GitHub error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // User-authenticated Publish
  // ==========================================================================

  /** POST /registry/publish - user-authenticated publish (JWT) */
  router.post('/registry/publish', apiLimiter, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] apiLimiter applied
    try {
      const { manifest, frontendUrl, backendImage, releaseNotes } = req.body;
      if (!manifest?.name || !manifest?.version) {
        return res.status(400).json({ error: 'manifest with name and version required' });
      }

      // Always run pre-publish verification — never allow user-controlled bypass
      const verification = await verifyPublish({ manifest, frontendUrl, backendImage, timeout: 5000 });
      if (!verification.valid) {
        return res.status(400).json({
          error: 'Pre-publish verification failed',
          verification: { errors: verification.errors, warnings: verification.warnings, checks: verification.checks },
        });

      }
      const safeName = String(manifest.name).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
      const safeVersion = String(manifest.version).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
      console.log(`[publish] Verification passed for ${safeName}@${safeVersion}:`, // lgtm[js/tainted-format-string] safeName/safeVersion sanitized inline
        verification.checks.map(c => `${c.name}: ${c.passed ? '✓' : '✗'}`).join(', '));

      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(401).json({ error: 'User not found' });

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

      const existingPkg = await db.pluginPackage.findUnique({ where: { name: manifest.name } });
      if (existingPkg && existingPkg.publisherId && existingPkg.publisherId !== publisher.id) {
        return res.status(403).json({ error: 'You do not own this package' });
      }

      const pkg = await db.pluginPackage.upsert({
        where: { name: manifest.name },
        update: {
          displayName: manifest.displayName, description: manifest.description,
          category: manifest.category || 'other', author: manifest.author?.name,
          authorEmail: manifest.author?.email, repository: manifest.repository,
          license: manifest.license, keywords: manifest.keywords || [],
          icon: manifest.frontend?.navigation?.icon, publishStatus: 'published',
        },
        create: {
          name: manifest.name, displayName: manifest.displayName, description: manifest.description,
          category: manifest.category || 'other', author: manifest.author?.name,
          authorEmail: manifest.author?.email, repository: manifest.repository,
          license: manifest.license, keywords: manifest.keywords || [],
          icon: manifest.frontend?.navigation?.icon, publisherId: publisher.id, publishStatus: 'published',
        },
      });

      // Atomic version creation — catch unique constraint violation to close
      // the race window between check and insert.
      let version;
      try {
        version = await db.pluginVersion.create({
          data: { packageId: pkg.id, version: manifest.version, manifest, frontendUrl, backendImage, releaseNotes },
        });
      } catch (createErr: any) {
        if (createErr?.code === 'P2002') {
          return res.status(409).json({ error: 'Version already exists', hint: 'Increment the version number and try again' });
        }
        throw createErr;
      }

      // Auto-install for the publisher: ensure a deployment + TenantPluginInstall
      // exist so the plugin is immediately visible in their sidebar and settings.
      try {
        let deployment = await db.pluginDeployment.findUnique({ where: { packageId: pkg.id } });
        if (!deployment) {
          deployment = await db.pluginDeployment.create({
            data: {
              packageId: pkg.id, versionId: version.id, status: 'running',
              frontendUrl: frontendUrl || '', deployedAt: new Date(),
              healthStatus: 'healthy', activeInstalls: 0,
            },
          });
        }

        const existingInstall = await db.tenantPluginInstall.findFirst({
          where: { userId, deploymentId: deployment.id, status: { not: 'uninstalled' } },
        });
        if (!existingInstall) {
          await db.tenantPluginInstall.create({
            data: { userId, deploymentId: deployment.id, status: 'active', enabled: true },
          });
          await db.pluginDeployment.update({
            where: { id: deployment.id },
            data: { activeInstalls: { increment: 1 } },
          });
        }

        await db.userPluginPreference.upsert({
          where: { userId_pluginName: { userId, pluginName: manifest.name } },
          update: { enabled: true },
          create: { userId, pluginName: manifest.name, enabled: true, order: 0, pinned: false },
        });
      } catch (installErr) {
        console.warn('Auto-install after publish failed (non-fatal):', installErr);
      }

      await lifecycleService.audit({
        action: 'plugin.publish', resource: 'plugin', resourceId: manifest.name, userId,
        details: { version: manifest.version, frontendUrl, backendImage, publisherId: publisher.id },
      });

      res.status(201).json({ package: pkg, version });
    } catch (error) {
      console.error('User publish error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Example Plugin Publishing (feature-flagged)
  // ==========================================================================

  const MONOREPO_ROOT = path.resolve(process.cwd(), process.env.MONOREPO_ROOT || '../..');
  const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';

  async function isExamplePublishingEnabled(): Promise<boolean> {
    const flag = await db.featureFlag.findUnique({ where: { key: 'enableExamplePublishing' } });
    return flag?.enabled === true;
  }

  /** GET /registry/examples - list available example plugins */
  router.get('/registry/examples', async (_req: Request, res: Response) => {
    try {
      if (!(await isExamplePublishingEnabled())) {
        return res.status(403).json({ error: 'Example plugin publishing is not enabled' });
      }

      const examples = discoverFromDir(MONOREPO_ROOT, 'examples');

      const publishedPkgs = examples.length > 0
        ? await db.pluginPackage.findMany({
            where: {
              name: { in: examples.map((e: DiscoveredPlugin) => e.name) },
              publishStatus: 'published',
            },
            select: { name: true },
          })
        : [];
      const publishedSet = new Set(publishedPkgs.map((p: { name: string }) => p.name));

      const result = examples.map((e: DiscoveredPlugin) => ({
        name: e.name,
        dirName: e.dirName,
        displayName: e.displayName,
        description: e.description || '',
        category: e.category || 'example',
        author: e.author || 'NAAP Examples',
        version: e.version,
        icon: e.icon,
        alreadyPublished: publishedSet.has(e.name),
      }));

      res.json({ success: true, examples: result });
    } catch (error) {
      console.error('List examples error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /registry/examples/:name/publish - publish an example plugin to marketplace */
  router.post('/registry/examples/:name/publish', async (req: Request, res: Response) => {
    try {
      if (!(await isExamplePublishingEnabled())) {
        return res.status(403).json({ error: 'Example plugin publishing is not enabled' });
      }

      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });

      const { name: pluginName } = req.params;

      // Discover examples and validate the requested name exists (path traversal safe)
      const examples = discoverFromDir(MONOREPO_ROOT, 'examples');
      const example = examples.find((e: DiscoveredPlugin) => e.name === pluginName);
      if (!example) {
        return res.status(404).json({
          error: 'Example plugin not found',
          available: examples.map((e: DiscoveredPlugin) => e.name),
        });
      }

      // Verify the plugin has been built
      const bundlePath = path.join(
        MONOREPO_ROOT, 'dist', 'plugins', example.dirName,
        example.version, `${example.dirName}.js`,
      );
      if (!fs.existsSync(bundlePath)) {
        return res.status(400).json({
          error: `Plugin "${example.dirName}" must be built first`,
          hint: `Run: bin/build-plugins.sh --plugin ${example.dirName}`,
        });
      }

      // Atomic publish: package + version + workflow + deployment + install in a transaction
      const result = await db.$transaction(async (tx: any) => {
        const pkgData = toPluginPackageData(example, PLUGIN_CDN_URL);
        const pkg = await tx.pluginPackage.upsert({
          where: { name: example.name },
          update: { ...pkgData, publishStatus: 'published' },
          create: pkgData,
        });

        const versionData = toPluginVersionData(example, pkg.id, PLUGIN_CDN_URL);
        const version = await tx.pluginVersion.upsert({
          where: { packageId_version: { packageId: pkg.id, version: example.version } },
          update: { frontendUrl: versionData.frontendUrl, manifest: versionData.manifest as any },
          create: versionData,
        });

        const workflowData = toWorkflowPluginData(example, PLUGIN_CDN_URL, MONOREPO_ROOT);
        const existingWP = await tx.workflowPlugin.findUnique({
          where: { name: example.name },
          select: { metadata: true },
        });
        const mergedMetadata = {
          ...((existingWP?.metadata as Record<string, unknown>) || {}),
          originalRoutes: example.originalRoutes,
        };
        await tx.workflowPlugin.upsert({
          where: { name: example.name },
          update: { ...workflowData, metadata: mergedMetadata },
          create: { ...workflowData, metadata: mergedMetadata },
        });

        const deployment = await tx.pluginDeployment.upsert({
          where: { packageId: pkg.id },
          update: {
            versionId: version.id,
            status: 'running',
            frontendUrl: getBundleUrl(PLUGIN_CDN_URL, example.dirName, example.version),
            deployedAt: new Date(),
            healthStatus: 'healthy',
          },
          create: {
            packageId: pkg.id,
            versionId: version.id,
            status: 'running',
            frontendUrl: getBundleUrl(PLUGIN_CDN_URL, example.dirName, example.version),
            deployedAt: new Date(),
            healthStatus: 'healthy',
            activeInstalls: 0,
          },
        });

        // Auto-install for the publishing user so the plugin appears in their
        // sidebar, settings, and marketplace as "Installed".
        const existingInstall = await tx.tenantPluginInstall.findFirst({
          where: { userId, deploymentId: deployment.id, status: { not: 'uninstalled' } },
        });
        if (!existingInstall) {
          await tx.tenantPluginInstall.create({
            data: {
              userId,
              deploymentId: deployment.id,
              status: 'active',
              enabled: true,
            },
          });
          await tx.pluginDeployment.update({
            where: { id: deployment.id },
            data: { activeInstalls: { increment: 1 } },
          });
        }

        await tx.userPluginPreference.upsert({
          where: { userId_pluginName: { userId, pluginName: example.name } },
          update: { enabled: true },
          create: { userId, pluginName: example.name, enabled: true, order: 0, pinned: false },
        });

        return { package: pkg, version };
      });

      // Symlink examples/{name} → plugins/{name} so start.sh and
      // sync-plugin-registry discover it like any regular plugin.
      const symlinkTarget = path.join(MONOREPO_ROOT, 'plugins', example.dirName);
      const symlinkSource = path.join(MONOREPO_ROOT, 'examples', example.dirName);
      if (!fs.existsSync(symlinkTarget) && fs.existsSync(symlinkSource)) {
        try {
          fs.symlinkSync(symlinkSource, symlinkTarget, 'dir');
          console.log(`[registry] Symlinked plugins/${example.dirName} → examples/${example.dirName}`);
        } catch (linkErr) {
          console.warn(`[registry] Could not create symlink for ${example.dirName}:`, linkErr);
        }
      }

      await lifecycleService.audit({
        action: 'plugin.publish', resource: 'plugin', resourceId: example.name,
        userId, details: { version: example.version, source: 'example' },
      });

      res.status(201).json({ success: true, ...result });
    } catch (error) {
      console.error('Publish example error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==========================================================================
  // Token-authenticated Publish
  // ==========================================================================

  /** POST /registry/publish/token - API token authenticated publish */
  router.post('/registry/publish/token', apiLimiter, requireToken('publish'), async (req: any, res: Response) => { // lgtm[js/missing-rate-limiting] apiLimiter applied
    try {
      const { manifest, frontendUrl, backendImage, releaseNotes } = req.body;
      if (!manifest?.name || !manifest?.version) {
        return res.status(400).json({ error: 'manifest with name and version required' });
      }

      // Always run pre-publish verification — never allow user-controlled bypass
      const verification = await verifyPublish({ manifest, frontendUrl, backendImage, timeout: 5000 });
      if (!verification.valid) {
        return res.status(400).json({
          error: 'Pre-publish verification failed',
          verification: { errors: verification.errors, warnings: verification.warnings, checks: verification.checks },
        });

      }
      const safeName = String(manifest.name).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
      const safeVersion = String(manifest.version).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
      console.log(`[publish/token] Verification passed for ${safeName}@${safeVersion}`);

      const existingPkg = await db.pluginPackage.findUnique({ where: { name: manifest.name } });
      if (existingPkg && existingPkg.publisherId && existingPkg.publisherId !== req.publisher!.id) {
        return res.status(403).json({ error: 'You do not own this package' });
      }

      const pkg = await db.pluginPackage.upsert({
        where: { name: manifest.name },
        update: {
          displayName: manifest.displayName, description: manifest.description,
          category: manifest.category || 'other', author: manifest.author?.name,
          authorEmail: manifest.author?.email, repository: manifest.repository,
          license: manifest.license, keywords: manifest.keywords || [],
          icon: manifest.frontend?.navigation?.icon, publishStatus: 'published',
        },
        create: {
          name: manifest.name, displayName: manifest.displayName, description: manifest.description,
          category: manifest.category || 'other', author: manifest.author?.name,
          authorEmail: manifest.author?.email, repository: manifest.repository,
          license: manifest.license, keywords: manifest.keywords || [],
          icon: manifest.frontend?.navigation?.icon, publisherId: req.publisher!.id, publishStatus: 'published',
        },
      });

      // Atomic version creation — catch unique constraint to close race window.
      let version;
      try {
        version = await db.pluginVersion.create({
          data: { packageId: pkg.id, version: manifest.version, manifest, frontendUrl, backendImage, releaseNotes },
        });
      } catch (createErr: any) {
        if (createErr?.code === 'P2002') {
          return res.status(409).json({ error: 'Version already exists', hint: 'Increment the version number and try again' });
        }
        throw createErr;
      }

      await lifecycleService.audit({
        action: 'plugin.publish', resource: 'plugin', resourceId: manifest.name,
        userId: req.publisher!.id, details: { version: manifest.version, frontendUrl, backendImage },
      });

      res.status(201).json({ package: pkg, version });
    } catch (error) {
      console.error('API token publish error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
