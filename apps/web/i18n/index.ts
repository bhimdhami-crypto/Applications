import { ar } from './ar';
import { en, MessageKey, Messages } from './en';
import { fr } from './fr';
import { sw } from './sw';

export const CATALOGUES: Record<string, Messages> = { en, sw, fr, ar };
export const UI_LANGUAGES = Object.keys(CATALOGUES);
export type { MessageKey };

export function translate(lang: string, key: MessageKey, vars?: Record<string, string>) {
  let text = (CATALOGUES[lang] ?? en)[key] ?? en[key];
  for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{${k}}`, v);
  return text;
}
