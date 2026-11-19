// A content store: bytes by their BLAKE3 address, one copy per address. `put` re-derives the address
// and refuses bytes that do not hash to it, so nothing is trusted on read that was not checked on write.
import { hex } from "./event.mjs";

export function memoryStore(hash) {
  const held = new Map();
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
    get size() {
      return held.size;
    },
  };
}
