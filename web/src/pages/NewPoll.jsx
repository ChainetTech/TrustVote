import { useState } from 'react';
import { LIMITS, POLL_TYPES, normalizePoll, tidyText } from '../../../shared/protocol.js';
import { api, serverNow } from '../api.js';
import { signTyped } from '../wallet.js';
import { saveReceipt } from '../receipts.js';

const DURATIONS = [
  ['1 hour', 3600],
  ['1 day', 86400],
  ['3 days', 3 * 86400],
  ['1 week', 7 * 86400],
  ['30 days', 30 * 86400],
];

const PLACEHOLDER_ADDRESS = '0x0000000000000000000000000000000000000001';

export default function NewPoll({ account, connect }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState(86400);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

  const draft = (creator) => {
    const createdAt = serverNow();
    return {
      title: tidyText(title),
      description: tidyText(description, { multiline: true }),
      options: options.map((o) => tidyText(o)).filter(Boolean),
      creator,
      createdAt,
      closesAt: createdAt + duration,
    };
  };

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      // Check the rules here first, so mistakes show up before the wallet opens.
      normalizePoll(draft(PLACEHOLDER_ADDRESS));
    } catch (err) {
      setError(err.message);
      return;
    }
    try {
      setStep('Connecting to your wallet…');
      const creator = account || (await connect());
      const message = draft(creator);
      setStep('Check the poll in your wallet and sign it…');
      const signature = await signTyped(creator, POLL_TYPES, message);
      setStep('Publishing…');
      const res = await api.createPoll({ message, signature });
      saveReceipt({ kind: 'poll', pollId: res.poll.id, title: message.title, signer: creator, ...res.receipt, savedAt: Date.now() });
      window.location.hash = `#/poll/${res.poll.id}`;
    } catch (err) {
      setError(err.message);
    } finally {
      setStep('');
    }
  }

  const setOption = (i, v) => setOptions((list) => list.map((o, j) => (j === i ? v : o)));
  const removeOption = (i) => setOptions((list) => list.filter((_, j) => j !== i));
  const busy = step !== '';

  return (
    <section className="narrow">
      <h1>Start a poll</h1>
      <p className="muted">
        You sign the poll with your wallet. After that, nobody (not even you) can change the question or the options.
      </p>

      <form className="card form" onSubmit={submit} onChange={() => error && setError('')}>
        <label className="field">
          <span>Question</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} placeholder="What should we decide?" required disabled={busy} />
          <span className="hint">
            {[...title].length}/{LIMITS.titleMax}
          </span>
        </label>

        <label className="field">
          <span>
            Details <span className="muted">(optional)</span>
          </span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LIMITS.descriptionMax} rows={3} disabled={busy} />
        </label>

        <fieldset className="field">
          <legend>Options</legend>
          {options.map((o, i) => (
            <div className="option-input" key={i}>
              <input
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                maxLength={LIMITS.optionMax}
                placeholder={`Option ${i + 1}`}
                aria-label={`Option ${i + 1}`}
                disabled={busy}
              />
              {options.length > LIMITS.minOptions && (
                <button type="button" className="btn ghost small" onClick={() => removeOption(i)} aria-label={`Remove option ${i + 1}`} disabled={busy}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {options.length < LIMITS.maxOptions && (
            <button type="button" className="btn ghost small" onClick={() => setOptions((l) => [...l, ''])} disabled={busy}>
              + Add option
            </button>
          )}
        </fieldset>

        <label className="field">
          <span>Voting closes after</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={busy}>
            {DURATIONS.map(([label, s]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="notice info small">
          Your wallet will show the poll and ask you to sign it. Signing is free: it is not a transaction and no funds move.
          Your wallet address is shown publicly as the poll's creator.
        </div>

        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? step : account ? 'Sign and publish poll' : 'Connect wallet and publish'}
        </button>
      </form>
    </section>
  );
}
