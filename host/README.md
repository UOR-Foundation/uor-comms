# Host

The part of the engine that does things: it stores, hashes, signs and passes bytes on. It decides
nothing. Every decision is a question to the room kernel, the verified holo built from `app/`.

This folder is the one place in the repository where non-Prism code may grow (`audit-prism`).

## What is here

| File | Does |
| --- | --- |
| `event.mjs` | Lays an event's fields out as bytes and reads them back, in the order `Comms.Event::layout` fixes |
| `kernel.mjs` | The kernel's questions as requests: create, compose, permit, step a membership, admit, order, step a send |
| `content.mjs` | Lays message content version 1 out and reads it back; the kernel judges it (operation 0d) |
| `store.mjs` | Bytes by BLAKE3 address, one copy per address, checked on write, and every admitted event as it arrived. `memoryStore` in memory; `browserStore` in IndexedDB, across reloads and closed tabs, with `evicted` true when the browser cleared it |
| `engine.mjs` | Rooms: create, join, leave, invite, kick, ban, unban, set power, send, receive, members, timeline |
| `transport.mjs` | WebRTC data channels between browsers, with ntfy.sh carrying only the setup on hourly BLAKE3-derived topics; peers prove their identity before any event moves |
| `publish.mjs` | Publishes these modules and the holo on the site under `engine/<version>/`, named by their BLAKE3 |
| `test.mjs` | Two or three peers in one process against the real holo |

## Loading it in a page

The site publishes every version at `engine/<version>/`, where the version is the BLAKE3 of the
file list in `engine/<version>/manifest.json`. `engine/index.json` names the latest. A page pins one
version, fetches its manifest, checks each file's BLAKE3 against it, then imports
`engine/<version>/engine.mjs` and loads `engine/<version>/room-kernel.holo`. Every deploy carries
forward the versions already live, after checking their files.

## How an event enters a room

One path, for an event a peer sent and for one this device wrote:

1. Read the bytes into fields. Bytes that are not whole words holding what they count are dropped.
2. Hash the bytes. The kernel compares that address with the one claimed.
3. Check the signature, and ask the identity layer whether that device may sign for that sender.
4. Check that every cited event is held. If not, the event waits and is tried again later.
5. Ask the kernel whether the sender was permitted, against the state the cited events define.
6. Ask the kernel to admit, with those five answers. Only then store it and fold it in.

Sending asks the kernel what to do next and does it: sign, store, announce.

## What the caller supplies

`open({ identity, device, kernel, hash, store, signer, verdict, transport })`. The host has no
identity, no keys and no network of its own:

- `signer` signs and verifies. The tests use a P-256 key from the platform.
- `verdict(sender, device)` is Prism ID's answer on a device. The tests use a table.
- `transport` has `announce(message)` and `fetch(address)`. The tests hand messages across directly.

## Asking and receiving

- `engine.offered(room, target, { granted })` lists the actions this identity may take toward `target` (itself when absent), by name, as the kernel answers (`Comms.Queue::offered`, proved equal to the permission and direct-room rules). `setPower` depends on the level granted: ask once per level offered. Show controls from this list; a refusal's `reason` is the fallback.
- `engine.receive(message)` answers `{ admitted: true }`, `{ admitted: false, held: true, reason: "parents unknown" }` when a cited event has not arrived (the kernel's verdict is `held`; it is admitted when the parent arrives), or `{ admitted: false, reason }` when refused. An event that fails its address, signature or device check is refused, never held (`badEventIsNeverHeld`). At most 1,000 events are held; past that the oldest is dropped, and arrives again only if a peer sends it again.

## Connecting two browsers

```js
const transport = webrtcTransport({ rendezvous: ntfyRendezvous(), signer, verdict, hash, store });
const engine = open({ identity, device, kernel, hash, store, signer, verdict, transport });
await engine.restore();
await transport.start();
transport.onStatus((status) => show(status)); // offline, connecting, online
```

`open` binds the transport to the engine. The transport listens on a meeting topic for each room it holds, for its own identity, and for each invited or joined member's identity, so creating a direct room with someone is how to reach them. When two peers meet, each proves its identity by signing the other's nonce with a device key (checked with the same `signer` and `verdict` as events), then they exchange the addresses each holds per room and send what the other lacks. A room's events go only to a peer the room lists as invited or joined, or to another device of the same identity. New events follow as they are admitted, and every member relays what it admits. Everything a peer sends goes through `engine.receive`. `host/transport.test.mjs` runs two Chromium pages through a local server that speaks ntfy's subset.

## Refusals

A refused call rejects with an error whose `reason` names the cause. From the kernel (`Comms.Reason`): `banned`, `closed`, `not joined`, `needs power`, `not allowed`, `unknown action`, and `direct` for an invitation in a direct room. From the host's own checks: `unknown room`, `malformed`, `content` (the kernel refused the content), and on receipt `tampered` (the address does not match the bytes), `signature`, `device`, or `not allowed`. A received event whose parents have not arrived is held, not refused: `{ held: true, reason: "parents unknown" }`.

## Not done

- **Restoring re-verifies.** `engine.restore()` rebuilds every room by admitting each kept event again, so a reload costs one signature check and one kernel answer per event. A page passes `browserStore(hash, { name })` to `open` and calls `restore` once.
- **The transport has no relay.** Two peers that cannot find a direct path (both behind strict NATs) do not connect. A member-owned relay (`Comms.Reach::mayForward`) is not built.
- **Meeting topics come from the room address, not a secret.** Anyone who has seen a room's address can derive its topic and see when its members set up connections, and the offers carry their network addresses. Topics move to the room's epoch secret when encryption lands.
- **Sync sends every address a room holds** when two peers connect, so the first exchange grows with history.
- **No Prism ID.** The signer and the device verdict are supplied by the caller.
- **No encryption.** Content is stored and fetched as given.
- **Three rules are computed here, not asked.** An event's depth (`Comms.Fold::depthOf`, proved in
  the model; that this code matches it is tested, not proved); a member's standing at creation; the
  power a change of power leaves. Each is marked in `engine.mjs`.
- **Room settings are fixed:** required power 0, not open.
- **Redactions are refused** on receipt: not wired.
- **Authorising events are never cited.** State is the fold of an event's ancestors.
- **Cost.** An event that lands last costs one step. One that lands earlier refolds the room.
- **`browser.test.mjs`** runs the browser store in Chromium in the browser workflow (`try-page.yml`): what it keeps survives a reload, and a cleared database is reported as evicted.
- **The tests run in the gate** (`just host`, part of `just vv`) against the holo the same run builds.
