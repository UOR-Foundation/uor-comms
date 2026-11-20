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
| `trust.mjs` | Which device key belongs to which person, until Prism ID: invite links carry a key and a one-time token, and a trusted device vouches for its person's new ones |
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

- `signer` signs and verifies; `verdict(sender, device)` says whether a device belongs to a person. Until Prism ID answers that, pass the device book from `trust.mjs` as both (next section).
- `transport` has `announce(message)` and `fetch(address)`. The tests hand messages across directly.

## Asking and receiving

- `engine.offered(room, target, { granted })` lists the actions this identity may take toward `target` (itself when absent), by name, as the kernel answers (`Comms.Queue::offered`, proved equal to the permission and direct-room rules). `setPower` depends on the level granted: ask once per level offered. Show controls from this list; a refusal's `reason` is the fallback.
- `engine.receive(message)` answers `{ admitted: true }`, `{ admitted: false, held: true, reason: "parents unknown" }` when a cited event has not arrived (the kernel's verdict is `held`; it is admitted when the parent arrives), or `{ admitted: false, reason }` when refused. An event that fails its address, signature or device check is refused, never held (`badEventIsNeverHeld`). At most 1,000 events are held; past that the oldest is dropped, and arrives again only if a peer sends it again. Events are admitted one at a time, in the order `receive` is called, so an event that arrives while its parent is being admitted is admitted right after it.
- `engine.carries(room, address)` says whether an admitted message of the room names that content address. The transport serves content only on that answer.
- `engine.timeline(room, { before, limit })` answers `{ events, hasMore }`: at most `limit` events (1 to 1,000, default 50), oldest first, that come just before the event `before` in the fold order (depth, then address; `Comms.Fold` proves a parent comes first and every peer holding the same events gives the same order), or the newest when `before` is absent. `hasMore` is true when earlier events exist. To page back, pass the first event of the window as `before`. An event that arrives later can take a place inside a window already shown: `subscribe` reports it, and asking again places it. Taking the window from the order is host code, not a model rule. It throws `limit`, `unknown event` (`before` is not in the room) or `unknown room`. Each event carries `redacted`.
- `engine.messages(room, { before, limit })` answers `{ messages, hasMore, missing }`: the room's messages as a page shows them, windowed as `timeline` is (`before` is a message's address). Each has `address`, `sender`, `sent`, `text`, `mentions`, `everyone`, `forwarded`, `replyTo`, `edited` (the edit shown, or null) and `reactions` (key to the members who reacted, hex, once each). An edit counts only from the message's sender, and the last in the fold order wins. A redacted message, edit or reaction is left out, so redacting your reaction takes it back; `timeline` still lists the event with `redacted: true`. Its kind is in its content, which is not fetched once redacted, so a redacted message and a redacted reaction look the same there. Content the kernel refuses is left out; `missing` counts events whose content no store or peer could give. These rules are host code, not model rules. It throws as `timeline` does.
- `engine.redact(room, event)` redacts an event of the room. The kernel decides (`Comms.Redact::composes`): a joined member with the power to send redacts their own event, and another member's only with the room's redaction power, fixed at 50 until room settings are events. A peer judges a received redaction by the same rule against the redaction's own parents, and holds it until the event it redacts arrives. The event stays in the order and the graph; its content is no longer shown or served (`carries`). Refusals: `unknown room`, `unknown event`, the send rule's reason (`not joined`, `banned`, `needs power`), or `not allowed` when only the redaction power is missing.

## Whose key is whose

A device's address is the BLAKE3 of its raw P-256 public key (65 bytes, uncompressed), so a key checks itself against the device an event names. What binds a device to a person, until Prism ID does (`docs/DESIGN.md` decision 19), is how its key arrived. The device book in `trust.mjs` learns a key in exactly three ways:

1. **Accepting an invite link.** `book.invite(base)` returns `<base>#uc1.<identity>.<device key>.<token>` (base64url), to share as a link or QR. `book.accept(link)` records the inviter's key: you trust whoever gave you the link.
2. **The invitee's first proof.** The link's token is one-time. When the invitee connects, its proof carries its key and a ticket, BLAKE3 over the token and the inviter's fresh nonce; the inviter records that key for the identity claimed and spends the token. The inviter trusts whoever it gave the link to.
3. **A vouch.** A person's trusted device signs a new device's address with `book.vouchFor(newRawKey)`; the new device opens its book with that vouch, and peers who know the first device accept the second.

4. **An introduction** (decision 20). When two proven peers share a room, each passes on the keys it knows of that room's other invited or joined members. A key is accepted only from a peer that is a joined member of that room, only for a person the room lists, and its device is its own BLAKE3. So in a group you trust whoever let you in to vouch for who else is there. A peer sends introductions when it first offers a room, and again to every peer that may see the room whenever an admitted event changes its members. An introduction that names a room this device does not hold yet, or a sender or person it does not list yet, is kept (at most 200, oldest dropped first) and judged by the same rule after each admission in that room, so a person invited while everyone is connected is introduced without a reconnect.

Nothing else adds a key: a peer that knows someone's identity but holds no link, and shares no room with anyone you trust, is refused. `book.onLearn` hears each device learned; `saved` and `save` keep the book across reloads.

## Sending, and what is sent

- `send` and every other call reject with a named `reason` when refused (below); nothing is kept.
- An admitted event of this identity is **sent** once a proven peer holds it, or it went to one over an open channel (`transport.delivered(address)`, `transport.onDelivered`). Until then it is in `engine.outbox()`, `{ room, address }`, oldest first.
- The outbox needs no storage: after a reload or a lost connection, the sync on connect sends a peer every event it lacks, and the outbox empties as peers take them. `engine.retry(address)` announces one again.
- Connection: `transport.status` is `offline`, `connecting` or `online`, with `transport.onStatus`.
- One tick is honest at **sent**. Read and received are not tracked yet (receipts).

## Connecting two browsers

```js
const own = { identity, ...(await newDeviceKey()) };
const book = deviceBook({ hash, own, saved: load(), save });
const transport = webrtcTransport({ rendezvous: ntfyRendezvous(), signer: book, verdict: book.verdict, hash, store });
const engine = open({ identity, device: book.device, kernel, hash, store, signer: book, verdict: book.verdict, transport });
await engine.restore();
await transport.start();
transport.onStatus((status) => show(status)); // offline, connecting, online
```

`open` binds the transport to the engine. The transport listens on a meeting topic for each room it holds, for its own identity, and for each invited or joined member's identity, so creating a direct room with someone is how to reach them. When two peers meet, each proves its identity by signing the other's nonce with a device key (checked with the same `signer` and `verdict` as events), then they exchange the addresses each holds per room and send what the other lacks. A room's events go only to a peer the room lists as invited or joined, or to another device of the same identity. New events follow as they are admitted, and every member relays what it admits. Everything a peer sends goes through `engine.receive`. `host/transport.test.mjs` runs two Chromium pages through a local server that speaks ntfy's subset.

## Refusals

The invitee reaches the inviter with `transport.reach(book.accept(link))`, and either may then create the direct room (`createDirect`): the other is a member, so the transport shares it.

A refused call rejects with an error whose `reason` names the cause. From the kernel (`Comms.Reason`): `banned`, `closed`, `not joined`, `needs power`, `not allowed`, `unknown action`, and `direct` for an invitation in a direct room. `needs power` is the room's required power for writing; a member below another's power who tries to remove or change them hears `not allowed`, since that rule is about the two members, not the room. From the host's own checks: `unknown room`, `a direct room names a target` (`createDirect` without one), `malformed`, `content` (the kernel refused the content), `unknown event` (`retry` or a timeline's `before` names no event held), `limit` (a timeline window outside 1 to 1,000), and on receipt `tampered` (the address does not match the bytes), `signature`, `device`, or `not allowed`. A received event whose parents have not arrived is held, not refused: `{ held: true, reason: "parents unknown" }`.

## Not done

- **Restoring re-verifies.** `engine.restore()` rebuilds every room by admitting each kept event again, parents first, so a reload costs one signature check and one kernel answer per event. A page passes `browserStore(hash, { name })` to `open` and calls `restore` once.
- **The transport has no relay.** Two peers that cannot find a direct path (both behind strict NATs) do not connect. A member-owned relay (`Comms.Reach::mayForward`) is not built.
- **Meeting topics come from the room address, not a secret.** Anyone who has seen a room's address can derive its topic and see when its members set up connections, and the offers carry their network addresses. Topics move to the room's epoch secret when encryption lands.
- **Rooms.** A group room's creating event carries a random salt in its content field, so each room has its own address. A direct room has none: creating a second one with the same person gives the first (`findDirect`).
- **Who hears what, when.** A peer is offered a room's keys and history when it is proven, and again the moment an admitted event lets it see the room (an invitation), not only at the next meeting. A member who is removed or banned is sent the event that removed it, and nothing after.
- **A concurrent ban.** An event that cites the room as it was before a ban is judged against its own parents, so a peer may admit a banned member's message written before the ban reached it. Matrix soft-fails such events; that is not modelled yet.
- **Sync sends every address a room holds** when two peers connect, so the first exchange grows with history.
- **No Prism ID.** The signer and the device verdict are supplied by the caller.
- **No encryption.** Content is stored and fetched as given. A peer serves content by address only to a proven peer that may see a room in which an admitted message names it. Once an event is redacted its content is no longer served, fetched or kept: each peer deletes it from its store (`store.delete`) when it admits the redaction, unless another unredacted message names the same bytes. A copy taken out of the engine before that, by a page or a peer that has not yet admitted the redaction, is beyond its reach.
- **Three rules are computed here, not asked.** An event's depth (`Comms.Fold::depthOf`, proved in
  the model; that this code matches it is tested, not proved); a member's standing at creation; the
  power a change of power leaves. Each is marked in `engine.mjs`.
- **Room settings are fixed:** required power 0, not open, redaction power 50 (Matrix's default; the model fixes none).
- **Authorising events are never cited.** State is the fold of an event's ancestors.
- **Cost.** An event that lands last costs one step. One that lands earlier refolds the room.
- **`browser.test.mjs`** runs the browser store in Chromium in the browser workflow (`try-page.yml`): what it keeps survives a reload, and a cleared database is reported as evicted.
- **The tests run in the gate** (`just host`, part of `just vv`) against the holo the same run builds.
