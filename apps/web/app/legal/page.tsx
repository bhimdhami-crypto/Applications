import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppFooter } from '@/components/AppFooter';
import { COMPANY, copyrightYears, COPYRIGHT_HOLDER, DESIGNER, HR_CONTACT, LEGAL_UPDATED, PRIVACY_CONTACT, PRODUCT } from '@/lib/legal';

export const metadata: Metadata = { title: 'Disclaimer, terms and privacy' };

const SECTIONS = [
  { id: 'disclaimer', title: 'Disclaimer' },
  { id: 'terms', title: 'Terms of use' },
  { id: 'privacy', title: 'Privacy notice' },
  { id: 'copyright', title: 'Copyright and credits' },
];

/** Public page: readable before signing in, linked from the footer of every page. */
export default function LegalPage() {
  return (
    <div className="legal">
      <header className="legal-top">
        <Link href="/" className="legal-brand">
          <span className="tile"><img src="/logo-mark.svg" alt="" /></span>
          <span><strong>mindspace</strong><span>HR and payroll</span></span>
        </Link>
        <Link href="/dashboard" className="button secondary small"><ArrowLeft size={14} /> Back to the portal</Link>
      </header>

      <div className="legal-body">
        <aside className="legal-toc" aria-label="On this page">
          <span className="muted small">On this page</span>
          {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}
        </aside>

        <main className="legal-main">
          <h1>Disclaimer, terms and privacy</h1>
          <p className="muted">Applies to {PRODUCT}, the HR and payroll portal of {COMPANY} and its subsidiaries. Last updated {LEGAL_UPDATED}.</p>

          <section id="disclaimer">
            <h2>Disclaimer</h2>
            <p>
              {PRODUCT} is an internal business system provided to authorised employees, managers and administrators of {COMPANY} and its
              subsidiaries to manage employment records, leave, payroll, loans, benefits, recruitment, performance and related HR processes.
            </p>
            <h3>No professional advice</h3>
            <p>
              Calculations, figures and guidance in the portal, including tax, social security, statutory deductions, leave entitlements and loan
              repayments, are produced from configured rules and the data on record. They are provided to support HR and payroll work and are not
              legal, tax, financial or investment advice. Where the portal marks a rule set as a draft or unverified, it must be confirmed by a
              qualified adviser in the country concerned before it is used for real pay.
            </p>
            <h3>Accuracy of information</h3>
            <p>
              Reasonable care is taken to keep the portal accurate and up to date, but laws, rates and company policies change and data can be
              entered incorrectly. Results depend on the completeness and accuracy of the information recorded. Users are responsible for checking
              figures before they approve, finalise or act on them, and for reporting errors to HR or Payroll promptly. Where the portal and an
              approved company policy or applicable law differ, the policy or the law prevails.
            </p>
            <h3>Official records</h3>
            <p>
              Payslips and documents produced by the portal are computer-generated and need no signature. The payroll and HR records held by the
              company remain the official record. Analytics and reports are management information, not audited statements.
            </p>
            <h3>No warranty and limitation of liability</h3>
            <p>
              The portal is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. To the extent permitted by applicable law, no warranty is given that it will be
              uninterrupted, error-free or free of harmful components, and neither {COMPANY} nor the designer of the portal is liable for indirect
              or consequential loss arising from its use or unavailability. Nothing in this disclaimer limits any right an employee has under
              employment, data protection or other law that cannot be limited by agreement.
            </p>
            <h3>Third-party services</h3>
            <p>
              The portal uses third-party services where needed, such as Cloudflare Turnstile to protect the sign-in page and email delivery for
              sign-in codes and notifications. Their use is subject to those providers&apos; own terms.
            </p>
          </section>

          <section id="terms">
            <h2>Terms of use</h2>
            <ol className="legal-list">
              <li><strong>Authorised use only.</strong> Access is for current employees and people the company has authorised. Use the portal only for legitimate work and HR purposes.</li>
              <li><strong>Your account.</strong> Keep your password and sign-in codes private. Do not share your account or let anyone use your session. Sign out on shared devices and tell IT and HR at once if you think your account has been misused.</li>
              <li><strong>Confidentiality.</strong> Personal, pay and HR information you can see is confidential. Do not copy, export, print or share it except as your role and company policy require. Access is limited by role and every sensitive action is logged.</li>
              <li><strong>Accurate information.</strong> Requests, claims, timesheets, documents and reviews you submit must be true and complete. False or misleading entries may lead to disciplinary action under the Disciplinary and Grievance policy (POL-18).</li>
              <li><strong>Acceptable use.</strong> Follow the Code of Conduct (POL-01), Information Security and Acceptable Use (POL-09) and the Community Page, Chat and Copyright Guidelines (POL-20). Do not attempt to bypass security, access records you are not entitled to, or upload unlawful, offensive or infringing content.</li>
              <li><strong>Monitoring.</strong> Sign-ins, changes and approvals are recorded in an audit trail, and the daily activity tracker records only what is described in POL-21. The company may review these records to protect its people, systems and data.</li>
              <li><strong>Availability and changes.</strong> The portal may be updated, suspended for maintenance or changed at any time. These terms may be updated; continued use after an update means you accept the new version.</li>
              <li><strong>Governing policies and law.</strong> These terms sit alongside your employment contract and company policies. Each subsidiary&apos;s use of the portal is governed by the laws of the country where it is registered.</li>
            </ol>
          </section>

          <section id="privacy">
            <h2>Privacy notice</h2>
            <p>
              {COMPANY} and the subsidiary that employs you are responsible for the personal data held in the portal. It is processed in line with the
              Data Privacy and Protection policy (POL-08) and the data protection laws of each country where the group operates.
            </p>
            <div className="legal-grid">
              <div>
                <h3>What is held</h3>
                <p>Identity and contact details, job and contract details, pay and bank-related deductions, tax and social security numbers, leave and attendance, loans and benefits, next of kin, HR documents, recruitment and performance records, and portal activity logs.</p>
              </div>
              <div>
                <h3>Why</h3>
                <p>To employ you and pay you correctly, meet legal, tax and social security obligations, run HR processes you take part in, keep the workplace and systems secure, and produce management information.</p>
              </div>
              <div>
                <h3>Who can see it</h3>
                <p>Only people whose role needs it: you, HR, Payroll and Finance, administrators, and your manager for the limited job details their role requires. Data is shared outside the company only where law requires it or with service providers bound to protect it.</p>
              </div>
              <div>
                <h3>How long</h3>
                <p>For as long as you work for the group and afterwards for the retention periods set by law and company policy. Leavers&apos; records are kept, not deleted, so they remain available for those periods.</p>
              </div>
            </div>
            <h3>Your rights</h3>
            <p>
              Depending on where you work, you can ask to see, correct or receive a copy of your personal data, and object to or restrict some
              processing. Use form HR-F18 (Data Subject Access Request) or contact <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. You may also
              complain to the data protection authority in your country.
            </p>
            <h3>Cookies and storage</h3>
            <p>
              The portal keeps your sign-in session in your browser tab only, so closing the tab signs you out. It remembers display choices such as
              theme and menu layout in your browser. It does not use advertising or tracking cookies.
            </p>
          </section>

          <section id="copyright">
            <h2>Copyright and credits</h2>
            <p>
              The {PRODUCT} software, including its design, interface, source code, graphics and documentation, is © {copyrightYears()} {COPYRIGHT_HOLDER}.
              All rights reserved. No part of it may be copied, modified, distributed or used outside {COMPANY} and its subsidiaries without written permission.
            </p>
            <p>
              The Mindspace name, logo and company policies are the property of {COMPANY} Employee, payroll and HR data belongs to the company and the
              people it describes. Third-party open-source components are used under their own licences.
            </p>
            <div className="legal-credit">
              <span className="muted small">Designed and created by</span>
              <strong>{DESIGNER}</strong>
            </div>
            <p className="muted small">Questions about these terms: <a href={`mailto:${HR_CONTACT}`}>{HR_CONTACT}</a>.</p>
          </section>
        </main>
      </div>
      <AppFooter />
    </div>
  );
}
