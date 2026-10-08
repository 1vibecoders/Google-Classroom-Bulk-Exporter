// Step 1 of the import: choose a file (button, drag and drop anywhere on the
// page, or pasted text), then read, parse and validate it (§ 16.1 steps 1–3).
// A valid file goes on to the preview; otherwise the problems are listed with
// their paths and nothing is imported.
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { MAX_IMPORT_BYTES } from '../../model/constants';
import { parseScheduleText, type ValidationIssue, type ValidationStage } from '../../lib/validate';
import { nowLocal, todayLocal } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { checkChosenFile, formatMegabytes, readFileText, tryParseJson, type FileProblem } from './logic';
import { ValidationErrors } from './ValidationErrors';
import type { LoadedFile } from './pending';

export interface ChooseProblem {
  /** Where the text came from ("schedule.json" or "pasted text"). */
  source: string;
  stage: ValidationStage | 'file';
  title: string;
  message?: string;
  errors: ValidationIssue[];
  /** The parsed (invalid) JSON, only used to name items in the error list. */
  raw?: unknown;
  version?: string;
}

const STAGE_TITLES: Record<ValidationStage, string> = {
  size: 'This file is too large',
  json: 'This is not a valid JSON file',
  root: 'This is not a schedule file',
  version: 'Unsupported schedule format version',
  content: 'This file can’t be imported',
};

function hasFiles(event: DragEvent | globalThis.DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

export function ChooseStep({ onLoaded }: { onLoaded: (loaded: LoadedFile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<ChooseProblem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const run = useRef(0);
  const pasteId = useId();
  const pasteHintId = useId();
  const zoneHintId = useId();

  const check = useCallback(
    async (text: string, source: string) => {
      const ticket = ++run.current;
      setBusy(`Checking ${source}…`);
      setProblem(null);
      // Let "Checking…" render before the (synchronous) validation of a large file.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (ticket !== run.current) return;
      const result = parseScheduleText(text, { today: todayLocal() });
      setBusy(null);
      if (result.ok && result.doc) {
        onLoaded({ incoming: result.doc, fileName: source, warnings: result.warnings, importTime: nowLocal() });
        return;
      }
      const stage = result.stage ?? 'content';
      const count = result.errors.length;
      setProblem({
        source,
        stage,
        title: stage === 'content' ? `${STAGE_TITLES.content}: ${count === 1 ? '1 problem' : `${count} problems`} found` : STAGE_TITLES[stage],
        errors: result.errors,
        raw: stage === 'content' ? tryParseJson(text) : undefined,
        version: result.schemaVersion,
      });
    },
    [onLoaded],
  );

  const takeFiles = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      const list = files ? Array.from(files) : [];
      if (!list.length) return;
      const file = list[0];
      setNote(list.length > 1 ? `You chose ${list.length} files; only the first one (“${file.name}”) is checked. Import one schedule file at a time.` : null);
      const early: FileProblem | null = checkChosenFile(file);
      if (early) {
        run.current++;
        setBusy(null);
        setProblem({ source: file.name, stage: 'file', title: early.title, message: early.message, errors: [] });
        return;
      }
      const ticket = ++run.current;
      setBusy(`Reading ${file.name}…`);
      setProblem(null);
      let text: string;
      try {
        text = await readFileText(file);
      } catch {
        if (ticket !== run.current) return;
        setBusy(null);
        setProblem({ source: file.name, stage: 'file', title: 'The file could not be read', message: 'Your browser could not open this file. Try choosing it again.', errors: [] });
        return;
      }
      if (ticket !== run.current) return;
      await check(text, file.name);
    },
    [check],
  );

  // Dropping a file anywhere on the page imports it (and never makes the browser open the file instead).
  useEffect(() => {
    const onDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: globalThis.DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      void takeFiles(event.dataTransfer.files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [takeFiles]);

  const checkPasted = () => {
    setNote(null);
    if (!pasted.trim()) {
      setProblem({ source: 'pasted text', stage: 'json', title: 'Nothing pasted yet', message: 'Paste the whole schedule file (it starts with { "schemaVersion": "1.0", … }) into the box first.', errors: [] });
      return;
    }
    void check(pasted, 'pasted text');
  };

  return (
    <div className="imp-choose stack">
      <div className={`imp-drop ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={(e) => hasFiles(e) && e.preventDefault()}>
        <span className="imp-drop-icon" aria-hidden="true">
          <Icon name="upload" size={28} />
        </span>
        <p className="imp-drop-title">{dragging ? 'Drop the file to check it' : 'Drag your schedule file here'}</p>
        <p className="imp-drop-sub muted" id={zoneHintId}>
          A <span className="mono">.json</span> file made by the /academic-schedule skill or exported from this website (up to {formatMegabytes(MAX_IMPORT_BYTES)}).
        </p>
        <button type="button" className="btn primary imp-drop-button" onClick={() => inputRef.current?.click()} disabled={!!busy} aria-describedby={zoneHintId}>
          <Icon name="file" />
          <span>Choose a file…</span>
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="import-file-input"
          onChange={(event) => {
            const files = event.target.files;
            void takeFiles(files ? Array.from(files) : null);
            // Allow choosing the same file again after fixing it.
            event.target.value = '';
          }}
        />
      </div>

      <div className="imp-status" role="status" aria-live="polite">
        {busy ? (
          <span className="row">
            <span className="imp-spinner" aria-hidden="true" /> {busy}
          </span>
        ) : null}
      </div>

      {note ? (
        <div className="banner warning">
          <Icon name="info" /> <span>{note}</span>
        </div>
      ) : null}

      {problem ? <ProblemPanel problem={problem} /> : null}

      <details className="imp-paste card">
        <summary>
          <span className="imp-paste-title">Paste the file’s text instead</span>
          <span className="small muted">If Claude showed you the schedule as text rather than a file</span>
        </summary>
        <div className="card-body stack">
          <div className="field">
            <label htmlFor={pasteId}>Schedule JSON</label>
            <textarea
              id={pasteId}
              className="textarea mono imp-paste-text"
              rows={8}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              value={pasted}
              placeholder={'{\n  "schemaVersion": "1.0",\n  …\n}'}
              aria-describedby={pasteHintId}
              onChange={(e) => setPasted(e.target.value)}
            />
            <span className="hint" id={pasteHintId}>
              Paste everything from the first {'{'} to the last {'}'}. It is only read as data.
            </span>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={checkPasted} disabled={!!busy}>
              <Icon name="check" /> Check pasted text
            </button>
            {pasted ? (
              <button type="button" className="btn ghost" onClick={() => setPasted('')}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </details>

      <section className="imp-help card" aria-labelledby="imp-help-title">
        <div className="card-body stack">
          <h2 id="imp-help-title" className="imp-help-title">
            What happens next
          </h2>
          <ol className="imp-help-list">
            <li>The file is checked against the schedule format. Nothing in it is ever run; it is read as data only, in this browser.</li>
            <li>You see a preview of what would be added, updated or removed, and choose what to take.</li>
            <li>Nothing changes until you press Import, and you can undo the import afterwards.</li>
          </ol>
          <p className="small muted" style={{ margin: 0 }}>
            Importing the same file twice changes nothing the second time. Your own items, completed work, notes and fields you edited are kept.
          </p>
        </div>
      </section>
    </div>
  );
}

function ProblemPanel({ problem }: { problem: ChooseProblem }) {
  return (
    <section className="imp-problem card" aria-labelledby="imp-problem-title">
      <div className="card-body stack">
        <div role="alert" className="stack" style={{ gap: 4 }}>
          <h2 id="imp-problem-title" className="imp-problem-title">
            <Icon name="warning" size={18} /> <span>{problem.title}</span>
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {problem.source === 'pasted text' ? 'Pasted text' : <>File “{problem.source}”</>} · Nothing was imported.
          </p>
        </div>
        {problem.message ? <p style={{ margin: 0 }}>{problem.message}</p> : null}
        {problem.stage === 'version' ? (
          <>
            <p style={{ margin: 0 }}>{problem.errors[0]?.message}</p>
            <p className="small muted" style={{ margin: 0 }}>
              This website reads schedule files of format version 1.x, described in SCHEDULE_FORMAT.md.
              {problem.version ? ` This file says it is version “${problem.version}”.` : ''} Ask /academic-schedule to write the schedule again as a version 1.0
              file.
            </p>
          </>
        ) : problem.stage !== 'file' && problem.errors.length ? (
          <ValidationErrors errors={problem.errors} raw={problem.raw} showPaths={problem.stage === 'content'} />
        ) : null}
        {problem.stage === 'content' ? (
          <p className="small muted" style={{ margin: 0 }}>
            You can copy this list and give it, with the file, to /academic-schedule so that it can correct the file.
          </p>
        ) : null}
      </div>
    </section>
  );
}
