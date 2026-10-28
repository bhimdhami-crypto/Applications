// Prepares the demo database during a Vercel build (see "vercel-build" in package.json):
// on an empty database it seeds the companies and test accounts, then imports the sample staff.
// Safe to run on every build: the seed runs once and the import skips people already there.
import { PrismaClient } from '@prisma/client';
import { importSample } from './import-sample';
import { seed } from './seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    if ((await prisma.user.count()) === 0) {
      const accounts = await seed(prisma);
      console.log(`Seeded ${accounts.length} test accounts`);
    } else {
      console.log('Test accounts already seeded');
    }
    await importSample(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
