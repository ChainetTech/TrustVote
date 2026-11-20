# TrustVote

Public polls that people don't have to take on faith. Every poll and every vote is signed by a crypto wallet and stored in a public, append-only log that anyone can download and recount.

## Why people can trust it

| Someone tries to…                          | What stops them                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Fake a vote, or vote as someone else       | Each vote is an EIP-712 signature from the voter's wallet. Without that wallet's private key it can't be made. |
| Change a vote after it was cast            | The signature covers the poll, the choice and the option text, so any change breaks it.                       |
| Edit or reorder the log                    | Each entry includes the hash of the one before it. One edit changes every later hash.                           |
| Remove a vote and rebuild the chain        | The voter holds a receipt: the server's signature on "entry #N has hash H". The rebuilt log can't match it.    |
| Show totals that don't match the votes     | The browser recount and `cli/verify.js` recount from the raw log and compare with what the site shows.          |
| Change a poll's question after it started  | The poll id is the hash of the signed question, options and closing time.                                      |
| Trick someone into signing something else  | The wallet shows the poll title and option text in plain words before signing.                                |

**Limits.** These are stated on the site's Verify page too.

- **One person, many wallets.** Wallets are free to create, so an open poll counts wallets, not people. Limiting each poll to holders of a token, or to a list of addresses, is the natural next step.
- **Votes are public.** Anyone can see which wallet chose what.
- **The server can refuse a vote.** The voter would know, because no receipt comes back.

## Run it locally

```bash
npm install
npm test                 # protocol + server tests
npm run build            # builds the web app into dist/
npm start                # http://127.0.0.1:8787 (serves the API and dist/)
```

For development with live reload of the web app, run `npm run dev:server` and `npm run dev:web` in two terminals, then open http://localhost:5173.

You need a browser wallet (MetaMask, Rabby, Trust Wallet's browser, etc.). Signing is free: it is not a transaction and needs no funds or particular chain.

## Verify a site from your own computer

```bash
node cli/verify.js https://your-site.example
node cli/verify.js https://your-site.example --receipt trustvote-receipt-12.json
node cli/verify.js trustvote-log.jsonl --server 0xServerKeyAddress
```

It checks every hash link and signature, the server's signed head, any receipts given, and that each poll's recount matches what the site shows. It exits with code 1 if anything fails.

## Deploying

- **HTTPS is required.** Wallets won't connect properly over plain HTTP on a public domain. Put it behind nginx or Caddy.
- Set `TRUST_PROXY` to your proxy's address (for example `TRUST_PROXY=127.0.0.1`) so per-IP rate limits see real client IPs.
- `DATA_DIR` (default `./data`) holds two files that matter:
  - `log.jsonl`: the log. Back it up. The server re-verifies the whole file on every start and refuses to run if it was edited.
  - `server-key.json`: the key that signs receipts. Back it up and keep it secret. If it's lost, old receipts can no longer be matched, and the server refuses to start a log with a different key. If it leaks, someone could sign fake receipts, but still not fake votes. You can supply it via `TRUSTVOTE_SERVER_KEY` instead.
- Run a single server process. Writes are serialized in-process. Two processes on one log file would corrupt it.

Environment variables: `PORT` (8787), `HOST` (127.0.0.1), `DATA_DIR`, `TRUST_PROXY`, `TRUSTVOTE_SERVER_KEY`.

## How it fits together

```
shared/protocol.js   The rules: message types, field checks, hashing, the Ledger that
                     replays and verifies a log. Used by the server, browser and CLI.
server/store.js      Append-only log file (fsync before any receipt is issued) + server key.
server/app.js        HTTP API and static file serving.
cli/verify.js        Independent recount tool.
web/src/             React app. audit.js is the in-browser recount.
```

API:

| Method | Path                | What                                                        |
| ------ | ------------------- | ----------------------------------------------------------- |
| GET    | `/api/info`         | Server key, signing domain, limits, current head            |
| GET    | `/api/polls`        | All polls with counts                                       |
| GET    | `/api/polls/:id`    | One poll with every vote                                    |
| POST   | `/api/polls`        | `{ message, signature }`: create a poll                     |
| POST   | `/api/votes`        | `{ message, signature }`: cast a vote, returns a receipt    |
| GET    | `/api/log`          | The full log as JSON lines (`?from=N`, `?download`)         |
| GET    | `/api/head`         | Latest log head, signed by the server                       |
| GET    | `/api/entries/:seq` | One entry plus a fresh signed receipt for it                |

Log entry: `{ seq, type, message, signature, receivedAt, prevHash, hash }`, where `hash = keccak256(canonical JSON of everything else)`. The first entry is a `genesis` entry naming the server key.
