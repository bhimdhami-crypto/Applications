/** Product naming and the developer credit, shown on every screen, payslip and export. */
export const BRAND = {
  productName: 'Global People & Payroll Enterprise Platform',
  shortName: 'Mindspace Portal',
  demoGroupName: 'Mindspace Artificial Intelligence Inc.',
  developerCredit: 'Designed and developed by Bhim Dhami',
  copyright: (year = new Date().getFullYear()) => `© ${year} Bhim Dhami. All rights reserved.`,
  disclaimer:
    'Demonstration system. All people, companies and figures are fictional. Statutory rules are unverified until approved by a qualified local specialist.',
} as const;
