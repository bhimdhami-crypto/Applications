/**
 * Reference facts for the initial countries: currency, languages, time zone and default weekend.
 * Statutory rates are deliberately not here: they live in versioned compliance rule sets (phase 5)
 * with their source and verification status.
 */
export interface CountryDef {
  code: string;
  name: string;
  currency: string;
  /** Interface and content languages, most used first */
  languages: string[];
  timeZone: string;
  /** Default weekend days (0 = Sunday ... 6 = Saturday); each company can override */
  weekendDays: number[];
  region: 'Africa' | 'Europe' | 'Asia' | 'Oceania' | 'Americas';
}

export const COUNTRIES: readonly CountryDef[] = [
  { code: 'KE', name: 'Kenya', currency: 'KES', languages: ['en', 'sw'], timeZone: 'Africa/Nairobi', weekendDays: [0, 6], region: 'Africa' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', languages: ['en', 'sw', 'lg'], timeZone: 'Africa/Kampala', weekendDays: [0, 6], region: 'Africa' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', languages: ['sw', 'en'], timeZone: 'Africa/Dar_es_Salaam', weekendDays: [0, 6], region: 'Africa' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', languages: ['ar', 'en'], timeZone: 'Africa/Cairo', weekendDays: [5, 6], region: 'Africa' },
  { code: 'FR', name: 'France', currency: 'EUR', languages: ['fr', 'en'], timeZone: 'Europe/Paris', weekendDays: [0, 6], region: 'Europe' },
  { code: 'IN', name: 'India', currency: 'INR', languages: ['hi', 'en', 'ta', 'te', 'bn', 'mr'], timeZone: 'Asia/Kolkata', weekendDays: [0, 6], region: 'Asia' },
  { code: 'CN', name: 'China', currency: 'CNY', languages: ['zh-Hans', 'en', 'zh-Hant'], timeZone: 'Asia/Shanghai', weekendDays: [0, 6], region: 'Asia' },
  { code: 'AU', name: 'Australia', currency: 'AUD', languages: ['en'], timeZone: 'Australia/Sydney', weekendDays: [0, 6], region: 'Oceania' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', languages: ['nl', 'en'], timeZone: 'Europe/Amsterdam', weekendDays: [0, 6], region: 'Europe' },
  { code: 'JP', name: 'Japan', currency: 'JPY', languages: ['ja', 'en'], timeZone: 'Asia/Tokyo', weekendDays: [0, 6], region: 'Asia' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', languages: ['ko', 'en'], timeZone: 'Asia/Seoul', weekendDays: [0, 6], region: 'Asia' },
  // Carried over from the first Mindspace build
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', languages: ['en', 'af', 'zu'], timeZone: 'Africa/Johannesburg', weekendDays: [0, 6], region: 'Africa' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', languages: ['en', 'yo', 'ha', 'ig'], timeZone: 'Africa/Lagos', weekendDays: [0, 6], region: 'Africa' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', languages: ['es', 'en'], timeZone: 'America/Mexico_City', weekendDays: [0, 6], region: 'Americas' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', languages: ['en', 'mi'], timeZone: 'Pacific/Auckland', weekendDays: [0, 6], region: 'Oceania' },
];
