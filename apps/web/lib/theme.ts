'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'mindspace.theme';

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Light, dark or follow the device. Saved per browser; the root layout applies it before first paint. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    let saved: Theme = 'system';
    try {
      saved = (localStorage.getItem(KEY) as Theme) || 'system';
    } catch {
      /* storage blocked: follow the device */
    }
    setThemeState(saved);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      let current: Theme = 'system';
      try {
        current = (localStorage.getItem(KEY) as Theme) || 'system';
      } catch {
        /* ignore */
      }
      if (current === 'system') apply('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* not saved, still applied for this page */
    }
    apply(t);
  }, []);

  return { theme, setTheme };
}
