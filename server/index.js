import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));

const store = openStore(dataDir);
const app = createApp(store, {
  staticDir: path.join(root, 'dist'),
  trustProxy: process.env.TRUST_PROXY || 'loopback',
});

app.listen(port, host, () => {
  console.log(`TrustVote running at http://${host}:${port}`);
  console.log(`  log:        ${store.logPath} (${store.ledger.entries.length} entries, all verified on start)`);
  console.log(`  server key: ${store.wallet.address}`);
});
