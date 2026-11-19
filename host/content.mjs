// Message content, version 1: the bytes behind an event's content address, before encryption.
// This file lays content out and reads it back. Whether content is valid is the kernel's answer
// (`Comms.Content::valid`, operation 0d), on these exact bytes.
//
// Layout, every number big-endian:
//   version 1 byte (1) | kind 1 byte (1 message, 2 edit, 3 reaction) | sent 8 bytes (ms since 1970)
//   relates 1 byte (0 or 1) | the related event's address, 32 bytes, only when relates is 1
//   kind 3:      key length 1 byte (1 to 32) | key bytes
//   kind 1 or 2: forwarded 1 byte | everyone 1 byte | mention count 1 byte (at most 50)
//                | mentioned identities, 32 bytes each, ascending | text length 4 bytes (1 to 16,384)
//                | text, UTF-8 | attachment count 1 byte (0 until the cipher is designed)
// Nothing follows.

export const KIND = Object.freeze({ message: 1, edit: 2, reaction: 3 });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function compare(left, right) {
  for (let i = 0; i < 32; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** Content fields to bytes. Text is normalised to NFC and CRLF to LF; mentions are sorted. */
export function encodeContent({ kind = KIND.message, sent = 0, relates = null, text = "", key = "",
  mentions = [], everyone = false, forwarded = false }) {
  const out = [1, kind];
  const time = new DataView(new ArrayBuffer(8));
  time.setBigUint64(0, BigInt(sent));
  out.push(...new Uint8Array(time.buffer));
  out.push(relates ? 1 : 0);
  if (relates) out.push(...relates);
  if (kind === KIND.reaction) {
    const bytes = encoder.encode(key.normalize("NFC"));
    out.push(bytes.length, ...bytes);
    return Uint8Array.from(out);
  }
  const sorted = [...mentions].sort(compare).filter((m, i, all) => i === 0 || compare(all[i - 1], m) !== 0);
  out.push(forwarded ? 1 : 0, everyone ? 1 : 0, sorted.length);
  for (const mention of sorted) out.push(...mention);
  const body = encoder.encode(text.normalize("NFC").replace(/\r\n?/g, "\n"));
  const size = new DataView(new ArrayBuffer(4));
  size.setUint32(0, body.length);
  out.push(...new Uint8Array(size.buffer), ...body, 0);
  return Uint8Array.from(out);
}

/** Bytes to content fields, or null when they cannot be read. It does not judge validity. */
export function decodeContent(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 11;
    const relates = bytes[10] === 1 ? bytes.slice(11, 43) : null;
    if (relates) at = 43;
    const content = { version: bytes[0], kind: bytes[1], sent: view.getBigUint64(2), relates };
    if (content.kind === KIND.reaction) {
      return { ...content, key: decoder.decode(bytes.slice(at + 1, at + 1 + bytes[at])) };
    }
    const count = bytes[at + 2];
    const mentions = Array.from({ length: count }, (_, i) => bytes.slice(at + 3 + 32 * i, at + 35 + 32 * i));
    const textAt = at + 3 + 32 * count;
    const length = view.getUint32(textAt);
    return { ...content, forwarded: bytes[at] === 1, everyone: bytes[at + 1] === 1, mentions,
      text: decoder.decode(bytes.slice(textAt + 4, textAt + 4 + length)) };
  } catch {
    return null;
  }
}
