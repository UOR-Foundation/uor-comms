# Design

A messenger with the features of Matrix and no server. Every decision about a room is a function in the LexLean model under `src/Comms`, proved by Lean. The host around it moves bytes and draws the screen; it decides nothing.

`MATRIX-MAP.md` records what Matrix specifies and which jobs its servers do. This file says where each job goes.

## Decisions taken

These were open in the map. The first four are the owner's instructions; the rest are assumptions made to start Phase 1 and can be reversed.

| # | Decision | Status |
|---|---|---|
| 1 | The user identity is Prism ID (stitch, as pinned by Foundry). Events are signed by a device of the identity, not by a server | instructed |
| 2 | Every address is BLAKE3 over the bytes that travel. The wire carries the address first; bytes move only when the receiver lacks them | instructed |
| 3 | Bytes move over Hologram's sync contract (fetch, announce, discover) | instructed |
| 4 | What is stored, and how two peers reconcile, follows kappa-registry's model: typed edges, tags, set reconciliation | instructed |
| 5 | Content is encrypted before it is addressed. Only ciphertext is ever named or sent | assumed |
| 6 | Equivalent features behind our own contract. An unmodified Matrix client is not a goal | assumed |
| 7 | The browser is the first target | assumed |
| 8 | An always-on peer is optional and untrusted: it may hold and forward ciphertext, and nothing depends on it being honest | assumed |
| 9 | This is a hand-written LexLean project, not a Prism app rendered from `prism/spec.json`. That spec covers an answer decided from fields or a bounded state machine, and a messenger keeps lists of events and free text | forced by the SDK |

## Where each server job goes

| Matrix server job | Here |
|---|---|
| Identity: account, login, devices, signing events for users | Prism ID. The device signs. The model takes Prism ID's verdict as an input and restates none of it |
| Storage: history, state, per-user data, media | Each peer's content store. Per-user private data is sealed to the Prism ID workspace key |
| Ordering: one stream per account, resolved state | `Comms.Order` and `Comms.Resolve`. State is a function of the set of events |
| Relay: fan-out, typing, receipts, device-to-device | Peers announce addresses to room members; receivers fetch what they lack (`Comms.Sync`) |
| Discovery: names, aliases, directories | A room is named by the address of its creating event. Finding peers is Hologram's lookup. Directories are rooms like any other |
| Push: waking a sleeping device | Not solved without an always-on party. Optional peer, decision 8 |
| Media forwarding | Encrypted content fetched from several peers at once. Group calls: peers forward for each other (Phase 3) |
| Enforcement: who may do what | `Comms.Rules` and `Comms.Admission`, run by every peer on every event |

## How a room works

An event is a record: the addresses of its parents, the addresses of the events that authorise it, the sender's Prism ID and device, a kind, and the address of its encrypted content. Its own address is BLAKE3 over its canonical bytes.

**Admission.** A peer accepts an event only when all five hold (`Comms.Admission`):
1. the address re-derived from the bytes equals the address claimed;
2. the signature verifies;
3. Prism ID says the signing device was an active device of the sender;
4. the peer holds every parent and authorising event named;
5. the permission rule allows it, judged against the state that the events it cites define.

Judging against cited evidence, and not against "current" state, is what makes admission the same on every peer: it depends on the event and its ancestors, never on arrival order. Matrix adds a second check against the receiver's current state, which is local; that check is dropped here.

**Permissions.** `Comms.Rules` covers join, leave, invite, kick, ban, unban, send and change of power level, with five member statuses. It follows Matrix room version 12 in substance: only joined members write, a sender needs the required power, nobody removes or changes a member of equal or higher power, nobody grants more power than they hold, a banned member can do nothing.

**Resolved state.** For each state key, every admitted candidate gets an ordering key built from its rank and its address (`Comms.Order`). Rank puts changes to membership and power ahead of everything else, then the sender's power. The address breaks ties, and addresses are unique, so the order is total. The resolved value is the greatest candidate (`Comms.Resolve`). Timestamps play no part.

**Reading.** Every membership change starts a new key epoch. A member holds the keys from the epoch they joined until the epoch they left (`Comms.Epoch`). History before joining is readable only when the room shares it.

**Sync.** Two peers compare head addresses. Equal heads move nothing. Otherwise the receiver asks only for addresses it does not hold (`Comms.Sync`).

**Calls.** A one-to-one call is a five-state machine (`Comms.Call`). When both sides call at once, the side with the lower offer address yields.

## What differs from Matrix, and why

| Matrix | Here | Why |
|---|---|---|
| The homeserver signs for its users | The user's device signs | Removes the party that can forge a user |
| SHA-256 addresses over plaintext events | BLAKE3 over ciphertext | One address scheme across UOR; a plaintext hash can be confirmed by guessing |
| Resolution depends on local rejection status and on timestamps | Resolution depends on the event set only | Needed for convergence to be provable at all |
| Media named by origin server | Media named by content | The content outlives any one holder |
| History visibility filtered by the server | Enforced by who holds which key | A peer holding the bytes cannot be trusted to filter |

## Not designed yet

- The wire format and the dispatch entry point of the holo. The scaffold's sample entry is still in place.
- The ban race: a ban and an event from the banned member that do not see each other. Rank decides it; the security argument is not proved.
- Group keys between users: how a room key is wrapped to each member's devices.
- Confirming that a contact's Prism ID is theirs.
- Group calls, large rooms, abuse control, waking mobile devices.
- Embedding kappa-registry's store in a browser, and BLAKE3 as its default.

## Status

See `STATUS.md` for what Lean proved in the last run, what is only tested, and what is assumed.
