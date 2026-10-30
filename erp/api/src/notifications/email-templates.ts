/** The emails the approval workflow sends. Plain text first; the HTML version says the same thing. */
export interface Email {
  subject: string;
  text: string;
  html: string;
}

export interface VoucherFacts {
  companyCode: string;
  voucherNo: string;
  description: string;
  amount: string;
  currency: string;
  author: string;
  link: string;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Header-safe: no line breaks, so a description cannot add headers, and within the subject column */
function subjectLine(s: string) {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

export function formatAmount(amount: string) {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : amount;
}

function layout(heading: string, paragraphs: string[], rows: Array<[string, string]>, link: string, button: string) {
  const table = rows
    .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#667085">${escapeHtml(k)}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`)
    .join('');
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d2939;margin:0;padding:24px;background:#f5f6f8">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:8px;padding:24px">
<div style="font-weight:700;margin-bottom:16px">MFI <span style="color:#1d4ed8">ERP</span></div>
<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(heading)}</h2>
${paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
<table style="border-collapse:collapse;margin:8px 0 18px">${table}</table>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">${escapeHtml(button)}</a>
<p style="margin:20px 0 0;font-size:12px;color:#98a2b3">You get these emails because email alerts are on for your sign-in. Turn them off on the Approvals screen.</p>
</div></body></html>`;
}

function facts(v: VoucherFacts): Array<[string, string]> {
  return [
    ['Voucher', `${v.companyCode} ${v.voucherNo}`],
    ['Description', v.description],
    ['Amount', `${v.currency} ${formatAmount(v.amount)}`],
    ['Prepared by', v.author],
  ];
}

function textBody(lines: string[], rows: Array<[string, string]>, link: string) {
  return [...lines, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', link, ''].join('\n');
}

export function approvalNeeded(v: VoucherFacts, stage: { stageNo: number; name: string }, standIn: boolean): Email {
  const heading = `${v.voucherNo} needs your approval`;
  const lines = [
    `${v.companyCode} ${v.voucherNo} is waiting at stage ${stage.stageNo}, ${stage.name}.`,
    ...(standIn ? ['Nobody else holds the role this stage needs, so it has come to you as an administrator.'] : []),
  ];
  const rows = facts(v);
  return {
    subject: subjectLine(`Approval needed: ${v.companyCode} ${v.voucherNo}, ${v.currency} ${formatAmount(v.amount)}, ${v.description}`),
    text: textBody(lines, rows, v.link),
    html: layout(heading, lines, rows, v.link, 'Open the voucher'),
  };
}

export function rejected(v: VoucherFacts, by: string, stageName: string, reason: string): Email {
  const lines = [`${by} rejected ${v.voucherNo} at ${stageName}.`, `Reason: ${reason}`, 'Correct it and submit it again, or cancel it.'];
  const rows = facts(v);
  return {
    subject: subjectLine(`Rejected: ${v.companyCode} ${v.voucherNo}, ${v.description}`),
    text: textBody(lines, rows, v.link),
    html: layout(`${v.voucherNo} was rejected`, lines, rows, v.link, 'Open the voucher'),
  };
}

export function posted(v: VoucherFacts, auditNo: string, by: string): Email {
  const lines = [`${v.voucherNo} has passed its last approval (${by}) and is posted to the ledger as ${auditNo}.`];
  const rows = facts(v);
  return {
    subject: subjectLine(`Posted: ${v.companyCode} ${v.voucherNo} as ${auditNo}`),
    text: textBody(lines, rows, v.link),
    html: layout(`${v.voucherNo} is posted`, lines, rows, v.link, 'Open the voucher'),
  };
}

export interface WaitingItem {
  companyCode: string;
  voucherNo: string;
  description: string;
  amount: string;
  currency: string;
  stage: string;
  days: number;
}

/** The morning reminder of everything that has waited on the person for a day or more */
export function digest(name: string, items: WaitingItem[], inboxLink: string): Email {
  const lines = [`Good morning ${name}. ${items.length === 1 ? 'One voucher has' : `${items.length} vouchers have`} waited a day or more for your approval:`];
  const list = items.map((i) => `${i.companyCode} ${i.voucherNo} · ${i.currency} ${formatAmount(i.amount)} · ${i.description} · ${i.stage} · ${i.days} day${i.days === 1 ? '' : 's'}`);
  const html = layout('Waiting for your approval', lines, [], inboxLink, 'Open approvals').replace(
    '<table style="border-collapse:collapse;margin:8px 0 18px"></table>',
    `<ul style="padding-left:18px;margin:0 0 18px">${list.map((l) => `<li style="margin-bottom:4px">${escapeHtml(l)}</li>`).join('')}</ul>`,
  );
  return {
    subject: `Waiting for your approval: ${items.length} voucher${items.length === 1 ? '' : 's'}`,
    text: [...lines, '', ...list.map((l) => `- ${l}`), '', inboxLink, ''].join('\n'),
    html,
  };
}

export function test(name: string, link: string): Email {
  const lines = [`Hello ${name}. This is a test from MFI ERP: email alerts are working.`];
  return { subject: 'MFI ERP test email', text: textBody(lines, [], link), html: layout('Email is working', lines, [], link, 'Open MFI ERP') };
}
