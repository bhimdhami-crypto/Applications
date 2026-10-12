import { kenyaRules } from './kenya';
import { RulesPack } from './types';

/**
 * Payroll rules per country. Countries without a pack cannot run payroll yet:
 * Uganda, Tanzania, South Africa, Egypt, Nigeria, Mexico and New Zealand are next.
 */
const PACKS: Record<string, RulesPack> = {
  KE: kenyaRules,
};

export function rulesFor(countryCode: string): RulesPack | undefined {
  return PACKS[countryCode.toUpperCase()];
}

export * from './types';
