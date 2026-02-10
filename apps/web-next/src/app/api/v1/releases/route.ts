import {NextRequest, NextResponse } from 'next/server';
import { success, errors } from '@/lib/api/response';

// Mock releases data
const RELEASES = [
  {
    id: '1',
    version: '2.5.0',
    name: 'Enhanced Plugin System',
    description: 'Major improvements to the plugin architecture with better performance and new APIs.',
    releaseDate: '2026-02-01',
    type: 'minor',
    changelog: [
      'New plugin management UI in Settings',
      'Improved plugin loading performance',
      'Added plugin configuration support',
      'Enhanced team plugin management',
      'New marketplace filtering options',
    ],
  },
  {
    id: '2',
    version: '2.4.0',
    name: 'Team Workspaces',
    description: 'Introducing team workspaces for better collaboration and organization.',
    releaseDate: '2026-01-15',
    type: 'minor',
    changelog: [
      'Team workspace switcher',
      'Team-specific plugin installations',
      'Role-based access control for teams',
      'Team settings and configuration',
      'Improved member management',
    ],
  },
  {
    id: '3',
    version: '2.3.2',
    name: 'Bug Fixes',
    description: 'Various bug fixes and stability improvements.',
    releaseDate: '2026-01-10',
    type: 'patch',
    changelog: [
      'Fixed sidebar navigation issues',
      'Resolved authentication edge cases',
      'Improved error handling',
      'Performance optimizations',
    ],
  },
];

// GET /api/v1/releases - Get release notes
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // In production, fetch from database or GitHub Releases API
    return success({
      releases: RELEASES,
    });
  } catch (err) {
    console.error('Error fetching releases:', err);
    return errors.internal('Failed to fetch releases');
  }
}
