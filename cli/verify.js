#!/usr/bin/env node
// Independent recount. Downloads (or reads) the full log, checks every hash link
// and every wallet signature, recounts every poll, and compares with what the
// server shows. Needs nothing from the server except its public data.
//
//   node cli/verify.js https://vote.example.com
//   node cli/verify.js trustvote-log.jsonl --server 0xServerKey
//   node cli/verify.js https://vote.example.com --receipt my-receipt.json

import fs from 'node:fs';
import { Ledger, checkSignedHead, parseJsonl, pollStatus } from '../shared/protocol.js';

const args = process.argv.slice(2);
const source = args.find((a, i) => !a.startsWith('--') && !['--server', '--receipt'].includes(args[i - 1]));
const expectedServer = args.includes('--server') ? args[args.indexOf('--server') + 1] : null;
const receiptFiles = args.flatMap((a, i) => (a === '--receipt' && args[i + 1] ? [args[i + 1]] : []));

if (!source) {
  console.log('Usage: node cli/verify.js <site-url | log.jsonl> [--server 0xADDRESS] [--receipt receipt.json ...]');
  process.exit(2);
}

let failed = false;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failed = true;
  console.log(`  ✗ ${msg}`);
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

const isUrl = /^https?:\/\//.test(source);
const base = isUrl ? source.replace(/\/+$/, '') : null;

// Fetch what the site shows, then the signed head, then the log, so the log is
// never older than what it is compared with.
const shown = isUrl ? await getJson(`${base}/api/polls`) : null;
const head = isUrl ? await getJson(`${base}/api/head`) : null;
const text = isUrl ? await (await fetch(`${base}/api/log`)).text() : fs.readFileSync(source, 'utf8');

console.log(`\nChecking ${source}\n`);

let ledger;
try {
  ledger = Ledger.replay(parseJsonl(text));
  const votes = ledger.entries.filter((e) => e.type === 'vote').length;
  ok(`${ledger.entries.length} log entries, each linked to the one before it`);
  ok(`${ledger.polls.size} polls and ${votes} votes, every one signed by the wallet it names`);
} catch (err) {
  bad(err.message);
  console.log('\nThe log does not verify. Results cannot be trusted.\n');
  process.exit(1);
}

console.log(`  server key: ${ledger.server}`);
if (expectedServer) {
  if (expectedServer.toLowerCase() === ledger.server.toLowerCase()) ok('server key matches --server');
  else bad(`server key does not match --server ${expectedServer}`);
}

if (head) {
  const r = checkSignedHead(ledger, head);
  if (r.ok) ok(`server's signed head (entry #${head.seq}) matches the log`);
  else bad(`server's signed head: ${r.problem}`);
}

for (const file of receiptFiles) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    bad(`${file}: not a readable receipt file`);
    continue;
  }
  const r = checkSignedHead(ledger, receipt);
  if (r.ok) ok(`${file}: receipt for entry #${receipt.seq} found in the log, unchanged`);
  else bad(`${file}: ${r.problem}`);
}

const shownById = new Map(shown ? shown.polls.map((p) => [p.id, p]) : []);
const asOf = shown ? shown.head.seq : Infinity;
const tallyAsOf = (p) => {
  const tally = p.message.options.map(() => 0);
  for (const v of p.votes) if (v.seq <= asOf) tally[v.message.choice] += 1;
  return tally;
};
const t = Math.floor(Date.now() / 1000);

console.log('\nRecount\n');
for (const p of ledger.polls.values()) {
  console.log(`  ${p.message.title}  [${pollStatus(p, t)}, ${p.votes.length} votes]`);
  const total = p.votes.length || 1;
  p.message.options.forEach((o, i) => {
    const pct = Math.round((p.tally[i] / total) * 100);
    console.log(`    ${String(p.tally[i]).padStart(6)}  ${String(pct).padStart(3)}%  ${o}`);
  });
  if (isUrl && p.entry.seq <= asOf) {
    const s = shownById.get(p.id);
    const recount = tallyAsOf(p);
    if (!s) bad('this poll is in the log but the site does not list it');
    else if (s.title !== p.message.title || s.options.join('\u0000') !== p.message.options.join('\u0000')) {
      bad('the site shows different question or option text than the creator signed');
    } else if (s.tally.join() !== recount.join()) bad(`the site shows ${s.tally.join('/')} but the recount is ${recount.join('/')}`);
    else ok('matches what the site shows');
  }
  console.log('');
}
for (const id of shownById.keys()) if (!ledger.polls.has(id)) bad(`the site lists poll ${id} which is not in the log`);

console.log(failed ? 'Some checks FAILED. See above.\n' : 'All checks passed.\n');
process.exit(failed ? 1 : 0);
