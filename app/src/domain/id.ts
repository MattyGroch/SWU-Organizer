/**
 * A random v4 UUID for a new record.
 *
 * `crypto.randomUUID` exists only in a secure context — HTTPS or localhost. A phone that
 * opens a dev server by its LAN address (`http://192.168…`) has no such function, so every
 * save that made an id threw. `crypto.getRandomValues` works in any context.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
