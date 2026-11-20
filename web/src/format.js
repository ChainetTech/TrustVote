export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '');

export function when(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeLeft(closesAt, now) {
  const s = closesAt - now;
  if (s <= 0) return 'Closed';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

export const pct = (n, total) => (total ? Math.round((n * 100) / total) : 0);
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
