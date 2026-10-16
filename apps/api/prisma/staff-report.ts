// Prints the demo workforce verification report: npm run db:report
import { PrismaClient } from '@prisma/client';
import { staffReport } from './staff-generator';

const prisma = new PrismaClient();
staffReport(prisma)
  .then((r) => console.log(`${r.people} people in total\n\n${r.markdown}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
