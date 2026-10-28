import Link from 'next/link';
import { copyrightLine, DESIGNER } from '@/lib/legal';

/** Copyright, credit and legal links shown at the bottom of every page. */
export function AppFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`app-footer${compact ? ' compact' : ''}`}>
      <span>{copyrightLine()}</span>
      <span className="credit">
        Designed and created by <strong>{DESIGNER}</strong>
      </span>
      <nav aria-label="Legal">
        <Link href="/legal#disclaimer">Disclaimer</Link>
        <Link href="/legal#terms">Terms of use</Link>
        <Link href="/legal#privacy">Privacy notice</Link>
        <Link href="/legal#copyright">Copyright</Link>
      </nav>
    </footer>
  );
}
