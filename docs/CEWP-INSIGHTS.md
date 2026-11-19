# What uor-comms can take from CEWP

A study of the CIRIS Epistemic Web (CEWP) for uor-comms, written 2026-11-19. The owner approved D1 to D5
and D7 the same day; they are in the model as `Comms.Queue`, `Comms.Admission::verdict`, `Comms.Tree`,
`Comms.Media` and `Comms.Reach` (RK-17), with the relay tree's fan-out fixed at 4 and the mesh limit at 6
because the prover's arithmetic is linear. D6 is not adopted yet. The sketches below are as proposed. Every claim about CEWP cites where it was
read; everything marked **proposal** is ours, not CEWP's.

Sources read: the site's "How it works" page, all four panels (`how-it-works.html`, including
`#peers`); the CIRISConstitution Part 5 (transport) in full, Part 6 (coherence mathematics) in full,
Part 4 §4.5.13 and Part 2 §2.7.1 to §2.7.3; the formal models `formal/event_lifecycle` and
`formal/alm`; CIRISEdge's README and `docs/LIGHTNET_DARKNET.md`; CEWP's `FSD/SIMULATION_ENGINE.md`
(v0.2), its README, and the twin files `evidence.md`, `media.md` and `nat.md`. Section numbers below
are the Constitution's (CC) unless another document is named.

## A. Summary

CEWP's useful ideas are architectural, not numerical. Five are worth adopting.

1. **The queue is the door** (CC §4.5.13). One predicate decides both what a person is offered and
   what a peer admits, proved sound and complete. uor-comms already decides admission with one
   function. Proving that the kernel's list of offered actions is that same function would stop the
   client and the engine from ever disagreeing.
2. **A row waits for what it names** (CC §2.7.3). An event whose parents have not arrived is held,
   never refused. The host already does this; the model does not say so.
3. **Determinism replaces coordination** (CC §6.1.6, §5.4.6). A relay tree for group calls and large
   rooms that every member computes identically, so there is no coordinator to capture and no
   media server.
4. **Derivation replaces discovery** (CC §5.4.6; CIRISEdge `LIGHTNET_DARKNET.md` §1). A group's
   meeting address is derived from keys members already hold and is never announced. For us this
   means the ntfy.sh topics used for WebRTC setup should be derived and rotated, so the relay cannot
   tell which rooms exist.
5. **Members relay for members** (CC §5.4.6). When two peers cannot reach each other directly, the
   forwarder is a member, or a node a member owns, that has said yes. It sees only ciphertext and
   drops out as soon as a direct path exists. This is the honest answer to NAT without a third-party
   relay.

Two things are not worth adopting now: shaped links and the onion tier. They add 0.2 to 4 seconds
of mean latency per hop and exclude calls and files (CC §5.4.3), which is the opposite of the latency
goal. CEWP's headline numbers (25.1 ms p50, 99.9985% delivery at 30% churn, 6,250,000× egress
relief) are not traceable to its own simulation spec, its evidence ledger or its media and NAT
models, so none is used here as evidence (section H).

One gap in CEWP is ours to fill: it hashes with SHA-256 and SHA3 throughout and never uses BLAKE3 or
verified streaming (CC Parts 2, 4, 5, 6). BLAKE3's verified streaming is a **proposal** of ours,
in D6.

## B. CEWP's mechanisms

| Mechanism | What it does and how | Stated guarantee | Stated limits | Where |
|---|---|---|---|---|
| One signed row | Identity, devices, rooms, moderation all travel as one canonical hybrid-signed row (Ed25519 + ML-DSA-65), five kinds | One grammar for everything | | site, "What is new" |
| State processor | State is the held rows plus each node's own first-held instant; verdicts are folds, never stored; one function runs as queue, preview and door | `queue_sound`, `queue_complete`, `door_is_queue`, `preview_is_execution`, `refused_previews_nothing` (Lean, `formal/event_lifecycle`) | The Lean model checks state and role only, not guards, policies or multi-voice transitions; the register still marks the claim normative-only | §4.5.13 |
| Order-free admission | No sequencer; rows of different signers are never ranked by time or arrival; a row waits for what it names | The kept set is the same in every arrival order | No general Lean theorem of fold permutation-invariance was found | §2.7.2, §2.7.3 |
| Windows from receipt time | A window runs from when this node first held the row; receipt time is never replicated | Counts agree on every node holding the same rows | Window outcomes are per node | §4.5.13 |
| Bootstrap | A shipped anchor (genesis bundle or accord-holder thumbprints) names seated serve nodes; peers holding each other's signed route rows (QR, contact code) connect directly | "One source of route rows, never a required party" | Default bootstrap depends on the shipped anchor | §5.3.4 |
| NAT fallback | When no direct path exists, a consenting member or member-owned node forwards end-to-end-encrypted bodies; a direct link must replace it when one appears | The forwarder learns only that a link exists, plus ciphertext size and timing | Hole punching is not specified; real NAT mix is FRONTIER (no data); A/V across real NATs is unproven (CIRISEdge README) | §5.4.6; SIMULATION_ENGINE §4.6.3 |
| Shaped links | Constant-rate Poisson frames per link, at the lower of the two ends' classes (server 7,000, home 2,800, phone-wifi 1,400, cellular 350 B/s), at most eight per node | Hides timing and volume inside a link | Mean added latency 0.2 to 4 s, minutes near the cap; files over 64 KiB, streams and calls never ride them; link existence and endpoints are not hidden; modelled, not measured on a live mesh | §5.4.3 |
| Anonymous tier | 15,296-byte X-Wing onion packets over shaped links, sticky guards from consenting contacts | Hides who published | Relays "do not mix at today's load"; no calls or streams; specified but switched off | §5.4.6 items 1 to 10 |
| Calls | Each participant sends its own stream; up to about 50 participants a direct mesh, above that a member relay tree, broadcast pull-only | No media server | Latency targets not stated | §5.3.3.2 |
| Layered media | AV1 SVC by default; a receiver takes each sender at the best layer fitting its budget divided by N, down to a presence floor of tens of bytes a second | "Quality falls, presence does not" | | §5.3.3.3, §5.3.3.6, §5.3.3.9 |
| Media chunks | Whole sealed chunks, never split; inner end-to-end seal, outer per-link seal; every chunk carries an Ed25519 signature that relays verify without the media key | Relays cannot inject chunks | Per-chunk signing cost is a single-core microbenchmark; one chunk per link payload (246 B budget over Reticulum) | §5.3.3.5, §5.3.3.7; twin `media.md` §3 |
| Deterministic relay tree | `compute_alm_topology`: integer-only, canonical tie-breaks, publisher alone at depth 0, signed capacity ads clamped before scoring; a missed chunk is pulled from a sibling, then the parent | Depth ⌈log_k N⌉ with no coordinator | Fan-out k is not pinned; that the live tree uses the verified function is staged (CIRISEdge#945); Lean structural theorems are checked on one instance; re-parenting on departure is not stated | §6.1.6, §5.3.3.9; `formal/alm` |
| Group addresses | Per-group destinations derived from directory state members hold; never announced | Outsiders cannot see that a group exists | An on-path observer correlating member traffic can infer it | §5.4.6; CIRISEdge `LIGHTNET_DARKNET.md` §1 |
| Offline delivery | A forwarder may keep a sealed envelope for a sleeping peer for about an hour; a room's mailbox is two member-owned always-on nodes; a phone is never a mailbox | Ciphertext only | With no always-on member, delivery needs both ends awake within two hours; no push wake | §5.4.6 item 6 |
| Removal rekey | Removals coalesced per 2 s window, at most 1,800 epochs an hour | A removed member's exposure is at most 2 s | Post-compromise security off by default | §5.1 |
| Storage | Owner picks a holder count per item; rarest chunk first; per-chunk SHA-256; holding claims challengeable; revoked content ejected below a noise floor | | "We emitted a purge" is not "the bytes are gone" | §6.1.5, §6.1.5.1 to §6.1.5.3 |
| Divergence witness | A signed, sorted, de-duplicated Merkle root of held claims, published on a constant tick | Detects divergence; never decides a merge | SHA-256 without RFC 6962 prefixes, safe only while roots are signed and recomputed in full | §6.1.1 |
| Abuse limits | Per-link, per-sender and node-wide receive rates applied as a set | | A swarm of minted keys can fill the stranger budget: "Nothing in this document keeps that chance up" | §5.3.3.10 E1.9, §5.4.6 |
| Cryptography | Composite ML-DSA-65 + Ed25519 signatures, X-Wing KEM, MLS with a private X-Wing suite | Post-quantum from the first key | No external audit (CIRISVerify) | §5.1; site, problem 6 |

## C. Against uor-comms

| CEWP mechanism | uor-comms today | Verdict |
|---|---|---|
| State processor, queue is the door | One kernel function per question (`Comms.Rules::permitted`); no "what may I do" question | **Better**: adopt as D1 |
| Order-free admission | Place and fold order proved independent of arrival (`placeIgnoresArrivalPosition`, `heldEarlierEventIsPlacedFirst`, `shallowerEventPrecedes`) | **Covered**, and ours is proved generally, where CEWP's is checked on instances |
| A row waits for what it names | The host holds an event with unknown parents and retries; `Comms.Admission` refuses it | **Better**: adopt as D2 |
| Windows from receipt time | No windows modelled yet | Adopt when receipts and typing are modelled; not now |
| Bootstrap by anchor or QR | Invite by Holo ID, link or QR (Holo Messenger's inventory); no anchor | **Different**: the QR and link half matches; the shipped anchor is a fixed entry point we need not have |
| NAT fallback by consenting members | WebRTC with ntfy.sh signalling, no relay | **Better**: adopt the rule as D5 |
| Shaped links, anonymous tier | None | **Not applicable now**: costs seconds of latency and excludes calls |
| Calls: per-sender streams, mesh then tree | `Comms.Call`: a 1:1 call's states only | **Better**: adopt as D3 and D4 |
| Layered media at budget ÷ N | None | **Better**: adopt as D4 |
| Per-chunk signatures on live media | None | **Different**: adopt for live media; for stored media BLAKE3 does better (D6) |
| Deterministic relay tree | None | **Better**: adopt as D3, keyed by place instead of by capacity score |
| Derived group addresses | Room named by the address of its creating event; ntfy topics undecided | **Better**: adopt as D5 |
| Two member-owned mailboxes | Decision 8: an optional, untrusted always-on peer | **Different**: CEWP's form is narrower and better; D7 |
| Coalesced removal rekey | `Comms.Epoch`: a new epoch per membership change | Adopt with the cipher decision, not before |
| Storage floors, noise floor | None | Phase 2 and later |
| Divergence witness | Heads compared (`Comms.Sync`) | **Covered** in spirit; a BLAKE3 heads digest is D6 |
| Post-quantum hybrids | Undecided (cipher, BLAKE3 scope against Prism ID's P-256) | Decision G3 |

## D. Specification sketches

Each sketch is in the style of `app/src/Comms`. Theorem statements are what Lean should prove; none
has been run. Numbers in kernel requests are big-endian, as now.

### D1. `Comms.Queue`: the actions offered are the actions admitted

```
definition{
  name: bit,
  parameters: [allowed : Bool, place : Nat],
  result: Nat,
  body: (if allowed then place else 0)
}

definition{
  name: offered,
  parameters: [senderStatus : Nat, senderPower : Nat, targetStatus : Nat, targetPower : Nat,
               required : Nat, open : Nat, grantedPower : Nat, isDirect : Nat],
  result: Nat,
  body: ((bit ((Comms.Rules::permitted 0 senderStatus senderPower targetStatus targetPower required open grantedPower)
               && (Comms.Create::directAllows 0 isDirect)) 1)
        + ((bit (... action 1 ...) 2) + ... + (bit (... action 7 ...) 128)))
}
```

Theorems, one per action a in 0 to 7, generated:

- `offeredIsAdmittedA`: `((((prim quotient (Comms.Queue::offered ...) 2^a 0 : Nat) % 2) =? 1) = ((Comms.Rules::permitted a ...) && (Comms.Create::directAllows a isDirect)))`. An action is offered exactly when the kernel would admit it.
- `strangerIsOfferedOnlyJoin`: for `senderStatus = 0` and a closed room, `offered = 0`; with an open room, `offered = 1`.

Kernel: operation `0f`, request as `02` without the action byte plus the direct flag; the answer is
eight characters of `0` and `1`, action 0 first.
Host: asks `0f` to draw the buttons; never computes an action list itself.
Moves: Holo Messenger's member and settings menus (part of its 33 membership items), and closes the
"UI rules versus engine rules" drift CEWP names as problem 1.

### D2. `Comms.Admission::verdict`: missing parents mean held, never refused

```
definition{
  name: verdict,
  parameters: [addressMatches : Nat, signatureValid : Nat, deviceMaySign : Nat,
               parentsKnown : Nat, permitted : Nat],
  result: Nat,
  body: (if (parentsKnown =? 0) then 1
         else (if (admitted addressMatches signatureValid deviceMaySign 1 permitted) then 2 else 0))
}
```

0 refused, 1 held, 2 admitted. Theorems:

- `missingParentsAreHeld`: `((verdict a s d 0 p) = 1)`. A missing parent never refuses an event.
- `heldIsNeverAdmitted`: `(((verdict a s d k p) =? 2) && (k =? 0)) = false`.
- `verdictAgreesWithAdmission`: `((((verdict a s d 1 p) =? 2)) = (admitted a s d 1 p))`.

Kernel: operation `01` answers `held` as a third answer (one vector more).
Host: already holds; it would ask instead of deciding. Moves: the "pending" and "failed" states of
Holo Messenger's item 9.

### D3. `Comms.Tree`: the relay tree every member computes the same way

Proposal: order receivers by place (`Comms.Resolve::place`, already proved independent of arrival),
put the publisher at index 0, and give index i the parent ⌊(i − 1) / k⌋. CEWP orders by a signed,
clamped capacity score instead (§6.1.6 N8). Ordering by place needs no capacity claims at all, so
there is no lie to clamp; the price is that a slow phone may sit high in the tree. Capacity can be
added later as a signed rank class.

```
definition{
  name: parentOf,
  parameters: [index : Nat, fanout : Nat],
  result: Nat,
  body: (if (index =? 0) then 0 else (prim quotient (index - 1) fanout 0 : Nat))
}
```

Theorems (fanout ≥ 1 where needed):

- `publisherIsTheOnlyRoot`: `(((0 <? index) && (1 <=? fanout) && (not ((parentOf index fanout) <? index))) = false)`. Every other member's parent comes before it, so the tree has no cycle.
- `noParentHasMoreThanFanoutChildren`: `((((parentOf index fanout) =? p) && (0 <? index) && (1 <=? fanout) && ((index <? ((p * fanout) + 1)) || (((p * fanout) + fanout) <? index))) = false)`. The children of p are exactly indices p·k+1 to p·k+k. (The product p·k needs `fanout` fixed per theorem or stated with the product as a parameter; the prover's arithmetic is linear.)
- `sameRosterSameTree`: follows from the place theorems; stated over two arrival orders of one roster.
- `departureMovesOnlyLaterMembers`: removing a member changes the parent of no member placed before it.

Kernel: operation `10`, request index (8), candidate parent (8), fan-out (1); answers `parent` or
`not parent`. Host: computes the index from place, connects to its parent, pulls a missed chunk
from a sibling first, then its parent (§5.3.3.9). Moves: group calls and large rooms.

### D4. `Comms.Call` extended: call shape and layers

```
definition{
  name: shape,
  parameters: [participants : Nat, meshLimit : Nat],
  result: Nat,
  body: (if (participants <=? 2) then 0 else (if (participants <=? meshLimit) then 1 else 2))
}

definition{
  name: layerFor,
  parameters: [share : Nat, base : Nat, middle : Nat, top : Nat],
  result: Nat,
  body: (if (((base + middle) + top) <=? share) then 2 else (if ((base + middle) <=? share) then 1 else 0))
}
```

`shape`: 0 direct pair, 1 full mesh, 2 relay tree (D3). `share` is the receiver's budget divided by
the number of senders, computed by the host (division by a variable is outside the prover's linear
arithmetic). Theorems:

- `layerNeverExceedsShare`: `(((0 <? (layerFor s b m t)) && (s <? (b + m))) = false)`, and the same for layer 2.
- No theorem is needed for the presence floor (CEWP §5.3.3.9): layer 0, the base, is the lowest answer `layerFor` can give, so a sender is never dropped by definition.
- `moreShareNeverLowersLayer`: `(((s <=? s2) && ((layerFor s2 b m t) <? (layerFor s b m t))) = false)`.

The mesh limit is a **proposal**: CEWP uses about 50 over Reticulum (§5.3.3.2), but a browser
uploading a separate WebRTC stream per peer saturates far sooner. We would start at 6 and measure.
Media keys come from the room's key epoch (`Comms.Epoch`). Moves: Holo Messenger's call items, and
the "1:1, then group" order of Phase 4 slices 5 and 6.

### D5. `Comms.Rendezvous`: derived meeting topics and member forwarders

The host derives the ntfy.sh topic for a room's WebRTC setup as BLAKE3 `derive_key` with context
`"uor-comms rendezvous v1"` over the room's epoch secret and the hour index. The relay then sees
only random topics that change every hour. CEWP's rotation rule applies (§5.4.6): topics rotate on
a global clock, never at a group event, so a membership change is not visible as a topic change.
The model decides who may hold a topic and who may forward:

```
definition{
  name: holdsTopic,
  parameters: [joinedAt : Nat, leftAt : Nat, topicEpoch : Nat],
  result: Bool,
  body: (Comms.Epoch::holdsKey joinedAt leftAt topicEpoch 0)
}

definition{
  name: mayForward,
  parameters: [forwarderStatus : Nat, ownedByMember : Nat, consented : Nat, directPath : Nat],
  result: Bool,
  body: ((directPath =? 0) && ((consented =? 1) && ((forwarderStatus =? 2) || (ownedByMember =? 1))))
}
```

Theorems:

- `removedMemberHearsNoLaterSetup`: `(((holdsTopic j l e) && (l <=? e)) = false)`, from `Comms.Epoch`.
- `strangerNeverForwards`: `(((mayForward s 0 c d) && (not (s =? 2))) = false)`.
- `directPathRetiresTheForwarder`: `((mayForward s o c 1) = false)` (CEWP §5.4.6: "MUST be made direct").
- `forwardingNeedsConsent`: `((mayForward s o 0 d) = false)`.

Moves: transport (Holo Messenger item 13) without a third party learning which rooms exist.

### D6. BLAKE3 doing more work (proposal; CEWP does none of this)

- **Stored media and files.** An attachment's address is the BLAKE3 root of its bytes, which it
  already is. With Bao's outboard tree, a receiver checks every 1 KiB group as it arrives and can
  fetch disjoint ranges from several holders at once, stopping a lying holder after one group
  instead of after the whole file. CEWP fetches whole chunks from at most two holders and checks
  each chunk's SHA-256 (§5.3.2.1). Model: `Comms.Fetch::assigned chunk holders = chunk % holders`,
  with `everyChunkHasOneHolder` and `aLostHolderReassignsOnlyItsChunks`.
- **Unchanged content is never resent.** The address of each 1 KiB group is part of the tree, so
  an edited file shares every untouched subtree with the old one. The host asks only for the
  subtrees it lacks: `Comms.Sync::wanted` over subtree addresses.
- **Heads as one address.** Two peers compare one BLAKE3 digest of the sorted heads before
  comparing the heads themselves (`Comms.Sync::bytesMove` already compares; this makes it one
  32-byte question per room). Sorting and de-duplicating before hashing is the same discipline as
  CEWP's witness (§6.1.1).
- **Live media.** Keep a signature per chunk, as CEWP does (§5.3.3.5): relays can verify without the
  media key and drop forged chunks. CEWP's media twin measures Ed25519 verify at 60 µs on a desktop
  and 150 µs on a phone, as a model input (twin `media.md` §3). BLAKE3 adds a hash chain: each chunk
  names the previous chunk's address, so a receiver detects a missing or reordered chunk without
  extra signatures.
- **Keyed mode.** BLAKE3 `keyed_hash` can authenticate a chunk between members who share the epoch
  key, where a relay need not verify. It replaces nothing that a signature must prove.

### D7. `Comms.Mailbox`: who may hold mail for a sleeping member

```
definition{
  name: mayHold,
  parameters: [holderStatus : Nat, ownedByMember : Nat, alwaysOn : Nat, isPhone : Nat],
  result: Bool,
  body: ((isPhone =? 0) && ((alwaysOn =? 1) && ((holderStatus =? 2) || (ownedByMember =? 1))))
}
```

Theorems: `aPhoneIsNeverAMailbox`, `aStrangerIsNeverAMailbox`. The mailbox holds ciphertext it
cannot read and takes no part in admission. This narrows decision 8 to CEWP's form (§5.4.6 item 6).

## E. The six goals

| Goal | Verdict | Where it bends | Least-centralised option |
|---|---|---|---|
| 1. Decentralised, serverless | **Partly met** | Bootstrap needs the first contact's address (QR, link). WebRTC setup uses ntfy.sh, a third party that sees topics and timing. Offline delivery and phone wake need an always-on party | Derived, rotating topics (D5); member-owned mailboxes (D7); later, signalling over already-connected members instead of ntfy.sh |
| 2. Very low latency | **Partly met** | Direct paths add only the network's round trip. A forwarder adds one hop. A relay tree adds one hop per level, ⌈log_k N⌉ levels. Shaped links would add seconds, so they are out | Direct first; a member forwarder only when no direct path exists; trees only above the mesh limit |
| 3. No limit on users or throughput | **Not met as stated; partly met in shape** | No component grows with total users. Per room it does: sending costs one event to each member's peers; a call costs each sender's uplink times the mesh size until the tree takes over; a tree adds latency at log rate. Storage grows with history | Cost per operation: send O(1) to compose plus O(m) delivery for m members; sync O(changed) by hashes; call O(N) up to the mesh limit, then O(k) per node and O(log_k N) latency |
| 4. Most use of BLAKE3 | **Met in design** | Every address is already BLAKE3. Verified streaming, subtree reuse and the heads digest are proposals (D6), not built | D6 |
| 5. Very high security | **Partly met** | Proved: admission, permissions, redaction, key epochs, content form, direct rooms. Assumed: BLAKE3, signatures, the cipher (undecided), Prism ID. Not designed: metadata privacy beyond D5, Sybil limits on open rooms, verifying another person | D2, D5, D7; the cipher decision (G3) |
| 6. Text, voice and video | **Text partly met; voice and video not started** | Text content is modelled and proved (RK-16). Calls have states only | D3, D4 |

The honest answers the brief asked for:

- **NAT with no relay.** Not always possible. The one field study CEWP's site cites (libp2p, IMC
  '22) reports direct hole punching succeeding about 70% of the time; CEWP's own NAT model has no
  real data (SIMULATION_ENGINE §4.6.3: FRONTIER). The least-centralised fallback is a consenting
  member or member-owned node (D5), never an anonymous public relay.
- **Everyone offline.** A message cannot be delivered when every device of every member is asleep.
  It waits on the sender's device. A member-owned always-on node (D7) is the only remedy that keeps
  third parties out.
- **Waking a phone without a vendor push service.** Not possible on iOS or stock Android while the
  app is closed. CEWP states no mechanism either. Without vendor push, a phone receives when it
  next opens the app, or while a member-owned node holds its mail.
- **"Limitless".** Flat in total users; not flat per room. The first point where cost stops being
  flat is a group call above the mesh limit, where latency starts to grow with log N.
- **Group voice and video with no media server.** Members forward for members along the tree (D3).
  Fan-out per node is bounded by k. Abuse is stopped by per-chunk signatures (only the publisher's
  chunks are forwarded) and by the tree's inputs being place, not claims. A member who drops chunks
  is routed around by sibling pull; a member who forwards garbage is caught by the signature.

## F. Proved, tested, assumed

| Proposal | Would be proved | Only tests or measurement can show | Stays assumed |
|---|---|---|---|
| D1 queue | Offered equals admitted, per action | That the client draws only what `0f` answers | |
| D2 verdict | Missing parents never refuse | That the host retries held events | |
| D3 tree | Acyclic, bounded fan-out, same tree from same roster, departure moves only later members | Latency per level, sibling-pull recovery time, behaviour on real NATs | Members forward honestly beyond what signatures catch |
| D4 call | Layer within share, presence kept, monotone in share | The right mesh limit for browsers; codec quality | Codec behaviour |
| D5 rendezvous | Removed members hold no later topic; forwarders are consenting members, and only without a direct path | Hole-punch success; ntfy.sh availability | BLAKE3 `derive_key` is a PRF; ntfy.sh does not correlate across topics beyond timing |
| D6 BLAKE3 | Fetch assignment covers every chunk once | Throughput of multi-holder fetch | BLAKE3 collision resistance |
| D7 mailbox | Phones and strangers never hold mail | Delivery rates with real always-on nodes | The mailbox node stays available |

Not proved today and not covered by these proposals: that peers holding the same events fold to the
same state (no sorted list in the model), UTF-8 and NFC of content, the cipher, Prism ID, and any
latency.

## G. Decisions for the owner

1. **Adopt D1 to D5 and D7 as the next model work, before transport code.** Recommended. Each is
   small (one module, three to six theorems, one kernel operation) and each removes a decision the
   host would otherwise make alone. Trade-off: about a week of model work before two browsers talk.
2. **Order the relay tree by place, not by capacity (D3).** Recommended: no capacity claims means
   nothing to lie about, and place is already proved. Trade-off: slower devices may sit high in the
   tree until a signed rank class is added.
3. **Cipher and signatures: post-quantum hybrids from the first key.** Recommended to decide now,
   because changing later is a migration (CEWP's problem 6). X-Wing (X25519 + ML-KEM-768) for key
   wrapping is a standard construction. Signatures depend on Prism ID, which uses P-256: either keep
   P-256 for now and plan a composite later, or ask Prism ID for a composite key.
4. **Narrow decision 8 to member-owned mailboxes (D7).** Recommended. Trade-off: rooms where no
   member runs an always-on node get no offline delivery.
5. **Derive and rotate ntfy.sh topics (D5).** Recommended; small. Trade-off: a peer must hold the
   epoch secret before it can find the room, so a first invitation still needs the QR or link.
6. **Start the mesh limit at 6 and measure (D4).** A guess, stated as one.
7. **Do not adopt shaped links or the onion tier now.** Recommended. Revisit as an opt-in privacy
   mode once rooms work.

## H. What could not be determined

- CEWP's headline figures (25.1 ms p50 fetch, 24.5 ms p50 call, 99.9985% delivery at 30% churn,
  78 / 390 ms re-home, +5 / +34 ms latency, 6,250,000× egress relief, 1.04 GB a day per home
  server) appear in none of the simulation spec, the evidence ledger, or the media and NAT models.
  The simulation spec labels its NAT inputs FRONTIER and its media results MODEL. 6,250,000 equals
  50 million divided by 8, so it is likely arithmetic on the assumed fan-out (our inference). The
  only field measurement found is one production node with 1,349 nodes announced, observed in four
  60-second windows (SIMULATION_ENGINE §4.7).
- The README's "five billion people simulated one-to-one over the real internet" conflicts with the
  spec, which calls planetary runs an eventual demonstration and the network graph a model stand-in
  (SIMULATION_ENGINE §4.5, §9.3).
- CIRISEdge's own README says its bench is one host, one relay and up to four subscribers, that no
  sweep is recorded green on 44.x, and that A/V across real NATs is unproven.
- The relay tree's fan-out, its re-parenting rule on departure, and the "15 frozen vectors" are not
  stated in the Constitution text read; the Lean model proves its structural theorems on one
  instance.
- How CEWP punches holes is not specified.
- Whether the "queue is the door" theorems cover multi-voice transitions: the Lean model checks only
  the one-voice case.
