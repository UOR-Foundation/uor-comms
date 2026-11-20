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
window.setup = async (name, other) => {
  const identity = hash(text("identity " + name));
  const book = deviceBook({ hash, own: { identity, ...(await newDeviceKey()) } });
  const device = book.device;
  const room = hash(text("the room"));
  const members = [hex(identity), ...[].concat(other).map((o) => hex(hash(text("identity " + o))))];
  const events = [];
  const listeners = new Set();
  const store = memoryStore(hash);
  const engine = {
    identity, device,
    rooms: () => [room],
    members: () => members.map((member) => ({ member, status: 2 })),
    eventsOf: () => events.slice(),
    eventOf: (_room, address) => events.find((e) => hex(e.address) === hex(address)) ?? null,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    async receive(message) {
      if (events.some((e) => hex(e.address) === hex(message.address))) return { admitted: true, known: true };
      if (hex(hash(message.bytes)) !== hex(message.address)) return { admitted: false, reason: "tampered" };
      events.push(message);
      for (const l of listeners) l({ room, address: message.address });
      return { admitted: true };
    },
  };
  const transport = webrtcTransport({
    rendezvous: ntfyRendezvous({ base: location.origin + "/ntfy/" }),
    signer: book,
    verdict: book.verdict,
    hash, store, helloEvery: 500,
  });
  transport.bind(engine);
  window.peer = { engine, transport, store, events, hash, text, hex, book };
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
  const open = async (name, other) => {
    const tab = await (await browser.newContext()).newPage();
    tab.on("pageerror", (e) => errors.push(e));
    await tab.goto(url);
    await tab.waitForFunction(() => window.ready === true);
    return { tab, info: await tab.evaluate(([n, o]) => window.setup(n, o), [name, other]) };
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
    return Array.from(await store.put(text("some content")));
  });
  await ben.tab.waitForFunction(() => window.peer.events.length === 2, null, { timeout: 10_000 });
  const fetched = await ben.tab.evaluate(async (address) => {
    const bytes = await window.peer.transport.fetch(Uint8Array.from(address));
    return bytes && new TextDecoder().decode(bytes);
  }, contentAddress);
  assert.equal(fetched, "some content");
  assert.deepEqual(await ben.tab.evaluate(() => window.peer.transport.peers()), [ada.info.identity]);
  assert.deepEqual(await ada.tab.evaluate(() => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity ben"))).length), 1);

  // Cam accepts only Ada's link. Ada introduces Ben to Cam (decision 20), so Cam and Ben meet and prove themselves.
  const cam = await open("cam", ["ada", "ben"]);
  const camLink = await ada.tab.evaluate(() => window.invite());
  await cam.tab.evaluate((l) => window.accept(l), camLink);
  await cam.tab.evaluate(() => window.peer.transport.start());
  await cam.tab.waitForFunction((b) => window.peer.book.devicesOf(window.peer.hash(window.peer.text("identity ben"))).length === 1, null, { timeout: 30_000 });
  await cam.tab.waitForFunction((b) => window.peer.transport.peers().includes(b), ben.info.identity, { timeout: 30_000 });
  await cam.tab.waitForFunction(() => window.peer.events.length === 2, null, { timeout: 10_000 });

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
