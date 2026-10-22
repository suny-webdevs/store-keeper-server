import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Seed or find default demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default-store' },
    update: {},
    create: {
      name: 'Default Store',
      slug: 'default-store',
    },
  });

  // 2. Seed default main branch
  const branch = await prisma.branch.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: 'MAIN',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Main Branch',
      code: 'MAIN',
      isActive: true,
    },
  });

  // 3. Seed default category
  const category = await prisma.category.upsert({
    where: {
      tenantId_slug: {
        tenantId: tenant.id,
        slug: 'general',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'General',
      slug: 'general',
      attributeSchema: {},
    },
  });

  console.log('✅ Seed completed successfully:');
  console.log(`   Tenant:   ${tenant.name} (${tenant.id})`);
  console.log(`   Branch:   ${branch.name} (${branch.id})`);
  console.log(`   Category: ${category.name} (${category.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
