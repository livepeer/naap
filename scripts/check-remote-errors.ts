import { PrismaClient } from '../packages/database/src/generated/client';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in your environment or .env.local');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  const records = await prisma.$queryRawUnsafe(
    'SELECT "statusCode", "error", "path", "timestamp" FROM "plugin_service_gateway"."GatewayUsageRecord" WHERE "path" LIKE \'%start-job%\' ORDER BY "timestamp" DESC LIMIT 10'
  );
  console.log(JSON.stringify(records, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
