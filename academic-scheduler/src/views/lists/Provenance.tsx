// Where an item came from and who controls it: origin, source(s), the
// person's kept edits (`overrides`, § 6.3), pinning (`locked`, § 6.2) and
// the assignment's sourceState badge (§ 8).
import { SOURCE_STATE_LABELS } from '../../model/constants';
import type { CollectionName, ItemBase, Source, SourceState } from '../../model/types';
import { useStore } from '../../state/store';
import { Icon } from '../../ui/Icon';
import { describeFields, originLabel, safeHref, sourceSummary } from './format';

export function SourceStateBadge({ state }: { state: SourceState | undefined }) {
  if (!state || state === 'present') return null;
  const text = SOURCE_STATE_LABELS[state];
  const title =
    state === 'withdrawn'
      ? 'The source removed, cancelled or excused this work. It is not counted in remaining work unless you mark it in progress.'
      : 'This work was not found in a newer export of its source. It is not counted in remaining work unless you mark it in progress.';
  return (
    <span className={`badge ${state === 'withdrawn' ? 'danger' : 'warning'}`} title={title}>
      <Icon name="info" size={12} />
      {text}
    </span>
  );
}

/** Compact indicators for a row: pinned, kept edits. */
export function ControlBadges({ item }: { item: Pick<ItemBase, 'origin' | 'locked' | 'overrides'> }) {
  const overrides = (item.origin ?? 'generated') !== 'user' ? item.overrides || [] : [];
  return (
    <>
      {item.locked ? (
        <span className="badge" title="Pinned: /academic-schedule will not change, move or delete it.">
          <Icon name="lock" size={12} />
          Pinned
        </span>
      ) : null}
      {overrides.length ? (
        <span className="badge" title={`Your changes to the ${describeFields(overrides)} are kept when /academic-schedule updates the schedule.`}>
          <Icon name="edit" size={12} />
          Edited
        </span>
      ) : null}
    </>
  );
}

export function SourceLine({ source, currentYear }: { source: Source; currentYear?: number }) {
  const href = safeHref(source.url);
  return (
    <li>
      <span>{sourceSummary(source, currentYear)}</span>
      {href ? (
        <>
          {' · '}
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open source
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </>
      ) : null}
      {source.label && source.path ? <div className="mono small muted ls-path">{source.path}</div> : null}
    </li>
  );
}

/**
 * Origin, sources and the controls to pin an item or let /academic-schedule
 * update overridden fields again.
 */
export function ProvenancePanel({ item, collection, currentYear }: { item: ItemBase; collection: CollectionName; currentYear?: number }) {
  const { dispatch } = useStore();
  const origin = item.origin ?? 'generated';
  const overrides = origin !== 'user' ? item.overrides || [] : [];
  const sources = [item.source, ...(item.sources || [])].filter((s): s is Source => !!s);
  return (
    <div className="ls-provenance">
      <div className="row small">
        <span className="badge">{originLabel(origin)}</span>
        {item.locked ? (
          <span className="badge">
            <Icon name="lock" size={12} /> Pinned
          </span>
        ) : null}
        <button
          type="button"
          className="btn small ghost"
          onClick={() => dispatch({ type: 'setLocked', collection, id: item.id, locked: !item.locked })}
        >
          <Icon name={item.locked ? 'unlock' : 'lock'} size={14} />
          {item.locked ? 'Unpin' : 'Pin'}
        </button>
      </div>
      {item.locked ? <p className="small muted">Pinned: /academic-schedule will not change, move or delete it.</p> : null}
      {overrides.length ? (
        <div className="row small">
          <span className="muted">You changed the {describeFields(overrides)}; /academic-schedule keeps your values.</span>
          <button type="button" className="btn small ghost" onClick={() => dispatch({ type: 'clearOverrides', collection, id: item.id })}>
            <Icon name="undo" size={14} /> Allow /academic-schedule to update this again
          </button>
        </div>
      ) : null}
      {sources.length ? (
        <div>
          <span className="small muted">{sources.length === 1 ? 'Source' : 'Sources'}</span>
          <ul className="ls-sources small">
            {sources.map((s, i) => (
              <SourceLine key={i} source={s} currentYear={currentYear} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
