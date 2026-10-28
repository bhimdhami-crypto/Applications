import { egyptRules } from './egypt';
import { kenyaRules } from './kenya';
import { mexicoRules } from './mexico';
import { newZealandRules } from './new-zealand';
import { nigeriaRules } from './nigeria';
import { southAfricaRules } from './south-africa';
import { tanzaniaRules } from './tanzania';
import { RulesPack } from './types';
import { ugandaRules } from './uganda';

/**
 * Payroll rules per country. Countries without a pack (the US parent company) cannot run
 * payroll in the portal. Every pack is a draft until a local payroll expert signs it off.
 */
const PACKS: Record<string, RulesPack> = {
  KE: kenyaRules,
  UG: ugandaRules,
  TZ: tanzaniaRules,
  ZA: southAfricaRules,
  EG: egyptRules,
  NG: nigeriaRules,
  MX: mexicoRules,
  NZ: newZealandRules,
};

export function rulesFor(countryCode: string): RulesPack | undefined {
  return PACKS[countryCode.toUpperCase()];
}

export * from './types';
