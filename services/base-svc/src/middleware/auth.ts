/**
 * Authentication Middleware for Registry API
 * Supports API tokens for publishing and webhook verification
 */

import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { db } from '../db/client';

export interface AuthenticatedRequest extends Request {
  publisher?: {
    id: string;
    name: string;
    githubOrg?: string | null;
    githubUser?: string | null;
  };
  token?: {
    id: string;
    scopes: string[];
  };
}

/**
 * Generate a cryptographically secure API token
 */
export function generateApiToken(): { token: string; hash: string; prefix: string } {
  // Generate 32 bytes of random data (256 bits)
  const tokenBytes = crypto.randomBytes(32);
  const token = `naap_${tokenBytes.toString('base64url')}`;
  const hash = hashToken(token);
  const prefix = token.substring(0, 12);
  
  return { token, hash, prefix };
}

/**
 * Hash a token for secure storage
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify a GitHub webhook signature
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Middleware to require API token authentication
 */
export function requireToken(...requiredScopes: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Missing or invalid authorization header',
          hint: 'Use "Authorization: Bearer <token>"'
        });
      }
      
      const token = authHeader.substring(7);
      const tokenHash = hashToken(token);
      
      // Look up token
      const apiToken = await db.apiToken.findUnique({
        where: { tokenHash },
        include: { publisher: true },
      });
      
      if (!apiToken) {
        return res.status(401).json({ error: 'Invalid API token' });
      }
      
      // Check if revoked
      if (apiToken.revokedAt) {
        return res.status(401).json({ error: 'API token has been revoked' });
      }
      
      // Check expiration
      if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
        return res.status(401).json({ error: 'API token has expired' });
      }
      
      // Check scopes
      if (requiredScopes.length > 0) {
        const hasScope = requiredScopes.some(scope => 
          apiToken.scopes.includes(scope) || apiToken.scopes.includes('admin')
        );
        
        if (!hasScope) {
          return res.status(403).json({ 
            error: 'Insufficient permissions',
            required: requiredScopes,
            granted: apiToken.scopes,
          });
        }
      }
      
      // Update last used timestamp (async, don't await)
      db.apiToken.update({
        where: { id: apiToken.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {}); // Ignore errors
      
      // Attach publisher and token info to request
      req.publisher = {
        id: apiToken.publisher.id,
        name: apiToken.publisher.name,
        githubOrg: apiToken.publisher.githubOrg,
        githubUser: apiToken.publisher.githubUser,
      };
      req.token = {
        id: apiToken.id,
        scopes: apiToken.scopes,
      };
      
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * Middleware to optionally authenticate (doesn't fail if no token)
 */
export function optionalToken() {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader?.startsWith('Bearer ')) {
        return next();
      }
      
      const token = authHeader.substring(7);
      const tokenHash = hashToken(token);
      
      const apiToken = await db.apiToken.findUnique({
        where: { tokenHash },
        include: { publisher: true },
      });
      
      if (apiToken && !apiToken.revokedAt) {
        if (!apiToken.expiresAt || new Date(apiToken.expiresAt) >= new Date()) {
          req.publisher = {
            id: apiToken.publisher.id,
            name: apiToken.publisher.name,
            githubOrg: apiToken.publisher.githubOrg,
            githubUser: apiToken.publisher.githubUser,
          };
          req.token = {
            id: apiToken.id,
            scopes: apiToken.scopes,
          };
        }
      }
      
      next();
    } catch (error) {
      console.error('Optional auth error:', error);
      next(); // Continue even on error
    }
  };
}

/**
 * Middleware to verify GitHub webhook signatures
 */
export function verifyGitHubWebhook() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = req.headers['x-hub-signature-256'] as string;
      
      if (!signature) {
        return res.status(401).json({ error: 'Missing signature header' });
      }
      
      // Get raw body for signature verification
      const rawBody = JSON.stringify(req.body);
      
      // Try to find the webhook secret for this repository
      const delivery = req.headers['x-github-delivery'] as string;
      const event = req.headers['x-github-event'] as string;
      
      if (!delivery || !event) {
        return res.status(400).json({ error: 'Missing GitHub headers' });
      }
      
      // Extract repository from payload
      const repoFullName = req.body.repository?.full_name;
      
      if (!repoFullName) {
        return res.status(400).json({ error: 'Missing repository in payload' });
      }
      
      // Find package by GitHub repo
      const pkg = await db.pluginPackage.findFirst({
        where: { githubRepo: repoFullName },
        include: { publisher: true },
      });
      
      if (!pkg || !pkg.publisherId) {
        return res.status(404).json({ error: 'No plugin registered for this repository' });
      }
      
      // Get webhook secret
      const webhookSecret = await db.webhookSecret.findUnique({
        where: { 
          publisherId_provider: { 
            publisherId: pkg.publisherId, 
            provider: 'github' 
          } 
        },
      });
      
      if (!webhookSecret || !webhookSecret.enabled) {
        return res.status(404).json({ error: 'Webhook not configured for this publisher' });
      }
      
      // Verify signature
      // Note: In production, decrypt the secret first
      const isValid = verifyGitHubSignature(rawBody, signature, webhookSecret.secretHash);
      
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
      
      // Attach package info to request
      (req as any).package = pkg;
      (req as any).publisher = pkg.publisher;
      (req as any).githubEvent = event;
      (req as any).githubDelivery = delivery;
      
      next();
    } catch (error) {
      console.error('Webhook verification error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
