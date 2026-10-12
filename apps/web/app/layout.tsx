import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mindspace HR Portal',
  description: 'HR and payroll for Mindspace Artificial Intelligence Inc.',
  icons: { icon: '/logo.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
