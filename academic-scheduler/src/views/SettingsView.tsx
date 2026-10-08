// Settings and data: scheduling preferences (with what each one means), data
// management (export, import, example schedule, undo history, delete all),
// where the data lives, and what this website is (no AI, offline, format).
import { useMemo, useState } from 'react';
import example from '../../examples/complete-schedule.json';
import { APP_VERSION, COLLECTION_LABELS, SCHEMA_VERSION, resolveSettings } from '../model/constants';
import type { ScheduleDocument } from '../model/types';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { Icon } from '../ui/Icon';
import { NumberField, SelectField, TimeField } from '../ui/fields';
import { routeToHash } from '../router';
import { createExport, rememberExportId } from '../lib/exportSchedule';
import { downloadText } from '../lib/download';
import { validateDocument } from '../lib/validate';
import { formatDateLong, formatDuration, isValidLocalDateTime, nowLocal } from '../lib/time';
import { DeleteAllDialog } from './lists/DeleteAllDialog';
import { SourceLine } from './lists/Provenance';
import { formatClockTime, formatLdt, plural, snapshotId } from './lists/format';
import { draftFrom, sameDraft, settingsFromDraft, timeOptions, validateDraft, type SettingsDraft } from './lists/settingsModel';
import '../styles/lists.css';

export const FORMAT_SPEC_URL = 'https://github.com/1vibecoders/Google-Classroom-Bulk-Exporter/blob/main/academic-scheduler/SCHEDULE_FORMAT.md';
const EXAMPLE_FIRST_DAY = '2026-10-13';

function docSummary(doc: ScheduleDocument): string {
  const parts = [
    plural(doc.classes.length, 'class', 'classes'),
    plural(doc.assignments.length, 'assignment'),
    plural(doc.events.length, 'event'),
    plural(doc.availability.length, COLLECTION_LABELS.availability.one, COLLECTION_LABELS.availability.many),
    plural(doc.scheduleBlocks.length, 'scheduled session'),
  ];
  return parts.join(', ');
}

function storageSize(value: unknown): string {
  try {
    const bytes = new Blob([JSON.stringify(value)]).size;
    return bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  } catch {
    return 'unknown size';
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function SettingsForm() {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const saved = useMemo(() => draftFrom(resolveSettings(doc.settings)), [doc.settings]);
  const [draft, setDraft] = useState<SettingsDraft>(saved);
  const [base, setBase] = useState<SettingsDraft>(saved);
  // Another change (import, another tab) replaced the settings: start from them.
  if (!sameDraft(base, saved)) {
    setBase(saved);
    setDraft(saved);
  }
  const errors = validateDraft(draft);
  const valid = Object.keys(errors).length === 0;
  const dirty = !sameDraft(draft, saved);
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    if (!valid || !dirty) return;
    dispatch({ type: 'updateSettings', settings: settingsFromDraft(draft, doc.settings) });
    notify('Settings saved.', { tone: 'success' });
  };

  const resetDefaults = () => {
    dispatch({
      type: 'updateSettings',
      settings: {
        weekStartsOn: undefined,
        dayStartTime: undefined,
        dayEndTime: undefined,
        defaultDueTime: undefined,
        minSessionMinutes: undefined,
        maxSessionMinutes: undefined,
        breakMinutes: undefined,
        maxDailyStudyMinutes: undefined,
      },
    });
    notify('Settings reset to the defaults.', { tone: 'success' });
  };

  const startOptions = timeOptions(0, 23 * 60 + 30, draft.dayStartTime).map((t) => ({ value: t, label: formatClockTime(t) }));
  const endOptions = timeOptions(30, 24 * 60, draft.dayEndTime).map((t) => ({ value: t, label: t === '24:00' ? 'Midnight (end of day)' : formatClockTime(t) }));

  return (
    <section className="card" aria-labelledby="prefs-head">
      <div className="card-header">
        <h2 id="prefs-head" style={{ flex: 1 }}>
          Scheduling preferences
        </h2>
        {dirty ? <span className="badge warning">Unsaved changes</span> : null}
      </div>
      <form
        className="card-body stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        <fieldset className="ls-fieldset">
          <legend>Calendar</legend>
          <div className="form-grid">
            <SelectField
              label="Week starts on"
              value={draft.weekStartsOn}
              onChange={(v) => set('weekStartsOn', v === 'sunday' ? 'sunday' : 'monday')}
              options={[
                { value: 'monday', label: 'Monday' },
                { value: 'sunday', label: 'Sunday' },
              ]}
              hint="First column of the week view; also decides what “this week” means."
            />
            <div className="ls-spacer" aria-hidden="true" />
            <SelectField
              label="Day view starts at"
              value={draft.dayStartTime}
              onChange={(v) => set('dayStartTime', v)}
              options={startOptions}
              error={errors.dayStartTime}
            />
            <SelectField
              label="Day view ends at"
              value={draft.dayEndTime}
              onChange={(v) => set('dayEndTime', v)}
              options={endOptions}
              error={errors.dayEndTime}
              hint="Timelines show this range and grow to fit anything outside it."
            />
          </div>
        </fieldset>

        <fieldset className="ls-fieldset">
          <legend>Due dates without a time</legend>
          <div className="form-grid">
            <TimeField
              label="Treat date-only due dates as due at"
              value={draft.defaultDueTime}
              onChange={(v) => set('defaultDueTime', v)}
              error={errors.defaultDueTime}
              step={60}
            />
            <div className="row ls-due-presets">
              <button type="button" className="btn small" aria-pressed={draft.defaultDueTime === '00:00'} onClick={() => set('defaultDueTime', '00:00')}>
                Start of the day (00:00)
              </button>
              <button type="button" className="btn small" aria-pressed={draft.defaultDueTime === '23:59'} onClick={() => set('defaultDueTime', '23:59')}>
                End of the day (23:59)
              </button>
            </div>
          </div>
          <p className="small muted ls-explain-text">
            Some due dates come without a time (for example “due Oct 13”). For planning and warnings they are treated as due at this time on that day. The
            default, <strong>00:00</strong>, means <strong>date-only due dates are treated as due at the start of that day</strong>, so the work is planned to
            be finished by the end of the day before — the safe choice when you do not know the time. Choose 23:59 to plan up to the end of the due date. Dates
            are always shown as given, without a time.
          </p>
        </fieldset>

        <fieldset className="ls-fieldset">
          <legend>Planning work sessions</legend>
          <p className="small muted ls-explain-text">
            Used by “Plan unscheduled work” and expected from schedules made by /academic-schedule. Sessions you place yourself can be any length.
          </p>
          <div className="form-grid">
            <NumberField
              label="Shortest session"
              value={draft.minSessionMinutes}
              onChange={(v) => set('minSessionMinutes', v)}
              min={5}
              max={240}
              step={5}
              suffix="minutes"
              error={errors.minSessionMinutes}
              hint="Smaller pieces of work are rounded up to one session."
            />
            <NumberField
              label="Longest session"
              value={draft.maxSessionMinutes}
              onChange={(v) => set('maxSessionMinutes', v)}
              min={10}
              max={480}
              step={5}
              suffix="minutes"
              error={errors.maxSessionMinutes}
              hint="Longer work is split over several sessions."
            />
            <NumberField
              label="Break between sessions"
              value={draft.breakMinutes}
              onChange={(v) => set('breakMinutes', v)}
              min={0}
              max={120}
              step={5}
              suffix="minutes"
              error={errors.breakMinutes}
            />
            <NumberField
              label="Most work per day"
              value={draft.maxDailyStudyMinutes}
              onChange={(v) => set('maxDailyStudyMinutes', v)}
              min={0}
              max={1440}
              step={15}
              suffix="minutes"
              error={errors.maxDailyStudyMinutes}
              hint={
                draft.maxDailyStudyMinutes === ''
                  ? 'Empty = no daily limit.'
                  : `${formatDuration(Number(draft.maxDailyStudyMinutes) || 0)} per day. Leave empty for no limit.`
              }
            />
          </div>
        </fieldset>

        <div className="row ls-form-actions">
          <button type="submit" className="btn primary" disabled={!valid || !dirty}>
            <Icon name="check" /> Save settings
          </button>
          {dirty ? (
            <button type="button" className="btn ghost" onClick={() => setDraft(saved)}>
              Discard changes
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn ghost small" onClick={resetDefaults} disabled={!doc.settings || Object.keys(doc.settings).length === 0}>
            Reset to defaults
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function DataPanel() {
  const { state, dispatch, notify, storageProblem } = useStore();
  const confirm = useConfirm();
  const doc = state.doc;
  const [deleting, setDeleting] = useState(false);
  const [exampleLoaded, setExampleLoaded] = useState(false);
  const year = Number(nowLocal().slice(0, 4));
  const summary = docSummary(doc);
  const size = useMemo(() => storageSize(state), [state]);
  const isEmpty = doc.classes.length + doc.assignments.length + doc.events.length + doc.availability.length + doc.scheduleBlocks.length === 0;

  const exportNow = () => {
    const result = createExport(doc, nowLocal());
    downloadText(result.fileName, result.json);
    rememberExportId(result.exportId);
    if (result.problems.length > 0) {
      notify(`Exported, but the file has ${plural(result.problems.length, 'problem')} (${result.problems[0].path}: ${result.problems[0].message}).`, {
        tone: 'warning',
      });
    } else {
      notify(`Saved ${result.fileName}.`, { tone: 'success' });
    }
  };

  const loadExample = async () => {
    const ok = await confirm({
      title: 'Load the example schedule?',
      confirmLabel: 'Load example',
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>
            The example replaces your current schedule{isEmpty ? '' : ` (${summary})`}. You can undo this afterwards from the undo history on this page.
          </p>
          <p style={{ margin: 0 }}>
            It shows a student’s week of <strong>October 12, 2026</strong>: English, Biology, school and activities, study time and planned sessions. Its dates
            are in October 2026, so open that week in the day or week view to see it.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    const result = validateDocument(example as unknown);
    if (!result.ok || !result.doc) {
      notify(`The example could not be loaded (${result.errors[0]?.message ?? 'invalid'}).`, { tone: 'error' });
      return;
    }
    const id = snapshotId();
    dispatch({ type: 'replaceDocument', doc: result.doc, label: 'Before loading the example schedule', now: nowLocal(), snapshotId: id });
    setExampleLoaded(true);
    notify('Example schedule loaded (week of Oct 12, 2026).', {
      tone: 'success',
      action: { label: 'Undo', run: () => dispatch({ type: 'undo', snapshotId: id }) },
    });
  };

  const restore = async (id: string) => {
    const snapshot = state.snapshots.find((s) => s.id === id);
    if (!snapshot) return;
    const ok = await confirm({
      title: 'Restore this version?',
      confirmLabel: 'Restore',
      message: (
        <p style={{ margin: 0 }}>
          Your schedule goes back to the copy saved{isValidLocalDateTime(snapshot.createdAt) ? ` on ${formatLdt(snapshot.createdAt, year)}` : ''} (“
          {snapshot.label}”). The current version is kept in the undo history, so you can switch back.
        </p>
      ),
    });
    if (!ok) return;
    dispatch({ type: 'replaceDocument', doc: snapshot.doc, label: 'Before restoring an earlier version', now: nowLocal(), snapshotId: snapshotId() });
    notify('Earlier version restored.', { tone: 'success' });
  };

  return (
    <section className="card" aria-labelledby="data-head">
      <div className="card-header">
        <h2 id="data-head" style={{ flex: 1 }}>
          Your data
        </h2>
      </div>
      <div className="card-body stack">
        <p className="small" style={{ margin: 0 }}>
          {isEmpty ? 'Your schedule is empty.' : `Your schedule: ${summary}.`}
        </p>

        <div className="ls-data-actions">
          <div className="ls-data-action">
            <button type="button" className="btn primary" onClick={exportNow}>
              <Icon name="download" /> Export schedule
            </button>
            <span className="small muted">A schedule file (JSON) to keep as a backup, move to another device, or give to /academic-schedule.</span>
          </div>
          <div className="ls-data-action">
            <a className="btn" href={routeToHash({ name: 'import' })}>
              <Icon name="upload" /> Import a schedule file
            </a>
            <span className="small muted">Preview what changes before anything is imported.</span>
          </div>
          <div className="ls-data-action">
            <button type="button" className="btn" onClick={() => void loadExample()}>
              <Icon name="file" /> Load example schedule
            </button>
            <span className="small muted">See the website with realistic data (dates in October 2026). Replaces your schedule; undoable.</span>
          </div>
        </div>

        {exampleLoaded ? (
          <div className="banner success" role="status">
            <Icon name="check" />
            <span>
              Example loaded. Its week starts on Monday, Oct 12, 2026:{' '}
              <a href={routeToHash({ name: 'day', date: EXAMPLE_FIRST_DAY })}>open {formatDateLong(EXAMPLE_FIRST_DAY)}</a> or{' '}
              <a href={routeToHash({ name: 'week', date: EXAMPLE_FIRST_DAY })}>that week</a>.
            </span>
          </div>
        ) : null}

        <div>
          <h3 className="ls-subhead">Undo history</h3>
          {state.snapshots.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Nothing to undo yet. A copy of your schedule is kept here before each import, example load or delete-all (the last 5).
            </p>
          ) : (
            <ul className="ls-snapshots">
              {state.snapshots.map((s) => (
                <li key={s.id}>
                  <div>
                    <div>{s.label}</div>
                    <div className="small muted">
                      {isValidLocalDateTime(s.createdAt) ? formatLdt(s.createdAt, year) : ''} · {docSummary(s.doc)}
                    </div>
                  </div>
                  <button type="button" className="btn small" onClick={() => void restore(s.id)}>
                    <Icon name="undo" size={14} /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="ls-subhead">Stored in this browser</h3>
          <p className="small muted" style={{ margin: 0 }}>
            Your schedule is saved only in this browser on this device ({size}). It is never uploaded. Clearing this site’s data in your browser
            deletes it, so export a backup now and then.
            {doc.deleted && doc.deleted.length
              ? ` ${plural(doc.deleted.length, 'item')} you deleted from imported schedules ${doc.deleted.length === 1 ? 'is' : 'are'} remembered so that later imports do not add ${doc.deleted.length === 1 ? 'it' : 'them'} again.`
              : ''}
          </p>
          {storageProblem ? (
            <div className="banner warning" role="alert" style={{ marginTop: 8 }}>
              <Icon name="warning" /> {storageProblem}
            </div>
          ) : null}
        </div>

        <div className="ls-danger-zone">
          <div>
            <h3 className="ls-subhead">Delete all data</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Removes every class, assignment, event, study time and session, and your settings.
            </p>
          </div>
          <button type="button" className="btn danger" onClick={() => setDeleting(true)} disabled={isEmpty && !doc.settings && !doc.meta}>
            <Icon name="trash" /> Delete all data…
          </button>
        </div>
      </div>
      {deleting ? <DeleteAllDialog onClose={() => setDeleting(false)} onExport={exportNow} summary={summary} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function ScheduleInfo() {
  const { state } = useStore();
  const meta = state.doc.meta;
  if (!meta || (!meta.title && !meta.generator && !meta.sources?.length)) return null;
  const year = Number(nowLocal().slice(0, 4));
  return (
    <section className="card" aria-labelledby="info-head">
      <div className="card-header">
        <h2 id="info-head">About this schedule</h2>
      </div>
      <div className="card-body stack">
        <dl className="ls-facts">
          {meta.title ? (
            <div className="ls-fact">
              <dt>Title</dt>
              <dd>{meta.title}</dd>
            </div>
          ) : null}
          {meta.generator ? (
            <div className="ls-fact">
              <dt>Last written by</dt>
              <dd>
                {meta.generator.name}
                {meta.generator.version ? ` ${meta.generator.version}` : ''}
                {meta.generatedAt && isValidLocalDateTime(meta.generatedAt) ? `, ${formatLdt(meta.generatedAt, year)}` : ''}
              </dd>
            </div>
          ) : null}
          {meta.timezone ? (
            <div className="ls-fact">
              <dt>Time zone</dt>
              <dd>{meta.timezone}</dd>
            </div>
          ) : null}
        </dl>
        {meta.sources && meta.sources.length ? (
          <div>
            <h3 className="ls-subhead">Made from</h3>
            <ul className="ls-sources small">
              {meta.sources.map((s, i) => (
                <SourceLine key={i} source={s} currentYear={year} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="card" aria-labelledby="about-head">
      <div className="card-header">
        <h2 id="about-head">About Academic Scheduler</h2>
      </div>
      <div className="card-body stack ls-about">
        <div className="ls-about-point">
          <Icon name="info" />
          <div>
            <strong>No AI in this website.</strong> It does not read or interpret your assignments, estimate workloads or make decisions with an AI model. Free
            time, remaining work and “Plan unscheduled work” are fixed arithmetic on the data you entered or imported — the same input always gives the same
            result.
          </div>
        </div>
        <div className="ls-about-point">
          <Icon name="wand" />
          <div>
            <strong>The AI part is separate.</strong> The /academic-schedule Claude skill reads your Google Classroom export and other materials and writes a
            schedule file. You import that file here, review the preview, and stay in control of every change.
          </div>
        </div>
        <div className="ls-about-point">
          <Icon name="lock" />
          <div>
            <strong>Private and offline.</strong> No account, no tracking, no network requests: your schedule stays in this browser. The website works offline
            once it has loaded.
          </div>
        </div>
        <div className="ls-about-point">
          <Icon name="file" />
          <div>
            <strong>Schedule format {SCHEMA_VERSION}.</strong> Imports and exports use the documented schedule file format (
            <span className="mono">"schemaVersion": "{SCHEMA_VERSION}"</span>
            ). Read the{' '}
            <a href={FORMAT_SPEC_URL} target="_blank" rel="noopener noreferrer">
              format specification (SCHEDULE_FORMAT.md)
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            .
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Academic Scheduler {APP_VERSION}
        </p>
      </div>
    </section>
  );
}

export function SettingsView() {
  return (
    <div className="lists-page">
      <div className="page-header">
        <div>
          <h1>Settings and data</h1>
          <div className="page-subtitle">Preferences, backups and how your data is handled.</div>
        </div>
      </div>
      <div className="ls-settings-grid">
        <SettingsForm />
        <div className="stack">
          <DataPanel />
          <ScheduleInfo />
          <About />
        </div>
      </div>
    </div>
  );
}
