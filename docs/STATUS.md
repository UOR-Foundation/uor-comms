# Status

Last run: 2026-11-18, the `build` workflow of this repository, `just app` in the SDK image `prismpm.lock` pins (`ghcr.io/afflom/prismpm-sdk-patched@sha256:3dfa5f72…`), Lean 4.32.1.
Result: `10 modules are canonical`, `lexlean.lock is current`, `verified attestation: cdb77bf69fd79ee37ce24c372792698fe3e08f07b4221914d172b5bc03960612`, [run 44289959087](https://github.com/UOR-Foundation/uor-comms/actions/runs/44289959087). That run was of a throwaway commit holding these same model files; the run of the commit that carries this document is named in the pull request.

"Proved" below means Lean accepted the theorem in that run. Each theorem declares the exact axioms Lean observed (`propext`, `Quot.sound`, `Classical.choice`, or none).

## Proved (46 theorems)

| Module | Theorem | What it says |
|---|---|---|
| `Comms.Resolve` | `mergeComm`, `mergeIdem`, `mergeAbsorb`, `mergeLeftComm` | Choosing between two candidates does not depend on their order or on repeats |
| | `redeliveryChangesNothing` | An event delivered twice gives the same state as once |
| | `arrivalPositionChangesNothing` | An event delivered at any position in any sequence gives the same state as if it had arrived first (by induction on the sequence) |
| | `neighboursSwapAnywhere` | Exchanging two neighbouring events anywhere in a sequence gives the same state (by induction on what comes before them) |
| `Comms.Order` | `orderIsTotal`, `orderNeverBothWays`, `orderNeverPrecedesItself`, `orderIsTransitive` | Rank then address is a strict total order |
| | `earlierInOrderHasSmallerKey`, `smallerKeyIsEarlierInOrder`, `equalKeysAreTheSameEvent` | For addresses below 2^256, the resolver's ordering key (rank times 2^256 plus address) orders events exactly as rank then address does, and equal keys mean the same event |
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

Planted defect, in the scaffold project before this repository existed: removing the power comparison from the ban rule made Lean reject `Comms.Rules`. The file was restored byte for byte. It has not been repeated through this repository's gate.

## Not proved

- **Convergence stated over permutations.** Lean proved that exchanging any two neighbours, moving one event to any position, and repeating one, change nothing. Neighbour exchanges generate every reordering, so any two orderings of the same events agree; that closing sentence is ordinary mathematics and is not itself a theorem in the model, which has no notion of permutation.
- **That the resolver is fed ordering keys.** `orderingKey` is proved to match the order, but nothing yet builds the resolver's input from events, because there is no entry point.
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

- The modules are entrypoints of the app's LexLean project and are not imported by `app/src/Contract.lex.tex`. A module the application imports is compiled into the guest, and a `linear_arithmetic` proof there makes that compile run past the build's ten-minute limit (`PP5007`, LexLean #465). When the entry point starts calling these definitions, each module splits into definitions and a separate proofs module, as Foundry's kernel does.
- No capability is registered in `model/ids.toml`, so `CONFORMANCE.md` claims nothing about messaging. Each theorem group still needs its ID row, scenario and pinned test (R3).
