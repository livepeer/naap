// @naap/database - Community User to CommunityProfile Migration Script
//
// This script migrates existing community User records to the unified schema:
// - community.User (with walletAddress) -> public.User (with address) + plugin_community.CommunityProfile
//
// Usage:
//   LEGACY_COMMUNITY_DB_URL=postgresql://... DATABASE_URL=postgresql://... npx tsx prisma/migrations/migrate-community-users.ts
//
// IMPORTANT: Run this BEFORE switching services to the unified database

import { PrismaClient as UnifiedClient } from '../../src/generated/client';

interface LegacyCommunityUser {
  id: string;
  walletAddress: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  reputation: number;
  level: number;
  createdAt: Date;
  updatedAt: Date;
}

async function migrateCommunityUsers() {
  console.log('Starting Community User Migration...');

  if (!process.env.LEGACY_COMMUNITY_DB_URL) {
    console.error('LEGACY_COMMUNITY_DB_URL environment variable is required');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const unifiedDb = new UnifiedClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const legacyDb = new UnifiedClient({
    datasources: { db: { url: process.env.LEGACY_COMMUNITY_DB_URL } },
  });

  try {
    console.log('Fetching users from legacy community database...');
    
    const communityUsers = await legacyDb.$queryRaw<LegacyCommunityUser[]>`
      SELECT id, "walletAddress", "displayName", "avatarUrl", bio, reputation, level, "createdAt", "updatedAt"
      FROM "User"
    `;

    console.log('Found ' + communityUsers.length + ' community users');

    let created = 0, updated = 0, skipped = 0, errors = 0;

    for (const cu of communityUsers) {
      try {
        let user = await unifiedDb.user.findUnique({
          where: { address: cu.walletAddress },
        });

        if (user) {
          if (!user.displayName && cu.displayName) {
            user = await unifiedDb.user.update({
              where: { id: user.id },
              data: { displayName: cu.displayName, avatarUrl: cu.avatarUrl || user.avatarUrl },
            });
            updated++;
          } else {
            skipped++;
          }
        } else {
          user = await unifiedDb.user.create({
            data: {
              address: cu.walletAddress,
              displayName: cu.displayName,
              avatarUrl: cu.avatarUrl,
              createdAt: cu.createdAt,
              updatedAt: cu.updatedAt,
            },
          });
          created++;
        }

        const existingProfile = await unifiedDb.communityProfile.findUnique({
          where: { userId: user.id },
        });

        if (!existingProfile) {
          await unifiedDb.communityProfile.create({
            data: {
              userId: user.id,
              bio: cu.bio,
              reputation: cu.reputation,
              level: cu.level,
              createdAt: cu.createdAt,
              updatedAt: cu.updatedAt,
            },
          });
        } else if (existingProfile.reputation !== cu.reputation || existingProfile.level !== cu.level) {
          await unifiedDb.communityProfile.update({
            where: { id: existingProfile.id },
            data: {
              bio: cu.bio || existingProfile.bio,
              reputation: Math.max(existingProfile.reputation, cu.reputation),
              level: Math.max(existingProfile.level, cu.level),
            },
          });
        }
      } catch (error) {
        errors++;
        console.error('Error processing user:', error);
      }
    }

    console.log('Migration Summary:');
    console.log('  Created:', created);
    console.log('  Updated:', updated);
    console.log('  Skipped:', skipped);
    console.log('  Errors:', errors);

    if (errors > 0) {
      process.exit(1);
    }
    console.log('Migration completed successfully!');
  } finally {
    await unifiedDb.$disconnect();
    await legacyDb.$disconnect();
  }
}

migrateCommunityUsers().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
