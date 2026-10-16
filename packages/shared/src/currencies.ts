/** ISO 4217 currencies used by the initial countries. Admins can add more in the database. */
export interface CurrencyDef {
  code: string;
  name: string;
  /** Minor-unit digits per ISO 4217, used for rounding and display */
  decimals: number;
  symbol: string;
}

export const CURRENCIES: readonly CurrencyDef[] = [
  { code: 'KES', name: 'Kenyan shilling', decimals: 2, symbol: 'KSh' },
  { code: 'UGX', name: 'Ugandan shilling', decimals: 0, symbol: 'USh' },
  { code: 'TZS', name: 'Tanzanian shilling', decimals: 2, symbol: 'TSh' },
  { code: 'EGP', name: 'Egyptian pound', decimals: 2, symbol: 'E£' },
  { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€' },
  { code: 'INR', name: 'Indian rupee', decimals: 2, symbol: '₹' },
  { code: 'CNY', name: 'Chinese yuan', decimals: 2, symbol: '¥' },
  { code: 'AUD', name: 'Australian dollar', decimals: 2, symbol: 'A$' },
  { code: 'JPY', name: 'Japanese yen', decimals: 0, symbol: '¥' },
  { code: 'KRW', name: 'South Korean won', decimals: 0, symbol: '₩' },
  { code: 'USD', name: 'US dollar', decimals: 2, symbol: '$' },
];

/** The group's reporting currency in the demo */
export const GROUP_REPORTING_CURRENCY = 'USD';

export function currencyDecimals(code: string): number {
  return CURRENCIES.find((c) => c.code === code)?.decimals ?? 2;
}

/** Formats an amount for display only. Never use the result for arithmetic. */
export function formatMoney(amount: number | string, currency: string, locale = 'en'): string {
  const digits = currencyDecimals(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(amount));
}
