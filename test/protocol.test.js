import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  DOMAIN,
  HEAD_TYPES,
  Ledger,
  POLL_TYPES,
  VOTE_TYPES,
  canonicalJson,
  checkSignedHead,
  entryHash,
  pollIdOf,
} from '../shared/protocol.js';

const T = 1_800_000_000;
const server = Wallet.createRandom();
const alice = Wallet.createRandom();
const bob = Wallet.createRandom();
const carol = Wallet.createRandom();

function pollMsg(creator, over = {}) {
  return {
    title: 'Best lunch spot?',
    description: 'Pick one.',
    options: ['Tacos', 'Ramen', 'Salad'],
    creator: creator.address,
    createdAt: T,
    closesAt: T + 3600,
    ...over,
  };
}

async function signedPoll(creator, over) {
  const message = pollMsg(creator, over);
  return { message, signature: await creator.signTypedData(DOMAIN, POLL_TYPES, message) };
}

async function signedVote(voter, poll, choice, over = {}) {
  const message = {
    pollId: pollIdOf(poll),
    poll: poll.title,
    choice,
    choiceText: poll.options[choice],
    voter: voter.address,
    castAt: T + 10,
    ...over,
  };
  return { message, signature: await voter.signTypedData(DOMAIN, VOTE_TYPES, message) };
}

function add(ledger, type, { message, signature }, at) {
  const { entry, checked } = ledger.prepare(type, message, signature, at);
  ledger.commit(entry, checked);
  return entry;
}

async function sampleLedger() {
  const ledger = new Ledger();
  add(ledger, 'genesis', { message: { app: 'TrustVote', server: server.address, createdAt: T }, signature: '' }, T);
  const p = await signedPoll(alice);
  add(ledger, 'poll', p, T);
  add(ledger, 'vote', await signedVote(alice, p.message, 0), T + 10);
  add(ledger, 'vote', await signedVote(bob, p.message, 1), T + 11);
  add(ledger, 'vote', await signedVote(carol, p.message, 1), T + 12);
  return { ledger, poll: p.message };
}

const copy = (x) => JSON.parse(JSON.stringify(x));

test('canonical JSON sorts keys and ignores spacing', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 'x', c: null }] }), '{"a":[2,{"c":null,"d":"x"}],"b":1}');
});

test('a valid log replays to the same counts', async () => {
  const { ledger, poll } = await sampleLedger();
  const replayed = Ledger.replay(copy(ledger.entries));
  const p = replayed.polls.get(pollIdOf(poll));
  assert.deepEqual(p.tally, [1, 2, 0]);
  assert.equal(replayed.server, server.address);
  assert.equal(replayed.prevHash, ledger.prevHash);
});

test('the same wallet cannot vote twice', async () => {
  const { ledger, poll } = await sampleLedger();
  const again = await signedVote(bob, poll, 2, { castAt: T + 20 });
  assert.throws(() => ledger.prepare('vote', again.message, again.signature, T + 20), /already voted/);
});

test('a vote signed by someone else is rejected', async () => {
  const { ledger, poll } = await sampleLedger();
  const dave = Wallet.createRandom();
  const forged = await signedVote(dave, poll, 0);
  forged.message.voter = Wallet.createRandom().address; // claim to be another wallet
  assert.throws(() => ledger.prepare('vote', forged.message, forged.signature, T + 20), /does not match the voter/);
});

test('votes after closing time are rejected', async () => {
  const { ledger, poll } = await sampleLedger();
  const late = await signedVote(Wallet.createRandom(), poll, 0, { castAt: T + 3600 });
  assert.throws(() => ledger.prepare('vote', late.message, late.signature, T + 3600), /closed/);
});

test('a vote must name the real option text', async () => {
  const { ledger, poll } = await sampleLedger();
  const v = await signedVote(Wallet.createRandom(), poll, 0, { choiceText: 'Ramen' });
  assert.throws(() => ledger.prepare('vote', v.message, v.signature, T + 20), /choice text does not match/);
});

test('invisible and direction-changing characters are rejected', async () => {
  const ledger = new Ledger();
  add(ledger, 'genesis', { message: { app: 'TrustVote', server: server.address, createdAt: T }, signature: '' }, T);
  const p = await signedPoll(alice, { options: ['Yes', 'No‮'] });
  assert.throws(() => ledger.prepare('poll', p.message, p.signature, T), /invisible or direction-changing/);
  const dup = await signedPoll(alice, { options: ['Yes', 'YES'] });
  assert.throws(() => ledger.prepare('poll', dup.message, dup.signature, T), /same as an earlier option/);
});

test('editing any entry is detected', async () => {
  const { ledger } = await sampleLedger();
  const entries = copy(ledger.entries);
  entries[3].message.choice = 0;
  assert.throws(() => Ledger.replay(entries), /Entry #3: its hash does not match/);
});

test('editing an entry and fixing its hash still breaks the chain', async () => {
  const { ledger } = await sampleLedger();
  const entries = copy(ledger.entries);
  entries[3].receivedAt += 1;
  entries[3].hash = entryHash(entries[3]);
  assert.throws(() => Ledger.replay(entries), /Entry #4: it does not link/);
});

test('changing a vote and rebuilding the whole chain fails the signature check', async () => {
  const { ledger } = await sampleLedger();
  const entries = copy(ledger.entries);
  entries[3].message.choice = 0;
  entries[3].message.choiceText = 'Tacos';
  for (let i = 3; i < entries.length; i++) {
    entries[i].prevHash = entries[i - 1].hash;
    entries[i].hash = entryHash(entries[i]);
  }
  assert.throws(() => Ledger.replay(entries), /signature does not match the voter/);
});

test('removing a vote is caught by its receipt', async () => {
  const { ledger } = await sampleLedger();
  const receipt = { seq: 4, hash: ledger.entries[4].hash };
  receipt.signature = await server.signTypedData(DOMAIN, HEAD_TYPES, receipt);
  assert.equal(checkSignedHead(ledger, receipt).ok, true);

  // The server drops the last vote and serves a shorter, still-valid log.
  const shorter = Ledger.replay(copy(ledger.entries.slice(0, 4)));
  const r = checkSignedHead(shorter, receipt);
  assert.equal(r.ok, false);
  assert.match(r.problem, /does not contain it/);
});

test('a receipt from a different key is not accepted', async () => {
  const { ledger } = await sampleLedger();
  const receipt = { seq: 4, hash: ledger.entries[4].hash };
  receipt.signature = await Wallet.createRandom().signTypedData(DOMAIN, HEAD_TYPES, receipt);
  assert.match(checkSignedHead(ledger, receipt).problem, /not signed by this log's server key/);
});
