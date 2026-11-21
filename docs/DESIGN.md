# Design

A messenger with the features of Matrix and no server. Every decision about a room is a function in the LexLean model under `src/Comms`, proved by Lean. The host around it moves bytes and draws the screen; it decides nothing.

`MATRIX-MAP.md` records what Matrix specifies and which jobs its servers do. This file says where each job goes.

## Decisions taken

These were open in the map. Decisions 1 to 4 and 10 to 22 are the owner's instructions or rulings; 5 to 8 are assumptions made to start Phase 2 and can be reversed.

| # | Decision | Status |
|---|---|---|
| 1 | The user identity is Prism ID (stitch, as pinned by Foundry). Events are signed by a device of the identity, not by a server | instructed |
| 2 | Every address is BLAKE3 over the bytes that travel. The wire carries the address first; bytes move only when the receiver lacks them | instructed |
| 3 | Bytes move over Hologram's sync contract (fetch, announce, discover) | instructed |
| 4 | What is stored, and how two peers reconcile, follows kappa-registry's model: typed edges, tags, set reconciliation | instructed |
| 5 | Content is encrypted before it is addressed. Only ciphertext is ever named or sent | assumed |
| 6 | Equivalent features behind our own contract. An unmodified Matrix client is not a goal | assumed |
| 7 | The browser is the first target | assumed |
| 8 | An always-on peer is optional and untrusted: it may hold and forward ciphertext, and nothing depends on it being honest. Narrowed by decision 15: it is a member's node, never a phone and never a third party | assumed, narrowed |
| 9 | This is a hand-written LexLean project, not a Prism app rendered from `prism/spec.json`. That spec covers an answer decided from fields or a bounded state machine, and a messenger keeps lists of events and free text | forced by the SDK |
| 10 | The host (store, transport, signing, the API a page calls) is built in this repository, under `host/`, the one folder exempt from the non-Prism ratchet | ruled 2026-11-18 |
| 11 | A page loads the host and the kernel holo from this repository's site under a path named by their content (`engine/<version>/`), pins the version and checks it on load | ruled 2026-11-19 |
| 12 | Browsers reach each other over WebRTC data channels; ntfy.sh carries only the connection setup. The sync contract of decision 3 (fetch, announce, discover) is what travels over those channels: WebRTC is the link, not a second protocol. Topics are derived and rotated (decision 15). One public STUN server finds each peer's public address; there is no TURN relay | ruled 2026-11-19; the layering under decision 3 is this repository's reading |
| 13 | A direct chat is exactly two people with equal power: a third invitation is refused, and an existing direct room is reused | ruled 2026-11-19 |
| 14 | This repository is the canonical reference for the engine. Holo Messenger is a client; where the two disagree on the engine's design, phases, behaviour or status, this repository is right | ruled 2026-11-19 |
| 15 | The proposals of `docs/CEWP-INSIGHTS.md` D1 to D5 and D7 are adopted: the actions offered are the actions admitted; a missing parent holds an event; a relay tree every member computes alike; per-sender call streams with layers; derived, rotating meeting topics and member-only forwarders; mailboxes only on always-on member nodes | approved 2026-11-19 |
| 16 | Encryption is post-quantum from the first key: room keys are wrapped to member devices with X-Wing (X25519 + ML-KEM-768). The browser library that provides it is to be pinned; it is not built | ruled 2026-11-19 |
| 17 | Per-user data synced across one's own devices (notification levels, mutes, pinned chats) lives in a private room per identity that only its devices join | ruled 2026-11-19 |
| 18 | A person's profile (name, picture by content address) lives in a public room per identity that only its devices write | ruled 2026-11-19 |
| 19 | Until Prism ID is wired, a device key reaches another person in an invite link (or its QR), which also carries a one-time token that binds the invitee's key back to the inviter; a person's later devices are vouched for by a device already trusted (`host/trust.mjs`). A device's address is the BLAKE3 of its key | ruled 2026-11-20 |
| 20 | Inside a room, a joined member passes on the device keys it knows of the room's other members, so group members need not all exchange links; you trust whoever let you in to vouch for who else is there | ruled 2026-11-20 |
| 21 | Room settings are events (action 10), decided by `Comms.Settings`: the power to change settings, a power per action, who may join, and a name, description and picture by content address; defaults are Matrix's (sending, inviting 0; kicking, banning, redacting and changing settings 50) and a room is invited-only until opened; a direct room changes only its name, description and picture | ruled 2026-11-20 |
| 22 | Read receipts are signed transport messages per room, kept on each device and synced on connect: never room events, never in the order or the proofs. Each person has one read marker per room, which only moves forward; a setting keeps one's own receipts on one's devices | ruled 2026-11-21 |

## Phases

The engine follows the four phases of its brief. The client's phases are its own releases and are not these.

| Phase | Output | State |
|---|---|---|
| 1. Study Matrix | `docs/MATRIX-MAP.md` | done |
| 2. Design | this file, with the decisions above | in use; open decisions are listed at the end |
| 3. Specify and verify in LexLean | `app/src/Comms`; `docs/STATUS.md` says what is proved, tested and assumed | under way |
| 4. Build and publish, in slices: (1) identity and 1:1 text, (2) rooms and state, (3) encryption and multi-device, (4) media, (5) 1:1 voice and video, (6) group calls, (7) spaces, threads and the rest | `host/`, the kernel holo, the site | slice 1 under way: rooms, send and receive run in the host between peers in one process; no transport, persistence, Prism ID or encryption yet |

## Where each server job goes

| Matrix server job | Here |
|---|---|
| Identity: account, login, devices, signing events for users | Prism ID. The device signs. The model takes Prism ID's verdict as an input and restates none of it |
| Storage: history, state, per-user data, media | Each peer's content store. Per-user private data is sealed to the Prism ID workspace key |
| Ordering: one stream per account, resolved state | `Comms.Order` and `Comms.Resolve`. State is a function of the set of events |
| Relay: fan-out, typing, receipts, device-to-device | Peers announce addresses to room members; receivers fetch what they lack (`Comms.Sync`) |
| Discovery: names, aliases, directories | A room is named by the address of its creating event. Finding peers is Hologram's lookup. Directories are rooms like any other |
| Push: waking a sleeping device | Not solved without an always-on party. Optional peer, decision 8 |
| Media forwarding | Encrypted content fetched from several peers at once. Group calls: members forward for members along a relay tree every peer computes alike (Phase 4, slice 6) |
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
| 1 | action, 0 to 7 as in `Comms.Rules`, 8 for a redaction, 9 for creating a room, 10 for changing a room setting |
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

**What a member may do.** The kernel lists the actions a member may take as eight characters, one per action (`Comms.Queue`), and the list is proved to be exactly what the permission and direct-room rules admit: the client never offers a button the engine would refuse. An event whose parents have not arrived is held, not refused (`Comms.Admission::verdict`).

**Calls and relay trees.** Two people call directly; up to six share a full mesh; above six, members forward for members along a tree every peer computes alike (`Comms.Tree`): the publisher at index 0, the others by place, and index i under ⌊(i − 1) / 4⌋. Each receiver takes each sender at the best layer that fits its share of its budget, never below the base layer (`Comms.Media`). There is no media server.

**Reaching a peer.** WebRTC is set up through ntfy.sh on topics the host derives from the room's epoch secret and the hour, so the relay sees only topics that change hourly; only members of an epoch hold its topic (`Comms.Reach::holdsTopic`). When no direct path exists, a consenting member or member-owned node may forward ciphertext, and a direct path retires it (`mayForward`). Mail for a sleeping member is held only by an always-on member node that is not a phone (`mayHoldMail`). These are the proposals approved from `docs/CEWP-INSIGHTS.md`.

**Creating a room.** A room is created by one event with action 9 (`Comms.Create`). It cites no parent and no authority and its room field is zero, because the room is named by the address of this event. Its sender starts joined with the creator's power. If it names a target the room is direct: the target starts invited with the creator's power, so may join whether or not the room is open, neither can remove the other, and no third member is ever invited; nobody else is a member. This is the state `Comms.State` gives a room with no later events.

**Room settings.** A setting changes by an event with action 10 (`Comms.Settings`). The first word of its target names the setting and the other three are zero; `granted` holds a number and `content` the address of a name, description or picture. Keys: 0 name, 1 description, 2 picture, 3 who may join (0 invited only, 1 open), 4 the power to change settings, 5 the power to redact another member's event, and 10 + action for the power that action needs (12 invite, 13 kick, 14 ban, 15 unban, 16 send, 17 set power). Only a joined member with the power to change settings changes one, never to a power above their own, and a direct room changes only its name, description and picture. A setting never changed holds its default: sending, inviting and who may join 0; kicking, banning, unbanning, setting power, redacting and changing settings 50, Matrix's defaults. Each peer folds changes in the fold order and keeps the last one permitted against the state its parents define. A change is in canonical form when it would be as any other action; `Comms.Event::canonical` checks actions below 9, so `changeComposes` checks action 10 itself.

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
