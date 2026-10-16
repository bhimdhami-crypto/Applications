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
