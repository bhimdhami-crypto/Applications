'use client';

import { ACCENTS, LANGUAGES } from '@gpp/shared';
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

export function AccentSelect() {
  const { accent, setAccent, t } = usePrefs();
  return (
    <label>
      {t('top.colour')}
      <select value={accent} onChange={(e) => setAccent(e.target.value)}>
        {Object.entries(ACCENTS).map(([key, a]) => (
          <option key={key} value={key}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Visual picker for the account page: one swatch per preset, in both themes */
export function AppearancePicker() {
  const { accent, setAccent, theme, setTheme, t } = usePrefs();
  return (
    <div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: '.85rem', marginBottom: '.4rem' }}>{t('top.theme')}</legend>
        <div className="row">
          {(['light', 'dark', 'system'] as ThemeChoice[]).map((x) => (
            <label key={x} className="check">
              <input type="radio" name="theme" checked={theme === x} onChange={() => setTheme(x)} />
              {t(`theme.${x}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: '.75rem 0 0' }}>
        <legend style={{ fontWeight: 600, fontSize: '.85rem', marginBottom: '.4rem' }}>{t('top.colour')}</legend>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([key, a]) => (
            <button key={key} type="button" className="swatch" aria-pressed={accent === key} onClick={() => setAccent(key)}>
              <span style={{ background: a.light.accent }} />
              <span style={{ background: a.dark.accent }} />
              {a.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
