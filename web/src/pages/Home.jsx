import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { pct, plural, timeLeft } from '../format.js';

function PollCard({ p, now }) {
  const lead = p.totalVotes ? p.tally.indexOf(Math.max(...p.tally)) : -1;
  return (
    <li>
      <a className="card poll-card" href={`#/poll/${p.id}`}>
        <div className="poll-card-top">
          <h3>{p.title}</h3>
          <span className={`pill ${p.status}`}>{p.status === 'open' ? timeLeft(p.closesAt, now) : 'Closed'}</span>
        </div>
        {lead >= 0 ? (
          <div className="lead">
            <div className="lead-text">
              <span className="muted">{p.status === 'open' ? 'Leading:' : 'Top answer:'}</span> {p.options[lead]}
              <span className="muted"> · {pct(p.tally[lead], p.totalVotes)}%</span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${pct(p.tally[lead], p.totalVotes)}%` }} />
            </div>
          </div>
        ) : (
          <p className="muted small">No votes yet · {plural(p.options.length, 'option')}</p>
        )}
        <p className="muted small">{plural(p.totalVotes, 'vote')}</p>
      </a>
    </li>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .polls()
        .then((d) => live && (setData(d), setError('')))
        .catch((e) => live && setError(e.message));
    load();
    const timer = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const counts = data
    ? { open: data.polls.filter((p) => p.status === 'open').length, closed: data.polls.filter((p) => p.status === 'closed').length, all: data.polls.length }
    : null;
  const polls = data ? data.polls.filter((p) => filter === 'all' || p.status === filter) : [];

  return (
    <>
      <section className="hero">
        <h1>Polls you can check for yourself</h1>
        <p>
          Every vote is signed by the voter's own wallet and added to a public log that can't be quietly edited.
          Anyone can download the log and recount every poll.
        </p>
        <div className="hero-actions">
          <a className="btn primary" href="#/new">
            Start a poll
          </a>
          <a className="btn" href="#/verify">
            How it works
          </a>
        </div>
      </section>

      {error && <p className="notice bad">{error}</p>}
      {!data && !error && <p className="muted">Loading polls…</p>}

      {data && (
        <>
          <div className="tabs" role="tablist" aria-label="Filter polls">
            {['open', 'closed', 'all'].map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)} <span className="count">{counts[f]}</span>
              </button>
            ))}
          </div>
          {polls.length === 0 ? (
            <div className="empty card">
              <p>{filter === 'open' ? 'No open polls right now.' : 'Nothing here yet.'}</p>
              <a className="btn primary" href="#/new">
                Start the first one
              </a>
            </div>
          ) : (
            <ul className="poll-list">
              {polls.map((p) => (
                <PollCard key={p.id} p={p} now={data.now} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
