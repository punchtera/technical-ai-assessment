export interface TextSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Splits `text` around exact occurrences of the given quotations so they can
 * be marked. Quotations come verbatim from the API; nothing is paraphrased or
 * fuzzily matched. Quotations not found exactly are simply not highlighted.
 */
export function highlightQuotes(text: string, quotes: readonly string[]): TextSegment[] {
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    if (!quote) continue;
    let from = 0;
    for (;;) {
      const index = text.indexOf(quote, from);
      if (index === -1) break;
      ranges.push([index, index + quote.length]);
      from = index + quote.length;
    }
  }
  if (ranges.length === 0) return [{ text, highlighted: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
