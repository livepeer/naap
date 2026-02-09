/**
 * Authentication Service
 * 
 * Handles email/password authentication, OAuth, and session management.
 * Single Responsibility: All authentication logic.
 */

import * as crypto from 'crypto';
import { PrismaClient } from '@naap/database';

// Simple password hashing using crypto (no external deps needed for dev)
// In production, use bcrypt
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  address: string | null;
  roles: string[];
  permissions: Array<{ resource: string; action: string }>;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

export interface OAuthConfig {
  google?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  github?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
}

// Lockout configuration
const LOCKOUT_THRESHOLD = 5; // Number of failed attempts before lockout
const LOCKOUT_WINDOW_MINUTES = 15; // Window to count failed attempts
const LOCKOUT_DURATION_MINUTES = 30; // How long account is locked

export function createAuthService(prisma: PrismaClient, oauthConfig?: OAuthConfig) {
  const SESSION_DURATION_HOURS = 24;

  /**
   * Check if account is currently locked
   */
  async function isAccountLocked(email: string): Promise<{ locked: boolean; lockedUntil?: Date }> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { lockedUntil: true },
    });

    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return { locked: true, lockedUntil: user.lockedUntil };
    }

    return { locked: false };
  }

  /**
   * Count recent failed login attempts
   */
  async function countFailedAttempts(email: string, ipAddress?: string): Promise<number> {
    const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000);

    const count = await prisma.loginAttempt.count({
      where: {
        email,
        success: false,
        createdAt: { gte: windowStart },
      },
    });

    return count;
  }

  /**
   * Record a login attempt
   */
  async function recordLoginAttempt(
    email: string,
    success: boolean,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    await prisma.loginAttempt.create({
      data: {
        email,
        success,
        userId,
        ipAddress,
      },
    });

    // If failed, check if we need to lock the account
    if (!success) {
      const failedCount = await countFailedAttempts(email, ipAddress);

      if (failedCount >= LOCKOUT_THRESHOLD) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);

        await prisma.user.updateMany({
          where: { email },
          data: { lockedUntil },
        });

        console.log(`Account locked: ${email} until ${lockedUntil.toISOString()}`);
      }
    }
  }

  /**
   * Clear lockout for an account
   */
  async function clearLockout(email: string): Promise<void> {
    await prisma.user.updateMany({
      where: { email },
      data: { lockedUntil: null },
    });
  }

  /**
   * Get user with roles
   */
  async function getUserWithRoles(userId: string): Promise<AuthUser | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) return null;

    // Get user roles
    const userRoles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });

    const roles = userRoles.map(ur => ur.role.name);
    const permissions: Array<{ resource: string; action: string }> = [];
    
    for (const ur of userRoles) {
      const rolePerms = ur.role.permissions as Array<{ resource: string; action: string }>;
      if (Array.isArray(rolePerms)) {
        permissions.push(...rolePerms);
      }
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      address: user.address,
      roles,
      permissions,
    };
  }

  /**
   * Create a session for a user
   */
  async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  return {
    /**
     * Register a new user with email/password
     */
    async register(
      email: string,
      password: string,
      displayName?: string
    ): Promise<AuthResult> {
      // Validate
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Check if user exists
      const existing = await prisma.user.findUnique({
        where: { email },
      });

      if (existing) {
        throw new Error('Email already registered');
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          displayName: displayName || email.split('@')[0],
          config: {
            create: {
              theme: 'dark',
            },
          },
        },
      });

      // Create session
      const { token, expiresAt } = await createSession(user.id);

      // Get user with roles
      const authUser = await getUserWithRoles(user.id);
      if (!authUser) {
        throw new Error('Failed to create user');
      }

      return { user: authUser, token, expiresAt };
    },

    /**
     * Login with email/password
     * Includes account lockout protection
     */
    async login(email: string, password: string, ipAddress?: string): Promise<AuthResult> {
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      // Check if account is locked
      const lockStatus = await isAccountLocked(email);
      if (lockStatus.locked) {
        const remainingMinutes = Math.ceil(
          (lockStatus.lockedUntil!.getTime() - Date.now()) / 60000
        );
        const error = new Error(
          `Account is temporarily locked. Try again in ${remainingMinutes} minutes.`
        );
        (error as any).code = 'ACCOUNT_LOCKED';
        (error as any).lockedUntil = lockStatus.lockedUntil;
        throw error;
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        // Record failed attempt even for non-existent users to prevent enumeration
        await recordLoginAttempt(email, false, undefined, ipAddress);
        throw new Error('Invalid email or password');
      }

      // Verify password
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        await recordLoginAttempt(email, false, user.id, ipAddress);
        
        // Check if this attempt triggers lockout
        const failedCount = await countFailedAttempts(email);
        const remainingAttempts = LOCKOUT_THRESHOLD - failedCount;
        
        if (remainingAttempts > 0 && remainingAttempts <= 2) {
          throw new Error(
            `Invalid email or password. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before account lockout.`
          );
        }
        
        throw new Error('Invalid email or password');
      }

      // Record successful login
      await recordLoginAttempt(email, true, user.id, ipAddress);

      // Clear any previous lockout on successful login
      if (user.lockedUntil) {
        await clearLockout(email);
      }

      // Create session
      const { token, expiresAt } = await createSession(user.id);

      // Get user with roles
      const authUser = await getUserWithRoles(user.id);
      if (!authUser) {
        throw new Error('User not found');
      }

      return { user: authUser, token, expiresAt };
    },

    /**
     * Validate a session token
     */
    async validateSession(token: string): Promise<AuthUser | null> {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session) return null;

      // Check expiration
      if (new Date(session.expiresAt) < new Date()) {
        // Delete expired session
        await prisma.session.delete({ where: { id: session.id } });
        return null;
      }

      // Update last used
      await prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      });

      return getUserWithRoles(session.userId);
    },

    /**
     * Validate a session and return expiration info
     */
    async validateSessionWithExpiry(token: string): Promise<{ user: AuthUser; expiresAt: Date } | null> {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session) return null;

      // Check expiration
      if (new Date(session.expiresAt) < new Date()) {
        // Delete expired session
        await prisma.session.delete({ where: { id: session.id } });
        return null;
      }

      // Update last used
      await prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      });

      const user = await getUserWithRoles(session.userId);
      if (!user) return null;

      return { user, expiresAt: session.expiresAt };
    },

    /**
     * Refresh a session - extend expiration time
     */
    async refreshSession(token: string): Promise<{ expiresAt: Date } | null> {
      const session = await prisma.session.findUnique({
        where: { token },
      });

      if (!session) return null;

      // Check if current session is still valid (allow refresh even if close to expiry)
      if (new Date(session.expiresAt) < new Date()) {
        await prisma.session.delete({ where: { id: session.id } });
        return null;
      }

      // Extend session by SESSION_DURATION_HOURS
      const newExpiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

      await prisma.session.update({
        where: { id: session.id },
        data: { 
          expiresAt: newExpiresAt,
          lastUsedAt: new Date(),
        },
      });

      return { expiresAt: newExpiresAt };
    },

    /**
     * Logout - revoke session
     */
    async logout(token: string): Promise<void> {
      await prisma.session.deleteMany({
        where: { token },
      });
    },

    /**
     * Get OAuth authorization URL
     */
    getOAuthUrl(provider: 'google' | 'github', state: string): string | null {
      if (provider === 'google' && oauthConfig?.google) {
        const params = new URLSearchParams({
          client_id: oauthConfig.google.clientId,
          redirect_uri: oauthConfig.google.redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          state,
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      }

      if (provider === 'github' && oauthConfig?.github) {
        const params = new URLSearchParams({
          client_id: oauthConfig.github.clientId,
          redirect_uri: oauthConfig.github.redirectUri,
          scope: 'user:email',
          state,
        });
        return `https://github.com/login/oauth/authorize?${params.toString()}`;
      }

      return null;
    },

    /**
     * Handle OAuth callback
     */
    async handleOAuthCallback(
      provider: 'google' | 'github',
      code: string
    ): Promise<AuthResult> {
      let email: string | null = null;
      let providerAccountId: string | null = null;
      let displayName: string | null = null;
      let avatarUrl: string | null = null;

      if (provider === 'google' && oauthConfig?.google) {
        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: oauthConfig.google.clientId,
            client_secret: oauthConfig.google.clientSecret,
            redirect_uri: oauthConfig.google.redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        const tokens = await tokenRes.json();
        if (!tokens.access_token) {
          throw new Error('Failed to get access token from Google');
        }

        // Get user info
        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        const userInfo = await userRes.json();
        email = userInfo.email;
        providerAccountId = userInfo.id;
        displayName = userInfo.name;
        avatarUrl = userInfo.picture;
      }

      if (provider === 'github' && oauthConfig?.github) {
        // Exchange code for tokens
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            code,
            client_id: oauthConfig.github.clientId,
            client_secret: oauthConfig.github.clientSecret,
          }),
        });

        const tokens = await tokenRes.json();
        if (!tokens.access_token) {
          throw new Error('Failed to get access token from GitHub');
        }

        // Get user info
        const userRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        const userInfo = await userRes.json();
        providerAccountId = String(userInfo.id);
        displayName = userInfo.name || userInfo.login;
        avatarUrl = userInfo.avatar_url;

        // Get primary email
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        const emails = await emailRes.json();
        const primaryEmail = emails.find((e: { primary: boolean }) => e.primary);
        email = primaryEmail?.email || null;
      }

      if (!providerAccountId) {
        throw new Error('Failed to get user info from OAuth provider');
      }

      // Find or create user
      let oauthAccount = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: { provider, providerAccountId },
        },
        include: { user: true },
      });

      let userId: string;

      if (oauthAccount) {
        // Existing OAuth account
        userId = oauthAccount.userId;
      } else {
        // Check if email exists
        let user = email
          ? await prisma.user.findUnique({ where: { email } })
          : null;

        if (!user) {
          // Create new user
          user = await prisma.user.create({
            data: {
              email,
              displayName,
              avatarUrl,
              emailVerified: email ? new Date() : null,
              config: {
                create: {
                  theme: 'dark',
                },
              },
            },
          });
        }

        // Link OAuth account
        await prisma.oAuthAccount.create({
          data: {
            userId: user.id,
            provider,
            providerAccountId,
          },
        });

        userId = user.id;
      }

      // Create session
      const { token, expiresAt } = await createSession(userId);

      // Get user with roles
      const authUser = await getUserWithRoles(userId);
      if (!authUser) {
        throw new Error('Failed to get user');
      }

      return { user: authUser, token, expiresAt };
    },

    /**
     * Get available OAuth providers
     */
    getAvailableProviders(): string[] {
      const providers: string[] = [];
      if (oauthConfig?.google) providers.push('google');
      if (oauthConfig?.github) providers.push('github');
      return providers;
    },

    /**
     * Hash password (for seeding)
     */
    hashPassword,

    /**
     * Get user with roles (exported for other services)
     */
    getUserWithRoles,

    /**
     * Request password reset - generates token
     */
    async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
      const user = await prisma.user.findUnique({ where: { email } });
      
      if (!user) {
        // Don't reveal if email exists
        return { success: true, message: 'If an account exists, a reset link has been sent.' };
      }

      // Invalidate existing tokens
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

      // Create new token (valid for 1 hour)
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      });

      // In production, send email. For now, log to console
      console.log(`[PASSWORD RESET] Token for ${email}: ${token}`);
      console.log(`[PASSWORD RESET] Reset URL: /auth/reset-password?token=${token}`);

      return { success: true, message: 'If an account exists, a reset link has been sent.' };
    },

    /**
     * Reset password with token
     */
    async resetPassword(token: string, newPassword: string): Promise<AuthResult> {
      if (!token || !newPassword) {
        throw new Error('Token and new password are required');
      }

      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      const resetToken = await prisma.passwordResetToken.findUnique({
        where: { token },
      });

      if (!resetToken) {
        throw new Error('Invalid or expired reset token');
      }

      if (new Date(resetToken.expiresAt) < new Date()) {
        await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
        throw new Error('Reset token has expired');
      }

      if (resetToken.usedAt) {
        throw new Error('Reset token has already been used');
      }

      // Hash new password
      const passwordHash = await hashPassword(newPassword);

      // Update user password
      await prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });

      // Mark token as used
      await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // Create new session
      const { token: sessionToken, expiresAt } = await createSession(resetToken.userId);
      const authUser = await getUserWithRoles(resetToken.userId);

      if (!authUser) {
        throw new Error('User not found');
      }

      return { user: authUser, token: sessionToken, expiresAt };
    },

    /**
     * Send email verification
     */
    async sendVerificationEmail(userId: string): Promise<{ success: boolean }> {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      
      if (!user || !user.email) {
        throw new Error('User not found or no email');
      }

      if (user.emailVerified) {
        return { success: true };
      }

      // Invalidate existing tokens
      await prisma.emailVerificationToken.deleteMany({ where: { userId } });

      // Create new token (valid for 24 hours)
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.emailVerificationToken.create({
        data: {
          userId,
          email: user.email,
          token,
          expiresAt,
        },
      });

      // In production, send email. For now, log to console
      console.log(`[EMAIL VERIFICATION] Token for ${user.email}: ${token}`);
      console.log(`[EMAIL VERIFICATION] Verify URL: /auth/verify-email?token=${token}`);

      return { success: true };
    },

    /**
     * Verify email with token
     */
    async verifyEmail(token: string): Promise<{ success: boolean; user: AuthUser }> {
      const verifyToken = await prisma.emailVerificationToken.findUnique({
        where: { token },
      });

      if (!verifyToken) {
        throw new Error('Invalid verification token');
      }

      if (new Date(verifyToken.expiresAt) < new Date()) {
        await prisma.emailVerificationToken.delete({ where: { id: verifyToken.id } });
        throw new Error('Verification token has expired');
      }

      if (verifyToken.usedAt) {
        throw new Error('Verification token has already been used');
      }

      // Verify email
      await prisma.user.update({
        where: { id: verifyToken.userId },
        data: { emailVerified: new Date() },
      });

      // Mark token as used
      await prisma.emailVerificationToken.update({
        where: { id: verifyToken.id },
        data: { usedAt: new Date() },
      });

      const authUser = await getUserWithRoles(verifyToken.userId);
      if (!authUser) {
        throw new Error('User not found');
      }

      return { success: true, user: authUser };
    },

    /**
     * Check if user email is verified
     */
    async isEmailVerified(userId: string): Promise<boolean> {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerified: true },
      });
      return !!user?.emailVerified;
    },
  };
}

// Type export
export type AuthService = ReturnType<typeof createAuthService>;
