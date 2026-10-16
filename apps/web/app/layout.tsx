import { ACCENTS, BRAND, DEFAULT_ACCENT, DEFAULT_THEME, THEME } from '@gpp/shared';
import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import { PrefsProvider } from '@/lib/prefs';
import './globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.shortName, template: `%s · ${BRAND.shortName}` },
  description: `${BRAND.productName}. ${BRAND.developerCredit}.`,
  authors: [{ name: 'Bhim Dhami' }],
  icons: { icon: '/logo.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME.light.sidebar },
    { media: '(prefers-color-scheme: dark)', color: THEME.dark.sidebar },
  ],
};

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const vars = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `--${kebab(k)}:${v};`).join('');

// Design tokens come from the shared package, so the web and mobile apps use the same colours
// Accent presets override the accent colours for each theme; orange is the default
const accents = Object.entries(ACCENTS)
  .map(([key, a]) => `[data-theme=light][data-accent=${key}]{${vars({ ...a.light })}}[data-theme=dark][data-accent=${key}]{${vars({ ...a.dark })}}`)
  .join('');
const tokens = `:root,[data-theme=light]{${vars(THEME.light)}color-scheme:light}[data-theme=dark]{${vars(THEME.dark)}color-scheme:dark}${accents}`;

// Runs before first paint so the page never flashes the wrong theme or text direction
const boot = `(function(){var h=document.documentElement;h.dataset.theme='${DEFAULT_THEME}';h.dataset.accent='${DEFAULT_ACCENT}';try{var a=localStorage.getItem('gpp.accent');if(a)h.dataset.accent=a;var t=localStorage.getItem('gpp.theme')||'${DEFAULT_THEME}';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);h.dataset.theme=d?'dark':'light';var l=localStorage.getItem('gpp.lang');if(l){h.lang=l;h.dir=l==='ar'?'rtl':'ltr';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme={DEFAULT_THEME} data-accent={DEFAULT_ACCENT} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: tokens }} />
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body>
        <PrefsProvider>{children}</PrefsProvider>
      </body>
    </html>
  );
}
