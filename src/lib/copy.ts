// Guardrail strings. Used verbatim (PRD §10). Do not paraphrase.

export const PRIVACY_BADGE =
  'Local-first mode: Your statements and profile stay in this browser. No bank logins. No loan offers.'

/** Only true for a server-side PDF path. This build has none, so the UI explains why it is not shown. */
export const PROCESSING_NOTICE =
  'Uploaded files are processed to extract transactions. This prototype does not retain uploaded files or transaction data.'

export const EDUCATION_DISCLAIMER =
  'Educational cash-flow simulation only. Not investment advice. Runway does not recommend specific securities, funds, or financial products.'

export const SIMULATION_DISCLAIMER =
  'Projections are estimates based on the information and assumptions you provide. Actual outcomes may differ.'

export const SURPLUS_GUIDANCE = 'Keep emergency savings in an accessible, low-risk place appropriate to your needs.'

export const MANDATE_GUIDANCE = 'You can review or manage active mandates through your UPI or banking app.'

/** Where mandates usually live. Named apps are where users look, not a recommendation; no click paths, which change often. */
export const MANDATE_WHERE =
  'In GPay, PhonePe, Paytm and most other UPI apps, active AutoPay mandates are usually listed in the app’s AutoPay or mandates section, where you can pause or revoke them. NACH debits and card standing instructions are managed with your bank or card issuer.'

/**
 * One phrase per idea. Every screen, agent reply and explainer uses these words and no synonyms
 * ("essential burn", "fixed costs", "liquid cash", "current habits" are retired).
 */
export const TERMS = [
  { term: 'Accessible cash', means: 'Savings you could use this week without breaking a deposit, selling or borrowing. You enter it; Runway never reads your balance.' },
  { term: 'Essentials', means: 'What you must pay every month: rent, EMIs, bills, groceries, family support, insurance and getting to work.' },
  { term: 'Flexible spending', means: 'Everything you could cut: dining, delivery, shopping, travel, subscriptions and anything not yet classified.' },
  { term: 'Survival runway', means: 'Months your accessible cash covers essentials if income stopped. The headline number.' },
  { term: 'Lifestyle runway', means: 'Months the same cash lasts if you also keep your flexible spending as it is today.' },
  { term: 'Surplus', means: 'Take-home pay minus essentials and flexible spending. It funds the emergency fund first, then goals.' },
] as const

/**
 * The one-line answer to "who pays?". Draft wording: confirm it matches the pitch before demoing.
 * Kept consistent with the guardrails: no loan commissions, no data sales, no product placement.
 */
export const BUSINESS_MODEL =
  'Free for individuals. Employers pay for it as a financial-wellness benefit for their staff. Lenders never pay: no loan commissions, no data sales.'

/** NPCI's site. Linked at the root on purpose: deep links to mandate pages change. */
export const NPCI_URL = 'https://www.npci.org.in/'
