import { approvalBlocker, matrixProblems, selectRule, staffingWarnings } from './approval-rules';

const rule = (id: number, minAmount: string, maxAmount: string | null, documentType = 'JOURNAL', isActive = true) => ({
  id,
  documentType,
  minAmount,
  maxAmount,
  isActive,
});

describe('selectRule', () => {
  const rules = [rule(1, '0', '1000000'), rule(2, '1000000', null), rule(3, '0', null, 'REVERSAL'), rule(4, '0', null, 'JOURNAL', false)];

  it('picks the band the amount falls in, upper bound exclusive', () => {
    expect(selectRule(rules, 'JOURNAL', 999999.99)?.id).toBe(1);
    expect(selectRule(rules, 'JOURNAL', 1000000)?.id).toBe(2);
    expect(selectRule(rules, 'REVERSAL', 5)?.id).toBe(3);
  });

  it('prefers the narrower band when bands overlap', () => {
    expect(selectRule([rule(1, '0', null), rule(2, '500', null)], 'JOURNAL', 600)?.id).toBe(2);
  });

  it('returns nothing when no active rule covers the voucher', () => {
    expect(selectRule([rule(1, '0', '100'), rule(4, '0', null, 'JOURNAL', false)], 'JOURNAL', 100)).toBeUndefined();
  });
});

describe('approvalBlocker', () => {
  const stage = { stageNo: 1, name: 'Finance manager review', approverRole: 'FINANCE_MANAGER' };
  const voucher = { createdById: 1 };

  it('lets the stage role approve', () => {
    expect(approvalBlocker(stage, { id: 2, role: 'FINANCE_MANAGER' }, voucher, [])).toBeNull();
  });

  it('needs the stage role, though an admin may stand in', () => {
    expect(approvalBlocker(stage, { id: 2, role: 'ACCOUNTANT' }, voucher, [])).toContain('needs the FINANCE_MANAGER role');
    expect(approvalBlocker(stage, { id: 9, role: 'ADMIN' }, voucher, [])).toBeNull();
  });

  it('never lets the author approve, admin or not', () => {
    expect(approvalBlocker(stage, { id: 1, role: 'ADMIN' }, voucher, [])).toContain('someone else');
  });

  it('lets one person approve only one stage per submission', () => {
    const director = { stageNo: 2, name: 'Director approval', approverRole: 'DIRECTOR' };
    const actions = [
      { action: 'SUBMITTED', stageNo: null, userId: 1 },
      { action: 'APPROVED', stageNo: 1, userId: 9 },
    ];
    expect(approvalBlocker(director, { id: 9, role: 'ADMIN' }, voucher, actions)).toContain('already approved');
    // After a rejection and resubmission the earlier approval no longer counts
    const resubmitted = [...actions, { action: 'REJECTED', stageNo: 2, userId: 5 }, { action: 'SUBMITTED', stageNo: null, userId: 1 }];
    expect(approvalBlocker(stage, { id: 9, role: 'ADMIN' }, voucher, resubmitted)).toBeNull();
  });
});

describe('matrixProblems', () => {
  const FM = { name: 'Review', approverRole: 'FINANCE_MANAGER' };
  const band = (minAmount: string, maxAmount: string | null, stages = [FM]) => ({ minAmount, maxAmount, stages });

  it('accepts bands from 0 that follow on and end open', () => {
    expect(matrixProblems([band('500000', null), band('0', '500000')])).toEqual([]);
  });

  it('finds gaps, overlaps, a closed top and a missing start', () => {
    expect(matrixProblems([band('0', '100'), band('200', null)])).toEqual(['Amounts from 100 to 200 have no approval route']);
    expect(matrixProblems([band('0', '300'), band('200', null)])).toEqual(['Bands overlap between 200 and 300']);
    expect(matrixProblems([band('0', '100')])[0]).toContain('leave the last band');
    expect(matrixProblems([band('10', null)])[0]).toContain('must start at 0');
    expect(matrixProblems([])).toEqual(['Add at least one amount band']);
  });

  it('needs a stage in every band, and no viewer approvals', () => {
    expect(matrixProblems([band('0', null, [])])[0]).toContain('at least one approval stage');
    expect(matrixProblems([band('0', null, [{ name: 'Look', approverRole: 'VIEWER' }])])[0]).toContain('VIEWER cannot approve');
  });
});

describe('staffingWarnings', () => {
  const twoDirectors = {
    name: 'Large journals',
    minAmount: '0',
    maxAmount: null,
    stages: [
      { name: 'A', approverRole: 'DIRECTOR' },
      { name: 'B', approverRole: 'DIRECTOR' },
    ],
  };

  it('warns when a band needs more distinct approvers than there are', () => {
    expect(staffingWarnings([twoDirectors], { DIRECTOR: 1 })).toEqual([
      '"Large journals" needs 2 different director approvers, but only 1 active user can act as one',
    ]);
    expect(staffingWarnings([twoDirectors], { DIRECTOR: 2 })).toEqual([]);
    // An administrator can stand in
    expect(staffingWarnings([twoDirectors], { DIRECTOR: 1, ADMIN: 1 })).toEqual([]);
  });
});
