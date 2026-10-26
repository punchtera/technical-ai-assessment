import type { EvidenceQuoteView } from '@fis/contracts';
import { Link } from 'react-router';
import { highlightQuotes } from '../lib/highlight';

function SourceLabel({ source }: { source: EvidenceQuoteView['source'] }) {
  switch (source.kind) {
    case 'request':
      return <>this request · {source.field}</>;
    case 'group_need':
      return (
        <>
          group need statement · <Link to={`/groups/${source.groupId}`}>open group</Link>
        </>
      );
    case 'member_request':
      return (
        <>
          approved member request · <Link to={`/requests/${source.requestId}`}>open request</Link>
        </>
      );
    default:
      return <>unknown source</>;
  }
}

/** Quotations exactly as returned by the API, with their verification result and source. */
export function EvidenceList({
  items,
  emptyText,
}: {
  items: EvidenceQuoteView[];
  emptyText: string;
}) {
  if (items.length === 0) return <p className="muted">{emptyText}</p>;
  return (
    <ul className="evidence">
      {items.map((item, index) => (
        <li
          key={`${item.ref}-${index}`}
          className={item.valid ? 'evidence__item' : 'evidence__item evidence__item--invalid'}
        >
          <blockquote>“{item.quote}”</blockquote>
          <div className="evidence__meta">
            <SourceLabel source={item.source} />
            {item.valid ? (
              <span className="badge badge--ok">verified verbatim</span>
            ) : (
              <span className="badge badge--failed">not found in source — not trusted</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Renders text with exact occurrences of verified quotations highlighted. */
export function HighlightedText({ text, quotes }: { text: string; quotes: string[] }) {
  return (
    <p className="source-text">
      {highlightQuotes(text, quotes).map((segment, index) =>
        segment.highlighted ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
