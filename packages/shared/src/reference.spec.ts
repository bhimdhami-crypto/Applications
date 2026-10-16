import { COUNTRIES, CURRENCIES, currencyDecimals, formatMoney, LANGUAGES, languageDir, THEME } from './index';

describe('reference data', () => {
  it('covers the eleven initial countries with known currencies and languages', () => {
    expect(COUNTRIES.map((c) => c.code)).toEqual(['KE', 'UG', 'TZ', 'EG', 'FR', 'IN', 'CN', 'AU', 'NL', 'JP', 'KR']);
    for (const c of COUNTRIES) {
      expect(CURRENCIES.some((x) => x.code === c.currency)).toBe(true);
      for (const l of c.languages) expect(LANGUAGES.some((x) => x.code === l)).toBe(true);
    }
  });

  it('uses ISO 4217 minor units', () => {
    expect(currencyDecimals('UGX')).toBe(0);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KRW')).toBe(0);
    expect(currencyDecimals('KES')).toBe(2);
    expect(formatMoney(1234.5, 'JPY', 'en')).toBe('¥1,235');
  });

  it('marks Arabic as right to left', () => {
    expect(languageDir('ar')).toBe('rtl');
    expect(languageDir('fr')).toBe('ltr');
  });
});

// WCAG 2.x relative luminance and contrast ratio
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme contrast (WCAG 2.2 AA)', () => {
  for (const name of ['light', 'dark'] as const) {
    const t = THEME[name];
    it(`${name}: body and muted text, links and buttons are readable`, () => {
      expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.textMuted, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accentText, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.danger, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.success, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.sidebarText, t.sidebar)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
