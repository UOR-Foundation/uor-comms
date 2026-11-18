# Status

Last run: 2026-11-18, `lexlean verify --all` in the SDK image `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:cd3b47d7…`, Lean 4.32.1, no network.
Result: `verified 11 modules; attestation bf5155d2bc81615ad29cbc1311fd7c5681778f4e3c9234de3cb2b8c8b0112ee5`.

"Proved" below means Lean accepted the theorem in that run. Each theorem declares the exact axioms Lean observed (`propext`, `Quot.sound`, or none).

## Proved (42 theorems)

| Module | Theorem | What it says |
|---|---|---|
| `Comms.Resolve` | `mergeComm`, `mergeIdem`, `mergeAbsorb`, `mergeLeftComm` | Choosing between two candidates does not depend on their order or on repeats |
| | `redeliveryChangesNothing` | An event delivered twice gives the same state as once |
| | `arrivalPositionChangesNothing` | An event delivered at any position in any sequence gives the same state as if it had arrived first (by induction on the sequence) |
| `Comms.Order` | `orderIsTotal`, `orderNeverBothWays`, `orderNeverPrecedesItself`, `orderIsTransitive` | Rank then address is a strict total order |
| `Comms.Admission` | `tamperedEventRefused` | An event whose bytes do not give its address is refused |
| | `unsignedEventRefused`, `removedDeviceRefused`, `orphanEventRefused`, `unpermittedEventRefused` | Each of the other four conditions is necessary |
| | `soundEventAdmitted` | An event that meets all five is accepted |
| `Comms.Rules` | `bannedMemberDoesNothing` | A banned member is permitted no action |
| | `onlyJoinedMembersWrite` | Invite, kick, ban, unban, send and power change need a joined sender |
| | `belowRequiredPowerRefused` | Those actions need the required power |
| | `cannotRemoveEqualOrHigher` | Nobody kicks or bans a member of equal or higher power |
| | `cannotGrantAboveOwnPower`, `cannotChangeEqualOrHigherPower` | Power changes stay below the sender's own |
| | `closedRoomNeedsInvite`, `unknownActionRefused`, `namedCodesMatch` | A closed room is joined only by invitation; an unknown action is refused |
| `Comms.Epoch` | `membershipChangeRotatesKey` | Every membership change starts a later epoch |
| | `joinerCannotReadEarlier` | Without shared history, a member holds no key from before joining |
| | `removedMemberCannotReadLater`, `removalEpochIsUnreadable` | A removed member holds no key from the removal onward |
| | `currentMemberReadsFromJoining` | A member holds the key of the epoch they joined |
| `Comms.Sync` | `equalHeadsMoveNothing` | Equal heads send no bytes |
| | `heldContentIsNotFetchedAgain`, `emptyOfferWantsNothing` | Content already held is never requested |
| `Comms.Call` | `endedCallStaysEnded`, `hangUpAlwaysEnds`, `stateStaysInRange` | A call ends for good and never leaves its five states |
| | `noConnectionFromIdle`, `callerConnectsOnlyWhenAnswered`, `calleeConnectsOnlyByAccepting` | A call connects only through an answer |
| | `crossedCallsNeverBothYield`, `crossedCallsOneSideYields` | When both sides call at once, exactly one yields |

Planted defect: removing the power comparison from the ban rule makes Lean reject `Comms.Rules`. The file was restored byte for byte.

## Not proved

- **Convergence for every reordering.** Lean proved that moving one event to any position, and repeating one, change nothing. That any two orderings of the same set agree follows from those two by ordinary mathematics; that last step is not stated in the model and not checked by Lean.
- **The link between the modules.** `Comms.Resolve` works on ordering keys and `Comms.Order` on rank and address pairs. That one encodes the other is not proved.
- **The ban race.** See `DESIGN.md`.
- **A member list.** `Comms.Rules` judges one action against given statuses and powers. Deriving those from a room's events is not modelled.

## Tested only

Nothing yet. The model has no acceptance vectors of its own; the scaffold's sample entry and its six vectors are unrelated to this model.

## Assumed

- BLAKE3 is collision resistant, and the host computes it correctly. The model receives the derived address as an input.
- Signatures cannot be forged, and the host checks them correctly.
- Prism ID's verdict on a device is correct. The model takes it as an input and restates none of stitch's model.
- Encryption hides content from anyone without the epoch key. `Comms.Epoch` decides who holds a key, not what a key protects.
- The network eventually delivers every event to every member.

## Where this stands in the repository

- The run above was made in a scaffold project before this repository existed, under the module prefix `PrismTextRequest`. Here the same seven files sit under `PrismTemplateContract`, so that attestation does not name this tree. This repository's own proof is the `build` workflow's run of `prismpm verify`.
- The modules are entrypoints of the app's LexLean project and are not imported by `app/src/Contract.lex.tex`. A module the application imports is compiled into the guest, and a `linear_arithmetic` proof there makes that compile run past the build's ten-minute limit (`PP5007`, LexLean #465). When the entry point starts calling these definitions, each module splits into definitions and a separate proofs module, as Foundry's kernel does.
- No capability is registered in `model/ids.toml`, so `CONFORMANCE.md` claims nothing about messaging. Each theorem group still needs its ID row, scenario and pinned test (R3).
