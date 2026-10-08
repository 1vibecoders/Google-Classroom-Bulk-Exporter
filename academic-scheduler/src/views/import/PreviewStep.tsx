// Step 2 of the import: the preview (SCHEDULE_FORMAT.md § 16.2). A summary in
// the style of the requirements' example ("New: + 3 assignments …"), notes,
// the file's warnings, then one collapsible section per category with every
// item, its field-level changes and — for the categories the person decides —
// checkboxes with the plan's defaults. The merged schedule is checked for
// every choice (§ 16.1 step 5); "Import" is enabled only when it is valid.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleDocument, Source } from '../../model/types';
import { SOURCE_KIND_LABELS } from '../../model/constants';
import { checkImport, defaultSelection, planImport, summaryLines, type ImportChange, type ImportCheck, type ImportPlan } from '../../lib/importDiff';
import { recentExportIds } from '../../lib/exportSchedule';
import { formatDateShort, formatTime12, isValidLocalDateTime, splitLocalDateTime } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { ChangeRow } from './ChangeRow';
import { ValidationErrors } from './ValidationErrors';
import {
  buildSections,
  categoryTone,
  deviceTimeZone,
  diffDocuments,
  diffShort,
  isChosen,
  neverSetSettingKeys,
  problemsByRow,
  selectionFor,
  setChoices,
  type Choices,
  type DocDiff,
  type PreviewSection,
} from './logic';
import type { LoadedFile } from './pending';

/** Sections with more rows than this show the first ones and a "Show all" button. */
const ROW_PAGE = 100;

export interface PreviewStepProps {
  loaded: LoadedFile;
  current: ScheduleDocument;
  choices: Choices;
  onChoices: (next: Choices) => void;
  onCancel: () => void;
  onImport: (plan: ImportPlan, selected: Set<string>) => void;
  /** Mark a current session done or skipped (a passed session, § 16.1 step 4). */
  onMarkPassed: (blockId: string, status: 'done' | 'skipped') => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export function PreviewStep({ loaded, current, choices, onChoices, onCancel, onImport, onMarkPassed, headingRef }: PreviewStepProps) {
  const exportIds = useMemo(() => recentExportIds(), []);
  const plan = useMemo(
    () =>
      planImport(current, loaded.incoming, loaded.importTime, {
        knownExportIds: exportIds.length ? exportIds : undefined,
        timezone: deviceTimeZone(),
      }),
    [current, loaded, exportIds],
  );
  const sections = useMemo(() => buildSections(plan), [plan]);
  const selected = useMemo(() => selectionFor(plan, choices), [plan, choices]);
  const check = useMemo<ImportCheck | null>(
    () => (plan.errors.length ? null : checkImport(current, loaded.incoming, plan, selected, loaded.importTime)),
    [current, loaded, plan, selected],
  );
  const diff = useMemo(() => (check ? diffDocuments(current, check.doc) : null), [current, check]);
  // With the default choices, "No changes" is decided by the plan (it ignores what is never stored, e.g. the file's writer fields).
  const atDefaults = useMemo(() => sameKeys(selected, defaultSelection(plan)), [selected, plan]);
  const nothingToImport = !diff?.changed || (plan.noChanges && atDefaults);
  const rowProblems = useMemo(() => problemsByRow(check?.problems ?? []), [check]);
  const labels = useMemo(() => new Map(plan.changes.map((r) => [r.key, r.label])), [plan]);
  const lines = summaryLines(plan);
  const year = Number(loaded.importTime.slice(0, 4)) || undefined;

  const toggle = (key: string, value: boolean) => onChoices(setChoices(choices, [key], value));
  const blockStillPlanned = (id: string) => current.scheduleBlocks.some((b) => b.id === id && (b.status ?? 'planned') === 'planned');

  const reveal = (category: string) => {
    const el = document.getElementById(`imp-sec-${category}`) as HTMLDetailsElement | null;
    if (!el) return;
    el.open = true;
    el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    el.querySelector<HTMLElement>('summary')?.focus();
  };

  if (plan.errors.length) {
    return (
      <div className="imp-preview stack">
        <h2 className="imp-step-title" ref={headingRef} tabIndex={-1}>
          This file can’t be combined with your schedule
        </h2>
        <section className="imp-problem card" aria-labelledby="imp-plan-errors">
          <div className="card-body stack">
            <div role="alert">
              <h3 id="imp-plan-errors" className="imp-problem-title">
                <Icon name="warning" size={18} /> <span>Nothing can be imported from “{loaded.fileName}”</span>
              </h3>
            </div>
            <ValidationErrors errors={plan.errors.map((message) => ({ path: '', message }))} showPaths={false} />
            <p className="small muted" style={{ margin: 0 }}>
              The file is valid on its own, but it uses IDs that mean something else in your schedule. Give your current schedule (Export) to
              /academic-schedule together with this list so that it can write a matching file.
            </p>
            <div className="row">
              <button type="button" className="btn primary" onClick={onCancel}>
                Choose another file
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const actions = (
    <ImportActions plan={plan} check={check} diff={diff} nothing={nothingToImport} onCancel={onCancel} onImport={() => onImport(plan, selected)} />
  );
  const stale = plan.staleBasedOn ? plan.notes.find((n) => n.startsWith('This file was made from an older export')) : undefined;
  const notes = plan.notes.filter((n) => n !== stale);

  return (
    <div className="imp-preview stack">
      <h2 className="visually-hidden" ref={headingRef} tabIndex={-1}>
        Review the changes from “{loaded.fileName}”
      </h2>

      {plan.noChanges ? (
        <div className="banner success" role="status">
          <Icon name="check" />
          <span>
            <strong>No changes.</strong> Everything in this file is already in your schedule, so importing it would change nothing.
            {sections.some((s) => s.toggleKeys.length) ? ' You can still choose optional changes below.' : ''}
          </span>
        </div>
      ) : null}

      {stale ? (
        <div className="banner warning" role="note">
          <Icon name="warning" />
          <span>{stale}</span>
        </div>
      ) : null}

      <section className="card imp-summary" aria-labelledby="imp-summary-title">
        <div className="card-header">
          <h2 id="imp-summary-title">Schedule Import</h2>
          <span className="small muted imp-file-name">{loaded.fileName}</span>
        </div>
        <div className="card-body stack">
          <dl className="imp-lines">
            {lines.map((line) => (
              <div key={line.category} className={`imp-line tone-${categoryTone(line.category)}`}>
                <dt>
                  <button type="button" className="imp-line-link" onClick={() => reveal(line.category)} title={`Show the ${line.label} items`}>
                    {line.label}:
                  </button>
                </dt>
                <dd>
                  {line.parts.map((part, i) => (
                    <span key={i} className="imp-part">
                      {part}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          {actions}
        </div>
      </section>

      <FileInfo loaded={loaded} year={year} plan={plan} latestExportId={exportIds[0]} />

      {notes.length || plan.otherChanges?.length || check?.skipped.length ? (
        <section className="card imp-notes" aria-labelledby="imp-notes-title">
          <div className="card-body stack">
            <h2 id="imp-notes-title" className="imp-subtitle">
              Good to know
            </h2>
            {notes.length ? (
              <ul className="imp-note-list">
                {notes.map((n, i) => (
                  <li key={i}>
                    <Icon name="info" size={14} /> <span>{n}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {plan.otherChanges?.length ? (
              <div>
                <h3 className="imp-mini-title">Also changed by this import</h3>
                <ul className="imp-note-list">
                  {plan.otherChanges.map((n, i) => (
                    <li key={i}>
                      <Icon name="plus" size={14} /> <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {check?.skipped.length ? (
              <div>
                <h3 className="imp-mini-title">Choices that can’t be carried out as ticked</h3>
                <ul className="imp-note-list">
                  {check.skipped.map((s) => (
                    <li key={s.key}>
                      <Icon name="warning" size={14} />
                      <span>
                        <strong>{s.label}</strong>: {s.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {loaded.warnings.length ? (
        <details className="card imp-warnings">
          <summary>
            <Icon name="warning" size={14} />{' '}
            <span>
              {loaded.warnings.length === 1 ? '1 warning' : `${loaded.warnings.length} warnings`} about the file (it can still be imported)
            </span>
          </summary>
          <div className="card-body">
            <ValidationErrors errors={loaded.warnings} tone="warning" />
          </div>
        </details>
      ) : null}

      <div className="imp-sections stack">
        <h2 className="imp-subtitle">Details</h2>
        {sections.map((section) => (
          <Section
            key={section.category}
            section={section}
            choices={choices}
            onChoices={onChoices}
            toggle={toggle}
            problems={rowProblems.byKey}
            labels={labels}
            neverSetKeys={section.category === 'setting' ? neverSetSettingKeys(plan) : []}
            onMarkPassed={(row, status) => onMarkPassed(row.id, status)}
            canMarkPassed={(row) => row.collection === 'scheduleBlocks' && blockStillPlanned(row.id)}
          />
        ))}
      </div>

      <div className="imp-bottom card">
        <div className="card-body">{actions}</div>
      </div>
    </div>
  );
}

function ImportActions({
  plan,
  check,
  diff,
  nothing,
  onCancel,
  onImport,
}: {
  plan: ImportPlan;
  check: ImportCheck | null;
  diff: DocDiff | null;
  /** Importing would change nothing. */
  nothing: boolean;
  onCancel: () => void;
  onImport: () => void;
}) {
  const problems = check?.problems ?? [];
  const general = problemsByRow(problems).general;
  let status: string;
  let tone = '';
  if (!check) {
    status = 'This file can’t be imported.';
    tone = 'error';
  } else if (!check.ok) {
    status = `Can’t import yet: ${problems.length === 1 ? '1 problem' : `${problems.length} problems`} with the result. Untick the highlighted rows, or change those items first.`;
    tone = 'error';
  } else if (nothing || !diff) {
    status = plan.noChanges ? 'Nothing to import: no changes.' : 'Nothing would change with these choices.';
  } else {
    status = `Import will change your schedule: ${diffShort(diff) || 'schedule details (title, sources or issues)'}.`;
  }
  const disabled = !check || !check.ok || nothing;
  return (
    <div className="imp-actions">
      <div className={`imp-actions-status small ${tone}`} aria-live="polite">
        {status}
        {general.length ? (
          <ul className="imp-row-problems">
            {general.map((p, i) => (
              <li key={i}>
                <Icon name="warning" size={12} />{' '}
                <span>
                  {p.path ? <code className="imp-path">{p.path}</code> : null} {p.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="imp-actions-buttons">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={onImport} disabled={disabled}>
          <Icon name="upload" /> Import
        </button>
      </div>
    </div>
  );
}

function Section({
  section,
  choices,
  onChoices,
  toggle,
  problems,
  labels,
  neverSetKeys,
  onMarkPassed,
  canMarkPassed,
}: {
  section: PreviewSection;
  choices: Choices;
  onChoices: (next: Choices) => void;
  toggle: (key: string, value: boolean) => void;
  problems: Map<string, string[]>;
  labels: Map<string, string>;
  neverSetKeys: string[];
  onMarkPassed: (row: ImportChange, status: 'done' | 'skipped') => void;
  canMarkPassed: (row: ImportChange) => boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const { category, rows, toggleKeys } = section;
  const hasProblems = rows.some((r) => problems.has(r.key));
  const decides = toggleKeys.length > 0;
  // Open state is the person's after the first render; a section only opens by itself when a problem appears in it.
  const [initiallyOpen] = useState(() => hasProblems || decides || ((category === 'new' || category === 'updated') && rows.length <= 40));
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (hasProblems && detailsRef.current) detailsRef.current.open = true;
  }, [hasProblems]);
  const chosenCount = rows.filter((r) => isChosen(r, choices)).length;
  const visible = showAll ? rows : rows.slice(0, ROW_PAGE);
  const titleId = `imp-sec-${category}-title`;

  return (
    <details ref={detailsRef} id={`imp-sec-${category}`} className={`card imp-section cat-${category}`} open={initiallyOpen}>
      <summary>
        <span className="imp-section-title" id={titleId}>
          {section.label}
        </span>
        <span className="badge">{rows.length}</span>
        {decides ? (
          <span className="small muted imp-section-chosen">
            {chosenCount} of {toggleKeys.length} ticked
          </span>
        ) : null}
        {hasProblems ? (
          <span className="badge danger">
            <Icon name="warning" size={12} /> Needs attention
          </span>
        ) : null}
      </summary>
      <div className="card-body stack">
        <p className="small muted" style={{ margin: 0 }}>
          {section.help}
        </p>
        {decides && toggleKeys.length > 1 ? (
          <div className="row imp-select-all" role="group" aria-label={`Choose all ${section.label} rows`}>
            <button type="button" className="btn small" onClick={() => onChoices(setChoices(choices, toggleKeys, true))}>
              Select all
            </button>
            <button type="button" className="btn small" onClick={() => onChoices(setChoices(choices, toggleKeys, false))}>
              Select none
            </button>
            {neverSetKeys.length ? (
              <button type="button" className="btn small" onClick={() => onChoices(setChoices(choices, neverSetKeys, true))}>
                Use the file’s values for the {neverSetKeys.length === 1 ? 'setting' : `${neverSetKeys.length} settings`} you never set
              </button>
            ) : null}
          </div>
        ) : null}
        <ul className="imp-rows" aria-labelledby={titleId}>
          {visible.map((row) => (
            <ChangeRow
              key={row.key}
              row={row}
              chosen={isChosen(row, choices)}
              onToggle={toggle}
              problems={problems.get(row.key)}
              parentLabel={row.parentId ? labels.get(`assignments:${row.parentId}`) : undefined}
              onMarkPassed={row.passed && canMarkPassed(row) ? (status) => onMarkPassed(row, status) : undefined}
            />
          ))}
        </ul>
        {rows.length > visible.length ? (
          <button type="button" className="btn small ghost" onClick={() => setShowAll(true)}>
            Show all {rows.length}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function sameKeys(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

function formatLdtShort(value: string, year?: number): string {
  if (!isValidLocalDateTime(value)) return value;
  const { date, time } = splitLocalDateTime(value);
  return `${formatDateShort(date, year)}, ${formatTime12(time)}`;
}

function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function FileInfo({ loaded, year, plan, latestExportId }: { loaded: LoadedFile; year?: number; plan: ImportPlan; latestExportId?: string }) {
  const meta = loaded.incoming.meta ?? {};
  const sources: Source[] = meta.sources ?? [];
  const facts: string[] = [];
  if (meta.generator?.name) facts.push(`Made by ${meta.generator.name}${meta.generator.version ? ` ${meta.generator.version}` : ''}`);
  if (meta.generatedAt) facts.push(`on ${formatLdtShort(meta.generatedAt, year)}`);
  if (meta.timezone) facts.push(`time zone ${meta.timezone}`);
  const basis = plan.fresh
    ? 'Made without your current schedule: planned work it does not contain is kept unless you remove it.'
    : plan.staleBasedOn
      ? 'Made from an older export of your schedule.'
      : meta.basedOn
        ? meta.basedOn === latestExportId
          ? 'Made from your latest export of this schedule.'
          : // This browser has no record of that export (e.g. it was made on another device).
            'Made from an export of a schedule that this browser has no record of (perhaps from another device).'
        : undefined;
  const requested = meta.requestedChanges?.length ?? 0;

  return (
    <details className="card imp-file">
      <summary>
        <Icon name="file" size={14} /> <span className="imp-file-title">{meta.title ? meta.title : 'About this file'}</span>
        <span className="small muted"> · {loaded.fileName}</span>
      </summary>
      <div className="card-body stack">
        {facts.length ? <p style={{ margin: 0 }}>{facts.join(' · ')}.</p> : null}
        {basis ? <p style={{ margin: 0 }}>{basis}</p> : null}
        {requested ? (
          <p style={{ margin: 0 }}>
            The file asks to change {requested === 1 ? '1 of your own items' : `${requested} of your own items`}; see “Changes to your items”.
          </p>
        ) : null}
        {sources.length ? (
          <div>
            <h3 className="imp-mini-title">Made from {sources.length === 1 ? '1 source' : `${sources.length} sources`}</h3>
            <ul className="imp-sources">
              {sources.map((s, i) => {
                const href = safeUrl(s.url);
                const name = s.label || s.path || s.url || s.id || SOURCE_KIND_LABELS[s.kind];
                return (
                  <li key={i}>
                    <span className="badge">{SOURCE_KIND_LABELS[s.kind] ?? s.kind}</span>{' '}
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {name}
                      </a>
                    ) : (
                      <span>{name}</span>
                    )}
                    {s.retrievedAt && isValidLocalDateTime(s.retrievedAt) ? (
                      <span className="small muted"> · retrieved {formatDateShort(s.retrievedAt.slice(0, 10), year)}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
