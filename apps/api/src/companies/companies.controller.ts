import { Controller, Get } from '@nestjs/common';
import { rulesFor } from '../payroll/rules';
import { PrismaService } from '../prisma/prisma.service';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const companies = await this.prisma.company.findMany({ orderBy: { name: 'asc' } });
    return companies.map((c) => {
      const pack = rulesFor(c.countryCode);
      return { ...c, payrollRules: pack ? { version: pack.version, verified: pack.verified } : null };
    });
  }
}
