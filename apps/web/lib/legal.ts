// Credits, copyright and legal wording used in the footer, on the sign-in page and on /legal.
// Change names and dates here; every page picks them up.

export const COMPANY = 'Mindspace Artificial Intelligence Inc.';
export const PRODUCT = 'Mindspace HR';
export const DESIGNER = 'Bhim Dhami';
export const COPYRIGHT_HOLDER = 'Bhim Dhami';
export const FIRST_YEAR = 2026;
export const LEGAL_UPDATED = '14 October 2026';
export const PRIVACY_CONTACT = 'privacy@mindspace-ai.com';
export const HR_CONTACT = 'hr@mindspace-ai.com';

/** "2026" in 2026, "2026–2027" from 2027 */
export function copyrightYears(now = new Date()) {
  const y = now.getFullYear();
  return y > FIRST_YEAR ? `${FIRST_YEAR}–${y}` : String(FIRST_YEAR);
}

export const copyrightLine = () => `© ${copyrightYears()} ${COPYRIGHT_HOLDER}. All rights reserved.`;
