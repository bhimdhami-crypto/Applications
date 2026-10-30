import '@fontsource-variable/ibm-plex-sans';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MFI ERP',
  description: 'General ledger, approvals and document archive for MFI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
