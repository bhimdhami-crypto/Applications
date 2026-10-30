// End-to-end checks against a real SQL Server test database (TEST_DATABASE_URL, a database ending in _test).
process.env.JWT_SECRET ??= 'e2e-secret';
process.env.ARCHIVE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'erp-archive-'));
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'sqlserver://localhost:1433;database=mfierp_test;user=sa;password=Erp#Test2026;trustServerCertificate=true';
// The suite wipes every table, so refuse anything that is not clearly a test database.
if (!/database=\w+_test(;|$)/i.test(process.env.DATABASE_URL)) throw new Error('TEST_DATABASE_URL must name a database ending in _test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

const PASSWORD = 'Test#Erp2026';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

describe('MFI ERP API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const ds: Record<string, number> = {};
  const mds: Record<string, number> = {};

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, who = 'accountant') =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${tokens[who]}`);

  /** Drafts, submits and fully approves a voucher; returns its final state */
  async function postVoucher(body: object, approvers: string[] = ['manager'], company = 'MFI-DS') {
    const draft = await api('post', `/companies/${company}/vouchers`).send(body).expect(201);
    const no = draft.body.voucherNo;
    await api('post', `/companies/${company}/vouchers/${no}/submit`).send({}).expect(200);
    let res = draft;
    for (const who of approvers) res = await api('post', `/companies/${company}/vouchers/${no}/approve`, who).send({}).expect(200);
    return res.body;
  }

  const journal = (amount: string, extra: object = {}) => ({
    txDate: '2026-03-15',
    description: 'Rent',
    lines: [
      { accountId: ds['5000'], debit: amount },
      { accountId: ds['1100'], credit: amount },
    ],
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Children before parents
    await prisma.auditLog.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.approvalAction.deleteMany();
    await prisma.voucherLine.deleteMany();
    await prisma.voucher.deleteMany();
    await prisma.approvalRuleStage.deleteMany();
    await prisma.approvalRule.deleteMany();
    await prisma.intercompanyLink.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.party.deleteMany();
    await prisma.postingBatch.updateMany({ data: { reversesId: null, intercompanyOfId: null } });
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

    process.env.SEED_ADMIN_PASSWORD = PASSWORD;
    await seed(prisma);
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const people = [
      ['accountant', 'ACCOUNTANT'],
      ['manager', 'FINANCE_MANAGER'],
      ['director', 'DIRECTOR'],
      ['director2', 'DIRECTOR'],
      ['viewer', 'VIEWER'],
    ];
    await prisma.user.createMany({
      data: people.map(([who, role]) => ({ email: `${who}@mfi-erp.test`, name: who, role, passwordHash })),
    });
    for (const who of ['admin', ...people.map(([w]) => w)]) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: `${who}@mfi-erp.test`, password: PASSWORD })
        .expect(200);
      tokens[who] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy and refuses requests without a valid sign-in', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
    await request(app.getHttpServer()).get('/api/companies').expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'accountant@mfi-erp.test', password: 'wrong' }).expect(401);
  });

  it('sets up two companies with linked intercompany current accounts', async () => {
    const companies = await api('get', '/companies').expect(200);
    expect(companies.body.map((c: { code: string }) => c.code)).toEqual(['MFI-DS', 'MFI-MDS', 'MFI-TS']);

    const chart = [
      { code: '1000', description: 'Assets', type: 'ASSET', isPostable: false },
      { code: '1100', description: 'Bank KES', type: 'ASSET', parentCode: '1000' },
      { code: '1110', description: 'Bank USD', type: 'ASSET', parentCode: '1000' },
      { code: '1900', description: 'Intercompany current account', type: 'ASSET' },
      { code: '4000', description: 'Sales', type: 'INCOME' },
      { code: '5000', description: 'Rent', type: 'EXPENSE' },
    ];
    for (const a of chart) {
      ds[a.code] = (await api('post', '/companies/MFI-DS/accounts').send(a).expect(201)).body.id;
      mds[a.code] = (await api('post', '/companies/MFI-MDS/accounts').send(a).expect(201)).body.id;
    }
    await api('post', '/companies/MFI-DS/accounts', 'viewer').send({ code: '9', description: 'x', type: 'ASSET' }).expect(403);
    await api('post', '/companies/MFI-DS/accounts').send(chart[1]).expect(409);

    await api('post', '/companies/MFI-DS/intercompany-links').send({ partnerCode: 'MFI-MDS', accountId: ds['1900'] }).expect(403);
    await api('post', '/companies/MFI-DS/intercompany-links', 'manager').send({ partnerCode: 'MFI-MDS', accountId: ds['1900'] }).expect(201);
    await api('post', '/companies/MFI-MDS/intercompany-links', 'manager').send({ partnerCode: 'MFI-DS', accountId: mds['1900'] }).expect(201);
  });

  it('posts nothing until a voucher is approved, and never by its author', async () => {
    const draft = await api('post', '/companies/MFI-DS/vouchers').send(journal('50000', { reference: 'RENT-03' })).expect(201);
    expect(draft.body).toMatchObject({ voucherNo: 'JV000001', status: 'DRAFT' });
    const no = draft.body.voucherNo;

    const submitted = await api('post', `/companies/MFI-DS/vouchers/${no}/submit`).send({}).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', currentStage: 1 });
    expect(submitted.body.rule.stages.map((s: { approverRole: string }) => s.approverRole)).toEqual(['FINANCE_MANAGER']);
    expect(await prisma.ledgerEntry.count()).toBe(0);

    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'viewer').send({}).expect(403);
    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'accountant').send({}).expect(403);
    const pending = await api('get', '/approvals/pending', 'manager').expect(200);
    expect(pending.body.map((v: { voucherNo: string }) => v.voucherNo)).toContain(no);

    const posted = await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'manager').send({ comment: 'Matches lease' }).expect(200);
    expect(posted.body).toMatchObject({ status: 'POSTED', postedBatch: { auditNo: 'GL000001' } });
    expect(posted.body.actions.map((a: { action: string }) => a.action)).toEqual(['SUBMITTED', 'APPROVED', 'POSTED']);
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  it('routes a large voucher through the director as a second stage', async () => {
    const draft = await api('post', '/companies/MFI-DS/vouchers').send(journal('2000000')).expect(201);
    const no = draft.body.voucherNo;
    await api('post', `/companies/MFI-DS/vouchers/${no}/submit`).send({}).expect(200);
    const stage2 = await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    expect(stage2.body).toMatchObject({ status: 'SUBMITTED', currentStage: 2 });
    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'manager').send({}).expect(403);
    const done = await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'director').send({}).expect(200);
    expect(done.body.status).toBe('POSTED');
  });

  it('needs two different directors from KES 5,000,000', async () => {
    const draft = await api('post', '/companies/MFI-DS/vouchers').send(journal('5000000')).expect(201);
    const no = draft.body.voucherNo;
    const submitted = await api('post', `/companies/MFI-DS/vouchers/${no}/submit`).send({}).expect(200);
    expect(submitted.body.rule.stages.map((s: { approverRole: string }) => s.approverRole)).toEqual(['FINANCE_MANAGER', 'DIRECTOR', 'DIRECTOR']);
    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'director').send({}).expect(200);
    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'director').send({}).expect(403);
    const done = await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'director2').send({}).expect(200);
    expect(done.body.status).toBe('POSTED');
  });

  it('sends a rejected voucher back to its author, who fixes and resubmits it', async () => {
    const draft = await api('post', '/companies/MFI-DS/vouchers').send(journal('300')).expect(201);
    const no = draft.body.voucherNo;
    await api('post', `/companies/MFI-DS/vouchers/${no}/submit`).send({}).expect(200);
    await api('post', `/companies/MFI-DS/vouchers/${no}/reject`, 'manager').send({}).expect(400);
    const rejected = await api('post', `/companies/MFI-DS/vouchers/${no}/reject`, 'manager').send({ comment: 'Wrong amount, should be 350' }).expect(200);
    expect(rejected.body.status).toBe('REJECTED');

    await api('put', `/companies/MFI-DS/vouchers/${no}`, 'manager').send(journal('350')).expect(403);
    await api('put', `/companies/MFI-DS/vouchers/${no}`).send(journal('350')).expect(200);
    await api('post', `/companies/MFI-DS/vouchers/${no}/submit`).send({}).expect(200);
    const posted = await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    expect(posted.body.status).toBe('POSTED');
    expect(Number(posted.body.lines[0].debit)).toBe(350);
  });

  it.each([
    ['unbalanced', { lines: [{ debit: '10', acc: '5000' }, { credit: '9', acc: '1100' }] }, 'does not balance'],
    ['a header account', { lines: [{ debit: '10', acc: '1000' }, { credit: '10', acc: '1100' }] }, 'header account'],
    ['a date with no period', { txDate: '2031-01-01' }, 'No fiscal period'],
  ])('will not submit a voucher with %s', async (_, variant, message) => {
    const base = { txDate: '2026-03-21', description: 'Bad', lines: [{ debit: '10', acc: '5000' }, { credit: '10', acc: '1100' }] };
    const body = { ...base, ...variant };
    const draft = await api('post', '/companies/MFI-DS/vouchers')
      .send({ ...body, lines: body.lines.map(({ acc, ...l }) => ({ ...l, accountId: ds[acc] })) })
      .expect(201);
    const res = await api('post', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(400);
    expect(res.body.message.toLowerCase()).toContain(message.toLowerCase());
    expect((await api('get', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}`).expect(200)).body.status).toBe('DRAFT');
  });

  it('refuses to submit into a closed period', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'MFI-DS' } });
    await prisma.fiscalPeriod.updateMany({ where: { companyId: company.id, year: 2026, number: 1 }, data: { isClosed: true } });
    const draft = await api('post', '/companies/MFI-DS/vouchers').send(journal('1', { txDate: '2026-01-10' })).expect(201);
    const res = await api('post', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(400);
    expect(res.body.message).toContain('closed');
  });

  it('converts a USD line to KES at the voucher rate', async () => {
    const posted = await postVoucher({
      txDate: '2026-03-20',
      description: 'USD sale',
      lines: [
        { accountId: ds['1110'], currencyCode: 'USD', exchangeRate: '129.5', foreignAmount: '1000' },
        { accountId: ds['4000'], credit: '129500' },
      ],
    });
    expect(posted.status).toBe('POSTED');
    const batch = await prisma.postingBatch.findFirstOrThrow({ where: { auditNo: posted.postedBatch.auditNo }, include: { entries: true } });
    const usd = batch.entries.find((e) => e.currencyCode === 'USD')!;
    expect(usd.debit.toNumber()).toBe(129500);
    expect(usd.foreignDebit.toNumber()).toBe(1000);
  });

  it('posts an intercompany charge in both companies, and the current accounts agree', async () => {
    const posted = await postVoucher({
      txDate: '2026-03-25',
      description: 'MDS rent paid by DS',
      lines: [
        { debit: '80000', partnerCompany: 'MFI-MDS', partnerAccountId: mds['5000'] },
        { accountId: ds['1100'], credit: '80000' },
      ],
    });
    expect(posted.postedBatch.intercompanyMirror).toHaveLength(1);

    const dsTb = await api('get', '/companies/MFI-DS/trial-balance?from=2026-03-25&to=2026-03-25').expect(200);
    expect(dsTb.body.rows.find((r: { code: string }) => r.code === '1900').balance).toBe('80000.00');
    expect(dsTb.body.rows.find((r: { code: string }) => r.code === '5000')).toBeUndefined();

    const mdsTb = await api('get', '/companies/MFI-MDS/trial-balance?from=2026-01-01&to=2026-12-31').expect(200);
    expect(mdsTb.body.rows.find((r: { code: string }) => r.code === '5000').balance).toBe('80000.00');
    expect(mdsTb.body.rows.find((r: { code: string }) => r.code === '1900').balance).toBe('-80000.00');

    const rec = await api('get', '/intercompany/reconciliation?to=2026-12-31').expect(200);
    expect(rec.body.rows).toEqual([expect.objectContaining({ company: 'MFI-DS', partner: 'MFI-MDS', difference: '0.00', agrees: true })]);

    await api('post', `/companies/MFI-DS/journals/${posted.postedBatch.auditNo}/reverse`).send({}).expect(409);
  });

  it('turns dropped files into a draft and keeps them in the archive', async () => {
    const res = await api('post', '/companies/MFI-DS/inbox')
      .attach('files', PDF, 'KPLC invoice March.pdf')
      .attach('files', Buffer.from('date,amount\n2026-03-01,4500\n'), 'meter.csv')
      .expect(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', description: 'KPLC invoice March.pdf, meter.csv' });
    expect(res.body.attachments.map((a: { fileName: string }) => a.fileName)).toEqual(['KPLC invoice March.pdf', 'meter.csv']);

    const bad = await api('post', '/companies/MFI-DS/inbox').attach('files', Buffer.from('MZ\x90\x00'), 'invoice.pdf').expect(400);
    expect(bad.body.message).toContain('does not match');

    // Found by file name, and by the voucher it belongs to
    const found = await api('get', '/companies/MFI-DS/archive?q=KPLC').expect(200);
    const invoice = found.body.find((f: { fileName: string }) => f.fileName === 'KPLC invoice March.pdf');
    expect(invoice).toBeDefined();
    const byVoucher = await api('get', `/companies/MFI-DS/archive?q=${res.body.voucherNo}`).expect(200);
    expect(byVoucher.body).toHaveLength(2);
    expect(byVoucher.body.every((f: { voucherNo: string }) => f.voucherNo === res.body.voucherNo)).toBe(true);
    const file = await api('get', `/companies/MFI-DS/archive/${invoice.id}/download`, 'viewer')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(file.body, PDF)).toBe(0);
    await api('get', `/companies/MFI-TS/archive/${invoice.id}/download`).expect(404);

    // Removable while a draft, kept for good once posted
    const no = res.body.voucherNo;
    const csv = res.body.attachments[1].id;
    await api('delete', `/companies/MFI-DS/vouchers/${no}/attachments/${csv}`).expect(200);
    await api('put', `/companies/MFI-DS/vouchers/${no}`).send(journal('4500', { description: 'KPLC electricity' })).expect(200);
    await api('post', `/companies/MFI-DS/vouchers/${no}/submit`).send({}).expect(200);
    await api('post', `/companies/MFI-DS/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    await api('delete', `/companies/MFI-DS/vouchers/${no}/attachments/${invoice.id}`).expect(409);
    await api('post', `/companies/MFI-DS/vouchers/${no}/attachments`).attach('files', PDF, 'receipt.pdf').expect(201);
  });

  it('reverses a posted journal through approval, once', async () => {
    const draft = await api('post', '/companies/MFI-DS/journals/GL000001/reverse').send({ txDate: '2026-03-31' }).expect(201);
    expect(draft.body).toMatchObject({ documentType: 'REVERSAL', status: 'DRAFT' });
    await api('post', '/companies/MFI-DS/journals/GL000001/reverse').send({}).expect(409);
    await api('post', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(200);
    const reviewed = await api('post', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}/approve`, 'manager').send({}).expect(200);
    expect(reviewed.body).toMatchObject({ status: 'SUBMITTED', currentStage: 2 });
    const posted = await api('post', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}/approve`, 'director').send({}).expect(200);
    expect(posted.body.status).toBe('POSTED');
    await api('post', '/companies/MFI-DS/journals/GL000001/reverse').send({}).expect(409);

    const tb = await api('get', '/companies/MFI-DS/trial-balance?from=2026-01-01&to=2026-12-31', 'viewer').expect(200);
    expect(tb.body.totalDebit).toBe(tb.body.totalCredit);
  });

  it('keeps customer and supplier balances on the control accounts, and ages them', async () => {
    const debtors = (await api('post', '/companies/MFI-DS/accounts').send({ code: '42000', description: 'Debtors Control', type: 'ASSET', subledger: 'AR' }).expect(201)).body;
    const creditors = (await api('post', '/companies/MFI-DS/accounts').send({ code: '22000', description: 'Creditors Control', type: 'LIABILITY' }).expect(201)).body;
    await api('patch', `/companies/MFI-DS/accounts/${creditors.id}`).send({ subledger: 'AP' }).expect(403);
    await api('patch', `/companies/MFI-DS/accounts/${creditors.id}`, 'manager').send({ subledger: 'AP' }).expect(200);

    await api('post', '/companies/MFI-DS/parties', 'viewer').send({ kind: 'CUSTOMER', code: 'C001', name: 'Acme Ltd' }).expect(403);
    const acme = (await api('post', '/companies/MFI-DS/parties').send({ kind: 'CUSTOMER', code: 'C001', name: 'Acme Ltd', termsDays: 30, creditLimit: '80000' }).expect(201)).body;
    await api('post', '/companies/MFI-DS/parties').send({ kind: 'CUSTOMER', code: 'C001', name: 'Again' }).expect(409);
    const kplc = (await api('post', '/companies/MFI-DS/parties').send({ kind: 'SUPPLIER', code: 'S001', name: 'Kenya Power', termsDays: 14 }).expect(201)).body;

    const sale = (date: string, amount: string, ref: string) => ({
      txDate: date,
      description: `Invoice ${ref}`,
      reference: ref,
      lines: [
        { accountId: debtors.id, partyId: acme.id, debit: amount },
        { accountId: ds['4000'], credit: amount },
      ],
    });

    // The control account rules are checked when a voucher is submitted
    for (const [lines, message] of [
      [[{ accountId: debtors.id, debit: '10' }, { accountId: ds['4000'], credit: '10' }], 'choose the customer'],
      [[{ accountId: debtors.id, partyId: kplc.id, debit: '10' }, { accountId: ds['4000'], credit: '10' }], 'not a customer'],
      [[{ accountId: ds['1100'], partyId: acme.id, debit: '10' }, { accountId: ds['4000'], credit: '10' }], 'Debtors or Creditors Control'],
    ] as const) {
      const draft = await api('post', '/companies/MFI-DS/vouchers').send({ txDate: '2026-02-10', description: 'Bad', lines }).expect(201);
      const res = await api('post', `/companies/MFI-DS/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(400);
      expect(res.body.message).toContain(message);
    }

    await postVoucher(sale('2026-02-10', '100000', 'INV-1'));
    await postVoucher(sale('2026-04-01', '50000', 'INV-2'));
    await postVoucher({
      txDate: '2026-04-10',
      description: 'Receipt from Acme',
      lines: [
        { accountId: ds['1100'], debit: '60000' },
        { accountId: debtors.id, partyId: acme.id, credit: '60000' },
      ],
    });
    await postVoucher({
      txDate: '2026-03-01',
      description: 'KPLC bill',
      lines: [
        { accountId: ds['5000'], debit: '20000' },
        { accountId: creditors.id, partyId: kplc.id, credit: '20000' },
      ],
    });

    // The receipt clears the oldest invoice first: 40,000 of INV-1 is 49 days overdue, INV-2 is not yet due
    const ar = await api('get', '/companies/MFI-DS/reports/aged?kind=CUSTOMER&asAt=2026-04-30', 'viewer').expect(200);
    expect(ar.body.rows).toEqual([
      expect.objectContaining({ code: 'C001', current: '50000.00', days31to60: '40000.00', balance: '90000.00', overLimit: true }),
    ]);
    expect(ar.body).toMatchObject({ total: '90000.00', controlBalance: '90000.00', difference: '0.00' });

    const ap = await api('get', '/companies/MFI-DS/reports/aged?kind=SUPPLIER&asAt=2026-04-30').expect(200);
    expect(ap.body.rows).toEqual([expect.objectContaining({ code: 'S001', days31to60: '20000.00', balance: '20000.00' })]);
    expect(ap.body.difference).toBe('0.00');

    const st = await api('get', `/companies/MFI-DS/reports/statement?party=${acme.id}&from=2026-04-01&to=2026-04-30`).expect(200);
    expect(st.body).toMatchObject({ opening: '100000.00', closing: '90000.00' });
    expect(st.body.rows.map((r: { balance: string }) => r.balance)).toEqual(['150000.00', '90000.00']);
    expect(st.body.rows[0].dueDate).toBe('2026-05-01');
    expect(st.body.openItems.map((o: { reference: string; open: string }) => [o.reference, o.open])).toEqual([
      ['INV-1', '40000.00'],
      ['INV-2', '50000.00'],
    ]);

    const gl = await api('get', '/companies/MFI-DS/reports/general-ledger?from=2026-04-01&to=2026-04-30&account=42000').expect(200);
    expect(gl.body.accounts).toHaveLength(1);
    expect(gl.body.accounts[0]).toMatchObject({ code: '42000', opening: '100000.00', debit: '50000.00', credit: '60000.00', closing: '90000.00' });
    expect(gl.body.accounts[0].rows[1]).toMatchObject({ party: 'C001 · Acme Ltd', credit: '60000.00', balance: '90000.00' });
    const all = await api('get', '/companies/MFI-DS/reports/general-ledger?from=2026-01-01&to=2026-12-31').expect(200);
    expect(all.body.totalDebit).toBe(all.body.totalCredit);
    expect(all.body.accounts.find((a: { code: string }) => a.code === '1000')).toBeUndefined();

    // Control accounts and posted balances stay consistent
    await api('patch', `/companies/MFI-DS/accounts/${debtors.id}`, 'manager').send({ subledger: null }).expect(409);
    await api('patch', `/companies/MFI-DS/accounts/${ds['1100']}`, 'manager').send({ subledger: 'AR' }).expect(409);
  });

  it('keeps companies apart', async () => {
    const res = await api('get', '/companies/MFI-TS/trial-balance?from=2026-01-01&to=2026-12-31').expect(200);
    expect(res.body.rows).toEqual([]);
    await api('post', '/companies/MFI-TS/vouchers').send(journal('1')).expect(400);
  });

  it('lets an administrator change the approval matrix without disturbing vouchers already on their way', async () => {
    const before = await api('get', '/companies/MFI-DS/approval-matrix', 'viewer').expect(200);
    const journals = before.body.documentTypes.find((d: { documentType: string }) => d.documentType === 'JOURNAL');
    expect(journals.bands).toHaveLength(3);
    expect(journals.problems).toEqual([]);
    expect(journals.warnings).toEqual([]);

    // On its way under the old matrix: 600,000 needs the finance manager, then a director
    const inFlight = await api('post', '/companies/MFI-DS/vouchers').send(journal('600000')).expect(201);
    await api('post', `/companies/MFI-DS/vouchers/${inFlight.body.voucherNo}/submit`).send({}).expect(200);

    const FM = { name: 'Finance manager review', approverRole: 'FINANCE_MANAGER' };
    const DIRECTOR = { name: 'Director approval', approverRole: 'DIRECTOR' };
    const top = journals.bands[2];
    const bands = [
      { name: 'Journals under KES 1,000,000', sopReference: 'SOP-FIN-004', minAmount: '0', maxAmount: '1000000', stages: [FM] },
      { name: 'Journals from KES 1,000,000', sopReference: 'SOP-FIN-004', minAmount: '1000000', maxAmount: '5000000', stages: [FM, DIRECTOR] },
      // Unchanged, so the rule is kept as it is
      { name: top.name, sopReference: top.sopReference, minAmount: top.minAmount, maxAmount: null, stages: top.stages.map(({ name, approverRole }: typeof FM) => ({ name, approverRole })) },
    ];
    const reason = 'Board resolution 14/2026';
    await api('put', '/companies/MFI-DS/approval-matrix/JOURNAL', 'manager').send({ bands, reason }).expect(403);
    await api('put', '/companies/MFI-DS/approval-matrix/JOURNAL', 'admin').send({ bands }).expect(400);
    await api('put', '/companies/MFI-DS/approval-matrix/PAYMENT', 'admin').send({ bands, reason }).expect(400);
    const gap = await api('put', '/companies/MFI-DS/approval-matrix/JOURNAL', 'admin')
      .send({ bands: [{ ...bands[0], maxAmount: '900000' }, ...bands.slice(1)], reason })
      .expect(400);
    expect(gap.body.message).toContain('Amounts from 900000 to 1000000 have no approval route');

    const saved = await api('put', '/companies/MFI-DS/approval-matrix/JOURNAL', 'admin').send({ bands, reason }).expect(200);
    expect(saved.body).toMatchObject({ created: 2, retired: 2, kept: 1 });
    expect(saved.body.matrix.history.map((r: { retiredBy: string }) => r.retiredBy)).toEqual(['Administrator', 'Administrator']);
    const again = await api('put', '/companies/MFI-DS/approval-matrix/JOURNAL', 'admin').send({ bands, reason }).expect(200);
    expect(again.body).toMatchObject({ created: 0, retired: 0, kept: 3 });

    // The voucher already submitted finishes the route it started on
    await api('post', `/companies/MFI-DS/vouchers/${inFlight.body.voucherNo}/approve`, 'manager').send({}).expect(200);
    const done = await api('post', `/companies/MFI-DS/vouchers/${inFlight.body.voucherNo}/approve`, 'director').send({}).expect(200);
    expect(done.body.status).toBe('POSTED');

    // A new one follows the new matrix
    const fresh = await api('post', '/companies/MFI-DS/vouchers').send(journal('600000')).expect(201);
    const submitted = await api('post', `/companies/MFI-DS/vouchers/${fresh.body.voucherNo}/submit`).send({}).expect(200);
    expect(submitted.body.rule).toMatchObject({ name: 'Journals under KES 1,000,000', sopReference: 'SOP-FIN-004' });
    expect(submitted.body.rule.stages).toHaveLength(1);

    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: 'approval.matrix_changed' } });
    expect(JSON.parse(logged.detail!).reason).toBe(reason);
  });

  it('keeps an audit trail of every step', async () => {
    const actions = await prisma.auditLog.groupBy({ by: ['action'], _count: true });
    const seen = actions.map((a) => a.action);
    for (const a of ['voucher.submitted', 'voucher.approved', 'voucher.rejected', 'gl.journal_posted', 'gl.intercompany_posted', 'archive.attached']) {
      expect(seen).toContain(a);
    }
  });
});
