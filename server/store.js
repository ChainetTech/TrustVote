import fs from 'node:fs';
import path from 'node:path';
import { Wallet } from 'ethers';
import { APP, Ledger, parseJsonl, signHead } from '../shared/protocol.js';

const unixNow = () => Math.floor(Date.now() / 1000);

// The server's signing key. It signs receipts and log heads; it can never sign
// votes or polls, because those must be signed by the voter's own wallet.
function loadWallet(dataDir, privateKey) {
  if (privateKey) return new Wallet(privateKey);
  const keyPath = path.join(dataDir, 'server-key.json');
  if (fs.existsSync(keyPath)) return new Wallet(JSON.parse(fs.readFileSync(keyPath, 'utf8')).privateKey);
  const wallet = Wallet.createRandom();
  fs.writeFileSync(keyPath, JSON.stringify({ address: wallet.address, privateKey: wallet.privateKey }, null, 2) + '\n', {
    mode: 0o600,
  });
  return wallet;
}

export function openStore(dataDir, { now = unixNow, privateKey = process.env.TRUSTVOTE_SERVER_KEY, log = console } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const wallet = loadWallet(dataDir, privateKey);
  const logPath = path.join(dataDir, 'log.jsonl');
  const ledger = new Ledger();

  if (fs.existsSync(logPath)) {
    let text = fs.readFileSync(logPath, 'utf8');
    if (text && !text.endsWith('\n')) {
      // A write was cut off (crash or power loss). Receipts are only issued after
      // a write is flushed to disk, so nobody holds a receipt for this partial line.
      const keep = text.lastIndexOf('\n') + 1;
      log.warn(`log.jsonl ended with an unfinished line; removing it (${text.length - keep} bytes)`);
      fs.truncateSync(logPath, keep);
      text = text.slice(0, keep);
    }
    // Re-verify the whole log on every start. If someone edited the file, refuse to run.
    for (const entry of parseJsonl(text)) ledger.apply(entry);
  }

  const fd = fs.openSync(logPath, 'a');

  // Check, write and flush, then commit to memory. Runs synchronously so no
  // other request can slip in between the check and the write.
  function append(type, message, signature) {
    const last = ledger.entries[ledger.entries.length - 1];
    const receivedAt = Math.max(now(), last ? last.receivedAt : 0);
    const { entry, checked } = ledger.prepare(type, message, signature, receivedAt);
    const sizeBefore = fs.fstatSync(fd).size;
    try {
      fs.writeSync(fd, JSON.stringify(entry) + '\n');
      fs.fsyncSync(fd);
    } catch (err) {
      try {
        fs.ftruncateSync(fd, sizeBefore);
      } catch {
        /* keep the original error */
      }
      throw err;
    }
    ledger.commit(entry, checked);
    return entry;
  }

  if (ledger.entries.length === 0) {
    append('genesis', { app: APP, server: wallet.address, createdAt: now() }, '');
  } else if (ledger.server !== wallet.address) {
    throw new Error(
      `The server key (${wallet.address}) is not the key this log was started with (${ledger.server}). ` +
        'Receipts already given out would no longer verify, so the server will not start.',
    );
  }

  const signed = new Map(); // seq -> signature, so repeat requests don't re-sign
  async function signedHeadAt(seq) {
    const entry = ledger.entries[seq];
    if (!entry) return null;
    let signature = signed.get(seq);
    if (!signature) {
      signature = await signHead(wallet, { seq, hash: entry.hash });
      if (signed.size > 10000) signed.clear();
      signed.set(seq, signature);
    }
    return { seq, hash: entry.hash, signature, server: wallet.address };
  }

  return {
    ledger,
    wallet,
    logPath,
    now,
    append,
    signedHeadAt,
    close: () => fs.closeSync(fd),
  };
}
