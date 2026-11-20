import { parseJsonl } from '../../shared/protocol.js';

async function request(path, body) {
  let res;
  try {
    res = await fetch(
      `/api${path}`,
      body === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const isJson = (res.headers.get('content-type') || '').startsWith('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && data.error) || `The server answered with error ${res.status}.`);
  return data;
}

export const api = {
  info: () => request('/info'),
  head: () => request('/head'),
  polls: () => request('/polls'),
  poll: (id) => request(`/polls/${encodeURIComponent(id)}`),
  createPoll: (body) => request('/polls', body),
  vote: (body) => request('/votes', body),
  entry: (seq) => request(`/entries/${seq}`),
  log: async () => parseJsonl(await request('/log')),
};

// Polls and votes carry timestamps the server checks against its own clock,
// so use the server's time rather than this device's (which may be off).
let offset = 0;
export function setServerTime(serverNow) {
  offset = serverNow - Math.floor(Date.now() / 1000);
}
export const serverNow = () => Math.floor(Date.now() / 1000) + offset;
