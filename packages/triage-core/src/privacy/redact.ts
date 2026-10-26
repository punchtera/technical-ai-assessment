/**
 * Personal-data handling policy (Stage A).
 *
 * - The ORIGINAL text is stored in the database unchanged: it is the evidence
 *   source a reviewer inspects.
 * - A REDACTED copy, with emails and phone numbers replaced by fixed
 *   placeholders, is the only text ever sent to external AI providers.
 * - Quotations returned by providers are verified against the redacted copy
 *   they were given; placeholders never reveal the masked value.
 *
 * Regex masking is a pragmatic baseline, not a guarantee: names, addresses and
 * free-form identifiers are not detected (documented in docs/ai-integration.md).
 */

export const EMAIL_PLACEHOLDER = '[email]';
export const PHONE_PLACEHOLDER = '[phone]';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 8+ digits allowing separators, optional leading +; avoids matching short numbers like "200 hours".
const PHONE = /(?<![\w.])\+?\d(?:[\s().-]*\d){7,14}(?![\w.])/g;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$/;

export interface RedactionSummary {
  email: number;
  phone: number;
}

export interface RedactionResult {
  text: string;
  summary: RedactionSummary;
}

export function redactPersonalData(text: string): RedactionResult {
  let email = 0;
  let phone = 0;
  const withoutEmails = text.replace(EMAIL, () => {
    email += 1;
    return EMAIL_PLACEHOLDER;
  });
  const redacted = withoutEmails.replace(PHONE, (match) => {
    if (DATE_LIKE.test(match.trim())) return match; // ISO dates are not phone numbers
    phone += 1;
    return PHONE_PLACEHOLDER;
  });
  return { text: redacted, summary: { email, phone } };
}

export function mergeSummaries(...summaries: RedactionSummary[]): RedactionSummary {
  return summaries.reduce(
    (acc, s) => ({ email: acc.email + s.email, phone: acc.phone + s.phone }),
    {
      email: 0,
      phone: 0,
    },
  );
}
