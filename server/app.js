import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { APP, DOMAIN, LIMITS, VerifyError, pollIdOf, pollSummary, voteRow } from '../shared/protocol.js';

// Fixed-window limit per client IP. Keeps one machine from flooding the log.
function rateLimit({ windowSec, max, message }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowSec * 1000).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: message });
    return next();
  };
}

export function createApp(store, { staticDir, trustProxy = 'loopback', limits = {} } = {}) {
  const { ledger } = store;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    // No framing: stops other sites from tricking people into signing inside a hidden frame.
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', express.json({ limit: '32kb' }));

  const pollLimit = rateLimit({
    windowSec: 3600,
    max: limits.pollsPerHour ?? 10,
    message: 'Too many polls from this network. Try again in an hour.',
  });
  const voteLimit = rateLimit({
    windowSec: 60,
    max: limits.votesPerMinute ?? 30,
    message: 'Too many votes from this network. Try again in a minute.',
  });

  const now = () => store.now();

  app.get('/api/info', (req, res) => {
    res.json({ app: APP, server: store.wallet.address, domain: DOMAIN, limits: LIMITS, head: ledger.head, now: now() });
  });

  // The latest log head, signed by the server. Anyone can save these over time;
  // two signed heads that disagree prove the server rewrote history.
  app.get('/api/head', async (req, res) => {
    res.json(await store.signedHeadAt(ledger.head.seq));
  });

  // The whole log (or the part from ?from=N), one entry per line.
  app.get('/api/log', (req, res) => {
    const from = Math.max(0, Number.parseInt(req.query.from, 10) || 0);
    const body = ledger.entries
      .slice(from)
      .map((e) => JSON.stringify(e) + '\n')
      .join('');
    res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    if (req.query.download !== undefined) res.set('Content-Disposition', 'attachment; filename="trustvote-log.jsonl"');
    res.send(body);
  });

  // One entry with a fresh server signature: a replacement for a lost receipt.
  app.get('/api/entries/:seq', async (req, res) => {
    const seq = Number(req.params.seq);
    const entry = Number.isSafeInteger(seq) ? ledger.entries[seq] : undefined;
    if (!entry) return res.status(404).json({ error: 'No entry with that number.' });
    return res.json({ entry, receipt: await store.signedHeadAt(seq) });
  });

  app.get('/api/polls', (req, res) => {
    const t = now();
    const polls = [...ledger.polls.values()].map((p) => pollSummary(p, t)).reverse();
    // `head` says how far into the log these numbers go, so a recount can compare like with like.
    res.json({ polls, head: ledger.head, now: t });
  });

  app.get('/api/polls/:id', (req, res) => {
    const p = ledger.polls.get(String(req.params.id).toLowerCase());
    if (!p) return res.status(404).json({ error: 'No poll with that id.' });
    return res.json({ poll: pollSummary(p, now()), votes: p.votes.map(voteRow), head: ledger.head, now: now() });
  });

  function submit(type) {
    return async (req, res) => {
      const { message, signature } = req.body || {};
      let entry;
      try {
        entry = store.append(type, message, signature);
      } catch (err) {
        if (err instanceof VerifyError) return res.status(400).json({ error: err.message });
        throw err;
      }
      const receipt = await store.signedHeadAt(entry.seq);
      if (type === 'poll') {
        const p = ledger.polls.get(pollIdOf(entry.message));
        return res.status(201).json({ poll: pollSummary(p, now()), receipt });
      }
      return res.status(201).json({ vote: voteRow(entry), receipt });
    };
  }

  app.post('/api/polls', pollLimit, submit('poll'));
  app.post('/api/votes', voteLimit, submit('vote'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: 'index.html', maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // Bad JSON bodies and anything unexpected.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
