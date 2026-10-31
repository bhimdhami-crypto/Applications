// End-to-end checks against a real SQL Server test database (TEST_DATABASE_URL, a database ending in _test).
process.env.JWT_SECRET ??= 'e2e-secret';
// Emails are built in full but not sent, and the worker only runs when a test calls it
process.env.EMAIL_TRANSPORT = 'json';
process.env.EMAIL_WORKER = 'off';
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
import { MailerService } from '../src/notifications/mailer.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

const PASSWORD = 'Test#Erp2026';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

describe('Mindspace ERP API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const ds: Record<string, number> = {};
  const mds: Record<string, number> = {};

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, who = 'accountant') =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${tokens[who]}`);

  /** Drafts, submits and fully approves a voucher; returns its final state */
  async function postVoucher(body: object, approvers: string[] = ['manager'], company = 'MS-AI') {
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
    await prisma.emailMessage.deleteMany();
    await prisma.bankReconciliation.deleteMany();
    await prisma.bankStatementLine.deleteMany();
    await prisma.bankMatchEntry.deleteMany();
    await prisma.bankMatch.deleteMany();
    await prisma.bankStatement.deleteMany();
    await prisma.bankAccount.deleteMany();
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
    expect(companies.body.map((c: { code: string }) => c.code)).toEqual(['MS-AI', 'MS-TS', 'MS-SI']);

    const chart = [
      { code: '1000', description: 'Assets', type: 'ASSET', isPostable: false },
      { code: '1100', description: 'Bank KES', type: 'ASSET', parentCode: '1000' },
      { code: '1110', description: 'Bank USD', type: 'ASSET', parentCode: '1000' },
      { code: '1900', description: 'Intercompany current account', type: 'ASSET' },
      { code: '4000', description: 'Sales', type: 'INCOME' },
      { code: '5000', description: 'Rent', type: 'EXPENSE' },
    ];
    for (const a of chart) {
      ds[a.code] = (await api('post', '/companies/MS-AI/accounts').send(a).expect(201)).body.id;
      mds[a.code] = (await api('post', '/companies/MS-TS/accounts').send(a).expect(201)).body.id;
    }
    await api('post', '/companies/MS-AI/accounts', 'viewer').send({ code: '9', description: 'x', type: 'ASSET' }).expect(403);
    await api('post', '/companies/MS-AI/accounts').send(chart[1]).expect(409);

    await api('post', '/companies/MS-AI/intercompany-links').send({ partnerCode: 'MS-TS', accountId: ds['1900'] }).expect(403);
    await api('post', '/companies/MS-AI/intercompany-links', 'manager').send({ partnerCode: 'MS-TS', accountId: ds['1900'] }).expect(201);
    await api('post', '/companies/MS-TS/intercompany-links', 'manager').send({ partnerCode: 'MS-AI', accountId: mds['1900'] }).expect(201);
  });

  it('posts nothing until a voucher is approved, and never by its author', async () => {
    const draft = await api('post', '/companies/MS-AI/vouchers').send(journal('50000', { reference: 'RENT-03' })).expect(201);
    expect(draft.body).toMatchObject({ voucherNo: 'JV000001', status: 'DRAFT' });
    const no = draft.body.voucherNo;

    const submitted = await api('post', `/companies/MS-AI/vouchers/${no}/submit`).send({}).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', currentStage: 1 });
    expect(submitted.body.rule.stages.map((s: { approverRole: string }) => s.approverRole)).toEqual(['FINANCE_MANAGER']);
    expect(await prisma.ledgerEntry.count()).toBe(0);

    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'viewer').send({}).expect(403);
    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'accountant').send({}).expect(403);
    const pending = await api('get', '/approvals/pending', 'manager').expect(200);
    expect(pending.body.map((v: { voucherNo: string }) => v.voucherNo)).toContain(no);

    const posted = await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'manager').send({ comment: 'Matches lease' }).expect(200);
    expect(posted.body).toMatchObject({ status: 'POSTED', postedBatch: { auditNo: 'GL000001' } });
    expect(posted.body.actions.map((a: { action: string }) => a.action)).toEqual(['SUBMITTED', 'APPROVED', 'POSTED']);
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  it('routes a large voucher through the director as a second stage', async () => {
    const draft = await api('post', '/companies/MS-AI/vouchers').send(journal('2000000')).expect(201);
    const no = draft.body.voucherNo;
    await api('post', `/companies/MS-AI/vouchers/${no}/submit`).send({}).expect(200);
    const stage2 = await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    expect(stage2.body).toMatchObject({ status: 'SUBMITTED', currentStage: 2 });
    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'manager').send({}).expect(403);
    const done = await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'director').send({}).expect(200);
    expect(done.body.status).toBe('POSTED');
  });

  it('needs two different directors from KES 5,000,000', async () => {
    const draft = await api('post', '/companies/MS-AI/vouchers').send(journal('5000000')).expect(201);
    const no = draft.body.voucherNo;
    const submitted = await api('post', `/companies/MS-AI/vouchers/${no}/submit`).send({}).expect(200);
    expect(submitted.body.rule.stages.map((s: { approverRole: string }) => s.approverRole)).toEqual(['FINANCE_MANAGER', 'DIRECTOR', 'DIRECTOR']);
    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'director').send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'director').send({}).expect(403);
    const done = await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'director2').send({}).expect(200);
    expect(done.body.status).toBe('POSTED');
  });

  it('sends a rejected voucher back to its author, who fixes and resubmits it', async () => {
    const draft = await api('post', '/companies/MS-AI/vouchers').send(journal('300')).expect(201);
    const no = draft.body.voucherNo;
    await api('post', `/companies/MS-AI/vouchers/${no}/submit`).send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${no}/reject`, 'manager').send({}).expect(400);
    const rejected = await api('post', `/companies/MS-AI/vouchers/${no}/reject`, 'manager').send({ comment: 'Wrong amount, should be 350' }).expect(200);
    expect(rejected.body.status).toBe('REJECTED');

    await api('put', `/companies/MS-AI/vouchers/${no}`, 'manager').send(journal('350')).expect(403);
    await api('put', `/companies/MS-AI/vouchers/${no}`).send(journal('350')).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${no}/submit`).send({}).expect(200);
    const posted = await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'manager').send({}).expect(200);
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
    const draft = await api('post', '/companies/MS-AI/vouchers')
      .send({ ...body, lines: body.lines.map(({ acc, ...l }) => ({ ...l, accountId: ds[acc] })) })
      .expect(201);
    const res = await api('post', `/companies/MS-AI/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(400);
    expect(res.body.message.toLowerCase()).toContain(message.toLowerCase());
    expect((await api('get', `/companies/MS-AI/vouchers/${draft.body.voucherNo}`).expect(200)).body.status).toBe('DRAFT');
  });

  it('refuses to submit into a closed period', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'MS-AI' } });
    await prisma.fiscalPeriod.updateMany({ where: { companyId: company.id, year: 2026, number: 1 }, data: { isClosed: true } });
    const draft = await api('post', '/companies/MS-AI/vouchers').send(journal('1', { txDate: '2026-01-10' })).expect(201);
    const res = await api('post', `/companies/MS-AI/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(400);
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
        { debit: '80000', partnerCompany: 'MS-TS', partnerAccountId: mds['5000'] },
        { accountId: ds['1100'], credit: '80000' },
      ],
    });
    expect(posted.postedBatch.intercompanyMirror).toHaveLength(1);

    const dsTb = await api('get', '/companies/MS-AI/trial-balance?from=2026-03-25&to=2026-03-25').expect(200);
    expect(dsTb.body.rows.find((r: { code: string }) => r.code === '1900').balance).toBe('80000.00');
    expect(dsTb.body.rows.find((r: { code: string }) => r.code === '5000')).toBeUndefined();

    const mdsTb = await api('get', '/companies/MS-TS/trial-balance?from=2026-01-01&to=2026-12-31').expect(200);
    expect(mdsTb.body.rows.find((r: { code: string }) => r.code === '5000').balance).toBe('80000.00');
    expect(mdsTb.body.rows.find((r: { code: string }) => r.code === '1900').balance).toBe('-80000.00');

    const rec = await api('get', '/intercompany/reconciliation?to=2026-12-31').expect(200);
    expect(rec.body.rows).toEqual([expect.objectContaining({ company: 'MS-AI', partner: 'MS-TS', difference: '0.00', agrees: true })]);

    await api('post', `/companies/MS-AI/journals/${posted.postedBatch.auditNo}/reverse`).send({}).expect(409);
  });

  it('turns dropped files into a draft and keeps them in the archive', async () => {
    const res = await api('post', '/companies/MS-AI/inbox')
      .attach('files', PDF, 'KPLC invoice March.pdf')
      .attach('files', Buffer.from('date,amount\n2026-03-01,4500\n'), 'meter.csv')
      .expect(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', description: 'KPLC invoice March.pdf, meter.csv' });
    expect(res.body.attachments.map((a: { fileName: string }) => a.fileName)).toEqual(['KPLC invoice March.pdf', 'meter.csv']);

    const bad = await api('post', '/companies/MS-AI/inbox').attach('files', Buffer.from('MZ\x90\x00'), 'invoice.pdf').expect(400);
    expect(bad.body.message).toContain('does not match');

    // Found by file name, and by the voucher it belongs to
    const found = await api('get', '/companies/MS-AI/archive?q=KPLC').expect(200);
    const invoice = found.body.find((f: { fileName: string }) => f.fileName === 'KPLC invoice March.pdf');
    expect(invoice).toBeDefined();
    const byVoucher = await api('get', `/companies/MS-AI/archive?q=${res.body.voucherNo}`).expect(200);
    expect(byVoucher.body).toHaveLength(2);
    expect(byVoucher.body.every((f: { voucherNo: string }) => f.voucherNo === res.body.voucherNo)).toBe(true);
    const file = await api('get', `/companies/MS-AI/archive/${invoice.id}/download`, 'viewer')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(file.body, PDF)).toBe(0);
    await api('get', `/companies/MS-SI/archive/${invoice.id}/download`).expect(404);

    // Removable while a draft, kept for good once posted
    const no = res.body.voucherNo;
    const csv = res.body.attachments[1].id;
    await api('delete', `/companies/MS-AI/vouchers/${no}/attachments/${csv}`).expect(200);
    await api('put', `/companies/MS-AI/vouchers/${no}`).send(journal('4500', { description: 'KPLC electricity' })).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${no}/submit`).send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${no}/approve`, 'manager').send({}).expect(200);
    await api('delete', `/companies/MS-AI/vouchers/${no}/attachments/${invoice.id}`).expect(409);
    await api('post', `/companies/MS-AI/vouchers/${no}/attachments`).attach('files', PDF, 'receipt.pdf').expect(201);
  });

  it('reverses a posted journal through approval, once', async () => {
    const draft = await api('post', '/companies/MS-AI/journals/GL000001/reverse').send({ txDate: '2026-03-31' }).expect(201);
    expect(draft.body).toMatchObject({ documentType: 'REVERSAL', status: 'DRAFT' });
    await api('post', '/companies/MS-AI/journals/GL000001/reverse').send({}).expect(409);
    await api('post', `/companies/MS-AI/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(200);
    const reviewed = await api('post', `/companies/MS-AI/vouchers/${draft.body.voucherNo}/approve`, 'manager').send({}).expect(200);
    expect(reviewed.body).toMatchObject({ status: 'SUBMITTED', currentStage: 2 });
    const posted = await api('post', `/companies/MS-AI/vouchers/${draft.body.voucherNo}/approve`, 'director').send({}).expect(200);
    expect(posted.body.status).toBe('POSTED');
    await api('post', '/companies/MS-AI/journals/GL000001/reverse').send({}).expect(409);

    const tb = await api('get', '/companies/MS-AI/trial-balance?from=2026-01-01&to=2026-12-31', 'viewer').expect(200);
    expect(tb.body.totalDebit).toBe(tb.body.totalCredit);
  });

  it('keeps customer and supplier balances on the control accounts, and ages them', async () => {
    const debtors = (await api('post', '/companies/MS-AI/accounts').send({ code: '42000', description: 'Debtors Control', type: 'ASSET', subledger: 'AR' }).expect(201)).body;
    const creditors = (await api('post', '/companies/MS-AI/accounts').send({ code: '22000', description: 'Creditors Control', type: 'LIABILITY' }).expect(201)).body;
    await api('patch', `/companies/MS-AI/accounts/${creditors.id}`).send({ subledger: 'AP' }).expect(403);
    await api('patch', `/companies/MS-AI/accounts/${creditors.id}`, 'manager').send({ subledger: 'AP' }).expect(200);

    await api('post', '/companies/MS-AI/parties', 'viewer').send({ kind: 'CUSTOMER', code: 'C001', name: 'Acme Ltd' }).expect(403);
    const acme = (await api('post', '/companies/MS-AI/parties').send({ kind: 'CUSTOMER', code: 'C001', name: 'Acme Ltd', termsDays: 30, creditLimit: '80000' }).expect(201)).body;
    await api('post', '/companies/MS-AI/parties').send({ kind: 'CUSTOMER', code: 'C001', name: 'Again' }).expect(409);
    const kplc = (await api('post', '/companies/MS-AI/parties').send({ kind: 'SUPPLIER', code: 'S001', name: 'Kenya Power', termsDays: 14 }).expect(201)).body;

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
      const draft = await api('post', '/companies/MS-AI/vouchers').send({ txDate: '2026-02-10', description: 'Bad', lines }).expect(201);
      const res = await api('post', `/companies/MS-AI/vouchers/${draft.body.voucherNo}/submit`).send({}).expect(400);
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
    const ar = await api('get', '/companies/MS-AI/reports/aged?kind=CUSTOMER&asAt=2026-04-30', 'viewer').expect(200);
    expect(ar.body.rows).toEqual([
      expect.objectContaining({ code: 'C001', current: '50000.00', days31to60: '40000.00', balance: '90000.00', overLimit: true }),
    ]);
    expect(ar.body).toMatchObject({ total: '90000.00', controlBalance: '90000.00', difference: '0.00' });

    const ap = await api('get', '/companies/MS-AI/reports/aged?kind=SUPPLIER&asAt=2026-04-30').expect(200);
    expect(ap.body.rows).toEqual([expect.objectContaining({ code: 'S001', days31to60: '20000.00', balance: '20000.00' })]);
    expect(ap.body.difference).toBe('0.00');

    const st = await api('get', `/companies/MS-AI/reports/statement?party=${acme.id}&from=2026-04-01&to=2026-04-30`).expect(200);
    expect(st.body).toMatchObject({ opening: '100000.00', closing: '90000.00' });
    expect(st.body.rows.map((r: { balance: string }) => r.balance)).toEqual(['150000.00', '90000.00']);
    expect(st.body.rows[0].dueDate).toBe('2026-05-01');
    expect(st.body.openItems.map((o: { reference: string; open: string }) => [o.reference, o.open])).toEqual([
      ['INV-1', '40000.00'],
      ['INV-2', '50000.00'],
    ]);

    const gl = await api('get', '/companies/MS-AI/reports/general-ledger?from=2026-04-01&to=2026-04-30&account=42000').expect(200);
    expect(gl.body.accounts).toHaveLength(1);
    expect(gl.body.accounts[0]).toMatchObject({ code: '42000', opening: '100000.00', debit: '50000.00', credit: '60000.00', closing: '90000.00' });
    expect(gl.body.accounts[0].rows[1]).toMatchObject({ party: 'C001 · Acme Ltd', credit: '60000.00', balance: '90000.00' });
    const all = await api('get', '/companies/MS-AI/reports/general-ledger?from=2026-01-01&to=2026-12-31').expect(200);
    expect(all.body.totalDebit).toBe(all.body.totalCredit);
    expect(all.body.accounts.find((a: { code: string }) => a.code === '1000')).toBeUndefined();

    // Control accounts and posted balances stay consistent
    await api('patch', `/companies/MS-AI/accounts/${debtors.id}`, 'manager').send({ subledger: null }).expect(409);
    await api('patch', `/companies/MS-AI/accounts/${ds['1100']}`, 'manager').send({ subledger: 'AR' }).expect(409);
  });

  it('keeps companies apart', async () => {
    const res = await api('get', '/companies/MS-SI/trial-balance?from=2026-01-01&to=2026-12-31').expect(200);
    expect(res.body.rows).toEqual([]);
    await api('post', '/companies/MS-SI/vouchers').send(journal('1')).expect(400);
  });

  it('lets an administrator change the approval matrix without disturbing vouchers already on their way', async () => {
    const before = await api('get', '/companies/MS-AI/approval-matrix', 'viewer').expect(200);
    const journals = before.body.documentTypes.find((d: { documentType: string }) => d.documentType === 'JOURNAL');
    expect(journals.bands).toHaveLength(3);
    expect(journals.problems).toEqual([]);
    expect(journals.warnings).toEqual([]);

    // On its way under the old matrix: 600,000 needs the finance manager, then a director
    const inFlight = await api('post', '/companies/MS-AI/vouchers').send(journal('600000')).expect(201);
    await api('post', `/companies/MS-AI/vouchers/${inFlight.body.voucherNo}/submit`).send({}).expect(200);

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
    await api('put', '/companies/MS-AI/approval-matrix/JOURNAL', 'manager').send({ bands, reason }).expect(403);
    await api('put', '/companies/MS-AI/approval-matrix/JOURNAL', 'admin').send({ bands }).expect(400);
    await api('put', '/companies/MS-AI/approval-matrix/PAYMENT', 'admin').send({ bands, reason }).expect(400);
    const gap = await api('put', '/companies/MS-AI/approval-matrix/JOURNAL', 'admin')
      .send({ bands: [{ ...bands[0], maxAmount: '900000' }, ...bands.slice(1)], reason })
      .expect(400);
    expect(gap.body.message).toContain('Amounts from 900000 to 1000000 have no approval route');

    const saved = await api('put', '/companies/MS-AI/approval-matrix/JOURNAL', 'admin').send({ bands, reason }).expect(200);
    expect(saved.body).toMatchObject({ created: 2, retired: 2, kept: 1 });
    expect(saved.body.matrix.history.map((r: { retiredBy: string }) => r.retiredBy)).toEqual(['Administrator', 'Administrator']);
    const again = await api('put', '/companies/MS-AI/approval-matrix/JOURNAL', 'admin').send({ bands, reason }).expect(200);
    expect(again.body).toMatchObject({ created: 0, retired: 0, kept: 3 });

    // The voucher already submitted finishes the route it started on
    await api('post', `/companies/MS-AI/vouchers/${inFlight.body.voucherNo}/approve`, 'manager').send({}).expect(200);
    const done = await api('post', `/companies/MS-AI/vouchers/${inFlight.body.voucherNo}/approve`, 'director').send({}).expect(200);
    expect(done.body.status).toBe('POSTED');

    // A new one follows the new matrix
    const fresh = await api('post', '/companies/MS-AI/vouchers').send(journal('600000')).expect(201);
    const submitted = await api('post', `/companies/MS-AI/vouchers/${fresh.body.voucherNo}/submit`).send({}).expect(200);
    expect(submitted.body.rule).toMatchObject({ name: 'Journals under KES 1,000,000', sopReference: 'SOP-FIN-004' });
    expect(submitted.body.rule.stages).toHaveLength(1);

    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: 'approval.matrix_changed' } });
    expect(JSON.parse(logged.detail!).reason).toBe(reason);
  });

  it('shows what changed, who changed it and when, field by field', async () => {
    // A draft edited before submission: the history keeps the old lines as well as the new
    const draft = (await api('post', '/companies/MS-AI/vouchers').send(journal('100')).expect(201)).body;
    await api('put', `/companies/MS-AI/vouchers/${draft.voucherNo}`)
      .send({
        txDate: '2026-03-16',
        description: 'Rent for March',
        lines: [
          { accountId: ds['5000'], debit: '120' },
          { accountId: ds['1100'], credit: '120' },
        ],
      })
      .expect(200);
    // Saving with nothing changed adds nothing to the history
    await api('put', `/companies/MS-AI/vouchers/${draft.voucherNo}`)
      .send({ txDate: '2026-03-16', description: 'Rent for March', lines: [{ accountId: ds['5000'], debit: '120.00' }, { accountId: ds['1100'], credit: '120' }] })
      .expect(200);
    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/submit`).send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/approve`, 'manager').send({ comment: 'ok' }).expect(200);

    const trail = (await api('get', `/companies/MS-AI/history/Voucher/${draft.id}`, 'viewer').expect(200)).body;
    expect(trail.map((e: { action: string }) => e.action)).toEqual(['voucher.created', 'voucher.updated', 'voucher.submitted', 'voucher.approved']);
    expect(trail[1]).toMatchObject({
      user: 'accountant',
      label: draft.voucherNo,
      detail: {
        changes: [
          { field: 'Date', from: '2026-03-15', to: '2026-03-16' },
          { field: 'Description', from: 'Rent', to: 'Rent for March' },
        ],
        removedLines: ['5000 · Dr 100.00', '1100 · Cr 100.00'],
        addedLines: ['5000 · Dr 120.00', '1100 · Cr 120.00'],
      },
    });
    expect(trail[3]).toMatchObject({ user: 'manager', detail: { stage: 1, comment: 'ok' } });

    // A customer's terms and limit, before and after
    const acme = (await api('get', '/companies/MS-AI/parties?kind=CUSTOMER').expect(200)).body.find((p: { code: string }) => p.code === 'C001');
    await api('patch', `/companies/MS-AI/parties/${acme.id}`, 'manager').send({ termsDays: 45, creditLimit: '80000.00', name: acme.name }).expect(200);
    const partyTrail = (await api('get', `/companies/MS-AI/history/Party/${acme.id}`).expect(200)).body;
    expect(partyTrail.at(-1)).toMatchObject({
      action: 'party.updated',
      label: 'Customer C001 Acme Ltd',
      detail: { changes: [{ field: 'Terms (days)', from: '30', to: '45' }] },
    });

    // The company-wide trail is for managers, directors and administrators
    await api('get', '/companies/MS-AI/history').expect(403);
    const all = (await api('get', '/companies/MS-AI/history?limit=3', 'manager').expect(200)).body;
    expect(all.items).toHaveLength(3);
    expect(all.items[0].action).toBe('party.updated');
    const older = (await api('get', `/companies/MS-AI/history?limit=3&before=${all.next}`, 'manager').expect(200)).body;
    expect(BigInt(older.items[0].id)).toBeLessThan(BigInt(all.items[2].id));

    const found = (await api('get', `/companies/MS-AI/history?q=${draft.voucherNo}`, 'director').expect(200)).body;
    expect(found.items).toHaveLength(4);
    const manager = await prisma.user.findFirstOrThrow({ where: { name: 'manager' } });
    const byManager = (await api('get', `/companies/MS-AI/history?entity=Party&userId=${manager.id}`, 'manager').expect(200)).body;
    expect(byManager.items.length).toBeGreaterThan(0);
    expect(byManager.items.every((e: { user: string; entity: string }) => e.user === 'manager' && e.entity === 'Party')).toBe(true);
    // Another company's trail holds none of this
    const mdsTrail = (await api('get', `/companies/MS-TS/history?q=${draft.voucherNo}`, 'manager').expect(200)).body;
    expect(mdsTrail.items).toHaveLength(0);

    // Sign-ins, including failed ones, are for administrators only
    await api('get', '/sign-ins', 'manager').expect(403);
    const signIns = (await api('get', '/sign-ins', 'admin').expect(200)).body;
    expect(signIns.items.map((e: { action: string }) => e.action)).toContain('auth.login_failed');
  });

  it('emails approvers when a voucher waits for them, and the author when it is rejected or posted', async () => {
    await prisma.emailMessage.deleteMany();
    const outbox = () => prisma.emailMessage.findMany({ orderBy: { id: 'asc' } });
    const draft = (await api('post', '/companies/MS-AI/vouchers').send(journal('250', { description: 'Courier' })).expect(201)).body;
    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/submit`).send({}).expect(200);
    let mails = await outbox();
    // Only the finance manager: administrators stand in only when nobody holds the role
    expect(mails.map((m) => [m.kind, m.toEmail])).toEqual([['APPROVAL_NEEDED', 'manager@mfi-erp.test']]);
    expect(mails[0].subject).toBe(`Approval needed: MS-AI ${draft.voucherNo}, KES 250.00, Courier`);
    expect(mails[0].text).toContain(`/vouchers/${draft.voucherNo}`);

    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/reject`, 'manager').send({ comment: 'Attach the waybill' }).expect(200);
    mails = await outbox();
    expect(mails[1]).toMatchObject({ kind: 'REJECTED', toEmail: 'accountant@mfi-erp.test' });
    expect(mails[1].text).toContain('Reason: Attach the waybill');

    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/submit`).send({}).expect(200);
    const posted = (await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/approve`, 'manager').send({}).expect(200)).body;
    mails = await outbox();
    expect(mails.slice(2).map((m) => [m.kind, m.toEmail])).toEqual([
      ['APPROVAL_NEEDED', 'manager@mfi-erp.test'],
      ['POSTED', 'accountant@mfi-erp.test'],
    ]);
    expect(mails[3].subject).toBe(`Posted: MS-AI ${draft.voucherNo} as ${posted.postedBatch.auditNo}`);

    // A two-stage voucher goes to the directors once the manager has approved
    const big = (await api('post', '/companies/MS-AI/vouchers').send(journal('2000000')).expect(201)).body;
    await api('post', `/companies/MS-AI/vouchers/${big.voucherNo}/submit`).send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${big.voucherNo}/approve`, 'manager').send({}).expect(200);
    const stage2 = await prisma.emailMessage.findMany({ where: { voucherId: big.id, kind: 'APPROVAL_NEEDED' }, orderBy: { id: 'asc' } });
    expect(stage2.map((m) => m.toEmail)).toEqual(['manager@mfi-erp.test', 'director@mfi-erp.test', 'director2@mfi-erp.test']);

    // Anyone can turn their alerts off
    expect((await api('get', '/me/email-alerts').expect(200)).body).toEqual({ emailAlerts: true, configured: true });
    await api('put', '/me/email-alerts').send({ emailAlerts: false }).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${big.voucherNo}/approve`, 'director').send({}).expect(200);
    expect(await prisma.emailMessage.count({ where: { voucherId: big.id, kind: 'POSTED' } })).toBe(0);
    await api('put', '/me/email-alerts').send({ emailAlerts: true }).expect(200);

    // The worker sends what is queued; administrators see the outbox
    const mailer = app.get(MailerService);
    expect(await mailer.flush()).toBeGreaterThanOrEqual(6);
    expect(await prisma.emailMessage.count({ where: { status: 'PENDING' } })).toBe(0);
    await api('get', '/email/outbox').expect(403);
    const box = (await api('get', '/email/outbox?status=SENT', 'admin').expect(200)).body;
    expect(box.counts.SENT).toBeGreaterThanOrEqual(6);
    expect((await api('post', '/email/test', 'admin').expect(200)).body).toMatchObject({ status: 'SENT', toEmail: 'admin@mfi-erp.test' });

    // Weekday mornings, one reminder per person of what has waited a day or more
    const waiting = (await api('post', '/companies/MS-AI/vouchers').send(journal('75', { description: 'Stationery' })).expect(201)).body;
    await api('post', `/companies/MS-AI/vouchers/${waiting.voucherNo}/submit`).send({}).expect(200);
    const morning = new Date(Date.now() + 2 * 86_400_000);
    while ([0, 6].includes(new Date(morning.getTime() + 3 * 3_600_000).getUTCDay())) morning.setTime(morning.getTime() + 86_400_000);
    morning.setUTCHours(6, 0, 0, 0); // 09:00 in Nairobi
    expect(await mailer.queueDigests(new Date(morning.getTime() - 4 * 3_600_000))).toBe(0); // 05:00, too early
    expect(await mailer.queueDigests(morning)).toBeGreaterThanOrEqual(1);
    expect(await mailer.queueDigests(morning)).toBe(0);
    const reminder = await prisma.emailMessage.findFirstOrThrow({ where: { kind: 'DIGEST', toEmail: 'manager@mfi-erp.test' } });
    expect(reminder.text).toContain(`${waiting.voucherNo} · KES 75.00 · Stationery · Finance manager review · 2 days`);
  });

  it('imports a bank statement, matches it to the ledger and signs off the reconciliation', async () => {
    const bank = (await api('post', '/companies/MS-AI/accounts').send({ code: '1120', description: 'SCB Harambee KES', type: 'ASSET' }).expect(201)).body;
    const setup = { glAccountId: bank.id, name: 'SCB Harambee KES', bankName: 'Standard Chartered', accountNumber: '0102030405060', reconcileFrom: '2026-03-01' };
    await api('post', '/companies/MS-AI/bank-accounts').send(setup).expect(403);
    const account = (await api('post', '/companies/MS-AI/bank-accounts', 'manager').send(setup).expect(201)).body;
    const B = `/companies/MS-AI/bank-accounts/${account.id}`;

    const pay = (txDate: string, description: string, amount: string, into: boolean, reference?: string) =>
      postVoucher({
        txDate,
        description,
        reference,
        lines: into
          ? [
              { accountId: bank.id, debit: amount },
              { accountId: ds['4000'], credit: amount },
            ]
          : [
              { accountId: ds['5000'], debit: amount },
              { accountId: bank.id, credit: amount },
            ],
      });
    await pay('2026-03-02', 'Capital deposit', '50000', true);
    await pay('2026-03-20', 'KPLC March', '4821', false, '000123');
    await pay('2026-03-28', 'Receipt Nairobi Hospital INV 0091', '25000', true);
    await pay('2026-03-30', 'Petty cash top-up', '1000', false, '000124');

    // The bank's export, newest first, with the account details above the headings
    const csv = [
      'Standard Chartered Bank Kenya',
      'Account,0102030405060',
      'Transaction Date,Value Date,Description,Cheque No,Debit,Credit,Balance',
      '31/03/2026,31/03/2026,"SERVICE CHARGE, MAR",,450.00,,"69,729.00"',
      '29/03/2026,29/03/2026,RTGS NAIROBI HOSPITAL INV 0091,,,"25,000.00","70,179.00"',
      '27/03/2026,27/03/2026,CHQ 000123 KENYA POWER,000123,"4,821.00",,"45,179.00"',
      '02/03/2026,02/03/2026,CASH DEPOSIT,,,"50,000.00","50,000.00"',
    ].join('\r\n');
    const upload = (path: string, body: string, name = 'march.csv', who = 'accountant') => api('post', `${B}${path}`, who).attach('file', Buffer.from(body), name);

    const preview = (await upload('/statements/preview', csv).expect(200)).body;
    expect(preview).toMatchObject({ problems: [], lineCount: 4, newLines: 4, skipped: 0, layout: { headerRow: 2, moneyOut: 'Debit', moneyIn: 'Credit' } });
    expect(preview.lines[0]).toMatchObject({ txDate: '2026-03-02', amount: '50000.0000' });
    await upload('/statements/preview', 'x', 'march.pdf').expect(400);
    // A file whose printed currency or account number is another account's is refused
    const usd = csv.replace('Account,0102030405060', 'Account Currency:,USD');
    expect((await upload('/statements/preview', usd).expect(200)).body.problems[0]).toBe('This statement is in USD but SCB Harambee KES is a KES account');
    await upload('/statements', usd).expect(400);
    const other = csv.replace('Account,0102030405060', 'Account No:,0100003275358 - SBICKENX');
    expect((await upload('/statements', other).expect(400)).body.message).toBe('This statement is for account 0100003275358 but SCB Harambee KES is account 0102030405060');

    const imported = (await upload('/statements', csv).expect(201)).body;
    // Deposit, cheque and receipt match; the bank charge is not in the ledger yet
    expect(imported).toMatchObject({ imported: 4, skipped: 0, matched: 3 });
    await upload('/statements', csv).expect(409);

    let ws = (await api('get', `${B}/workspace`).expect(200)).body;
    expect(ws.lines.map((l: { description: string }) => l.description)).toEqual(['SERVICE CHARGE, MAR']);
    expect(ws.entries.map((e: { amount: string }) => e.amount)).toEqual(['-1000.0000']);

    // The bank charge becomes a voucher, goes through approval and is then ticked off automatically
    const charge = ws.lines[0];
    const draft = (await api('post', `${B}/lines/${charge.id}/voucher`).send({ contraAccountId: ds['5000'] }).expect(201)).body;
    expect(draft).toMatchObject({ txDate: expect.stringMatching(/^2026-03-31/), status: 'DRAFT', lines: [{ credit: '450' }, { debit: '450' }] });
    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/submit`).send({}).expect(200);
    await api('post', `/companies/MS-AI/vouchers/${draft.voucherNo}/approve`, 'manager').send({}).expect(200);
    expect((await api('post', `${B}/auto-match`).expect(200)).body).toEqual({ matched: 1 });

    // A match can be undone and made by hand; both sides must add up to the same amount
    ws = (await api('get', `${B}/workspace`).expect(200)).body;
    const deposit = ws.matches.find((m: { lines: Array<{ description: string }> }) => m.lines[0].description === 'CASH DEPOSIT');
    await api('delete', `${B}/matches/${deposit.id}`).expect(200);
    const petty = ws.entries.find((e: { amount: string }) => e.amount === '-1000.0000');
    const wrong = await api('post', `${B}/matches`).send({ lineIds: [deposit.lines[0].id], entryIds: [petty.id] }).expect(400);
    expect(wrong.body.message).toBe('The statement lines come to 50000.0000 and the ledger rows to -1000.0000; they must be equal');
    await api('post', `${B}/matches`).send({ lineIds: [deposit.lines[0].id], entryIds: deposit.entries.map((e: { id: string }) => e.id) }).expect(201);

    // An overlapping export brings in only the new line
    const rows = csv.split('\r\n');
    const april = [...rows.slice(0, 3), '02/04/2026,02/04/2026,INTEREST,,,12.50,"69,741.50"', ...rows.slice(3, 5)].join('\r\n');
    expect((await upload('/statements', april, 'march-april.csv').expect(201)).body).toMatchObject({ imported: 1, skipped: 2 });

    const recon = (await api('get', `${B}/reconciliation?asAt=2026-03-31`, 'viewer').expect(200)).body;
    expect(recon).toMatchObject({
      statementBalance: '69729.0000',
      depositsInTransit: '0.0000',
      unpresentedPayments: '1000.0000',
      bankMoneyIn: '0.0000',
      bankMoneyOut: '0.0000',
      ledgerBalance: '68729.0000',
      difference: '0.0000',
    });
    expect(recon.outstandingEntries.map((e: { reference: string }) => e.reference)).toEqual(['000124']);

    // Prepared by one person, reviewed by another; then the matches it relies on are locked
    const prepared = (await api('post', `${B}/reconciliations`).send({ asAt: '2026-03-31' }).expect(201)).body;
    await api('post', `${B}/reconciliations/${prepared.id}/review`).expect(403);
    await api('post', `${B}/reconciliations/${prepared.id}/review`, 'manager').expect(200);
    const locked = (await api('get', `${B}/workspace`).expect(200)).body.matches[0];
    await api('delete', `${B}/matches/${locked.id}`).expect(409);
    await api('post', `${B}/reconciliations`).send({ asAt: '2026-03-31' }).expect(409);

    const listed = (await api('get', '/companies/MS-AI/bank-accounts').expect(200)).body;
    expect(listed[0]).toMatchObject({ name: 'SCB Harambee KES', statementBalance: '69741.5000', unmatchedLines: 1, unmatchedEntries: 1 });
    const trail = (await api('get', `/companies/MS-AI/history/BankAccount/${account.id}`).expect(200)).body;
    expect(trail.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['bank.account_created', 'bank.statement_imported', 'bank.auto_matched', 'bank.unmatched', 'bank.matched', 'bank.reconciliation_reviewed']),
    );
  });

  it('keeps an audit trail of every step', async () => {
    const actions = await prisma.auditLog.groupBy({ by: ['action'], _count: true });
    const seen = actions.map((a) => a.action);
    for (const a of ['voucher.submitted', 'voucher.approved', 'voucher.rejected', 'gl.journal_posted', 'gl.intercompany_posted', 'archive.attached']) {
      expect(seen).toContain(a);
    }
  });
});
