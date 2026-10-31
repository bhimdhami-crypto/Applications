import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    // In the order they were set up, so the main company comes first
    return this.prisma.company.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  }

  /** The company named in the URL, with its home currency, or 404 */
  async byCode(code: string) {
    const company = await this.prisma.company.findUnique({ where: { code }, include: { currency: true } });
    if (!company || !company.isActive) throw new NotFoundException(`No company ${code}`);
    return company;
  }

  async periods(code: string) {
    const company = await this.byCode(code);
    return this.prisma.fiscalPeriod.findMany({
      where: { companyId: company.id },
      orderBy: [{ year: 'desc' }, { number: 'asc' }],
    });
  }
}
