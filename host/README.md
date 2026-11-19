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
| `store.mjs` | Bytes by BLAKE3 address, one copy per address, checked on write. In memory only |
| `engine.mjs` | Rooms: create, join, leave, invite, kick, ban, unban, set power, send, receive, members, timeline |
| `test.mjs` | Two or three peers in one process against the real holo |

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

## Not done

- **Nothing survives a reload.** The store and the rooms are in memory.
- **No transport.** How two browsers reach each other is not decided.
- **No Prism ID.** The signer and the device verdict are supplied by the caller.
- **No encryption.** Content is stored and fetched as given.
- **Three rules are computed here, not asked.** An event's depth (`Comms.Fold::depthOf`, proved in
  the model; that this code matches it is tested, not proved); a member's standing at creation; the
  power a change of power leaves. Each is marked in `engine.mjs`.
- **Room settings are fixed:** required power 0, not open.
- **Redactions are refused** on receipt: not wired.
- **Authorising events are never cited.** State is the fold of an event's ancestors.
- **Cost.** An event that lands last costs one step. One that lands earlier refolds the room.
- **The tests run in the gate** (`just host`, part of `just vv`) against the holo the same run builds.
