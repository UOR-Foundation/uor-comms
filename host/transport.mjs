// Moving events between browsers: WebRTC data channels, with ntfy.sh carrying only the connection
// setup (docs/DESIGN.md decisions 12 and 15). Nothing here decides admission: every event a peer sends
// goes to engine.receive, which checks it as it checks any other.
//
// How two peers meet. Each room has a meeting topic, and each identity has one, derived with BLAKE3
// from the room or identity and the hour, so the relay sees only names that change hourly. A peer
// says hello on its topics; when two hear each other, the one with the larger session id offers.
// Offer and answer travel over the topic whole (no trickle), so setup is two messages each way.
//
// Who sees what. Once the channel opens, each side proves its identity by signing the other's fresh
// nonce with a device key, checked with the caller's signer and verdict, as events are. A room's
// events go only to a peer the room lists as invited or joined, or to another device of this
// identity. After that, each side offers the addresses it holds per room, and sends what the other
// lacks; new events follow as they are admitted. A member relays what it admits to the members it
// is connected to, so two members need not be connected to each other.
import { hex } from "./event.mjs";

const encoder = new TextEncoder();
const DOMAIN = "uor-comms rendezvous v1";
const PROOF = encoder.encode("uor-comms peer proof v1");
const HOUR = 3_600_000;
const SHARED = new Set([1, 2]); // invited, joined
const PART = 3_000; // ntfy.sh takes messages up to 4,096 bytes; larger ones are split.

/**
 * The default ICE servers: one public STUN server, which learns each peer's public address and nothing
 * else. Without STUN two peers on different networks cannot find a direct path. No TURN: a relay for
 * peers that cannot connect directly is not built yet.
 */
export const PUBLIC_STUN = [{ urls: "stun:stun.l.google.com:19302" }];

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** A meeting topic: the first 40 hex digits of BLAKE3 over the domain, the kind, the id and the hour. */
export function topicFor(hash, kind, id, hour) {
  const hourBytes = new Uint8Array(8);
  new DataView(hourBytes.buffer).setBigUint64(0, BigInt(hour));
  return "uc" + hex(hash(concat(encoder.encode(DOMAIN + " " + kind), id, hourBytes))).slice(0, 40);
}

/** ntfy.sh, or any server that speaks its publish and server-sent-events subset, as a rendezvous. */
export function ntfyRendezvous({ base = "https://ntfy.sh", fetcher = globalThis.fetch, EventSourceClass = globalThis.EventSource } = {}) {
  const root = base.endsWith("/") ? base : base + "/";
  return {
    publish: (topic, text) => fetcher(root + topic, { method: "POST", body: text }).then(() => undefined),
    /** One stream for every topic (ntfy takes a comma-separated list), so a page holds one connection. */
    subscribe(topics, handler) {
      const source = new EventSourceClass(root + topics.join(",") + "/sse");
      source.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.event === "message" && typeof data.message === "string") handler(data.topic, data.message);
        } catch { /* not ntfy's shape: ignored */ }
      };
      return () => source.close();
    },
  };
}

export function webrtcTransport({
  rendezvous, signer, verdict, hash, store,
  RTCPeerConnectionClass = globalThis.RTCPeerConnection,
  iceServers = PUBLIC_STUN, helloEvery = 10_000, now = () => Date.now(), random = (n) => crypto.getRandomValues(new Uint8Array(n)),
}) {
  const self = hex(random(16));
  const peers = new Map(); // session id -> peer
  let topics = new Set(); // topic names heard now
  let closeStream = null;
  const pending = new Map(); // request id -> resolve
  const parts = new Map(); // message id -> received parts
  const statusListeners = new Set();
  let engine = null;
  let timer = null;
  let status = "offline";
  const reached = new Set(); // identities to meet though no room is shared yet
  const unhexId = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

  const setStatus = () => {
    const next = [...peers.values()].some((p) => p.identity) ? "online"
      : peers.size > 0 || topics.size > 0 ? "connecting" : "offline";
    if (next === status) return;
    status = next;
    for (const listener of statusListeners) listener(status);
  };

  /** The rooms a peer may see: those listing it as invited or joined, or all, for this identity's own devices. */
  const mayShare = (peer, room) => peer.identity && (peer.identity === hex(engine.identity)
    || engine.members(room).some((m) => m.member === peer.identity && SHARED.has(m.status)));

  const send = (peer, message) => {
    if (peer.channel?.readyState === "open") peer.channel.send(JSON.stringify(message));
  };

  const sendEvent = (peer, { address, bytes, signature }) => {
    const key = hex(address);
    if (peer.sent.has(key)) return;
    peer.sent.add(key);
    send(peer, { t: "event", bytes: b64(bytes), signature: signature ? b64(signature) : null, address: b64(address) });
  };

  async function publish(topic, message) {
    const text = JSON.stringify(message);
    if (text.length <= PART) return rendezvous.publish(topic, text);
    const id = hex(random(8));
    const count = Math.ceil(text.length / PART);
    for (let i = 0; i < count; i++) await rendezvous.publish(topic, JSON.stringify({ t: "part", id, i, count, text: text.slice(i * PART, (i + 1) * PART) }));
  }

  function onSignal(topic, text) {
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (message.t === "part") {
      const got = parts.get(message.id) ?? [];
      got[message.i] = message.text;
      parts.set(message.id, got);
      if (got.filter((x) => x !== undefined).length < message.count) return;
      parts.delete(message.id);
      return onSignal(topic, got.join(""));
    }
    if (message.from === self || (message.to && message.to !== self)) return;
    if (message.t === "hello") return hello(topic, message.from);
    if (message.t === "offer") return answer(topic, message.from, message.sdp);
    if (message.t === "answer") return peers.get(message.from)?.pc.setRemoteDescription({ type: "answer", sdp: message.sdp }).catch(() => drop(message.from));
  }

  async function gathered(pc) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const done = () => { if (pc.iceGatheringState === "complete") resolve(); };
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, 3_000);
    });
  }

  function peerFor(from, pc) {
    const peer = { id: from, pc, channel: null, identity: null, nonce: random(32), sent: new Set(), early: [] };
    peers.set(from, peer);
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) drop(from);
    });
    setStatus();
    return peer;
  }

  function useChannel(peer, channel) {
    peer.channel = channel;
    channel.onopen = () => send(peer, { t: "nonce", nonce: b64(peer.nonce) });
    channel.onmessage = (e) => onPeerMessage(peer, e.data).catch(() => {});
    channel.onclose = () => drop(peer.id);
  }

  async function hello(topic, from) {
    if (peers.has(from)) return;
    if (self < from) return publish(topic, { t: "hello", from: self }); // the larger id offers
    const pc = new RTCPeerConnectionClass({ iceServers });
    const peer = peerFor(from, pc);
    useChannel(peer, pc.createDataChannel("uor-comms"));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await publish(topic, { t: "offer", from: self, to: from, sdp: pc.localDescription.sdp });
  }

  async function answer(topic, from, sdp) {
    if (peers.has(from)) return;
    const pc = new RTCPeerConnectionClass({ iceServers });
    const peer = peerFor(from, pc);
    pc.ondatachannel = (e) => useChannel(peer, e.channel);
    await pc.setRemoteDescription({ type: "offer", sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await publish(topic, { t: "answer", from: self, to: from, sdp: pc.localDescription.sdp });
  }

  function drop(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    try { peer.pc.close(); } catch { /* already closed */ }
    setStatus();
  }

  async function onPeerMessage(peer, data) {
    const message = JSON.parse(data);
    if (message.t === "nonce") {
      const nonce = unb64(message.nonce);
      const signature = await signer.sign(concat(PROOF, nonce));
      // The device key, a ticket per accepted invite and any vouch travel with the proof (host/trust.mjs).
      return send(peer, { t: "proof", identity: b64(engine.identity), device: b64(engine.device), signature: b64(signature),
        key: signer.rawKey ? b64(signer.rawKey) : null, tickets: signer.ticketsFor?.(nonce) ?? [], vouch: signer.vouch ?? null });
    }
    if (message.t === "proof") {
      const identity = unb64(message.identity), device = unb64(message.device);
      if (signer.learn && message.key) {
        await signer.learn({ identity, device, rawKey: unb64(message.key), tickets: message.tickets ?? [], vouch: message.vouch, nonce: peer.nonce });
      }
      const proven = (await signer.verify(concat(PROOF, peer.nonce), unb64(message.signature), identity, device))
        && (await verdict(identity, device));
      if (!proven) return drop(peer.id);
      peer.identity = hex(identity);
      setStatus();
      // What arrived before this side had checked the proof is handled now, in order.
      for (const data of peer.early.splice(0)) await onPeerMessage(peer, data);
      for (const room of engine.rooms()) {
        if (mayShare(peer, room)) send(peer, { t: "have", room: b64(room), addresses: engine.eventsOf(room).map((e) => hex(e.address)) });
      }
      return;
    }
    if (!peer.identity) { peer.early.push(data); return; } // held until the proof is checked
    if (message.t === "have") {
      const room = unb64(message.room);
      const held = new Set(engine.eventsOf(room).map((e) => hex(e.address)));
      for (const a of message.addresses) peer.sent.add(a); // the peer has these
      const wanted = message.addresses.filter((a) => !held.has(a));
      if (wanted.length) send(peer, { t: "want", room: message.room, addresses: wanted });
      return;
    }
    if (message.t === "want") {
      const room = unb64(message.room);
      if (!mayShare(peer, room)) return;
      const wanted = new Set(message.addresses);
      for (const e of engine.eventsOf(room)) if (wanted.has(hex(e.address))) sendEvent(peer, e);
      return;
    }
    if (message.t === "event") {
      const address = unb64(message.address);
      peer.sent.add(hex(address));
      await engine.receive({ address, bytes: unb64(message.bytes), signature: message.signature ? unb64(message.signature) : null });
      return;
    }
    if (message.t === "get") {
      const bytes = await store.get(unb64(message.address));
      return send(peer, { t: "got", id: message.id, bytes: bytes ? b64(bytes) : null });
    }
    if (message.t === "got") pending.get(message.id)?.(message.bytes ? unb64(message.bytes) : null);
  }

  function refreshTopics() {
    const hour = Math.floor(now() / HOUR);
    const wanted = new Set();
    const ids = [["identity", engine.identity], ...[...reached].map((i) => ["identity", unhexId(i)]), ...engine.rooms().map((room) => ["room", room])];
    for (const room of engine.rooms()) {
      for (const m of engine.members(room)) if (SHARED.has(m.status)) ids.push(["identity", Uint8Array.from(m.member.match(/../g).map((x) => parseInt(x, 16)))]);
    }
    const current = new Set();
    for (const [kind, id] of ids) {
      current.add(topicFor(hash, kind, id, hour));
      for (const h of [hour, hour - 1]) wanted.add(topicFor(hash, kind, id, h));
    }
    const same = wanted.size === topics.size && [...wanted].every((t) => topics.has(t));
    if (!same) {
      closeStream?.();
      topics = wanted;
      closeStream = rendezvous.subscribe([...wanted].sort(), (topic, text) => onSignal(topic, text));
    }
    setStatus();
    return [...current]; // hellos go to this hour's topics; last hour's are still heard
  }

  async function sayHello() {
    for (const topic of refreshTopics()) await publish(topic, { t: "hello", from: self }).catch(() => {});
  }

  return {
    /** Called by `open`: from here on the transport knows the engine it serves. */
    bind(api) {
      engine = api;
      engine.subscribe(({ room, address }) => {
        const event = engine.eventsOf(room).find((e) => hex(e.address) === hex(address));
        if (!event) return;
        for (const peer of peers.values()) if (mayShare(peer, room)) sendEvent(peer, event);
        refreshTopics();
      });
    },
    /** Starts meeting peers: says hello on every topic now and every `helloEvery` milliseconds. */
    async start() {
      await sayHello();
      timer = setInterval(() => sayHello().catch(() => {}), helloEvery);
    },
    stop() {
      clearInterval(timer);
      closeStream?.();
      closeStream = null;
      topics = new Set();
      for (const id of [...peers.keys()]) drop(id);
      setStatus();
    },
    /** The engine gives each new event here; it goes to every connected peer that may see its room. */
    async announce(message) {
      const room = engine.rooms().find((r) => engine.eventsOf(r).some((e) => hex(e.address) === hex(message.address)));
      for (const peer of peers.values()) if (!room || mayShare(peer, room)) sendEvent(peer, message);
    },
    /** Bytes by address from any connected peer, checked against the address; null after five seconds. */
    async fetch(address) {
      const ready = [...peers.values()].filter((p) => p.identity);
      if (!ready.length) return null;
      return new Promise((resolve) => {
        let open = ready.length;
        const ids = [];
        const finish = (bytes) => { for (const id of ids) pending.delete(id); resolve(bytes); };
        const timeout = setTimeout(() => finish(null), 5_000);
        for (const peer of ready) {
          const id = hex(random(8));
          ids.push(id);
          pending.set(id, (bytes) => {
            if (bytes && hex(hash(bytes)) === hex(address)) { clearTimeout(timeout); finish(bytes); }
            else if (--open === 0) { clearTimeout(timeout); finish(null); }
          });
          send(peer, { t: "get", id, address: b64(address) });
        }
      });
    },
    /** Meets a person by identity though no room is shared yet: after accepting their invite. */
    reach(identity) {
      reached.add(hex(identity));
      if (engine) sayHello().catch(() => {});
    },
    /** `offline`, `connecting` (meeting topics held, no proven peer) or `online` (at least one proven peer). */
    get status() { return status; },
    onStatus(listener) { statusListeners.add(listener); return () => statusListeners.delete(listener); },
    /** The identities of the proven peers connected now. */
    peers: () => [...peers.values()].filter((p) => p.identity).map((p) => p.identity),
  };
}
