'use client';

import { languageDir } from '@gpp/shared';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { MessageKey, translate, UI_LANGUAGES } from '@/i18n';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface Prefs {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  lang: string;
  setLang: (l: string) => void;
  t: (key: MessageKey, vars?: Record<string, string>) => string;
}

const PrefsContext = createContext<Prefs | null>(null);

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the choice then lasts for this page only
  }
}

export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    const t = read('gpp.theme') as ThemeChoice | null;
    if (t) setThemeState(t);
    const l = read('gpp.lang');
    if (l && UI_LANGUAGES.includes(l)) setLangState(l);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = languageDir(lang);
  }, [lang]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    write('gpp.theme', t);
  }, []);
  const setLang = useCallback((l: string) => {
    setLangState(l);
    write('gpp.lang', l);
  }, []);
  const t = useCallback((key: MessageKey, vars?: Record<string, string>) => translate(lang, key, vars), [lang]);

  return <PrefsContext.Provider value={{ theme, setTheme, lang, setLang, t }}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs outside PrefsProvider');
  return ctx;
}
