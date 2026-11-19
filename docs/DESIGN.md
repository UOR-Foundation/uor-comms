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

**Place in the order.** A peer orders the events it holds by ordering key (`Comms.Order`). The place of an event is the number of held events with a smaller key (`Comms.Resolve::place`). It depends on which events are held and not on when each arrived, so two peers that hold the same events give every event the same place.

**State from history.** The status and power of every member are the room's events folded by one step, newest first (`Comms.State`). An event is four numbers: action, sender, target, granted power. The step asks the permission rule against the state the earlier events define, then applies the membership or power change to the event's subject and to nobody else. A join or a leave has its sender as subject. A room starts with its creator joined at the creator's power. The required power and whether the room is open are fixed for the fold; events that change them are not modelled.

**Event bytes.** An event is a list of 64-bit words, and its bytes are those words at eight bytes each, most significant byte first (`Comms.Event`). An address is four words. The order is fixed by `layout`:

| Words | Field |
|---|---|
| 0 | version, 1 |
| 1 | action, 0 to 7 as in `Comms.Rules`, 8 for a redaction, 9 for creating a room |
| 2 to 5 | room |
| 6 to 9 | sender |
| 10 to 13 | device |
| 14 to 17 | target |
| 18 | granted power |
| 19 to 22 | address of the encrypted content |
| 23 | number of parent words |
| 24 | number of authority words |
| then | parents, then authorities |

An event has one byte form. Parents and authorities are each in ascending order of address, which also refuses an address named twice and a list that is not whole addresses; each list holds at most 20 addresses. The version must be 1 and the action below 9. Decoding the bytes returns every word below 2^64 unchanged.

**Reading an event.** `Comms.Event::readable` accepts words only when they hold at least the 25 fixed words, hold exactly the parents and authorities their two counts name with nothing after them, and are canonical. The fields are then read by position: `wordAt` for version, action and granted power, `parentsOf` and `authoritiesOf` for the two lists. The kernel reads the words of an event from the request, refuses a length that is not whole words, and asks `readable`, so a request may be up to 1,508 bytes. The compiled guest cannot pass a list from one function to another, so `skip`, `take` and the readers built on them return a list inside the record `Words`.

**Sending.** `Comms.Send` composes an event only when `Comms.Rules` permits the action against the sender's state and the form is canonical; otherwise it returns no bytes. The host then reports three steps in order: signed, stored, announced. The core asks for one step at a time, a report for any other step changes nothing, and so an address is announced only after its bytes are stored. The sent event becomes a head of the room and the heads it cites stop being heads.

**Message content.** The bytes behind an event's content address, before encryption (`Comms.Content`, version 1): a message, an edit or a reaction, with the sender's claimed time for display only, and the address of the event it replies to, replaces or answers. Text is the source as typed, LF only. Mentions are identity addresses in ascending order; the list, not the text, decides who is notified. Attachments wait for the cipher. `host/content.mjs` lays it out.

**Creating a room.** A room is created by one event with action 9 (`Comms.Create`). It cites no parent and no authority and its room field is zero, because the room is named by the address of this event. Its sender starts joined with the creator's power. If it names a target the room is direct: the target starts invited with the creator's power, so may join whether or not the room is open, neither can remove the other, and no third member is ever invited; nobody else is a member. This is the state `Comms.State` gives a room with no later events.

**Redaction.** A redaction is an event with action 8 whose target is the address of the event it redacts (`Comms.Redact`). Only a joined member with the power to send may redact: their own event with that alone, another member's only with the room's redaction power. A peer keeps the set of events redacted. An event in that set shows no content and its content is not fetched; the event record itself stays, so its address, its place in the graph and its effect on membership and power do not change. The set only grows, and the order and number of times redactions arrive make no difference. This follows Matrix in substance; Matrix strips keys from a plaintext event, and here the content is a separate encrypted object that is simply dropped.

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

- Whether the address covers the signature. `Comms.Event` fixes the bytes that are signed; the signature's own bytes and where they travel are not specified.
- The creating event: it has no parents and cannot name its own address as its room.
- Whether a redaction is applied before the event it names arrives, and how a peer learns that the redactor sent that event. `Comms.Redact` takes "own" as an input.
- The host (`host/`) folds events by depth, then address. The depth is `Comms.Fold::depthOf`, one more than the deepest parent, so a parent is always folded first (`shallowerEventPrecedes`). The host computes the depth itself; the kernel compares the keys.
- The kernel says whether an event may be composed; it does not return the bytes. A redaction is asked through its own operation.
- The ban race: a ban and an event from the banned member that do not see each other. Rank decides it; the security argument is not proved.
- Group keys between users: how a room key is wrapped to each member's devices.
- Confirming that a contact's Prism ID is theirs.
- Group calls, large rooms, abuse control, waking mobile devices.
- Embedding kappa-registry's store in a browser, and BLAKE3 as its default.

## Status

See `STATUS.md` for what Lean proved in the last run, what is only tested, and what is assumed.
