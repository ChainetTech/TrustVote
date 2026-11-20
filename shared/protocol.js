// The TrustVote protocol. The server, the browser and the command-line verifier
// all run this same file, so anything the server accepts, anyone can re-check.
//
// The log is a list of entries, one JSON object per line:
//   { seq, type, message, signature, receivedAt, prevHash, hash }
// - type "genesis": first entry; names the server key that signs receipts.
// - type "poll":    a poll, signed by its creator's wallet (EIP-712 "Poll").
// - type "vote":    a vote, signed by the voter's wallet (EIP-712 "Vote").
// hash = keccak256(canonical JSON of the entry without `hash`), and every
// entry carries the previous entry's hash, so editing, removing or reordering
// anything breaks the chain from that point on.

import { TypedDataEncoder, verifyTypedData, keccak256, toUtf8Bytes, getAddress, ZeroHash } from 'ethers';

export const APP = 'TrustVote';
export const DOMAIN = Object.freeze({ name: APP, version: '1' });

export const POLL_TYPES = {
  Poll: [
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'options', type: 'string[]' },
    { name: 'creator', type: 'address' },
    { name: 'createdAt', type: 'uint64' },
    { name: 'closesAt', type: 'uint64' },
  ],
};

// `poll` and `choiceText` repeat the poll title and option text so the wallet
// shows the voter, in words, exactly what they are signing.
export const VOTE_TYPES = {
  Vote: [
    { name: 'pollId', type: 'bytes32' },
    { name: 'poll', type: 'string' },
    { name: 'choice', type: 'uint32' },
    { name: 'choiceText', type: 'string' },
    { name: 'voter', type: 'address' },
    { name: 'castAt', type: 'uint64' },
  ],
};

// The server signs (seq, hash) pairs. Signed for a vote, that is the voter's
// receipt: a commitment that the log up to that entry has exactly that hash.
export const HEAD_TYPES = {
  Head: [
    { name: 'seq', type: 'uint64' },
    { name: 'hash', type: 'bytes32' },
  ],
};

export const LIMITS = Object.freeze({
  titleMax: 200,
  descriptionMax: 2000,
  optionMax: 120,
  minOptions: 2,
  maxOptions: 10,
  minDurationSec: 60,
  maxDurationSec: 366 * 86400,
  clockSkewSec: 300,
});

const ENTRY_FIELDS = ['seq', 'type', 'message', 'signature', 'receivedAt', 'prevHash', 'hash'];

export class VerifyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerifyError';
  }
}

const fail = (msg) => {
  throw new VerifyError(msg);
};

// ---------- canonical encoding ----------

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
      .join(',') +
    '}'
  );
}

export function entryHash({ seq, type, message, signature, receivedAt, prevHash }) {
  return keccak256(toUtf8Bytes(canonicalJson({ seq, type, message, signature, receivedAt, prevHash })));
}

export function pollIdOf(poll) {
  return TypedDataEncoder.hash(DOMAIN, POLL_TYPES, poll);
}

export function parseJsonl(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new VerifyError(`log line ${i + 1} is not valid JSON`);
      }
    });
}

// ---------- field rules ----------

// Characters that are invisible or flip text direction. They can make two
// options look identical, or make an option display as something it isn't.
const INVISIBLE = /[؜​‎‏‪-‮⁠-⁤⁦-⁩﻿]/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;

function checkText(label, s, max, { multiline = false, allowEmpty = false } = {}) {
  if (typeof s !== 'string') fail(`${label} must be text`);
  if (!allowEmpty && s.length === 0) fail(`${label} is empty`);
  if (s !== s.trim()) fail(`${label} starts or ends with spaces`);
  if ([...s].length > max) fail(`${label} is longer than ${max} characters`);
  if (s !== s.normalize('NFC')) fail(`${label} is not in normal (NFC) form`);
  if ((multiline ? CONTROL_EXCEPT_NEWLINE : CONTROL).test(s)) fail(`${label} contains control characters`);
  if (INVISIBLE.test(s)) fail(`${label} contains invisible or direction-changing characters`);
}

// Two options that differ only by case, spacing or look-alike forms count as the same.
export function sameTextKey(s) {
  return s.normalize('NFKC').replace(/[‌‍]/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function checkUint(label, n, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) fail(`${label} must be a whole number`);
}

function checkAddress(label, a) {
  if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) fail(`${label} must be a wallet address`);
  try {
    return getAddress(a);
  } catch {
    return fail(`${label} has a bad checksum`);
  }
}

function checkKeys(label, obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(`${label} must be an object`);
  const got = Object.keys(obj).sort().join(',');
  if (got !== [...keys].sort().join(',')) fail(`${label} must have exactly these fields: ${keys.join(', ')}`);
}

function checkSignature(sig) {
  if (typeof sig !== 'string' || !/^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(sig)) {
    fail('signature must be a 64- or 65-byte hex string');
  }
  return sig.toLowerCase();
}

function recover(types, message, signature) {
  try {
    return verifyTypedData(DOMAIN, types, message, signature);
  } catch {
    return fail('signature is not valid');
  }
}

// Clean up user input the way the protocol expects it, before signing.
export function tidyText(s, { multiline = false } = {}) {
  let t = String(s ?? '').normalize('NFC');
  t = multiline ? t.replace(/\r\n?/g, '\n') : t.replace(/\s+/g, ' ');
  return t.trim();
}

export function normalizePoll(m) {
  checkKeys('poll', m, POLL_TYPES.Poll.map((f) => f.name));
  checkText('Title', m.title, LIMITS.titleMax);
  checkText('Description', m.description, LIMITS.descriptionMax, { multiline: true, allowEmpty: true });
  if (!Array.isArray(m.options)) fail('options must be a list');
  if (m.options.length < LIMITS.minOptions || m.options.length > LIMITS.maxOptions) {
    fail(`A poll needs ${LIMITS.minOptions} to ${LIMITS.maxOptions} options`);
  }
  const seen = new Set();
  m.options.forEach((o, i) => {
    checkText(`Option ${i + 1}`, o, LIMITS.optionMax);
    const key = sameTextKey(o);
    if (seen.has(key)) fail(`Option ${i + 1} is the same as an earlier option`);
    seen.add(key);
  });
  const creator = checkAddress('creator', m.creator);
  checkUint('createdAt', m.createdAt);
  checkUint('closesAt', m.closesAt);
  const open = m.closesAt - m.createdAt;
  if (open < LIMITS.minDurationSec) fail('A poll must stay open for at least 1 minute');
  if (open > LIMITS.maxDurationSec) fail('A poll can stay open for at most 366 days');
  return {
    title: m.title,
    description: m.description,
    options: [...m.options],
    creator,
    createdAt: m.createdAt,
    closesAt: m.closesAt,
  };
}

export function normalizeVote(m) {
  checkKeys('vote', m, VOTE_TYPES.Vote.map((f) => f.name));
  if (typeof m.pollId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(m.pollId)) fail('pollId must be a 32-byte hex id');
  if (typeof m.poll !== 'string') fail('poll must be the poll title');
  checkUint('choice', m.choice, 0xffffffff);
  if (typeof m.choiceText !== 'string') fail('choiceText must be text');
  const voter = checkAddress('voter', m.voter);
  checkUint('castAt', m.castAt);
  return {
    pollId: m.pollId.toLowerCase(),
    poll: m.poll,
    choice: m.choice,
    choiceText: m.choiceText,
    voter,
    castAt: m.castAt,
  };
}

// ---------- the ledger ----------

export class Ledger {
  entries = [];
  polls = new Map(); // pollId -> { id, entry, message, tally, voters: Map(address -> seq), votes: [entry] }
  server = null;

  get nextSeq() {
    return this.entries.length;
  }

  get prevHash() {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : ZeroHash;
  }

  get head() {
    const last = this.entries[this.entries.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : null;
  }

  // Check a submission against the rules and the log so far. Does not change anything.
  check(type, message, signature, receivedAt) {
    checkUint('receivedAt', receivedAt);
    const last = this.entries[this.entries.length - 1];
    if (last && receivedAt < last.receivedAt) fail('receivedAt is earlier than the entry before it');

    if (type === 'genesis') {
      if (last) fail('genesis must be the first entry');
      checkKeys('genesis', message, ['app', 'server', 'createdAt']);
      if (message.app !== APP) fail(`genesis app must be "${APP}"`);
      const server = checkAddress('server', message.server);
      checkUint('createdAt', message.createdAt);
      if (signature !== '') fail('genesis has no signature');
      return { message: { app: APP, server, createdAt: message.createdAt }, signature: '' };
    }
    if (!last) fail('the log must start with a genesis entry');

    if (type === 'poll') {
      const poll = normalizePoll(message);
      const sig = checkSignature(signature);
      if (Math.abs(poll.createdAt - receivedAt) > LIMITS.clockSkewSec) {
        fail("the poll's start time is too far from the time the server received it; check your device clock");
      }
      const pollId = pollIdOf(poll);
      if (this.polls.has(pollId)) fail('this poll already exists');
      if (recover(POLL_TYPES, poll, sig) !== poll.creator) fail("the signature does not match the poll's creator");
      return { message: poll, signature: sig, pollId };
    }

    if (type === 'vote') {
      const vote = normalizeVote(message);
      const sig = checkSignature(signature);
      const p = this.polls.get(vote.pollId);
      if (!p) fail('this poll does not exist');
      if (vote.poll !== p.message.title) fail('the vote names a different poll title');
      if (vote.choice >= p.message.options.length) fail('that choice is not one of the options');
      if (vote.choiceText !== p.message.options[vote.choice]) fail('the choice text does not match the option');
      if (receivedAt >= p.message.closesAt || vote.castAt >= p.message.closesAt) fail('this poll is closed');
      if (Math.abs(vote.castAt - receivedAt) > LIMITS.clockSkewSec) {
        fail('the vote time is too far from the time the server received it; check your device clock');
      }
      if (p.voters.has(vote.voter)) fail('this wallet has already voted in this poll');
      if (recover(VOTE_TYPES, vote, sig) !== vote.voter) fail('the signature does not match the voter');
      return { message: vote, signature: sig };
    }

    return fail(`unknown entry type "${type}"`);
  }

  // Build the next entry for a submission. Pass the result to commit() once it is safely stored.
  prepare(type, message, signature, receivedAt) {
    const checked = this.check(type, message, signature, receivedAt);
    const entry = {
      seq: this.nextSeq,
      type,
      message: checked.message,
      signature: checked.signature,
      receivedAt,
      prevHash: this.prevHash,
    };
    entry.hash = entryHash(entry);
    return { entry, checked };
  }

  commit(entry, checked) {
    if (entry.seq !== this.nextSeq || entry.prevHash !== this.prevHash) fail('the log changed before this entry was saved');
    this.entries.push(entry);
    if (entry.type === 'genesis') {
      this.server = entry.message.server;
    } else if (entry.type === 'poll') {
      this.polls.set(checked.pollId, {
        id: checked.pollId,
        entry,
        message: entry.message,
        tally: entry.message.options.map(() => 0),
        voters: new Map(),
        votes: [],
      });
    } else {
      const p = this.polls.get(entry.message.pollId);
      p.tally[entry.message.choice] += 1;
      p.voters.set(entry.message.voter, entry.seq);
      p.votes.push(entry);
    }
  }

  // Verify an existing entry (from a log file or download) and add it.
  apply(entry) {
    const seq = this.nextSeq;
    try {
      checkKeys('entry', entry, ENTRY_FIELDS);
      if (entry.seq !== seq) fail(`expected entry number ${seq}, found ${entry.seq}`);
      if (entry.prevHash !== this.prevHash) fail('it does not link to the entry before it (the chain is broken)');
      if (entry.hash !== entryHash(entry)) fail('its hash does not match its contents (the entry was altered)');
      const checked = this.check(entry.type, entry.message, entry.signature, entry.receivedAt);
      if (canonicalJson(checked.message) !== canonicalJson(entry.message) || checked.signature !== entry.signature) {
        fail('it is not stored in canonical form');
      }
      this.commit(entry, checked);
    } catch (e) {
      if (e instanceof VerifyError) e.message = `Entry #${seq}: ${e.message}`;
      throw e;
    }
  }

  static replay(entries) {
    const ledger = new Ledger();
    for (const entry of entries) ledger.apply(entry);
    return ledger;
  }
}

// ---------- receipts and signed heads ----------

export function signHead(wallet, head) {
  return wallet.signTypedData(DOMAIN, HEAD_TYPES, { seq: head.seq, hash: head.hash });
}

export function headSigner(head) {
  try {
    return verifyTypedData(DOMAIN, HEAD_TYPES, { seq: head.seq, hash: head.hash }, head.signature);
  } catch {
    return null;
  }
}

// Check that a signed (seq, hash) from the server is still true of this log.
// Works for vote receipts and for the server's published log head.
export function checkSignedHead(ledger, head) {
  if (!head || !Number.isSafeInteger(head.seq) || typeof head.hash !== 'string' || typeof head.signature !== 'string') {
    return { ok: false, problem: 'This is not a valid receipt.' };
  }
  const signer = headSigner(head);
  if (!signer || signer !== ledger.server) {
    return { ok: false, problem: "This receipt was not signed by this log's server key." };
  }
  const entry = ledger.entries[head.seq];
  if (!entry) {
    return { ok: false, problem: `The server signed entry #${head.seq}, but the log does not contain it. Entries were removed.` };
  }
  if (entry.hash !== head.hash.toLowerCase()) {
    return { ok: false, problem: `The server signed a different entry #${head.seq} than the one in the log. The log was rewritten.` };
  }
  return { ok: true, entry };
}

// ---------- read models ----------

export function pollStatus(p, now) {
  return now < p.message.closesAt ? 'open' : 'closed';
}

export function pollSummary(p, now) {
  const m = p.message;
  return {
    id: p.id,
    title: m.title,
    description: m.description,
    options: m.options,
    creator: m.creator,
    createdAt: m.createdAt,
    closesAt: m.closesAt,
    status: pollStatus(p, now),
    tally: [...p.tally],
    totalVotes: p.votes.length,
    seq: p.entry.seq,
    hash: p.entry.hash,
    signature: p.entry.signature,
  };
}

export function voteRow(entry) {
  const m = entry.message;
  return {
    seq: entry.seq,
    voter: m.voter,
    choice: m.choice,
    choiceText: m.choiceText,
    castAt: m.castAt,
    receivedAt: entry.receivedAt,
    signature: entry.signature,
    hash: entry.hash,
  };
}
