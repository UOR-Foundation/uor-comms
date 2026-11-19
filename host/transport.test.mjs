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
import { hex } from "/host/event.mjs";
import { blake3 } from "/try/vendor/prism-code/src/blake3.mjs";
const hash = (b) => blake3(b);
const text = (t) => new TextEncoder().encode(t);
const algorithm = { name: "ECDSA", hash: "SHA-256" };
window.setup = async (name, other) => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const identity = hash(text("identity " + name));
  const device = hash(raw);
  const devices = new Map([[hex(device), { identity: hex(identity), key: keys.publicKey }]]);
  window.addDevice = async (deviceHex, identityHex, rawKey) => devices.set(deviceHex, { identity: identityHex,
    key: await crypto.subtle.importKey("raw", Uint8Array.from(rawKey), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]) });
  const room = hash(text("the room"));
  const members = [hex(identity), hex(hash(text("identity " + other)))];
  const events = [];
  const listeners = new Set();
  const store = memoryStore(hash);
  const engine = {
    identity, device,
    rooms: () => [room],
    members: () => members.map((member) => ({ member, status: 2 })),
    eventsOf: () => events.slice(),
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
    signer: {
      sign: async (bytes) => new Uint8Array(await crypto.subtle.sign(algorithm, keys.privateKey, bytes)),
      verify: async (bytes, signature, sender, signedBy) => {
        const known = devices.get(hex(signedBy));
        return Boolean(known && known.identity === hex(sender)) && crypto.subtle.verify(algorithm, known.key, signature, bytes);
      },
    },
    verdict: async (sender, signedBy) => devices.get(hex(signedBy))?.identity === hex(sender),
    hash, store, helloEvery: 500,
  });
  transport.bind(engine);
  window.peer = { engine, transport, store, events, hash, text, hex };
  return { device: hex(device), identity: hex(identity), raw: Array.from(raw) };
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
  const ada = await open("ada", "ben");
  const ben = await open("ben", "ada");
  await ada.tab.evaluate((i) => window.addDevice(i.device, i.identity, i.raw), ben.info);
  await ben.tab.evaluate((i) => window.addDevice(i.device, i.identity, i.raw), ada.info);

  // Ada holds an event before Ben is connected: it must arrive by the sync on connect.
  await ada.tab.evaluate(async () => {
    const { engine, hash, text } = window.peer;
    const bytes = text("first event");
    await engine.receive({ address: hash(bytes), bytes, signature: null });
  });
  await Promise.all([ada, ben].map(({ tab }) => tab.evaluate(() => window.peer.transport.start())));
  for (const { tab } of [ada, ben]) await tab.waitForFunction(() => window.peer.transport.status === "online", null, { timeout: 30_000 });
  await ben.tab.waitForFunction(() => window.peer.events.length === 1, null, { timeout: 10_000 });

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
  assert.deepEqual(errors, []);
});
