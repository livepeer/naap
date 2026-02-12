import { PrismaClient } from '../packages/database/src/generated/client';

const prisma = new PrismaClient();

async function main() {
  const plugins = await prisma.workflowPlugin.findMany({
    where: {
      OR: [
        { name: { contains: 'Lightning' } },
        { name: { contains: 'lightning' } }
      ]
    }
  });

  console.log('Found plugins:', plugins.map(p => ({ id: p.id, name: p.name, bundleUrl: p.bundleUrl })));

  for (const plugin of plugins) {
    if (plugin.bundleUrl) {
      const newUrl = plugin.bundleUrl.includes('?') 
        ? plugin.bundleUrl.split('?')[0] + '?v=' + Date.now()
        : plugin.bundleUrl + '?v=' + Date.now();
      
      await prisma.workflowPlugin.update({
        where: { id: plugin.id },
        data: { bundleUrl: newUrl }
      });
      console.log(`Updated ${plugin.name} bundleUrl to ${newUrl}`);
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
