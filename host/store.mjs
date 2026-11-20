// A content store: bytes by their BLAKE3 address, one copy per address. `put` re-derives the address
// and refuses bytes that do not hash to it, so nothing is trusted on read that was not checked on write.
// It also keeps every admitted event as it arrived (address, bytes, signature), so an engine can be
// rebuilt from it by admitting each event again (`engine.restore`).
//
// Two stores share one interface: `memoryStore` for tests and one-off use, `browserStore` for pages,
// which keeps everything in IndexedDB across reloads and closed tabs and reports when the browser
// has evicted it.
import { hex, unhex } from "./event.mjs";

export function memoryStore(hash) {
  const held = new Map();
  const events = new Map();
  return {
    /** Stores the bytes and returns their address. Storing the same bytes twice keeps one copy. */
    async put(bytes, claimed) {
      const address = hash(bytes);
      if (claimed && hex(claimed) !== hex(address)) throw new Error("store.address-mismatch");
      const key = hex(address);
      if (!held.has(key)) held.set(key, bytes.slice());
      return address;
    },
    async get(address) {
      return held.get(hex(address))?.slice() ?? null;
    },
    async has(address) {
      return held.has(hex(address));
    },
    /** Forgets the bytes at an address (redacted content). Kept events are not touched. */
    async delete(address) {
      held.delete(hex(address));
    },
    /** Keeps an admitted event as it arrived. */
    async putEvent({ address, bytes, signature }) {
      events.set(hex(address), { address: address.slice(), bytes: bytes.slice(), signature: signature?.slice() ?? null });
    },
    /** Every kept event, in no particular order. */
    async events() {
      return [...events.values()];
    },
    evicted: false,
    get size() {
      return held.size;
    },
  };
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * A store in IndexedDB database `uor-comms:<name>`. `evicted` is true when this browser held the
 * store before (a marker in localStorage says so) and the database is now empty: the browser cleared
 * it. The store asks for persistent storage once, which a browser may refuse.
 */
export async function browserStore(hash, { name = "default" } = {}) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open("uor-comms:" + name, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("bytes");
      open.result.createObjectStore("events");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  const marker = "uor-comms:" + name + ":held";
  const count = await request(tx("bytes", "readonly").count());
  let markerSet = false;
  try { markerSet = localStorage.getItem(marker) === "1"; } catch { markerSet = false; }
  const evicted = markerSet && count === 0;
  try { await navigator.storage?.persist?.(); } catch { /* a browser may refuse */ }
  const remember = () => { try { localStorage.setItem(marker, "1"); } catch { /* storage blocked */ } };
  return {
    async put(bytes, claimed) {
      const address = hash(bytes);
      if (claimed && hex(claimed) !== hex(address)) throw new Error("store.address-mismatch");
      const key = hex(address);
      const store = tx("bytes", "readwrite");
      if ((await request(store.count(key))) === 0) await request(store.put(bytes.slice(), key));
      remember();
      return address;
    },
    async get(address) {
      const bytes = await request(tx("bytes", "readonly").get(hex(address)));
      return bytes ? new Uint8Array(bytes) : null;
    },
    async has(address) {
      return (await request(tx("bytes", "readonly").count(hex(address)))) > 0;
    },
    async delete(address) {
      await request(tx("bytes", "readwrite").delete(hex(address)));
    },
    async putEvent({ address, bytes, signature }) {
      await request(tx("events", "readwrite").put({ bytes: bytes.slice(), signature: signature?.slice() ?? null }, hex(address)));
      remember();
    },
    async events() {
      const store = tx("events", "readonly");
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
      return keys.map((key, i) => ({ address: unhex(key), bytes: new Uint8Array(values[i].bytes), signature: values[i].signature ? new Uint8Array(values[i].signature) : null }));
    },
    evicted,
    get size() {
      return count;
    },
    close: () => db.close(),
  };
}
