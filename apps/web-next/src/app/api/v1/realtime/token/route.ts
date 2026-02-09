/**
 * Ably Token Request Endpoint
 * GET /api/v1/realtime/token
 *
 * Generates an Ably token for authenticated users.
 * This endpoint is called by the Ably client for authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import Ably from 'ably';

export async function GET(request: NextRequest) {
  try {
    // Validate user session
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Check if Ably is configured
    const ablyApiKey = process.env.ABLY_API_KEY;
    if (!ablyApiKey) {
      // Return mock token for development without Ably
      return NextResponse.json({
        token: 'mock-token',
        clientId: user.id,
        capability: { '*': ['subscribe', 'publish'] },
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });
    }

    // Create Ably REST client for token generation
    const ably = new Ably.Rest({ key: ablyApiKey });

    // Define capabilities based on user roles
    const capabilities: Record<string, string[]> = {
      // All users can subscribe to their own channel
      [`naap:user:${user.id}`]: ['subscribe', 'publish'],
      // All users can subscribe to notifications
      'naap:notifications': ['subscribe'],
      // All users can subscribe to system events
      'naap:system': ['subscribe'],
      // All users can subscribe to plugin health
      'naap:plugin:health': ['subscribe'],
    };

    // Admins can publish to system channels
    if (user.roles.includes('admin') || user.roles.includes('system:admin')) {
      capabilities['naap:notifications'] = ['subscribe', 'publish'];
      capabilities['naap:system'] = ['subscribe', 'publish'];
      capabilities['naap:plugin:health'] = ['subscribe', 'publish'];
      capabilities['naap:debug:*'] = ['subscribe', 'publish'];
    }

    // All authenticated users can subscribe to debug channels
    capabilities['naap:debug:*'] = capabilities['naap:debug:*'] || ['subscribe'];

    // Create token request
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: user.id,
      capability: JSON.stringify(capabilities),
      ttl: 60 * 60 * 1000, // 1 hour
    });

    return NextResponse.json(tokenRequest);
  } catch (err) {
    console.error('Ably token error:', err);
    return errors.internal('Failed to generate realtime token');
  }
}
