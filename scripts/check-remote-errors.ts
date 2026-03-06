import { PrismaClient } from '../packages/database/src/generated/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_Jq8oXhTnUDW0@ep-frosty-pine-aiybl1uq.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
    }
  }
});

async function main() {
  const records = await prisma.$queryRawUnsafe(
    'SELECT "statusCode", "error", "path", "timestamp" FROM "plugin_service_gateway"."GatewayUsageRecord" WHERE "path" LIKE \'%start-job%\' ORDER BY "timestamp" DESC LIMIT 10'
  );
  console.log(JSON.stringify(records, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
