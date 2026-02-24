/**
 * Authentication Routes
 *
 * API endpoints for email/password auth, OAuth, session management,
 * password reset, and email verification.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@naap/database';
import { generateCsrfToken, invalidateCsrfToken } from '../services/csrf';
import { createAuthService } from '../services/auth';
import type { AuditLogInput } from '../services/lifecycle';

// Rate Limiting
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
      return res.status(429).json({ error: 'Too many attempts, please try again later' });
    }
    entry.count++;
    return next();
  };
}
const authLimiter = createRateLimiter(15 * 60 * 1000, 10);

interface AuthRouteDeps {
  db: PrismaClient;
  lifecycleService: {
    audit: (input: AuditLogInput) => Promise<unknown>;
  };
}

export function createAuthRoutes({ db, lifecycleService }: AuthRouteDeps) {
  const router = Router();

  const authService = createAuthService(db, {
    google: process.env.GOOGLE_CLIENT_ID
      ? {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirectUri: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback/google`,
        }
      : undefined,
    github: process.env.GITHUB_CLIENT_ID
      ? {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
          redirectUri: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback/github`,
        }
      : undefined,
  });

  // Get available auth providers
  router.get('/auth/providers', (_req: Request, res: Response) => {
    res.json({
      providers: authService.getAvailableProviders(),
      emailPassword: true,
    });
  });

  // Register with email/password
  router.post('/auth/register', async (req: Request, res: Response) => {
    try {
      const { email, password, displayName } = req.body;
      const result = await authService.register(email, password, displayName);

      // Generate CSRF token for this session
      const csrfToken = generateCsrfToken(result.token);

      await lifecycleService.audit({
        action: 'auth.register',
        resource: 'user',
        resourceId: result.user.id,
        userId: result.user.id,
        details: { email },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        token: result.token,
        csrfToken,
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      console.error('Registration error:', error);
      res.status(400).json({ error: message });
    }
  });

  // Login with email/password
  router.post('/auth/login', authLimiter, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] authLimiter applied
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress;
      const result = await authService.login(email, password, ipAddress);

      // Generate CSRF token for this session
      const csrfToken = generateCsrfToken(result.token);

      await lifecycleService.audit({
        action: 'auth.login',
        resource: 'user',
        resourceId: result.user.id,
        userId: result.user.id,
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        token: result.token,
        csrfToken,
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Login failed';
      const code = error?.code;
      const lockedUntil = error?.lockedUntil;

      await lifecycleService.audit({
        action: 'auth.login',
        resource: 'user',
        status: 'failure',
        errorMsg: message,
        details: code === 'ACCOUNT_LOCKED' ? { lockedUntil } : undefined,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      console.error('Login error:', error);

      // Return 423 Locked for account lockout
      if (code === 'ACCOUNT_LOCKED') {
        return res.status(423).json({
          error: message,
          code: 'ACCOUNT_LOCKED',
          lockedUntil: lockedUntil?.toISOString(),
        });
      }

      res.status(401).json({ error: message });
    }
  });

  // Get current user (also returns CSRF token and session expiry for page reloads)
  router.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const result = await authService.validateSessionWithExpiry(token);
      if (!result) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const csrfToken = generateCsrfToken(token);
      res.json({
        user: result.user,
        csrfToken,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('Get current user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Refresh session
  router.post('/auth/refresh', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const result = await authService.refreshSession(token);
      if (!result) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      const csrfToken = generateCsrfToken(token);

      await lifecycleService.audit({
        action: 'auth.session_refresh',
        resource: 'session',
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        csrfToken,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('Session refresh error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Logout
  router.post('/auth/logout', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        invalidateCsrfToken(token);
        await authService.logout(token);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Request password reset
  router.post('/auth/forgot-password', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      const result = await authService.requestPasswordReset(email);

      await lifecycleService.audit({
        action: 'auth.password_reset_request',
        resource: 'user',
        details: { email },
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json(result);
    } catch (error) {
      console.error('Password reset request error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Reset password with token
  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required' });
      }

      const result = await authService.resetPassword(token, password);

      await lifecycleService.audit({
        action: 'auth.password_reset',
        resource: 'user',
        resourceId: result.user.id,
        userId: result.user.id,
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        token: result.token,
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed';
      console.error('Password reset error:', error);
      res.status(400).json({ error: message });
    }
  });

  // Send email verification
  router.post('/auth/send-verification', async (req: Request, res: Response) => {
    try {
      const headerUserId = req.headers['x-user-id'] as string;
      let userId: string | null = headerUserId || null;

      if (!userId) {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          const user = await authService.validateSession(token);
          userId = user?.id || null;
        }
      }

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await authService.sendVerificationEmail(userId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send verification';
      console.error('Send verification error:', error);
      res.status(400).json({ error: message });
    }
  });

  // Verify email with token
  router.post('/auth/verify-email', authLimiter, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] authLimiter applied
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Token is required and must be a string' });
      }

      const result = await authService.verifyEmail(token);

      await lifecycleService.audit({
        action: 'auth.email_verified',
        resource: 'user',
        resourceId: result.user.id,
        userId: result.user.id,
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email verification failed';
      console.error('Email verification error:', error);
      res.status(400).json({ error: message });
    }
  });

  // Initiate OAuth flow
  router.get('/auth/oauth/:provider', (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      const { redirect } = req.query;

      if (provider !== 'google' && provider !== 'github') {
        return res.status(400).json({ error: 'Invalid provider' });
      }

      const state = Buffer.from(
        JSON.stringify({
          redirect: redirect || '/',
          timestamp: Date.now(),
        })
      ).toString('base64');

      const url = authService.getOAuthUrl(provider, state);
      if (!url) {
        return res.status(400).json({ error: `${provider} OAuth not configured` });
      }

      res.json({ url });
    } catch (error) {
      console.error('OAuth URL error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Handle OAuth callback (called from frontend)
  router.post('/auth/callback/:provider', authLimiter, async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] authLimiter applied
    try {
      const { provider } = req.params;
      const { code } = req.body;

      if (provider !== 'google' && provider !== 'github') {
        return res.status(400).json({ error: 'Invalid provider' });
      }

      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Authorization code required and must be a string' });
      }

      const result = await authService.handleOAuthCallback(provider, code);

      await lifecycleService.audit({
        action: 'auth.oauth',
        resource: 'user',
        resourceId: result.user.id,
        userId: result.user.id,
        details: { provider },
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        token: result.token,
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OAuth failed';
      console.error('OAuth callback error:', error);
      res.status(400).json({ error: message });
    }
  });

  // Export authService for use elsewhere (e.g., getUserIdFromRequest)
  return { router, authService };
}
