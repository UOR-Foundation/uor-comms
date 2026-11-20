// Publishes the host and the room kernel holo under a path named by their content, so a page can pin
// one version and check it on load:
//
//   engine/index.json                  { latest, versions: [version, ...] }
//   engine/<version>/manifest.json     { version, commit, files: { name: blake3 hex } }
//   engine/<version>/<name>            the host modules and room-kernel.holo
//
// <version> is the BLAKE3 of the manifest's file list, so it changes when any file does. Pages
// replaces the whole site on each deploy, so every version already live is fetched, checked against
// its manifest and published again. A version whose files do not match is dropped, never re-signed.
//
//   node host/publish.mjs <site dir> <holo> <live site URL> <commit>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { blake3Hex } from "../try/vendor/prism-code/src/blake3.mjs";

export const MODULES = ["content.mjs", "engine.mjs", "event.mjs", "kernel.mjs", "store.mjs", "transport.mjs", "trust.mjs"];
const HOLO = "room-kernel.holo";

/** The manifest of a set of files: each file's BLAKE3, and the version those name. */
export function manifestOf(files, commit) {
  const names = Object.keys(files).sort();
  const hashes = Object.fromEntries(names.map((name) => [name, blake3Hex(files[name])]));
  const listing = names.map((name) => `${name} ${hashes[name]}\n`).join("");
  return { version: blake3Hex(new TextEncoder().encode(listing)), commit, files: hashes };
}

/** Whether fetched files are exactly the ones a manifest names, under the version it claims. */
export function matches(manifest, files) {
  const again = manifestOf(files, manifest.commit);
  return again.version === manifest.version
    && JSON.stringify(again.files) === JSON.stringify(manifest.files);
}

/** Every live version that still checks out, fetched with `get(path) -> bytes or null`. */
export async function carried(get, current) {
  const index = await get("engine/index.json");
  if (!index) return [];
  const kept = [];
  for (const version of JSON.parse(new TextDecoder().decode(index)).versions ?? []) {
    if (version === current || !/^[0-9a-f]{64}$/.test(version)) continue;
    const raw = await get(`engine/${version}/manifest.json`);
    if (!raw) continue;
    const manifest = JSON.parse(new TextDecoder().decode(raw));
    const files = {};
    for (const name of Object.keys(manifest.files ?? {})) {
      if (!/^[a-z0-9.-]+$/.test(name)) continue;
      const bytes = await get(`engine/${version}/${name}`);
      if (bytes) files[name] = bytes;
    }
    if (manifest.version === version && matches(manifest, files)) kept.push({ manifest, files });
  }
  return kept;
}

async function write(site, { manifest, files }) {
  const dir = join(site, "engine", manifest.version);
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes);
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function publish({ site, holo, live, commit, fetcher = fetch }) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = { [HOLO]: await readFile(holo) };
  for (const name of MODULES) files[name] = await readFile(join(here, name));
  const current = { manifest: manifestOf(files, commit), files };
  const get = async (path) => {
    const response = await fetcher(new URL(path, live)).catch(() => null);
    return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  };
  const versions = [current, ...(await carried(get, current.manifest.version))];
  for (const version of versions) await write(site, version);
  const index = { latest: current.manifest.version, versions: versions.map((v) => v.manifest.version) };
  await writeFile(join(site, "engine", "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [site, holo, live, commit] = process.argv.slice(2);
  const index = await publish({ site, holo, live: live.endsWith("/") ? live : `${live}/`, commit });
  console.log(`engine ${index.latest}, ${index.versions.length} version(s) published`);
}
