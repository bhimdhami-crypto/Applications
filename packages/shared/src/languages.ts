/**
 * Language catalogue. `interface` languages have portal translations; `catalogue` languages
 * can be chosen for content and names and get interface translations when they are added.
 */
export interface LanguageDef {
  code: string;
  englishName: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  status: 'interface' | 'catalogue';
}

export const LANGUAGES: readonly LanguageDef[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', dir: 'ltr', status: 'interface' },
  { code: 'sw', englishName: 'Kiswahili', nativeName: 'Kiswahili', dir: 'ltr', status: 'interface' },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', dir: 'rtl', status: 'interface' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', dir: 'ltr', status: 'interface' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr', status: 'catalogue' },
  { code: 'zh-Hans', englishName: 'Chinese (Simplified)', nativeName: '简体中文', dir: 'ltr', status: 'catalogue' },
  { code: 'zh-Hant', englishName: 'Chinese (Traditional)', nativeName: '繁體中文', dir: 'ltr', status: 'catalogue' },
  { code: 'nl', englishName: 'Dutch', nativeName: 'Nederlands', dir: 'ltr', status: 'catalogue' },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', dir: 'ltr', status: 'catalogue' },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', dir: 'ltr', status: 'catalogue' },
  { code: 'lg', englishName: 'Luganda', nativeName: 'Luganda', dir: 'ltr', status: 'catalogue' },
  { code: 'ta', englishName: 'Tamil', nativeName: 'தமிழ்', dir: 'ltr', status: 'catalogue' },
  { code: 'te', englishName: 'Telugu', nativeName: 'తెలుగు', dir: 'ltr', status: 'catalogue' },
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', dir: 'ltr', status: 'catalogue' },
  { code: 'mr', englishName: 'Marathi', nativeName: 'मराठी', dir: 'ltr', status: 'catalogue' },
];

export function languageDir(code: string): 'ltr' | 'rtl' {
  return LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr';
}
