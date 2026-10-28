import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/ibm-plex-sans';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mindspace HR', template: '%s · Mindspace HR' },
  description: 'HR, payroll and people operations for Mindspace Artificial Intelligence Inc. and its subsidiaries.',
  icons: { icon: '/logo-mark.svg' },
  robots: { index: false, follow: false },
  authors: [{ name: 'Bhim Dhami' }],
  creator: 'Bhim Dhami',
  applicationName: 'Mindspace HR',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f6' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1b1f' },
  ],
};

// Applies the saved theme before the first paint, so dark mode never flashes white.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('mindspace.theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
