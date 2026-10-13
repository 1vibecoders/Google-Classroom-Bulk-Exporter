// Google Classroom sync (SPEC.md § 12.1): sign in with Google, sync up to 3
// times per 24 hours, review the result in the usual import preview. Shown in
// Settings and in onboarding; on a site without the sync backend it explains
// that the feature needs the online version.
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { Icon } from '../ui/Icon';
import { LOGIN_URL, deleteAccount, fetchAccount, runSync, signOut, type Account } from '../lib/sync/api';
import { SYNC_FILE_NAME } from '../lib/sync/mergeBatch';
import { openBatchPreview } from './import/fromBatch';
import { runAnalysis } from '../lib/ai/api';
import { getAiStatus, setAiStatus } from '../state/aiStore';
import type { SyncAllowance } from '../model/importBatch';

type State = { kind: 'loading' } | { kind: 'none'; message: string } | { kind: 'account'; account: Account };

const RETURN_MESSAGES: Record<string, string> = {
  connected: 'Signed in with Google.',
  denied: 'Google sign-in was cancelled. Nothing was shared.',
  failed: 'Google sign-in did not complete. Try again.',
};

function allowanceText(a: SyncAllowance): string {
  if (a.remaining > 0) return `${a.remaining} of ${a.limit} syncs left in the last 24 hours.`;
  const next = a.nextAvailableAt ? new Date(a.nextAvailableAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'later';
  return `No syncs left: the next one is available ${next}.`;
}

export function ClassroomSyncCard() {
  const { state, notify } = useStore();
  const confirm = useConfirm();
  const [view, setView] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const returned = /[?&]google=(\w+)/.exec(window.location.hash)?.[1];

  useEffect(() => {
    let alive = true;
    void fetchAccount().then((account) => {
      if (!alive) return;
      if (!account) setView({ kind: 'none', message: 'Google Classroom sync needs the online version of this website (it is not available in the offline file or on a plain static host).' });
      else if ('unavailable' in account) setView({ kind: 'none', message: account.message });
      else setView({ kind: 'account', account });
    });
    return () => {
      alive = false;
    };
  }, []);

  const setAllowance = (allowance: SyncAllowance | undefined) => {
    setView((v) => (v.kind === 'account' && v.account.signedIn && allowance ? { kind: 'account', account: { ...v.account, allowance } } : v));
  };

  const sync = async () => {
    setBusy(true);
    setProblem(null);
    const result = await runSync(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    if (!result.ok) {
      setAllowance(result.allowance);
      setProblem(result.message);
      if (result.code === 'signed_out') setView({ kind: 'account', account: { signedIn: false } });
      return;
    }
    setAllowance(result.allowance);
    // New Classroom data: read what changed with AI in the background (SPEC.md § 17.1); findings appear in Review.
    if (getAiStatus()?.configured) void runAnalysis(Intl.DateTimeFormat().resolvedOptions().timeZone).then((r) => 'error' in r || setAiStatus(r));
    const failed = openBatchPreview(state.doc, result.batch, SYNC_FILE_NAME);
    if (failed) {
      setProblem(failed);
      return;
    }
    const { counts } = result.batch;
    notify(`Synced: ${counts.new} new, ${counts.changed} changed, ${counts.missing} no longer in Classroom. Review the changes before importing.`, { tone: 'success' });
  };

  const leave = async () => {
    if (await signOut()) setView({ kind: 'account', account: { signedIn: false } });
  };

  const removeData = async () => {
    const ok = await confirm({
      title: 'Delete your Google Classroom data from the server?',
      message: 'This signs you out, removes this website’s access to your Google account, and deletes the synced Classroom records kept on the server. Your schedule in this browser is not changed.',
      confirmLabel: 'Delete server data',
      danger: true,
    });
    if (!ok) return;
    if (await deleteAccount()) {
      setView({ kind: 'account', account: { signedIn: false } });
      notify('Your server data was deleted and Google access was removed.', { tone: 'success' });
    } else setProblem('The server data could not be deleted. Try again.');
  };

  return (
    <section className="card" aria-labelledby="gc-sync-head">
      <div className="card-header">
        <h2 id="gc-sync-head">Google Classroom sync</h2>
      </div>
      <div className="card-body stack">
        {returned && RETURN_MESSAGES[returned] ? (
          <p className="small" role="status">
            {RETURN_MESSAGES[returned]}
          </p>
        ) : null}
        {view.kind === 'loading' ? <p className="muted small">Checking…</p> : null}
        {view.kind === 'none' ? <p className="muted small">{view.message}</p> : null}
        {view.kind === 'account' && !view.account.signedIn ? (
          <>
            <p className="small">
              Sign in with Google to read your classes and coursework straight from Google Classroom (read-only). Your schedule stays in this browser;
              the server keeps what it read from Classroom so later syncs only report changes. Your school may not allow this; the browser extension
              works either way.
            </p>
            <div className="row">
              <a className="btn primary" href={LOGIN_URL}>
                <Icon name="upload" /> Sign in with Google
              </a>
            </div>
          </>
        ) : null}
        {view.kind === 'account' && view.account.signedIn ? (
          <>
            <p className="small">
              Signed in as <strong>{view.account.email}</strong>. {allowanceText(view.account.allowance)}
            </p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void sync()} disabled={busy || view.account.allowance.remaining === 0 || view.account.allowance.running}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button type="button" className="btn ghost" onClick={() => void leave()}>
                Sign out
              </button>
              <a className="btn ghost" href="/api/account" download>
                Download server data
              </a>
              <button type="button" className="btn ghost danger" onClick={() => void removeData()}>
                Delete server data
              </button>
            </div>
            <p className="muted small">
              A sync counts once Google has answered; attempts that fail before that are not counted. Nothing changes in your schedule until you review
              and import.
            </p>
          </>
        ) : null}
        {problem ? (
          <p className="banner warning" role="alert">
            <Icon name="warning" /> {problem}
          </p>
        ) : null}
      </div>
    </section>
  );
}
