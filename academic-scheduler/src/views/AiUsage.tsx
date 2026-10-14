// Settings → AI token usage: what the AI provider reported for the last 24
// hours and the last 10 runs. Counts only, as reported; no cost estimate
// (SPEC.md § 18). Refreshed with the analysis status.
import type { AnalysisStatus } from '../model/aiProposal';

const TRIGGERS = { user: 'You', background: 'Daily check', setup: 'Setup (free)' } as const;
const n = (value: number) => value.toLocaleString('en-US');

export function AiUsage({ usage }: { usage: NonNullable<AnalysisStatus['usage']> }) {
  const { day, runs } = usage;
  return (
    <details>
      <summary className="small">
        Token usage: {n(day.inputTokens + day.outputTokens)} tokens in the last 24 hours ({n(day.inputTokens)} in, {n(day.outputTokens)} out, {n(day.calls)}{' '}
        {day.calls === 1 ? 'request' : 'requests'})
      </summary>
      {runs.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="table small">
            <caption className="visually-hidden">The last {runs.length} AI runs</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Started by</th>
                <th scope="col">Requests</th>
                <th scope="col">Tokens in</th>
                <th scope="col">Tokens out</th>
                <th scope="col">Model</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.at}>
                  <td className="nowrap">{new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td>{TRIGGERS[r.trigger] ?? r.trigger}</td>
                  <td>{n(r.calls)}</td>
                  <td>{n(r.inputTokens)}</td>
                  <td>{n(r.outputTokens)}</td>
                  <td>{r.models ?? '—'}</td>
                  <td>{r.error ? `Stopped: ${r.error}` : r.status === 'ok' ? 'OK' : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted">No AI runs yet.</p>
      )}
      <p className="small muted">Counts as reported by the AI provider. Thinking tokens, when a model uses them, are included in “out”.</p>
    </details>
  );
}
