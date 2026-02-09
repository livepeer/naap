/**
 * Team Context Middleware
 * 
 * Extracts team context from requests and makes it available to downstream handlers.
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@naap/database';

// Helper to get user ID from request
function getUserId(req: Request): string | undefined {
  return (req as any).user?.id;
}

// Helper to get/set team context from request
function getTeamContext(req: Request): {
  teamId: string;
  team?: any;
  memberId?: string;
  memberRole?: string;
} | undefined {
  return (req as any).teamContext;
}

function setTeamContext(req: Request, context: {
  teamId: string;
  team?: any;
  memberId?: string;
  memberRole?: string;
}): void {
  (req as any).teamContext = context;
}

/**
 * Create team context middleware
 * Extracts teamId from params/headers and loads team info
 */
export function createTeamContextMiddleware(db: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId || req.headers['x-team-id'] as string;
      
      if (!teamId) {
        // No team context, continue
        return next();
      }

      const userId = getUserId(req);
      if (!userId) {
        return next();
      }

      // Fetch team and member info
      const team = await db.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
            where: { userId },
            take: 1,
          },
        },
      });

      if (!team) {
        return next();
      }

      const member = team.members[0];
      if (!member) {
        // User is not a member of this team
        return next();
      }

      // Set team context
      setTeamContext(req, {
        teamId: team.id,
        team,
        memberId: member.id,
        memberRole: member.role,
      });

      next();
    } catch (error) {
      console.error('Team context middleware error:', error);
      next();
    }
  };
}

/**
 * Require team context middleware
 * Ensures req.teamContext is set before proceeding
 */
export function requireTeamContext(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const teamContext = getTeamContext(req);
  if (!teamContext) {
    return res.status(403).json({
      success: false,
      error: 'Team context required',
    });
  }
  next();
}

/**
 * Require specific team role middleware
 */
export function requireTeamRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const teamContext = getTeamContext(req);
    if (!teamContext) {
      return res.status(403).json({
        success: false,
        error: 'Team context required',
      });
    }

    if (!roles.includes(teamContext.memberRole || '')) {
      return res.status(403).json({
        success: false,
        error: `Required role: ${roles.join(' or ')}`,
      });
    }

    next();
  };
}

/**
 * Require team owner middleware
 */
export function requireTeamOwner(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const teamContext = getTeamContext(req);
  if (!teamContext) {
    return res.status(403).json({
      success: false,
      error: 'Team context required',
    });
  }

  if (teamContext.memberRole !== 'owner') {
    return res.status(403).json({
      success: false,
      error: 'Only team owner can perform this action',
    });
  }

  next();
}
