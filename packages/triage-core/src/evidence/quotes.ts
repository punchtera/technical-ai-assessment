/**
 * Deterministic quotation-fidelity checks. A quotation is valid only if it is
 * an exact substring of the text it claims to come from — no normalisation,
 * no fuzzy matching. Invalid quotations are reported, never silently kept.
 */

export interface QuoteCheck {
  ref: string;
  quote: string;
  valid: boolean;
  reason?: 'unknown_source' | 'not_found' | 'too_short';
}

/** Quotes shorter than this are too weak to count as evidence ("a", "the"). */
export const MIN_QUOTE_LENGTH = 3;

export function checkQuote(
  sources: ReadonlyMap<string, string>,
  ref: string,
  quote: string,
): QuoteCheck {
  const source = sources.get(ref);
  if (source === undefined) return { ref, quote, valid: false, reason: 'unknown_source' };
  if (quote.trim().length < MIN_QUOTE_LENGTH)
    return { ref, quote, valid: false, reason: 'too_short' };
  return source.includes(quote)
    ? { ref, quote, valid: true }
    : { ref, quote, valid: false, reason: 'not_found' };
}

export function checkQuotes(
  sources: ReadonlyMap<string, string>,
  quotes: readonly { ref: string; quote: string }[],
): { checks: QuoteCheck[]; allValid: boolean } {
  const checks = quotes.map((q) => checkQuote(sources, q.ref, q.quote));
  return { checks, allValid: checks.every((c) => c.valid) };
}
