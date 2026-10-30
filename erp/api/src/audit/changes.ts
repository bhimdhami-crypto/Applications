/** One field that an edit changed, as the change history shows it */
export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** Puts values in one comparable form: amounts as plain numbers, dates as yyyy-mm-dd, blanks as null */
export function display(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'toFixed' in value && typeof (value as { toFixed: unknown }).toFixed === 'function') {
    // Prisma Decimal: drop trailing zeros so 30.00 and 30 compare equal
    return String(Number((value as { toString(): string }).toString()));
  }
  if (typeof value === 'number') return String(value);
  return String(value);
}

/** The fields, by their labels, whose values differ between two versions of a record */
export function fieldChanges<T extends object>(before: T, after: T, fields: Partial<Record<keyof T, string>>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [key, field] of Object.entries(fields) as Array<[keyof T, string]>) {
    const from = display(before[key]);
    const to = display(after[key]);
    if (from !== to) out.push({ field, from, to });
  }
  return out;
}

/**
 * Lines compared as text, one per line, so the history shows which were removed and which added.
 * A line kept as it was appears in neither list, wherever it moved to.
 */
export function lineChanges(before: string[], after: string[]) {
  const remaining = [...after];
  const removed: string[] = [];
  for (const line of before) {
    const i = remaining.indexOf(line);
    if (i >= 0) remaining.splice(i, 1);
    else removed.push(line);
  }
  return { removed, added: remaining };
}
