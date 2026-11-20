import { useState } from 'react';
import { Ledger, checkSignedHead } from '../../../shared/protocol.js';
import { api } from '../api.js';
import { downloadJson, loadReceipts, receiptFilename } from '../receipts.js';
import Recount from '../components/Recount.jsx';

function ReceiptChecker() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setResult(null);
    try {
      let receipt;
      try {
        receipt = JSON.parse(text);
      } catch {
        throw new Error('That is not a receipt file. It should be JSON with "seq", "hash" and "signature".');
      }
      const ledger = Ledger.replay(await api.log());
      const r = checkSignedHead(ledger, receipt);
      setResult(r.ok ? { ok: true, text: `Entry #${receipt.seq} is in the log, unchanged.` } : { ok: false, text: r.problem });
    } catch (e) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(e) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  }

  return (
    <div className="card">
      <h2>Check a receipt</h2>
      <p className="muted small">Choose a receipt file or paste its contents.</p>
      <input type="file" accept="application/json,.json" onChange={loadFile} aria-label="Receipt file" />
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"seq": 12, "hash": "0x…", "signature": "0x…"}' aria-label="Receipt contents" />
      <div className="row">
        <button type="button" className="btn" onClick={check} disabled={busy || !text.trim()}>
          {busy ? 'Checking…' : 'Check receipt'}
        </button>
      </div>
      {result && (
        <p className={`notice ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? '✓ ' : '✗ '}
          {result.text}
        </p>
      )}
    </div>
  );
}

function MyReceipts() {
  const receipts = loadReceipts().sort((a, b) => b.savedAt - a.savedAt);
  if (receipts.length === 0) return null;
  return (
    <div className="card">
      <h2>Receipts saved in this browser</h2>
      <p className="muted small">The check above includes these automatically. Download them to keep a copy somewhere safe.</p>
      <ul className="receipt-list">
        {receipts.map((r) => (
          <li key={`${r.seq}-${r.hash}`}>
            <a href={`#/poll/${r.pollId}`}>{r.title}</a>
            <span className="muted small">{r.kind === 'vote' ? `You voted "${r.choiceText}"` : 'You created this poll'} · entry #{r.seq}</span>
            <button type="button" className="btn ghost small" onClick={() => downloadJson(receiptFilename(r), r)}>
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Verify({ info }) {
  const origin = window.location.origin;
  return (
    <section className="narrow">
      <h1>Check the results yourself</h1>
      <p className="lede">
        You don't have to trust this website. Every poll and vote is a message signed by a wallet, and the whole record is public.
        Here is what that guarantees, and how to check it.
      </p>

      <Recount />

      <div className="card">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <strong>You sign your vote.</strong> Your wallet signs a message that names the poll and your choice in plain words.
            Without your wallet's private key, nobody (including this server) can cast a vote as you or change the one you cast.
          </li>
          <li>
            <strong>It goes into a public log.</strong> Each entry carries the fingerprint (hash) of the entry before it. Changing,
            removing or reordering any past entry changes every fingerprint after it, so it can't be done quietly.
          </li>
          <li>
            <strong>You get a receipt.</strong> The server signs "entry #N has fingerprint H" and gives it to you. If your vote is
            ever removed or changed, the receipt proves the server did it.
          </li>
          <li>
            <strong>Anyone can recount.</strong> The log is public. The check above runs in your browser; the command below runs on
            your own computer.
          </li>
        </ol>
      </div>

      <div className="card">
        <h2>What this protects against, and what it doesn't</h2>
        <div className="two-col">
          <div>
            <h3 className="ok-text">Protected</h3>
            <ul>
              <li>Fake votes, or votes cast in someone else's name</li>
              <li>Votes changed after they were cast</li>
              <li>Votes removed after a receipt was given</li>
              <li>Totals that don't match the votes</li>
              <li>A question or its options edited after the poll started</li>
            </ul>
          </div>
          <div>
            <h3 className="warn-text">Not protected</h3>
            <ul>
              <li>
                <strong>One person, many wallets.</strong> Wallets are free to create, so an open poll counts wallets, not people.
              </li>
              <li>
                <strong>Privacy.</strong> Votes are public. Anyone can see which wallet chose what, and if a wallet is linked to your
                name, so is your vote.
              </li>
              <li>
                <strong>Refused votes.</strong> The server could refuse to record a vote. You would know, because you would not get a
                receipt.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Check without using this website</h2>
        <p>
          This page comes from the same server it checks. For a fully independent check, run the open-source verifier on your own
          computer. It downloads the log and checks everything from scratch:
        </p>
        <pre>
          <code>node cli/verify.js {origin}</code>
        </pre>
        <p className="small">
          Add <code>--receipt your-receipt.json</code> to check your receipts as well.
        </p>
        <div className="row">
          <a className="btn" href="/api/log?download">
            Download the full log
          </a>
        </div>
        {info && (
          <dl className="kv small">
            <dt>Server key</dt>
            <dd>
              <code>{info.server}</code>
            </dd>
            <dt>Log entries</dt>
            <dd>{(info.head.seq + 1).toLocaleString()}</dd>
            <dt>Latest fingerprint</dt>
            <dd>
              <code>{info.head.hash}</code>
            </dd>
          </dl>
        )}
      </div>

      <ReceiptChecker />
      <MyReceipts />
    </section>
  );
}
