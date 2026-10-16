'use client';

import { LANGUAGES } from '@gpp/shared';
import { UI_LANGUAGES } from '@/i18n';
import { ThemeChoice, usePrefs } from '@/lib/prefs';

export function LanguageSelect() {
  const { lang, setLang, t } = usePrefs();
  return (
    <label>
      {t('top.language')}
      <select value={lang} onChange={(e) => setLang(e.target.value)}>
        {UI_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGES.find((l) => l.code === code)?.nativeName ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThemeSelect() {
  const { theme, setTheme, t } = usePrefs();
  return (
    <label>
      {t('top.theme')}
      <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
        <option value="system">{t('theme.system')}</option>
      </select>
    </label>
  );
}
