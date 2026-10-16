import { BRAND, THEME } from '@gpp/shared';
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
const tokens = `:root,[data-theme=light]{${vars(THEME.light)}color-scheme:light}[data-theme=dark]{${vars(THEME.dark)}color-scheme:dark}`;

// Runs before first paint so the page never flashes the wrong theme or text direction
const boot = `(function(){try{var t=localStorage.getItem('gpp.theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';var l=localStorage.getItem('gpp.lang');if(l){document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
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
