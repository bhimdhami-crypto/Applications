/**
 * Design tokens for the web portal and mobile app. The accent is KTM orange (#FF6600) with
 * near-black and white, the motorcycle brand's palette. Orange on white fails WCAG contrast
 * for small text, so text-on-light uses the deeper `accentText` shade instead.
 */
export const THEME = {
  light: {
    bg: '#F6F6F4',
    surface: '#FFFFFF',
    surfaceAlt: '#F0EFEC',
    border: '#E2E0DB',
    text: '#141414',
    textMuted: '#5C5A55',
    accent: '#FF6600',
    accentHover: '#E55C00',
    accentText: '#B84700',
    onAccent: '#141414',
    success: '#1F7A3A',
    warning: '#9A6200',
    danger: '#C0262D',
    focus: '#FF6600',
    sidebar: '#141414',
    sidebarText: '#F2F2F2',
  },
  dark: {
    bg: '#0E0E0E',
    surface: '#181818',
    surfaceAlt: '#222222',
    border: '#2F2F2F',
    text: '#F2F2F2',
    textMuted: '#A8A6A1',
    accent: '#FF6600',
    accentHover: '#FF7A1F',
    accentText: '#FF8533',
    onAccent: '#141414',
    success: '#4CC26D',
    warning: '#F0B33C',
    danger: '#FF6B6B',
    focus: '#FF8533',
    sidebar: '#000000',
    sidebarText: '#F2F2F2',
  },
} as const;

export type ThemeName = keyof typeof THEME;

/** The colours an accent preset overrides, for each of light and dark */
export interface AccentTokens {
  accent: string;
  accentHover: string;
  accentText: string;
  onAccent: string;
  focus: string;
}

/**
 * Accent colour presets users can pick in the portal. KTM orange is the default.
 * Each pair is checked for WCAG AA contrast in reference.spec.ts.
 */
export const ACCENTS: Record<string, { label: string; light: AccentTokens; dark: AccentTokens }> = {
  ktm: {
    label: 'KTM orange',
    light: { accent: THEME.light.accent, accentHover: THEME.light.accentHover, accentText: THEME.light.accentText, onAccent: THEME.light.onAccent, focus: THEME.light.focus },
    dark: { accent: THEME.dark.accent, accentHover: THEME.dark.accentHover, accentText: THEME.dark.accentText, onAccent: THEME.dark.onAccent, focus: THEME.dark.focus },
  },
  blue: {
    label: 'Ocean blue',
    light: { accent: '#1F6FEB', accentHover: '#1A5FCC', accentText: '#1A5FCC', onAccent: '#FFFFFF', focus: '#1F6FEB' },
    dark: { accent: '#4C8DFF', accentHover: '#6CA6FF', accentText: '#6CA6FF', onAccent: '#0E0E0E', focus: '#6CA6FF' },
  },
  green: {
    label: 'Forest green',
    light: { accent: '#18803A', accentHover: '#136B30', accentText: '#18803A', onAccent: '#FFFFFF', focus: '#18803A' },
    dark: { accent: '#3DBE6A', accentHover: '#57D07F', accentText: '#57D07F', onAccent: '#0E0E0E', focus: '#57D07F' },
  },
  purple: {
    label: 'Royal purple',
    light: { accent: '#7C3AED', accentHover: '#6D28D9', accentText: '#6D28D9', onAccent: '#FFFFFF', focus: '#7C3AED' },
    dark: { accent: '#A78BFA', accentHover: '#B794F6', accentText: '#B794F6', onAccent: '#0E0E0E', focus: '#B794F6' },
  },
  red: {
    label: 'Racing red',
    light: { accent: '#C8102E', accentHover: '#A50D26', accentText: '#B00E29', onAccent: '#FFFFFF', focus: '#C8102E' },
    dark: { accent: '#FF5A6E', accentHover: '#FF7A8A', accentText: '#FF7A8A', onAccent: '#0E0E0E', focus: '#FF7A8A' },
  },
  teal: {
    label: 'Teal',
    light: { accent: '#0F766E', accentHover: '#0B5F58', accentText: '#0F766E', onAccent: '#FFFFFF', focus: '#0F766E' },
    dark: { accent: '#2DD4BF', accentHover: '#5EEAD4', accentText: '#5EEAD4', onAccent: '#0E0E0E', focus: '#5EEAD4' },
  },
};

export const DEFAULT_THEME: ThemeName = 'light';
export const DEFAULT_ACCENT = 'ktm';
