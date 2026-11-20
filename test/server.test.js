import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { DOMAIN, Ledger, POLL_TYPES, VOTE_TYPES, checkSignedHead, parseJsonl } from '../shared/protocol.js';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const quiet = { warn() {} };

async function start(dir, clock) {
  const store = openStore(dir, { now: () => clock.t, privateKey: clock.key, log: quiet });
  const app = createApp(store, { limits: { pollsPerHour: 1000, votesPerMinute: 1000 } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (p, body) => {
    const res = await fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.startsWith('application/json') ? await res.json() : await res.text() };
  };
  const stop = () =>
    new Promise((r) => {
      server.close(() => (store.close(), r()));
      server.closeAllConnections();
    });
  return { call, stop, store, base };
}

test('create, vote, recount, restart, and catch tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustvote-'));
  const clock = { t: 1_800_000_000, key: Wallet.createRandom().privateKey };
  let s = await start(dir, clock);

  const creator = Wallet.createRandom();
  const poll = {
    title: 'Which day for the meetup?',
    description: '',
    options: ['Friday', 'Saturday'],
    creator: creator.address,
    createdAt: clock.t,
    closesAt: clock.t + 600,
  };
  const created = await s.call('/polls', { message: poll, signature: await creator.signTypedData(DOMAIN, POLL_TYPES, poll) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const pollId = created.body.poll.id;

  const voters = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()];
  const receipts = [];
  for (const [i, w] of voters.entries()) {
    clock.t += 1;
    const choice = i === 0 ? 0 : 1;
    const vote = { pollId, poll: poll.title, choice, choiceText: poll.options[choice], voter: w.address, castAt: clock.t };
    const r = await s.call('/votes', { message: vote, signature: await w.signTypedData(DOMAIN, VOTE_TYPES, vote) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    receipts.push(r.body.receipt);
  }

  // Second vote from the same wallet is refused.
  const w0 = voters[0];
  const again = { pollId, poll: poll.title, choice: 1, choiceText: 'Saturday', voter: w0.address, castAt: clock.t };
  const dup = await s.call('/votes', { message: again, signature: await w0.signTypedData(DOMAIN, VOTE_TYPES, again) });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /already voted/);

  // A vote claiming to be from a wallet that didn't sign it is refused.
  const fake = { ...again, voter: Wallet.createRandom().address };
  const forged = await s.call('/votes', { message: fake, signature: await w0.signTypedData(DOMAIN, VOTE_TYPES, fake) });
  assert.equal(forged.status, 400);

  const shown = await s.call(`/polls/${pollId}`);
  assert.deepEqual(shown.body.poll.tally, [1, 2]);
  assert.equal(shown.body.votes.length, 3);

  // Anyone can recount from the public log and check receipts and the signed head.
  const log = await s.call('/log');
  const ledger = Ledger.replay(parseJsonl(log.body));
  assert.deepEqual(ledger.polls.get(pollId).tally, [1, 2]);
  for (const r of receipts) assert.equal(checkSignedHead(ledger, r).ok, true);
  assert.equal(checkSignedHead(ledger, (await s.call('/head')).body).ok, true);

  // Closed polls take no more votes.
  clock.t = poll.closesAt;
  const late = { pollId, poll: poll.title, choice: 0, choiceText: 'Friday', voter: creator.address, castAt: clock.t };
  const lateRes = await s.call('/votes', { message: late, signature: await creator.signTypedData(DOMAIN, VOTE_TYPES, late) });
  assert.equal(lateRes.status, 400);
  assert.match(lateRes.body.error, /closed/);

  // Restart: the log is re-verified and the counts come back the same.
  await s.stop();
  s = await start(dir, clock);
  assert.deepEqual((await s.call(`/polls/${pollId}`)).body.poll.tally, [1, 2]);
  await s.stop();

  // A half-written last line (crash mid-write) is dropped on start.
  const logPath = path.join(dir, 'log.jsonl');
  fs.appendFileSync(logPath, '{"seq":5,"ty');
  s = await start(dir, clock);
  assert.equal(s.store.ledger.entries.length, 5);
  await s.stop();

  // Someone edits the file on disk: the server refuses to start.
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  const edited = JSON.parse(lines[3]);
  edited.message.choice = 0;
  edited.message.choiceText = 'Friday';
  lines[3] = JSON.stringify(edited);
  fs.writeFileSync(logPath, lines.join('\n') + '\n');
  assert.throws(() => openStore(dir, { now: () => clock.t, privateKey: clock.key, log: quiet }), /Entry #3/);

  // Starting the same log with a different server key is refused.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'trustvote-'));
  openStore(dir2, { now: () => clock.t, privateKey: clock.key, log: quiet }).close();
  assert.throws(() => openStore(dir2, { now: () => clock.t, privateKey: Wallet.createRandom().privateKey, log: quiet }), /not the key/);
});

test('bad input gets a clear error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustvote-'));
  const s = await start(dir, { t: 1_800_000_000, key: Wallet.createRandom().privateKey });
  const broken = await fetch(`${s.base}/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(broken.status, 400);
  assert.match((await broken.json()).error, /not valid JSON/);
  const r1 = await s.call('/votes', { message: { nope: 1 }, signature: '0x00' });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /must have exactly these fields/);
  const r2 = await s.call('/polls/0xdeadbeef');
  assert.equal(r2.status, 404);
  await s.stop();
});
