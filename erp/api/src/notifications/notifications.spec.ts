import { approvalNeeded, digest, escapeHtml, rejected } from './email-templates';
import { nairobiClock } from './mailer.service';
import { Candidate, stageRecipients } from './recipients';

const facts = {
  companyCode: 'MS-AI',
  voucherNo: 'JV000014',
  description: 'Office rent <October>',
  amount: '195000',
  currency: 'KES',
  author: 'Wanjiru Kamau',
  link: 'http://erp.local/vouchers/JV000014',
};

describe('approval emails', () => {
  it('names the voucher, amount and stage, and escapes what users typed', () => {
    const email = approvalNeeded(facts, { stageNo: 1, name: 'Finance manager' }, false);
    expect(email.subject).toBe('Approval needed: MS-AI JV000014, KES 195,000.00, Office rent <October>');
    expect(email.text).toContain('waiting at stage 1, Finance manager');
    expect(email.text).toContain(facts.link);
    expect(email.html).toContain('Office rent &lt;October&gt;');
    expect(email.html).not.toContain('<October>');
  });

  it('keeps line breaks out of the subject', () => {
    expect(rejected({ ...facts, description: 'Rent\r\nBcc: x@evil.test' }, 'David', 'stage 1', 'No').subject).not.toMatch(/[\r\n]/);
  });

  it('lists every waiting voucher in the morning reminder', () => {
    const email = digest('David', [{ ...facts, stage: 'Finance manager', days: 2 }], 'http://erp.local/approvals');
    expect(email.subject).toBe('Waiting for your approval: 1 voucher');
    expect(email.text).toContain('JV000014 · KES 195,000.00 · Office rent <October> · Finance manager · 2 days');
    expect(escapeHtml(`"a" & 'b'`)).toBe('&quot;a&quot; &amp; &#39;b&#39;');
  });
});

describe('stageRecipients', () => {
  const person = (id: number, role: Candidate['role'], emailAlerts = true): Candidate => ({ id, role, email: `${id}@x`, name: `P${id}`, emailAlerts });
  const people = [person(1, 'ACCOUNTANT'), person(2, 'FINANCE_MANAGER'), person(3, 'FINANCE_MANAGER', false), person(4, 'DIRECTOR'), person(9, 'ADMIN')];
  const stage = { stageNo: 1, name: 'Finance manager', approverRole: 'FINANCE_MANAGER' };

  it('tells the role holders who can act, not administrators, and respects opting out', () => {
    expect(stageRecipients(stage, { createdById: 1 }, [], people)).toEqual({ recipients: [people[1]], standIn: false });
  });

  it('skips the author and anyone who signed an earlier stage', () => {
    const director = { stageNo: 2, name: 'Director', approverRole: 'DIRECTOR' };
    const actions = [
      { action: 'SUBMITTED', stageNo: null, userId: 2 },
      { action: 'APPROVED', stageNo: 1, userId: 4 },
    ];
    // The only director already approved, so an administrator stands in
    expect(stageRecipients(director, { createdById: 2 }, actions, people)).toEqual({ recipients: [people[4]], standIn: true });
  });
});

describe('nairobiClock', () => {
  it('works in East Africa Time', () => {
    const c = nairobiClock(new Date('2026-10-30T05:30:00Z'));
    expect(c).toMatchObject({ hour: 8, weekday: 5 });
    expect(c.midnight.toISOString()).toBe('2026-10-29T21:00:00.000Z');
  });
});
