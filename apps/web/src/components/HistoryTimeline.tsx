import type { RequestHistory } from '@fis/contracts';
import { Link } from 'react-router';
import { actorLabel, buildHistory, type EntryKind } from '../lib/history';

const KIND_LABEL: Record<EntryKind, string> = {
  system: 'System',
  recommendation: 'Recommendation',
  decision: 'Human decision',
  reversal: 'Reversal',
  activity: 'Activity',
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export function HistoryTimeline({ history }: { history: RequestHistory }) {
  const entries = buildHistory(history);
  if (entries.length === 0) return <p className="muted">No recorded events.</p>;
  return (
    <ol className="timeline" aria-label="Audit history">
      {entries.map((entry) => (
        <li key={entry.id} className={`timeline__item timeline__item--${entry.kind}`}>
          <div className="timeline__head">
            <span className={`kind kind--${entry.kind}`}>{KIND_LABEL[entry.kind]}</span>
            <strong>{entry.title}</strong>
          </div>
          <div className="timeline__meta">
            <time dateTime={entry.at}>{formatTime(entry.at)}</time> · {actorLabel(entry.actor)}
            {entry.groupId && (
              <>
                {' '}
                · <Link to={`/groups/${entry.groupId}`}>group</Link>
              </>
            )}
          </div>
          {entry.detail && <div className="timeline__detail">{entry.detail}</div>}
          {entry.note && <div className="timeline__note">Note: {entry.note}</div>}
        </li>
      ))}
    </ol>
  );
}
