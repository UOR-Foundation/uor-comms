// Which device key belongs to which person, until Prism ID answers that (docs/DESIGN.md decision 19).
//
// A device's address is the BLAKE3 of its raw P-256 public key, so a key checks itself against the
// address an event names. What binds a device to a person is how its key arrived:
//   - an invite link (or its QR) carries the inviter's identity and key: you trust whoever gave it
//     to you, as you would a QR shown in person;
//   - the same link carries a one-time token; the first peer to prove it holds that token, when it
//     connects, has its key recorded for the identity it claims: the inviter trusts whoever it gave
//     the link to;
//   - a person's later device is vouched for by one of their devices already trusted: it signs the
//     new device's address.
// Nothing else adds a key. The book is the caller's `signer` and `verdict` for `open` and the
// transport, and it learns keys only through `learn`, which the transport calls with a peer's proof.
import { hex, unhex } from "./event.mjs";

const encoder = new TextEncoder();
const VOUCH = encoder.encode("uor-comms device vouch v1");
const TICKET = encoder.encode("uor-comms invite ticket v1");
const algorithm = { name: "ECDSA", hash: "SHA-256" };
const curve = { name: "ECDSA", namedCurve: "P-256" };
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unb64url = (text) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

/** A new device key for this browser: the private half cannot be exported. */
export async function newDeviceKey() {
  const keys = await crypto.subtle.generateKey(curve, false, ["sign", "verify"]);
  return { privateKey: keys.privateKey, rawKey: new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)) };
}

/** An invite link: `<base>#uc1.<identity>.<device key>.<token>`, each base64url. */
export function inviteLink(base, { identity, rawKey, token }) {
  return base.split("#")[0] + "#uc1." + [identity, rawKey, token].map(b64url).join(".");
}

/** The inviter's identity, key and token from a link, or null when it is not one. */
export function readInvite(link) {
  const m = String(link).match(/#uc1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try { return { identity: unb64url(m[1]), rawKey: unb64url(m[2]), token: unb64url(m[3]) }; } catch { return null; }
}

/**
 * The device book. `own` is this browser's device: `{ identity, privateKey, rawKey }` and, for a
 * device added later, the `vouch` another of its devices made. `saved` and `save` let a page keep the
 * book across reloads (plain JSON).
 */
export function deviceBook({ hash, own, saved = null, save = () => {}, random = (n) => crypto.getRandomValues(new Uint8Array(n)) }) {
  const people = new Map(); // identity hex -> Map(device hex -> raw key)
  const tokens = new Map(); // token hex -> { forInvitee: true } (ours) | { identity } (one we hold for an inviter)
  const imported = new Map();
  const learners = new Set();
  if (saved) {
    for (const [identity, devices] of Object.entries(saved.people ?? {})) people.set(identity, new Map(Object.entries(devices)));
    for (const [token, entry] of Object.entries(saved.tokens ?? {})) tokens.set(token, entry);
  }
  const persist = () => save({
    people: Object.fromEntries([...people].map(([i, d]) => [i, Object.fromEntries(d)])),
    tokens: Object.fromEntries(tokens),
  });
  const record = (identity, rawKey) => {
    const device = hex(hash(rawKey));
    const devices = people.get(hex(identity)) ?? new Map();
    if (devices.has(device)) return device;
    devices.set(device, hex(rawKey));
    people.set(hex(identity), devices);
    persist();
    for (const l of learners) l({ identity: hex(identity), device });
    return device;
  };
  const ownDevice = hash(own.rawKey);
  record(own.identity, own.rawKey);

  const keyOf = async (identity, device) => {
    const raw = people.get(hex(identity))?.get(hex(device));
    if (!raw) return null;
    if (!imported.has(raw)) imported.set(raw, await crypto.subtle.importKey("raw", unhex(raw), curve, false, ["verify"]));
    return imported.get(raw);
  };
  const verify = async (bytes, signature, identity, device) => {
    const key = signature && (await keyOf(identity, device));
    return Boolean(key) && crypto.subtle.verify(algorithm, key, signature, bytes);
  };

  return {
    // As `signer` and `verdict` for `open` and the transport.
    sign: async (bytes) => new Uint8Array(await crypto.subtle.sign(algorithm, own.privateKey, bytes)),
    verify,
    verdict: async (identity, device) => Boolean(people.get(hex(identity))?.has(hex(device))),
    device: ownDevice,
    rawKey: own.rawKey,
    vouch: own.vouch ?? null,

    /** A link that lets one person reach this one: it carries this device's key and a fresh token. */
    invite(base) {
      const token = random(16);
      tokens.set(hex(token), { forInvitee: true });
      persist();
      return inviteLink(base, { identity: own.identity, rawKey: own.rawKey, token });
    },
    /** Accepts a link: records the inviter's key, keeps the token to show, and returns the inviter. */
    accept(link) {
      const invite = readInvite(link);
      if (!invite || invite.rawKey.length !== 65) return null;
      record(invite.identity, invite.rawKey);
      tokens.set(hex(invite.token), { identity: hex(invite.identity) });
      persist();
      return invite.identity;
    },
    /** What this device shows a peer that challenged it with `nonce`: a ticket per invite it accepted. A ticket reveals nothing of its token. */
    ticketsFor(nonce) {
      return [...tokens].filter(([, e]) => e.identity).map(([t]) => hex(hash(concat(TICKET, unhex(t), nonce))));
    },
    /**
     * Learns a peer's key from its proof: it must hash to the device it claims, and either be known,
     * or come with a ticket for a token this device issued (spent on use), or a vouch from a device
     * of the same identity already known. Returns whether the device is now known.
     */
    async learn({ identity, device, rawKey, tickets = [], vouch = null, nonce }) {
      if (!rawKey || hex(hash(rawKey)) !== hex(device)) return false;
      if (people.get(hex(identity))?.has(hex(device))) return true;
      for (const [token, entry] of tokens) {
        if (!entry.forInvitee) continue;
        if (tickets.includes(hex(hash(concat(TICKET, unhex(token), nonce))))) {
          tokens.delete(token);
          record(identity, rawKey);
          return true;
        }
      }
      if (vouch && (await verify(concat(VOUCH, identity, device), unhex(vouch.signature), identity, unhex(vouch.by)))) {
        record(identity, rawKey);
        return true;
      }
      return false;
    },
    /** A vouch for another device of this person: give it to that device, which shows it to peers. */
    async vouchFor(rawKey) {
      const device = hash(rawKey);
      record(own.identity, rawKey);
      const signature = new Uint8Array(await crypto.subtle.sign(algorithm, own.privateKey, concat(VOUCH, own.identity, device)));
      return { by: hex(ownDevice), signature: hex(signature) };
    },
    /** The devices known for a person, by address. */
    devicesOf: (identity) => [...(people.get(hex(identity))?.keys() ?? [])],
    /** Hears each device learned: `{ identity, device }`, both hex. */
    onLearn(listener) { learners.add(listener); return () => learners.delete(listener); },
  };
}
