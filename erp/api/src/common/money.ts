/**
 * Exact money arithmetic for ledger amounts. Amounts are stored as DECIMAL(19,4), so we work in
 * whole ten-thousandths held in a bigint: no float rounding can make a balanced journal look unbalanced.
 */

export const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);
const PATTERN = /^-?\d+(\.\d+)?$/;

/** Parses "1234.5" or 1234.5 into units of 0.0001. Rejects more than 4 decimal places. */
export function toUnits(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toString() : value.trim();
  if (!PATTERN.test(text)) throw new Error(`Not a valid amount: ${value}`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  if (fraction.length > SCALE) throw new Error(`Amount has more than ${SCALE} decimal places: ${value}`);
  const units = BigInt(whole) * FACTOR + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -units : units;
}

/** Formats units of 0.0001 back to a decimal string with 4 places, as SQL Server returns it */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / FACTOR;
  const fraction = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Rounds units to a currency's decimals (half away from zero), e.g. 2 for KES */
export function roundUnits(units: bigint, decimals: number): bigint {
  const step = 10n ** BigInt(SCALE - decimals);
  const half = step / 2n;
  const abs = units < 0n ? -units : units;
  const rounded = ((abs + half) / step) * step;
  return units < 0n ? -rounded : rounded;
}
