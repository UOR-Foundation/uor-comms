// The browser store in a real browser: what it keeps survives a reload, and an eviction is reported.
// Run with:  node --test host/browser.test.mjs   (needs Playwright's Chromium)
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const page = `<!doctype html><meta charset="utf-8"><title>store</title><script type="module">
import { browserStore } from "/host/store.mjs";
import { blake3 } from "/try/vendor/prism-code/src/blake3.mjs";
window.open_ = (name) => browserStore((b) => blake3(b), { name });
window.ready = true;
</script>`;

async function serve() {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/") return response.writeHead(200, { "content-type": types[".html"] }).end(page);
      const file = join(root, normalize(decodeURIComponent(path)).replace(/^([/\\]|\.\.)+/, ""));
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

test("the browser store keeps bytes and events across a reload and reports an eviction", async (t) => {
  const { server, url } = await serve();
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const tab = await browser.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error));
  const load = async () => { await tab.goto(url); await tab.waitForFunction(() => window.ready === true); };

  await load();
  const written = await tab.evaluate(async () => {
    const store = await window.open_("test");
    const bytes = new TextEncoder().encode("hello");
    const address = await store.put(bytes);
    await store.put(bytes);
    await store.putEvent({ address, bytes, signature: new Uint8Array([1, 2, 3]) });
    let refused = false;
    try { await store.put(new TextEncoder().encode("other"), address); } catch { refused = true; }
    const result = { address: Array.from(address), evicted: store.evicted, refused };
    store.close();
    return result;
  });
  assert.equal(written.evicted, false);
  assert.equal(written.refused, true);

  await load();
  const read = await tab.evaluate(async (address) => {
    const store = await window.open_("test");
    const bytes = await store.get(Uint8Array.from(address));
    const events = await store.events();
    const result = { text: new TextDecoder().decode(bytes), events: events.length, signature: Array.from(events[0].signature), size: store.size, evicted: store.evicted };
    store.close();
    return result;
  }, written.address);
  assert.deepEqual(read, { text: "hello", events: 1, signature: [1, 2, 3], size: 1, evicted: false });

  // Deleting bytes (redacted content) removes them across a reload and leaves the kept events.
  await tab.evaluate(async (address) => {
    const store = await window.open_("test");
    const extra = await store.put(new TextEncoder().encode("redacted later"));
    await store.delete(extra);
    store.close();
    window.deleted = Array.from(extra);
  }, written.address);
  const deleted = await tab.evaluate(() => window.deleted);
  await load();
  const afterDelete = await tab.evaluate(async (address) => {
    const store = await window.open_("test");
    const result = { gone: !(await store.has(Uint8Array.from(address))), events: (await store.events()).length };
    store.close();
    return result;
  }, deleted);
  assert.deepEqual(afterDelete, { gone: true, events: 1 });

  // This device's read marker survives a reload, one per room.
  await tab.evaluate(async () => {
    const store = await window.open_("test");
    const room = new Uint8Array(32).fill(7);
    await store.putMark({ room, address: new Uint8Array(32).fill(1), signature: new Uint8Array([9]) });
    await store.putMark({ room, address: new Uint8Array(32).fill(2), signature: new Uint8Array([9]) });
    store.close();
  });
  await load();
  const marks = await tab.evaluate(async () => {
    const store = await window.open_("test");
    const kept = (await store.marks()).map((m) => [m.room[0], m.address[0], m.signature[0]]);
    store.close();
    return kept;
  });
  assert.deepEqual(marks, [[7, 2, 9]]);

  // The browser clears the database but not the marker: the next open reports the eviction.
  await tab.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("uor-comms:test");
    req.onsuccess = resolve;
    req.onerror = reject;
  }));
  await load();
  const after = await tab.evaluate(async () => {
    const store = await window.open_("test");
    const result = { evicted: store.evicted, size: store.size };
    store.close();
    return result;
  });
  assert.deepEqual(after, { evicted: true, size: 0 });
  assert.deepEqual(errors, []);
});
