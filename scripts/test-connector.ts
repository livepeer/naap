
import { PrismaClient } from './packages/database/src/generated/client/index.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    const connector = await prisma.gatewayConnector.findFirst({
      where: { slug: 'livepeer-gateway' }
    });
    if (!connector) {
      console.error('Connector not found');
      return;
    }
    console.log('Connector found:', connector.id);

    // Get an admin user or first user to act as caller
    const user = await prisma.user.findFirst();
    if (!user) {
        console.error('No user found');
        return;
    }

    // Start a job directly via the connector's upstream
    const startRes = await fetch(`${connector.upstreamBaseUrl}/start-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: 'noop' })
    });
    const job = await startRes.json();
    console.log('Job started:', JSON.stringify(job, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main();
