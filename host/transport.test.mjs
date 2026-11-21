// The WebRTC transport between two real browser pages. They meet through a local server that speaks
// ntfy.sh's publish and server-sent-events subset, prove their identities over the data channel,
// sync what each lacks, forward new events, and serve content by address.
// Run with:  node --test host/transport.test.mjs   (needs Playwright's Chromium)
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const page = `<!doctype html><meta charset="utf-8"><title>peer</title><script type="module">
import { webrtcTransport, ntfyRendezvous } from "/host/transport.mjs";
import { memoryStore } from "/host/store.mjs";
import { hex, unhex } from "/host/event.mjs";
import { deviceBook, newDeviceKey } from "/host/trust.mjs";
import { blake3 } from "/try/vendor/prism-code/src/blake3.mjs";
const hash = (b) => blake3(b);
const text = (t) => new TextEncoder().encode(t);
window.setup = async (name, other, holds = true, lossy = false, { refuse = [], forward = false } = {}) => {
  const identity = hash(text("identity " + name));
  const book = deviceBook({ hash, own: { identity, ...(await newDeviceKey()) } });
  const device = book.device;
  const room = hash(text("the room"));
  // An event "member <name>" lists that person; a device that holds no room yet lists nobody.
  const members = holds ? [hex(identity), ...[].concat(other).map((o) => hex(hash(text("identity " + o))))] : [];
  let held = holds;
  const contents = new Set();
  const marks = new Map();
  const events = [];
  const listeners = new Set();
  const store = memoryStore(hash);
  const engine = {
    identity, device,
    rooms: () => (held ? [room] : []),
    members: () => members.map((member) => ({ member, status: 2 })),
    carries: (_room, address) => contents.has(hex(address)),
    // Receipts are checked by the engine (host/test.mjs); here the latest per reader is kept.
    receiveReceipt: async (r) => {
      const key = hex(r.identity);
      if (marks.has(key) && hex(marks.get(key).address) === hex(r.address)) return false;
      marks.set(key, r);
      return true;
    },
    receipts: () => [...marks.values()],
    // The kernel's mayForward is tested in host/test.mjs; here a member that consents may forward.
    mayForward: async (_room, { consented }) => consented && held,
    eventsOf: () => events.slice(),
    eventOf: (_room, address) => events.find((e) => hex(e.address) === hex(address)) ?? null,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    async receive(message) {
      if (events.some((e) => hex(e.address) === hex(message.address))) return { admitted: true, known: true };
      if (hex(hash(message.bytes)) !== hex(message.address)) return { admitted: false, reason: "tampered" };
      events.push(message);
      held = true;
      const said = new TextDecoder().decode(message.bytes);
      if (said.startsWith("member ")) {
        const member = hex(hash(text("identity " + said.slice(7))));
        if (!members.includes(member)) members.push(member);
      }
      for (const l of listeners) l({ room, address: message.address });
      return { admitted: true };
    },
  };
  // A lossy relay loses this peer's first offer, as a reply can be lost before the other side's stream listens.
  const relay = ntfyRendezvous({ base: location.origin + "/ntfy/" });
  let lost = !lossy;
  const rendezvous = { ...relay, publish: (topic, text) => {
    if (!lost && JSON.parse(text).t === "offer") { lost = true; return Promise.resolve(); }
    return relay.publish(topic, text);
  } };
  // A peer refused here never connects directly: a stand-in for two networks with no path between them.
  const refused = new Set([].concat(refuse).map((o) => hex(hash(text("identity " + o)))));
  const verdict = (identity, device) => (refused.has(hex(identity)) ? false : book.verdict(identity, device));
  const transport = webrtcTransport({
    rendezvous,
    signer: book,
    verdict,
    hash, store, helloEvery: 500, setupWithin: 10_000, typingFor: 1_500, forward,
  });
  transport.bind(engine);
  window.peer = { engine, transport, store, events, contents, marks, hash, text, hex, book };
  window.markRead = async (address) => {
    const receipt = { room, identity, device, address: Uint8Array.from(address), signature: new Uint8Array(64) };
    await engine.receiveReceipt(receipt);
    transport.receipt(receipt);
  };
  window.invite = () => book.invite(location.origin + "/");
  window.accept = (link) => { const inviter = book.accept(link); transport.reach(inviter); return hex(inviter); };
  window.reachOnly = (identityHex) => transport.reach(unhex(identityHex));
  return { device: hex(device), identity: hex(identity) };
};
window.ready = true;
</script>`;

/** Serves the repository, the test page, and a minimal ntfy: POST /ntfy/<topic>, GET /ntfy/<topic>/sse. */
async function serve() {
  const streams = new Map();
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const ntfy = path.match(/^\/ntfy\/([A-Za-z0-9_,-]{1,2000})(\/sse)?$/);
    if (ntfy && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const event = JSON.stringify({ id: String(Date.now()), time: 0, event: "message", topic: ntfy[1], message: body });
      for (const s of streams.get(ntfy[1]) ?? []) s.write(`data: ${event}\n\n`);
      return response.writeHead(200, { "content-type": "application/json" }).end("{}");
    }
    if (ntfy && ntfy[2]) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`data: ${JSON.stringify({ event: "open", topic: ntfy[1] })}\n\n`);
      for (const topic of ntfy[1].split(",")) {
        const set = streams.get(topic) ?? new Set();
        set.add(response);
        streams.set(topic, set);
        request.on("close", () => set.delete(response));
      }
      return;
    }
    try {
      if (path === "/") return response.writeHead(200, { "content-type": types[".html"] }).end(page);
      const file = join(root, normalize(decodeURIComponent(path)).replace(/^([/\\]|\.\.)+/, ""));
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/`, close: () => { for (const set of streams.values()) for (const s of set) s.end(); server.close(); } };
}

test("two browsers meet over the rendezvous, prove their identities, sync, forward and serve content", async (t) => {
  const { url, close } = await serve();
  t.after(close);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const errors = [];
  const open = async (name, other, holds = true) => {
    const tab = await (await browser.newContext()).newPage();
    tab.on("pageerror", (e) => errors.push(e));
    await tab.goto(url);
    await tab.waitForFunction(() => window.ready === true);
    return { tab, info: await tab.evaluate(([n, o, h]) => window.setup(n, o, h), [name, other, holds]) };
  };
  const ada = await open("ada", ["ben", "cam"]);
  const ben = await open("ben", ["ada", "cam"]);
  // Ben accepts Ada's invite link: he learns her key from it, and she learns his from the token he shows.
  const link = await ada.tab.evaluate(() => window.invite());
  assert.equal(await ben.tab.evaluate((l) => window.accept(l), link), ada.info.identity);

  // Ada holds an event before Ben is connected: it must arrive by the sync on connect.
  await ada.tab.evaluate(async () => {
    const { engine, hash, text } = window.peer;
    const bytes = text("first event");
    await engine.receive({ address: hash(bytes), bytes, signature: null });
  });
  await Promise.all([ada, ben].map(({ tab }) => tab.evaluate(() => window.peer.transport.start())));
  for (const { tab } of [ada, ben]) await tab.waitForFunction(() => window.peer.transport.status === "online", null, { timeout: 30_000 });
  await ben.tab.waitForFunction(() => window.peer.events.length === 1, null, { timeout: 10_000 });
  assert.equal(await ada.tab.evaluate(() => window.peer.transport.delivered(window.peer.events[0].address)), true);

  // A new event Ada announces reaches Ben; content Ada stores is fetched by Ben and checked.
  const contentAddress = await ada.tab.evaluate(async () => {
    const { engine, transport, store, hash, text } = window.peer;
    const bytes = text("second event");
    const message = { address: hash(bytes), bytes, signature: null };
    await engine.receive(message);
    await transport.announce(message);
    const content = await store.put(text("some content"));
    window.peer.contents.add(window.peer.hex(content));
    await store.put(text("named by no event"));
    return Array.from(content);
  });
  await ben.tab.waitForFunction(() => window.peer.events.length === 2, null, { timeout: 10_000 });
  const fetched = await ben.tab.evaluate(async (address) => {
    const bytes = await window.peer.transport.fetch(Uint8Array.from(address));
    return bytes && new TextDecoder().decode(bytes);
  }, contentAddress);
  assert.equal(fetched, "some content");
  // Content no admitted message names is not served, even to a member.
  assert.equal(await ben.tab.evaluate(async () => {
    const { transport, hash, text } = window.peer;
    return transport.fetch(hash(text("named by no event")));
  }), null);
  assert.deepEqual(await ben.tab.evaluate(() => window.peer.transport.peers()), [ada.info.identity]);

  // A receipt reaches a connected member at once, and a member who connects later on connect.
  await ada.tab.evaluate(() => window.markRead(Array.from(window.peer.events[0].address)));
  await ben.tab.waitForFunction(() => window.peer.marks.size === 1, null, { timeout: 5_000 });

  // Typing is ephemeral: Ben hears Ada start and stop, and a notice not renewed runs out.
  const typingIn = (side) => side.tab.evaluate(() => window.peer.transport.typingIn(window.peer.engine.rooms()[0]));
  await ada.tab.evaluate(() => window.peer.transport.typing(window.peer.engine.rooms()[0], true));
  await ben.tab.waitForFunction((a) => window.peer.transport.typingIn(window.peer.engine.rooms()[0]).includes(a), ada.info.identity, { timeout: 5_000 });
  await ada.tab.evaluate(() => window.peer.transport.typing(window.peer.engine.rooms()[0], false));
  await ben.tab.waitForFunction(() => window.peer.transport.typingIn(window.peer.engine.rooms()[0]).length === 0, null, { timeout: 5_000 });
  await ada.tab.evaluate(() => window.peer.transport.typing(window.peer.engine.rooms()[0], true));
  await ben.tab.waitForFunction(() => window.peer.transport.typingIn(window.peer.engine.rooms()[0]).length === 1, null, { timeout: 5_000 });
  await ben.tab.waitForTimeout(2_000);
  assert.deepEqual(await typingIn(ben), []);
  assert.equal(await ben.tab.evaluate(() => window.peer.events.length), 2); // nothing typed became an event
  assert.deepEqual(await ada.tab.evaluate(() => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity ben"))).length), 1);

  // Cam accepts only Ada's link. Once Ada announces Cam as a member, she introduces Ben to Cam and Cam to Ben
  // (decision 20), so Cam and Ben meet and prove themselves without a reconnect.
  const cam = await open("cam", ["ada", "ben"]);
  const camLink = await ada.tab.evaluate(() => window.invite());
  await cam.tab.evaluate((l) => window.accept(l), camLink);
  await cam.tab.evaluate(() => window.peer.transport.start());
  await ada.tab.waitForFunction((c) => window.peer.transport.peers().includes(c), cam.info.identity, { timeout: 30_000 });
  await ada.tab.evaluate(async () => {
    const { engine, transport, hash, text } = window.peer;
    const bytes = text("member cam");
    const message = { address: hash(bytes), bytes, signature: null };
    await engine.receive(message);
    await transport.announce(message);
  });
  await cam.tab.waitForFunction((b) => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity ben"))).length === 1, null, { timeout: 30_000 });
  await cam.tab.waitForFunction((b) => window.peer.transport.peers().includes(b), ben.info.identity, { timeout: 30_000 });
  await cam.tab.waitForFunction(() => window.peer.events.length === 3, null, { timeout: 10_000 });
  await cam.tab.waitForFunction(() => window.peer.marks.size >= 1, null, { timeout: 10_000 });

  // stop() is final: no hello or event brings the transport back.
  await cam.tab.evaluate(() => window.peer.transport.stop());
  await cam.tab.waitForTimeout(1_500);
  assert.equal(await cam.tab.evaluate(() => window.peer.transport.status), "offline");

  // Eve knows Ada's identity but holds no link: Ada never accepts her, and the spent token admits nobody else.
  const eve = await open("eve", "ada");
  await eve.tab.evaluate((i) => window.reachOnly(i), ada.info.identity);
  await eve.tab.evaluate(() => window.peer.transport.start());
  await eve.tab.waitForTimeout(5_000);
  assert.notEqual(await eve.tab.evaluate(() => window.peer.transport.status), "online");
  assert.equal(await eve.tab.evaluate(() => window.peer.events.length), 0);
  assert.deepEqual(errors, []);
});

test("a member invited while connected is introduced to the others, and they to it, in the same session", async (t) => {
  const { url, close } = await serve();
  t.after(close);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const errors = [];
  const open = async (name, other, holds = true) => {
    const tab = await (await browser.newContext()).newPage();
    tab.on("pageerror", (e) => errors.push(e));
    await tab.goto(url);
    await tab.waitForFunction(() => window.ready === true);
    return { tab, info: await tab.evaluate(([n, o, h]) => window.setup(n, o, h), [name, other, holds]) };
  };
  const devicesOf = (side, name) => side.tab.evaluate((n) => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity " + n))).length, name);
  const say = (side, words) => side.tab.evaluate(async (w) => {
    const { engine, transport, hash, text } = window.peer;
    const bytes = text(w);
    const message = { address: hash(bytes), bytes, signature: null };
    await engine.receive(message);
    await transport.announce(message);
  }, words);

  // Dan and Fay share the room and are connected. Gus holds no room and knows only Dan's link.
  const dan = await open("dan", ["fay"]);
  const fay = await open("fay", ["dan"]);
  await fay.tab.evaluate((l) => window.accept(l), await dan.tab.evaluate(() => window.invite()));
  await Promise.all([dan, fay].map(({ tab }) => tab.evaluate(() => window.peer.transport.start())));
  await fay.tab.waitForFunction((d) => window.peer.transport.peers().includes(d), dan.info.identity, { timeout: 30_000 });
  await say(dan, "member dan");
  await say(dan, "member fay");
  const gus = await open("gus", [], false);
  await gus.tab.evaluate((l) => window.accept(l), await dan.tab.evaluate(() => window.invite()));
  await gus.tab.evaluate(() => window.peer.transport.start());
  await dan.tab.waitForFunction((g) => window.peer.transport.peers().includes(g), gus.info.identity, { timeout: 30_000 });
  assert.equal(await devicesOf(fay, "gus"), 0);

  // Dan lists Gus while all three are connected: Fay is told of Gus before she lists him, and Gus of Fay
  // before he holds the room. Each keeps the introduction until the event that lets it judge arrives.
  await say(dan, "member gus");
  await fay.tab.waitForFunction(() => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity gus"))).length === 1, null, { timeout: 15_000 });
  await gus.tab.waitForFunction(() => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity fay"))).length === 1, null, { timeout: 15_000 });
  await gus.tab.waitForFunction((f) => window.peer.transport.peers().includes(f), fay.info.identity, { timeout: 30_000 });
  for (const side of [dan, fay, gus]) await side.tab.evaluate(() => window.peer.transport.stop());
  assert.deepEqual(errors, []);
});

test("a peer whose offer was lost is set up again once the setup deadline passes", async (t) => {
  const { url, close } = await serve();
  t.after(close);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const errors = [];
  const open = async (name, other) => {
    const tab = await (await browser.newContext()).newPage();
    tab.on("pageerror", (e) => errors.push(e));
    await tab.goto(url);
    await tab.waitForFunction(() => window.ready === true);
    return { tab, info: await tab.evaluate(([n, o]) => window.setup(n, o, true, true), [name, other]) };
  };
  // Both relays lose their first offer, so whichever side offers loses one, and the first setup never completes.
  const ivy = await open("ivy", ["joe"]);
  const joe = await open("joe", ["ivy"]);
  await joe.tab.evaluate((l) => window.accept(l), await ivy.tab.evaluate(() => window.invite()));
  await Promise.all([ivy, joe].map(({ tab }) => tab.evaluate(() => window.peer.transport.start())));
  await joe.tab.waitForFunction((i) => window.peer.transport.peers().includes(i), ivy.info.identity, { timeout: 40_000 });
  await ivy.tab.waitForFunction((j) => window.peer.transport.peers().includes(j), joe.info.identity, { timeout: 10_000 });
  for (const side of [ivy, joe]) await side.tab.evaluate(() => window.peer.transport.stop());
  assert.deepEqual(errors, []);
});

test("a consenting member fetches content for a member with no direct path to its holder, and stops when consent is withdrawn", async (t) => {
  const { url, close } = await serve();
  t.after(close);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const errors = [];
  const open = async (name, other, options) => {
    const tab = await (await browser.newContext()).newPage();
    tab.on("pageerror", (e) => errors.push(e));
    await tab.goto(url);
    await tab.waitForFunction(() => window.ready === true);
    return { tab, info: await tab.evaluate(([n, o, opt]) => window.setup(n, o, true, false, opt), [name, other, options]) };
  };
  // Ana and Cy refuse each other's proofs, so they never connect; Bo reaches both and consents to forward.
  const ana = await open("ana", ["bo", "cy"], { refuse: ["cy"] });
  const bo = await open("bo", ["ana", "cy"], { forward: true });
  const cy = await open("cy", ["ana", "bo"], { refuse: ["ana"] });
  for (const side of [ana, cy]) await side.tab.evaluate((l) => window.accept(l), await bo.tab.evaluate(() => window.invite()));
  await Promise.all([ana, bo, cy].map(({ tab }) => tab.evaluate(() => window.peer.transport.start())));
  for (const side of [ana, cy]) await bo.tab.waitForFunction((i) => window.peer.transport.peers().includes(i), side.info.identity, { timeout: 30_000 });
  // Each side checks the other's proof in its own time: wait for Ana's and Cy's view of Bo too.
  for (const side of [ana, cy]) await side.tab.waitForFunction((b) => window.peer.transport.peers().includes(b), bo.info.identity, { timeout: 30_000 });
  // Only Ana holds the bytes; every member's engine has admitted the message that names them.
  const address = await ana.tab.evaluate(async () => {
    const { store, text, hex, contents } = window.peer;
    const at = await store.put(text("from the other network"));
    contents.add(hex(at));
    return Array.from(at);
  });
  for (const side of [bo, cy]) await side.tab.evaluate((a) => window.peer.contents.add(window.peer.hex(Uint8Array.from(a))), address);
  assert.equal(await cy.tab.evaluate(() => window.peer.transport.peers().length), 1);
  // Events already cross: Bo relays what it admits to the members it reaches.
  await ana.tab.evaluate(async () => {
    const { engine, transport, hash, text } = window.peer;
    const bytes = text("an event across networks");
    const message = { address: hash(bytes), bytes, signature: null };
    await engine.receive(message);
    await transport.announce(message);
  });
  await cy.tab.waitForFunction(() => window.peer.events.some((e) => new TextDecoder().decode(e.bytes) === "an event across networks"), null, { timeout: 10_000 });
  // So do receipts: signed by their reader, they are relayed like events.
  await ana.tab.evaluate(() => window.markRead(Array.from(window.peer.events.at(-1).address)));
  await cy.tab.waitForFunction((a) => window.peer.marks.has(a), ana.info.identity, { timeout: 10_000 });
  const fetched = await cy.tab.evaluate(async (a) => {
    const bytes = await window.peer.transport.fetch(Uint8Array.from(a));
    return bytes && new TextDecoder().decode(bytes);
  }, address);
  assert.equal(fetched, "from the other network");
  // Bo did not keep a copy: forwarding passes the bytes on.
  assert.equal(await bo.tab.evaluate((a) => window.peer.store.has(Uint8Array.from(a)), address), false);
  // Without consent nothing is forwarded.
  await bo.tab.evaluate(() => window.peer.transport.forwarding(false));
  assert.equal(await cy.tab.evaluate((a) => window.peer.transport.fetch(Uint8Array.from(a)), address), null);
  for (const side of [ana, bo, cy]) await side.tab.evaluate(() => window.peer.transport.stop());
  assert.deepEqual(errors, []);
});
