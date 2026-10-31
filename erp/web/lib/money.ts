// Amounts travel as decimal strings. Totals are added as integers of 0.0001, the same as the API,
// so the live totals on screen never disagree with what the ledger will post.
const SCALE = 10_000n;

export function toUnits(value: string | null | undefined): bigint {
  const s = (value ?? '').trim().replace(/,/g, '');
  if (!s) return 0n;
  const m = /^(-?)(\d*)(?:\.(\d{0,4})\d*)?$/.exec(s);
  if (!m) return 0n;
  const units = BigInt(m[2] || '0') * SCALE + BigInt((m[3] ?? '').padEnd(4, '0') || '0');
  return m[1] ? -units : units;
}

export function fromUnits(units: bigint, decimals = 2): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(4, '0').slice(0, decimals);
  return `${neg ? '-' : ''}${whole}${decimals ? `.${frac}` : ''}`;
}

/** 1234567.5 → "1,234,567.50" */
export function formatAmount(value: string | bigint | null | undefined, decimals = 2): string {
  const units = typeof value === 'bigint' ? value : toUnits(value);
  const [whole, frac] = fromUnits(units, decimals).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${digits}${frac !== undefined ? `.${frac}` : ''}`;
}

/** What the API accepts: plain digits, at most 4 decimals, no separators */
export function cleanAmount(value: string): string | undefined {
  const units = toUnits(value);
  if (units <= 0n) return undefined;
  return fromUnits(units, 4).replace(/\.?0+$/, '');
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
