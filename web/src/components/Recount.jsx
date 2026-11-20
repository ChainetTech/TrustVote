import { useState } from 'react';
import { runAudit } from '../audit.js';

export default function Recount({ pollId }) {
  const [state, setState] = useState(null);

  async function run() {
    setState({ running: true });
    try {
      setState(await runAudit({ pollId }));
    } catch (e) {
      setState({ ok: false, checks: [{ ok: false, text: `The check could not finish: ${e.message}` }], recounts: [] });
    }
  }

  const done = state && !state.running;

  return (
    <section className="card recount" aria-live="polite">
      <h2>{pollId ? 'Recount this poll yourself' : 'Check every poll'}</h2>
      <p className="muted small">
        Your browser downloads the whole public log, re-checks every fingerprint and signature itself, recounts the votes, and
        compares the totals with what this site shows.
      </p>
      <button type="button" className="btn" onClick={run} disabled={state?.running}>
        {state?.running ? 'Checking…' : done ? 'Check again' : 'Run the check'}
      </button>

      {done && (
        <>
          <p className={`verdict ${state.ok ? 'ok' : 'bad'}`}>{state.ok ? 'Everything checks out.' : 'Something does not check out. See below.'}</p>
          <ul className="checks">
            {state.checks.map((c, i) => (
              <li key={i} className={c.ok ? 'ok' : 'bad'}>
                <span className="mark" aria-hidden="true">
                  {c.ok ? '✓' : '✗'}
                </span>
                <span className="sr-only">{c.ok ? 'Passed: ' : 'Failed: '}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          {!pollId && state.recounts.length > 0 && (
            <ul className="recount-list">
              {state.recounts.map((r) => (
                <li key={r.id}>
                  <a href={`#/poll/${r.id}`}>{r.title}</a>
                  <span className="muted small">{r.options.map((o, i) => `${o} ${r.tally[i]}`).join(' · ')}</span>
                  <span className={r.matches ? 'ok-text' : 'bad-text'}>{r.matches ? '✓ matches' : '✗ differs'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
