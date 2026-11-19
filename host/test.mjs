// Two peers, one kernel holo, no network: each peer's announce is handed to the other's receive.
// Run with the holo to test against:  HOLO=<path to Room kernel.holo> node --test host/test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { blake3 } from "../try/vendor/prism-code/src/blake3.mjs";
import { loadArchive } from "../try/vendor/prism-code/src/index.mjs";
import { open } from "./engine.mjs";
import { ACTION, decode, encode, hex } from "./event.mjs";
import { kernel as kernelOver } from "./kernel.mjs";
import { memoryStore } from "./store.mjs";

const holo = process.env.HOLO;
if (!holo) throw new Error("set HOLO to the room kernel holo to test against");
const app = await loadArchive(new Uint8Array(await readFile(holo)));
const kernel = kernelOver((request) => app.dispatch(request));
const hash = (bytes) => blake3(bytes);
const text = (value) => new TextEncoder().encode(value);

// Devices known to the test, by address: the stand-in for Prism ID's device log.
const devices = new Map();

async function peer(name, wire) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const identity = hash(text(`identity ${name}`));
  const device = hash(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  devices.set(hex(device), { identity: hex(identity), key: keys.publicKey });
  const algorithm = { name: "ECDSA", hash: "SHA-256" };
  const store = memoryStore(hash);
  const engine = open({
    identity, device, kernel, hash, store,
    signer: {
      sign: async (bytes) => new Uint8Array(await crypto.subtle.sign(algorithm, keys.privateKey, bytes)),
      verify: async (bytes, signature, _sender, signedBy) => {
        const known = devices.get(hex(signedBy));
        return Boolean(known && signature) && crypto.subtle.verify(algorithm, known.key, signature, bytes);
      },
    },
    verdict: async (sender, signedBy) => devices.get(hex(signedBy))?.identity === hex(sender),
    transport: {
      announce: async (message) => { for (const other of wire.peers) if (other !== engine) await wire.deliver(other, message); },
      fetch: async (address) => { for (const other of wire.stores) { const held = await other.get(address); if (held) return held; } return null; },
    },
  });
  wire.peers.push(engine);
  wire.stores.push(store);
  return { engine, identity, device, store };
}

const direct = () => {
  const wire = { peers: [], stores: [], deliver: (other, message) => other.receive(message) };
  return wire;
};
const standing = (engine, room, member) => engine.members(room).find((m) => m.member === hex(member));

test("event bytes read back as the fields they were laid out from", () => {
  const a = hash(text("a"));
  const b = hash(text("b"));
  const fields = decode(encode({ action: ACTION.send, room: a, sender: b, device: a, content: b, parents: [b, a, b] }));
  assert.equal(fields.action, ACTION.send);
  assert.deepEqual(fields.parents.map(hex), [a, b].map(hex).sort());
  assert.equal(decode(new Uint8Array(7)), null);
});

test("a direct chat: create, join, and a message each way reach both peers in one order", async () => {
  const wire = direct();
  const ada = await peer("ada", wire);
  const ben = await peer("ben", wire);
  const steps = [];
  const room = await ada.engine.createDirect(ben.identity, { onStep: (step) => steps.push(step) });
  assert.deepEqual(steps, ["sign", "store", "announce"]);
  assert.deepEqual(standing(ben.engine, room, ada.identity), { member: hex(ada.identity), status: 2, power: 100 });
  assert.equal(standing(ben.engine, room, ben.identity).status, 1);

  await ben.engine.join(room);
  assert.equal(standing(ada.engine, room, ben.identity).status, 2);

  const first = await ada.engine.send(room, text("hello"));
  const second = await ben.engine.send(room, text("hello back"));
  for (const side of [ada, ben]) {
    const timeline = side.engine.timeline(room);
    assert.deepEqual(timeline.map((event) => event.action), [ACTION.create, ACTION.join, ACTION.send, ACTION.send]);
    assert.deepEqual(timeline.slice(2).map((event) => hex(event.address)), [first, second].map(hex));
  }
  const received = ben.engine.timeline(room)[2];
  assert.equal(new TextDecoder().decode(await ben.engine.content(received.content)), "hello");
});

test("a stranger cannot write, and a peer refuses an event the sender was not permitted", async () => {
  const wire = direct();
  const ada = await peer("ada", wire);
  const ben = await peer("ben", wire);
  const eve = await peer("eve", wire);
  const room = await ada.engine.createDirect(ben.identity);
  await assert.rejects(eve.engine.send(room, text("let me in")), { reason: "refused" });
  await assert.rejects(eve.engine.join(room), { reason: "refused" });
  // Eve writes the bytes anyway and signs them with her own device.
  const head = ada.engine.timeline(room).at(-1).address;
  const bytes = encode({ action: ACTION.send, room, sender: eve.identity, device: eve.device, parents: [head] });
  const signature = new Uint8Array(64);
  const result = await ada.engine.receive({ address: hash(bytes), bytes, signature });
  assert.equal(result.admitted, false);
  assert.equal(ada.engine.timeline(room).length, 1);
});

test("a tampered event, a wrong address and a device of another identity are refused", async () => {
  const wire = direct();
  const seen = [];
  wire.deliver = async (_other, message) => { seen.push(message); };
  const ada = await peer("ada", wire);
  const ben = await peer("ben", wire);
  const mal = await peer("mal", wire);
  await ada.engine.createDirect(ben.identity);
  const [creation] = seen;
  const tampered = creation.bytes.slice();
  tampered[tampered.length - 1 - 8 * 6] ^= 1;
  assert.equal((await ben.engine.receive({ ...creation, bytes: tampered })).admitted, false);
  assert.equal((await ben.engine.receive({ ...creation, address: hash(text("other")) })).admitted, false);
  // Mal signs as Ada with Mal's own device: the verdict on the device refuses it.
  const forged = encode({ action: ACTION.create, sender: ada.identity, device: mal.device, target: ben.identity });
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
    (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])).privateKey, forged));
  assert.equal((await ben.engine.receive({ address: hash(forged), bytes: forged, signature })).admitted, false);
  assert.equal(ben.engine.rooms().length, 0);
  assert.equal((await ben.engine.receive(creation)).admitted, true);
  assert.equal((await ben.engine.receive(creation)).known, true);
  assert.equal(ben.store.size, 1);
});

test("events that arrive out of order are held and land in the same order on both peers", async () => {
  const wire = direct();
  const sent = [];
  wire.deliver = async (_other, message) => { sent.push(message); };
  const ada = await peer("ada", wire);
  const ben = await peer("ben", wire);
  const room = await ada.engine.createDirect(ben.identity);
  await ada.engine.send(room, text("one"));
  await ada.engine.send(room, text("two"));
  for (const message of [...sent].reverse()) await ben.engine.receive(message);
  assert.deepEqual(ben.engine.timeline(room).map((e) => hex(e.address)), ada.engine.timeline(room).map((e) => hex(e.address)));
  assert.equal(ben.engine.timeline(room).length, 3);
});

test("two peers who write at once agree on the order once each has the other's event", async () => {
  const wire = direct();
  const held = [];
  const ada = await peer("ada", wire);
  const ben = await peer("ben", wire);
  const room = await ada.engine.createDirect(ben.identity);
  await ben.engine.join(room);
  wire.deliver = async (other, message) => { held.push([other, message]); };
  await ada.engine.send(room, text("from ada"));
  await ben.engine.send(room, text("from ben"));
  for (const [other, message] of held) await other.receive(message);
  const order = (side) => side.engine.timeline(room).map((e) => hex(e.address));
  assert.equal(order(ada).length, 4);
  assert.deepEqual(order(ada), order(ben));
  // The next event cites both heads.
  wire.deliver = (other, message) => other.receive(message);
  const next = await ada.engine.send(room, text("after both"));
  assert.equal(ada.engine.timeline(room).at(-1).parents.length, 2);
  assert.equal(hex(ben.engine.timeline(room).at(-1).address), hex(next));
});

test("moderation: the creator bans a member, whose later event every peer refuses", async () => {
  const wire = direct();
  const ada = await peer("ada", wire);
  const ben = await peer("ben", wire);
  const room = await ada.engine.createDirect(ben.identity);
  await ben.engine.join(room);
  await ada.engine.ban(room, ben.identity);
  assert.equal(standing(ben.engine, room, ben.identity).status, 4);
  await assert.rejects(ben.engine.send(room, text("still here")), { reason: "refused" });
  await assert.rejects(ben.engine.ban(room, ada.identity), { reason: "refused" });
});
