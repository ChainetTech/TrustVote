// The in-browser recount. Downloads the full log and checks it with the same
// code the server uses, then compares against what the site displays.
import { Ledger, checkSignedHead } from '../../shared/protocol.js';
import { api } from './api.js';
import { loadReceipts } from './receipts.js';

const same = (a, b) => a.join('\u0000') === b.join('\u0000');

// Count a poll's votes up to a given log position.
function tallyUpTo(p, maxSeq) {
  const tally = p.message.options.map(() => 0);
  for (const v of p.votes) if (v.seq <= maxSeq) tally[v.message.choice] += 1;
  return tally;
}

const describe = (options, tally) => options.map((o, i) => `${o}: ${tally[i]}`).join(' · ');

export async function runAudit({ pollId } = {}) {
  const checks = [];
  const add = (ok, text) => checks.push({ ok, text });

  // Fetch what the site shows first, then the signed head, then the log, so the
  // log is never older than the numbers it is compared with.
  const shown = pollId ? await api.poll(pollId) : await api.polls();
  const head = await api.head();
  const entries = await api.log();

  let ledger;
  try {
    ledger = Ledger.replay(entries);
  } catch (e) {
    add(false, `The log does not verify. ${e.message}`);
    return { ok: false, checks, recounts: [] };
  }
  const voteCount = entries.filter((e) => e.type === 'vote').length;
  add(true, `Downloaded the full log: ${entries.length} entries, each linked to the one before it by its hash.`);
  add(true, `Checked ${ledger.polls.size} poll and ${voteCount} vote signatures. Each one was signed by the wallet it names.`);

  const h = checkSignedHead(ledger, head);
  add(h.ok, h.ok ? `The server's signed log head (entry #${head.seq}) matches the log.` : `Signed log head: ${h.problem}`);

  const asOf = shown.head.seq;
  const list = pollId ? [shown.poll] : shown.polls;
  const recounts = [];
  for (const s of list) {
    const p = ledger.polls.get(s.id);
    if (!p) {
      add(false, `"${s.title}" is shown on the site but is not in the log.`);
      continue;
    }
    const tally = tallyUpTo(p, asOf);
    const textMatches = s.title === p.message.title && s.description === p.message.description && same(s.options, p.message.options);
    recounts.push({ id: s.id, title: p.message.title, options: p.message.options, tally, matches: textMatches && same(tally, s.tally) });
    if (!textMatches) add(false, `"${s.title}": the question or options shown differ from what the creator signed.`);
  }

  if (pollId && recounts[0]) {
    const r = recounts[0];
    const listOk =
      shown.votes.length === r.tally.reduce((a, b) => a + b, 0) &&
      shown.votes.every((v) => ledger.entries[v.seq]?.hash === v.hash);
    if (r.matches && listOk) add(true, `Recount: ${describe(r.options, r.tally)}. Matches this page.`);
    else add(false, `Recount gives ${describe(r.options, r.tally)}, but this page shows ${describe(r.options, shown.poll.tally)}.`);
  } else if (!pollId) {
    const wrong = recounts.filter((r) => !r.matches);
    const polls = recounts.length === 1 ? 'the 1 poll' : `all ${recounts.length} polls`;
    if (wrong.length === 0) add(true, `Recounted ${polls}. Every count matches what the site shows.`);
    else add(false, `${wrong.length} poll(s) show counts that differ from the recount: ${wrong.map((r) => `"${r.title}"`).join(', ')}.`);
    for (const p of ledger.polls.values()) {
      if (p.entry.seq <= asOf && !list.some((s) => s.id === p.id)) add(false, `"${p.message.title}" is in the log but the site hides it.`);
    }
  }

  const mine = loadReceipts().filter((r) => !pollId || r.pollId === pollId);
  for (const r of mine) {
    const what = r.kind === 'vote' ? `your vote for "${r.choiceText}"` : `creating "${r.title}"`;
    const c = checkSignedHead(ledger, r);
    add(c.ok, c.ok ? `Your receipt for ${what} (entry #${r.seq}) is in the log, unchanged.` : `Your receipt for ${what}: ${c.problem}`);
  }

  return { ok: checks.every((c) => c.ok), checks, recounts, server: ledger.server, entries: entries.length };
}
