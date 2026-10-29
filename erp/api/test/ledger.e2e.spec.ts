// End-to-end checks against a real SQL Server test database (TEST_DATABASE_URL, a database ending in _test).
process.env.JWT_SECRET ??= 'e2e-secret';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'sqlserver://localhost:1433;database=mfierp_test;user=sa;password=Erp#Test2026;trustServerCertificate=true';
// The suite wipes every table, so refuse anything that is not clearly a test database.
if (!/database=\w+_test(;|$)/i.test(process.env.DATABASE_URL)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';
import * as bcrypt from 'bcryptjs';

describe('MFI ERP ledger API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const accounts: Record<string, number> = {};

  const api = (method: 'get' | 'post', path: string, who = 'accountant') =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Children before parents
    await prisma.auditLog.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.postingBatch.updateMany({ data: { reversesId: null } });
    await prisma.postingBatch.deleteMany();
    await prisma.numberSequence.deleteMany();
    await prisma.glAccount.updateMany({ data: { parentId: null } });
    await prisma.glAccount.deleteMany();
    await prisma.project.deleteMany();
    await prisma.taxCode.deleteMany();
    await prisma.fiscalPeriod.deleteMany();
    await prisma.company.deleteMany();
    await prisma.exchangeRate.deleteMany();
    await prisma.currency.deleteMany();
    await prisma.user.deleteMany();

    process.env.SEED_ADMIN_PASSWORD = 'Admin#Erp2026';
    await seed(prisma);
    const hash = await bcrypt.hash('Test#Erp2026', 4);
    await prisma.user.createMany({
      data: [
        { email: 'accountant@mfi-erp.test', name: 'Accountant', role: 'ACCOUNTANT', passwordHash: hash },
        { email: 'viewer@mfi-erp.test', name: 'Viewer', role: 'VIEWER', passwordHash: hash },
      ],
    });
    for (const [who, password] of [
      ['admin', 'Admin#Erp2026'],
      ['accountant', 'Test#Erp2026'],
      ['viewer', 'Test#Erp2026'],
    ]) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: `${who}@mfi-erp.test`, password })
        .expect(200);
      tokens[who] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy with the database reachable', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('refuses requests without a token and wrong passwords', async () => {
    await request(app.getHttpServer()).get('/api/companies').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'accountant@mfi-erp.test', password: 'wrong' })
      .expect(401);
  });

  it('lists the three seeded companies', async () => {
    const res = await api('get', '/companies').expect(200);
    expect(res.body.map((c: { code: string }) => c.code)).toEqual(['MFI-DS', 'MFI-MDS', 'MFI-TS']);
  });

  it('creates accounts, but not for a viewer, and not twice', async () => {
    const chart = [
      { code: '1000', description: 'Assets', type: 'ASSET', isPostable: false },
      { code: '1100', description: 'Bank KES', type: 'ASSET', parentCode: '1000' },
      { code: '1110', description: 'Bank USD', type: 'ASSET', parentCode: '1000' },
      { code: '4000', description: 'Sales', type: 'INCOME' },
      { code: '5000', description: 'Rent', type: 'EXPENSE' },
    ];
    for (const a of chart) {
      const res = await api('post', '/companies/MFI-DS/accounts').send(a).expect(201);
      accounts[a.code] = res.body.id;
    }
    await api('post', '/companies/MFI-DS/accounts', 'viewer').send({ code: '9', description: 'x', type: 'ASSET' }).expect(403);
    await api('post', '/companies/MFI-DS/accounts').send(chart[1]).expect(409);
  });

  it('posts a balanced journal with a gapless audit number', async () => {
    const res = await api('post', '/companies/MFI-DS/journals')
      .send({
        txDate: '2026-03-15',
        description: 'March rent',
        reference: 'RENT-03',
        lines: [
          { accountId: accounts['5000'], debit: '50000' },
          { accountId: accounts['1100'], credit: '50000' },
        ],
      })
      .expect(201);
    expect(res.body.auditNo).toBe('GL000001');
    expect(res.body.entries).toHaveLength(2);
    expect(typeof res.body.entries[0].id).toBe('string');
  });

  it('converts a USD receipt to KES at the given rate', async () => {
    const res = await api('post', '/companies/MFI-DS/journals')
      .send({
        txDate: '2026-03-20',
        description: 'USD sale',
        lines: [
          { accountId: accounts['1110'], currencyCode: 'USD', exchangeRate: '129.5', foreignAmount: '1000' },
          { accountId: accounts['4000'], credit: '129500' },
        ],
      })
      .expect(201);
    expect(res.body.auditNo).toBe('GL000002');
    expect(res.body.entries[0]).toMatchObject({ currencyCode: 'USD' });
    expect(Number(res.body.entries[0].debit)).toBe(129500);
    expect(Number(res.body.entries[0].foreignDebit)).toBe(1000);
  });

  it.each([
    ['unbalanced', { lines: [{ debit: '10', acc: '5000' }, { credit: '9', acc: '1100' }] }, 'does not balance'],
    ['a header account', { lines: [{ debit: '10', acc: '1000' }, { credit: '10', acc: '1100' }] }, 'header account'],
    ['a date with no period', { txDate: '2031-01-01' }, 'No fiscal period'],
  ])('rejects a journal with %s', async (_, variant, message) => {
    const base = {
      txDate: '2026-03-21',
      description: 'Bad',
      lines: [
        { debit: '10', acc: '5000' },
        { credit: '10', acc: '1100' },
      ],
    };
    const body = { ...base, ...variant };
    const res = await api('post', '/companies/MFI-DS/journals')
      .send({ ...body, lines: body.lines.map(({ acc, ...l }) => ({ ...l, accountId: accounts[acc] })) })
      .expect(400);
    expect(res.body.message).toContain(message);
  });

  it('refuses to post into a closed period', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'MFI-DS' } });
    await prisma.fiscalPeriod.updateMany({ where: { companyId: company.id, year: 2026, number: 1 }, data: { isClosed: true } });
    const res = await api('post', '/companies/MFI-DS/journals')
      .send({
        txDate: '2026-01-10',
        description: 'Late entry',
        lines: [
          { accountId: accounts['5000'], debit: '1' },
          { accountId: accounts['1100'], credit: '1' },
        ],
      })
      .expect(400);
    expect(res.body.message).toContain('closed');
  });

  it('reverses a journal once, and the trial balance still balances', async () => {
    const rev = await api('post', '/companies/MFI-DS/journals/GL000001/reverse').send({ txDate: '2026-03-31' }).expect(201);
    expect(rev.body).toMatchObject({ auditNo: 'GL000003', documentType: 'REVERSAL' });
    await api('post', '/companies/MFI-DS/journals/GL000001/reverse').send({}).expect(409);

    const tb = await api('get', '/companies/MFI-DS/trial-balance?from=2026-01-01&to=2026-12-31', 'viewer').expect(200);
    expect(tb.body.totalDebit).toBe(tb.body.totalCredit);
    const rent = tb.body.rows.find((r: { code: string }) => r.code === '5000');
    expect(rent.balance).toBe('0.00');
    const sales = tb.body.rows.find((r: { code: string }) => r.code === '4000');
    expect(sales.balance).toBe('-129500.00');
  });

  it('keeps companies apart', async () => {
    const res = await api('get', '/companies/MFI-TS/trial-balance?from=2026-01-01&to=2026-12-31').expect(200);
    expect(res.body.rows).toEqual([]);
    await api('post', '/companies/MFI-TS/journals')
      .send({
        txDate: '2026-03-15',
        description: 'Uses MFI-DS accounts',
        lines: [
          { accountId: accounts['5000'], debit: '1' },
          { accountId: accounts['1100'], credit: '1' },
        ],
      })
      .expect(400);
  });

  it('writes an audit trail of postings', async () => {
    const count = await prisma.auditLog.count({ where: { action: { startsWith: 'gl.' } } });
    expect(count).toBeGreaterThanOrEqual(3 + 5);
  });
});
