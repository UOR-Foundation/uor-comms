// The bytes of an event, as `Comms.Event::layout` fixes them: 64-bit words, most significant byte
// first. This file lays bytes out and reads them back. It does not say whether an event is valid:
// the kernel does, on these exact bytes.

export const ACTION = Object.freeze({
  join: 0, leave: 1, invite: 2, kick: 3, ban: 4, unban: 5, send: 6, setPower: 7, redact: 8, create: 9, change: 10,
});
export const ZERO = new Uint8Array(32);
const FIXED = 25;

export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const unhex = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
export const isZero = (address) => address.every((b) => b === 0);

function compare(left, right) {
  for (let i = 0; i < 32; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** Addresses in ascending order with repeats dropped: the one form the model accepts. */
export function ascending(addresses) {
  const sorted = [...addresses].sort(compare);
  return sorted.filter((address, i) => i === 0 || compare(sorted[i - 1], address) !== 0);
}

function address(value, name) {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new TypeError(`${name} must be 32 bytes`);
  return value;
}

/** Event fields to bytes. Parents and authorities are put in ascending order. */
export function encode(fields) {
  const parents = ascending((fields.parents ?? []).map((a) => address(a, "parent")));
  const authorities = ascending((fields.authorities ?? []).map((a) => address(a, "authority")));
  const out = new Uint8Array((FIXED + 4 * (parents.length + authorities.length)) * 8);
  const view = new DataView(out.buffer);
  const word = (index, value) => view.setBigUint64(index * 8, BigInt(value));
  const place = (index, value, name) => out.set(address(value ?? ZERO, name), index * 8);
  word(0, fields.version ?? 1);
  word(1, fields.action);
  place(2, fields.room, "room");
  place(6, fields.sender, "sender");
  place(10, fields.device, "device");
  place(14, fields.target, "target");
  word(18, fields.granted ?? 0);
  place(19, fields.content, "content");
  word(23, parents.length * 4);
  word(24, authorities.length * 4);
  [...parents, ...authorities].forEach((a, i) => out.set(a, (FIXED + 4 * i) * 8));
  return out;
}

/** Bytes to event fields, or null when they are not whole words holding exactly what they count. */
export function decode(bytes) {
  if (bytes.length % 8 !== 0 || bytes.length < FIXED * 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (index) => view.getBigUint64(index * 8);
  const at = (index) => bytes.slice(index * 8, index * 8 + 32);
  const parentWords = word(23);
  const authorityWords = word(24);
  if (parentWords % 4n !== 0n || authorityWords % 4n !== 0n) return null;
  if (BigInt(bytes.length / 8) !== BigInt(FIXED) + parentWords + authorityWords) return null;
  const list = (start, count) => Array.from({ length: count }, (_, i) => at(start + 4 * i));
  const parents = Number(parentWords) / 4;
  return {
    version: Number(word(0)),
    action: Number(word(1)),
    room: at(2),
    sender: at(6),
    device: at(10),
    target: at(14),
    granted: word(18),
    content: at(19),
    parents: list(FIXED, parents),
    authorities: list(FIXED + 4 * parents, Number(authorityWords) / 4),
  };
}
