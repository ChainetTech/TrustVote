import { useCallback, useEffect, useState } from 'react';
import { VOTE_TYPES } from '../../../shared/protocol.js';
import { api, serverNow } from '../api.js';
import { signTyped } from '../wallet.js';
import { downloadJson, loadReceipts, receiptFilename, saveReceipt } from '../receipts.js';
import { pct, plural, shortAddr, timeLeft, when } from '../format.js';
import Recount from '../components/Recount.jsx';

const PAGE = 50;

export default function PollPage({ id, account, connect }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
  const [step, setStep] = useState('');
  const [voteError, setVoteError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [receiptsVersion, setReceiptsVersion] = useState(0);

  const load = useCallback(
    () =>
      api
        .poll(id)
        .then((d) => {
          setData(d);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !data) {
    return (
      <>
        <a href="#/" className="back">
          ← All polls
        </a>
        <p className="notice bad">{error}</p>
      </>
    );
  }
  if (!data) return <p className="muted">Loading poll…</p>;

  const { poll, votes } = data;
  const open = serverNow() < poll.closesAt;
  const mine = account ? votes.find((v) => v.voter === account) : null;
  const receipt = mine ? loadReceipts().find((r) => r.seq === mine.seq && r.hash === mine.hash) : null;
  void receiptsVersion; // re-render after a receipt is saved
  const top = Math.max(...poll.tally);

  async function castVote() {
    setVoteError('');
    try {
      setStep('Connecting to your wallet…');
      const voter = account || (await connect());
      if (votes.some((v) => v.voter === voter)) {
        setPicked(null);
        return;
      }
      const choice = picked;
      const message = { pollId: poll.id, poll: poll.title, choice, choiceText: poll.options[choice], voter, castAt: serverNow() };
      setStep('Check your choice in your wallet and sign…');
      const signature = await signTyped(voter, VOTE_TYPES, message);
      setStep('Recording your vote…');
      const res = await api.vote({ message, signature });
      saveReceipt({ kind: 'vote', pollId: poll.id, title: poll.title, choiceText: message.choiceText, signer: voter, ...res.receipt, savedAt: Date.now() });
      setPicked(null);
      await load();
    } catch (e) {
      setVoteError(e.message);
    } finally {
      setStep('');
    }
  }

  async function fetchReceipt() {
    try {
      const res = await api.entry(mine.seq);
      saveReceipt({ kind: 'vote', pollId: poll.id, title: poll.title, choiceText: mine.choiceText, signer: mine.voter, ...res.receipt, savedAt: Date.now() });
      setReceiptsVersion((n) => n + 1);
    } catch (e) {
      setVoteError(e.message);
    }
  }

  const shownVotes = [...votes].reverse().slice(0, showAll ? undefined : PAGE);

  return (
    <article className="poll">
      <a href="#/" className="back">
        ← All polls
      </a>

      <header className="poll-head">
        <span className={`pill ${open ? 'open' : 'closed'}`}>{open ? timeLeft(poll.closesAt, serverNow()) : 'Closed'}</span>
        <h1>{poll.title}</h1>
        {poll.description && <p className="description">{poll.description}</p>}
        <p className="muted small">
          Created by{' '}
          <code title={poll.creator}>{shortAddr(poll.creator)}</code> · {when(poll.createdAt)} · {open ? 'closes' : 'closed'} {when(poll.closesAt)}
        </p>
      </header>

      {mine && (
        <div className="notice ok receipt-note">
          <p>
            <strong>You voted for "{mine.choiceText}".</strong> It is entry #{mine.seq} in the public log.
          </p>
          {receipt ? (
            <div className="row">
              <button type="button" className="btn small" onClick={() => downloadJson(receiptFilename(receipt), receipt)}>
                Download receipt
              </button>
              <span className="small">Keep it. If your vote is ever removed or changed, this file proves it.</span>
            </div>
          ) : (
            <div className="row">
              <span className="small">This browser doesn't have your receipt.</span>
              <button type="button" className="btn small" onClick={fetchReceipt}>
                Get a signed copy
              </button>
            </div>
          )}
        </div>
      )}

      <section className="card results" aria-label="Results">
        <div className="section-head">
          <h2>{open ? 'Results so far' : 'Final results'}</h2>
          <span className="muted">{plural(poll.totalVotes, 'vote')}</span>
        </div>
        <ol className="options">
          {poll.options.map((o, i) => {
            const n = poll.tally[i];
            const share = pct(n, poll.totalVotes);
            const classes = ['option', mine?.choice === i && 'mine', picked === i && 'picked', n === top && n > 0 && 'lead'].filter(Boolean).join(' ');
            return (
              <li key={i} className={classes}>
                <div className="option-row">
                  <span className="option-text">
                    {o}
                    {mine?.choice === i && <span className="tag">Your vote</span>}
                  </span>
                  <span className="option-count">
                    {n.toLocaleString()} <span className="muted">· {share}%</span>
                  </span>
                </div>
                <div className="bar" aria-hidden="true">
                  <span style={{ width: `${share}%` }} />
                </div>
                {open && !mine && (
                  <button
                    type="button"
                    className={`btn small ${picked === i ? 'primary' : ''}`}
                    onClick={() => {
                      setPicked(i);
                      setVoteError('');
                    }}
                    disabled={!!step}
                    aria-pressed={picked === i}
                  >
                    {picked === i ? 'Selected' : 'Vote for this'}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {picked !== null && open && !mine && (
          <div className="confirm" role="region" aria-label="Confirm your vote">
            <p>
              Vote for <strong>"{poll.options[picked]}"</strong>?
            </p>
            <ul className="small">
              <li>
                Votes are <strong>public</strong>: anyone can see that {account ? <code>{shortAddr(account)}</code> : 'your wallet'} chose this.
              </li>
              <li>
                Votes are <strong>final</strong>. You can't change it later.
              </li>
              <li>Your wallet will show the poll and your choice before you sign. Signing is free and no funds move.</li>
            </ul>
            {voteError && (
              <p className="notice bad" role="alert">
                {voteError}
              </p>
            )}
            <div className="row">
              <button type="button" className="btn primary" onClick={castVote} disabled={!!step}>
                {step || (account ? 'Sign and vote' : 'Connect wallet and vote')}
              </button>
              <button type="button" className="btn ghost" onClick={() => setPicked(null)} disabled={!!step}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {!open && <p className="muted small">Voting has closed.</p>}
        {mine && voteError && <p className="notice bad">{voteError}</p>}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Every vote</h2>
          <span className="muted small">public · newest first</span>
        </div>
        {votes.length === 0 ? (
          <p className="muted">No votes yet.</p>
        ) : (
          <ul className="votes">
            {shownVotes.map((v) => (
              <li key={v.seq}>
                <details>
                  <summary>
                    <code title={v.voter}>{shortAddr(v.voter)}</code>
                    <span className="vote-choice">{v.choiceText}</span>
                    <span className="muted small">{when(v.castAt)}</span>
                  </summary>
                  <dl className="kv small">
                    <dt>Wallet</dt>
                    <dd>
                      <code>{v.voter}</code>
                    </dd>
                    <dt>Log entry</dt>
                    <dd>
                      #{v.seq} · <code>{v.hash}</code>
                    </dd>
                    <dt>Signature</dt>
                    <dd>
                      <code>{v.signature}</code>
                    </dd>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
        {votes.length > PAGE && !showAll && (
          <button type="button" className="btn ghost small" onClick={() => setShowAll(true)}>
            Show all {votes.length.toLocaleString()} votes
          </button>
        )}
      </section>

      <Recount pollId={poll.id} />

      <details className="card poll-record">
        <summary>Poll record</summary>
        <dl className="kv small">
          <dt>Poll id</dt>
          <dd>
            <code>{poll.id}</code>
          </dd>
          <dt>Log entry</dt>
          <dd>
            #{poll.seq} · <code>{poll.hash}</code>
          </dd>
          <dt>Creator</dt>
          <dd>
            <code>{poll.creator}</code>
          </dd>
          <dt>Creator's signature</dt>
          <dd>
            <code>{poll.signature}</code>
          </dd>
        </dl>
      </details>
    </article>
  );
}
