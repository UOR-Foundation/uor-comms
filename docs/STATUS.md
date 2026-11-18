# Status

Last run: 2026-11-18, the `build` workflow of this repository, `just app` in the SDK image `prismpm.lock` pins, Lean 4.32.1.
Result: `19 modules are canonical`, `verified attestation: a43e6052f386c4caddb0498f476e3856c2e3ffc733a5c94cb55fccdf834f7ed7`, provenance signed, [run 44301638095](https://github.com/UOR-Foundation/uor-comms/actions/runs/44301638095). That run was of a throwaway commit holding these same model files; the run of the commit that carries this document is named in the pull request.

That run covered the 58 theorems of the first eight proof modules. The 14 theorems of `Comms.StateProofs` were added afterwards: the gate run of the pull request that adds them is the run that proves them, and it is named there. The 20 theorems of `Comms.EventProofs` and `Comms.SendProofs` were added after that in the same way, and then the 13 of `Comms.RedactProofs` and 14 more in `Comms.EventProofs` for reading an event.

"Proved" means Lean accepted the theorem in that run. "Tested" means an acceptance vector was replayed in the compiled guest in that run. Each theorem declares the exact axioms Lean observed (`propext`, `Quot.sound`, `Classical.choice`, or none).

## Proved (119 theorems)

| Module | Theorems | What they say |
|---|---|---|
| `Comms.AdmissionProofs` | `tamperedEventRefused`, `unsignedEventRefused`, `removedDeviceRefused`, `orphanEventRefused`, `unpermittedEventRefused`, `soundEventAdmitted` | An event failing any one of the five conditions is refused; one meeting all five is admitted |
| `Comms.RulesProofs` | `bannedMemberDoesNothing`, `onlyJoinedMembersWrite`, `belowRequiredPowerRefused`, `cannotRemoveEqualOrHigher`, `cannotGrantAboveOwnPower`, `cannotChangeEqualOrHigherPower`, `closedRoomNeedsInvite`, `unknownActionRefused`, `namedCodesMatch` | Who may join, leave, invite, kick, ban, unban, send and change power |
| `Comms.OrderProofs` | `orderIsTotal`, `orderNeverBothWays`, `orderNeverPrecedesItself`, `orderIsTransitive` | Rank then address is a strict total order |
| | `earlierInOrderHasSmallerKey`, `smallerKeyIsEarlierInOrder`, `equalKeysAreTheSameEvent` | For addresses below 2^256 the resolver's ordering key orders events exactly as rank then address does |
| | `wideOrderIsTotal`, `wideOrderNeverBothWays`, `wideOrderMatchesPackedAddress`, `packedAddressIsBelowTheBound` | The kernel's comparison of four 64-bit words agrees with rank then address on the packed 256-bit address |
| `Comms.ResolveProofs` | `mergeComm`, `mergeIdem`, `mergeAbsorb`, `mergeLeftComm` | Choosing between two candidates does not depend on order or repeats |
| | `redeliveryChangesNothing`, `arrivalPositionChangesNothing`, `neighboursSwapAnywhere` | Delivering an event twice, at any position, or exchanging any two neighbours gives the same state (the last two by induction) |
| `Comms.EpochProofs` | `membershipChangeRotatesKey`, `joinerCannotReadEarlier`, `removedMemberCannotReadLater`, `removalEpochIsUnreadable`, `currentMemberReadsFromJoining` | Who holds the key of which epoch |
| `Comms.MemberProofs` | `statusStaysInRange`, `banLeavesBanned`, `onlyJoiningMakesAMember`, `refusedEventChangesNothing`, `powerChangesOnlyByPowerChange`, `newestBanDecides`, `bannedMemberIsNotInvitedOrKicked`, `permittedBanTakesEffect` | What status and power a permitted action leaves behind |
| `Comms.StateProofs` | `statusStepIsTheKernelStep`, `powerStepIsTheKernelStep` | One event changes a status exactly as the kernel's membership step does, and a power exactly as `nextPower` does, when the kernel's permission rule allows it |
| | `eventChangesOnlyItsSubjectsStatus`, `eventChangesOnlyItsSubjectsPower`, `bannedSenderChangesNothing`, `onlyAnUnbanLiftsABan` | An event changes nobody but its subject; an event from a banned sender changes nothing; a banned member stays banned through every action but an unban |
| | `statusStaysInRangeAfterAnyHistory`, `noPowerAboveTheCreator`, `roomStartsWithItsCreator` | After any list of events every status is one of the five and no power exceeds the creator's (both by induction); an empty room holds its creator alone |
| | `cappedStatusStaysCapped`, `cappedPowerStaysCapped`, `cappedNeverExceedsItsLimit`, `statusIsCapped`, `powerIsCapped` | Lemmas the two inductions rest on |
| `Comms.EventProofs` | `decodingUndoesEncoding`, `wordSurvivesItsBytes`, `boundedWordIsUnchanged`, `bytesSurviveTheirWord` | Decoding an event's bytes returns each word reduced below 2^64, which is the word itself when it is below 2^64 (the first by induction); eight bytes below 256 survive being read as a word and written back |
| | `everyWordIsEightBytes`, `eightMoreBytes` | An event of n words is 8n bytes (by induction), and the arithmetic step it rests on |
| | `repeatedAddressRefused`, `addressesHaveOneOrder`, `partAddressRefused`, `wrongVersionRefused` | A list naming an address twice in a row, a pair of addresses in the other order, three words of an address, and version 2 are each refused |
| | `versionIsReadBack`, `actionIsReadBack`, `grantedPowerIsReadBack`, `parentsAreReadBack`, `authoritiesAreReadBack`, `nothingIsLeftOver` | From the words of an event laid out with four-word addresses, the version, action, granted power, parents and authorities are read back unchanged and no word is left over |
| | `takeReturnsTheFront`, `skipReturnsTheRest`, `takeReturnsAll`, `skipLeavesNothing`, `oneMoreIsTheNext` | Taking and skipping as many words as a list holds return that list and what follows it (by induction), and the arithmetic step they rest on |
| | `eightBytesAreAWholeWord`, `ninthByteIsRefused`, `shortEventIsRefused` | Eight bytes are a whole word, nine are refused, and an event of no words is refused |
| `Comms.SendProofs` | `composedExactlyWhenPermittedAndCanonical`, `bannedSenderComposesNothing`, `wrongVersionComposesNothing` | An event is composed exactly when the permission rule allows the action and the form is canonical; never for a banned sender or another version |
| | `sentEventBecomesAHead`, `soleHeadIsReplaced` | The sent event is a head afterwards; a room with one head, cited, is left with the sent event alone |
| | `announcedOnlyAfterStored`, `storedOnlyAfterSigned`, `sendNeverStepsBack`, `wrongReportChangesNothing`, `announceIsAskedOnlyOnceStored` | A send reaches stored only from signed and announced only from stored, never moves back, ignores a report for any other step, and asks for the announcement only once stored |
| `Comms.RedactProofs` | `onlyJoinedMembersRedact`, `bannedMemberRedactsNothing`, `redactionNeedsSendingPower`, `ownEventNeedsOnlySendingPower`, `anothersEventNeedsPower`, `redactionNeedsCanonicalForm` | Only a joined member with the power to send redacts; their own event needs nothing more, another member's needs the redaction power; a redaction of another version is not composed |
| | `redactedContentIsGone`, `laterRedactionUndoesNone`, `redeliveredRedactionChangesNothing`, `redactionOrderChangesNothing`, `redactionTouchesOnlyItsEvent`, `redactedContentIsNotFetched` | A redacted event shows no content, a later redaction of another event does not bring it back, a redaction delivered twice or two delivered in either order give the same result, a redaction changes no other event, and redacted content is not fetched |
| | `redactionChangesNoMember` | A redaction changes no member's status or power |
| `Comms.SyncProofs` | `equalHeadsMoveNothing`, `emptyOfferWantsNothing`, `heldContentIsNotFetchedAgain` | Equal heads send nothing; held content is never requested |
| `Comms.CallProofs` | `endedCallStaysEnded`, `hangUpAlwaysEnds`, `stateStaysInRange`, `noConnectionFromIdle`, `callerConnectsOnlyWhenAnswered`, `calleeConnectsOnlyByAccepting`, `crossedCallsNeverBothYield`, `crossedCallsOneSideYields`, `namedStatesMatch` | A call connects only through an answer and ends for good; when calls cross exactly one side yields |

## Tested (51 acceptance vectors)

The holo's entry point, `RoomKernel.dispatch`, answers ten operations. The vectors are in the `application` record of `app/src/RoomKernel.lex.tex` and were replayed in the compiled guest.

| Operation | Vectors | Covers |
|---|---|---|
| Admit | 4 | all conditions met; address mismatch; device may not sign; parent missing |
| Permit | 7 | send; ban at equal power; ban of a lower member; banned sender; join of a closed room with and without an invitation; granting above own power |
| Order | 3 | left earlier, same, left later |
| Key | 4 | inside membership; before joining with and without shared history; at removal |
| Call | 4 | answer connects; ended stays ended; idle ignores an answer; accepting connects |
| Member | 3 | permitted ban; refused ban; accepted invitation |
| Redact | 5 | another member's event with and without the redaction power; own event; banned sender; own event below the power to send |
| Send | 5 | signed, stored and announced in turn; a report for another step; no report |
| Heads | 2 | equal heads; different heads |
| Compose | 8 | a send citing one parent; version 2; banned sender; parents out of order; two parents in order; a parent count the words do not match; a trailing byte; no parents |
| Invalid | 6 | empty; unknown operation; wrong length, three times; a request at the guest's allocation bound |

The expected answers were computed by a script that restates the rules in JavaScript; the replay is what checks them against the model.

## Not proved

- **Convergence stated over permutations.** Neighbour exchanges generate every reordering, so any two orderings of the same events agree; that closing sentence is ordinary mathematics and not a theorem in the model, which has no notion of permutation.
- **That the kernel's answers are the modelled functions.** `RK-09` pins the text of the entry point and the vectors exercise it; no theorem relates `dispatch` to the decision functions, and none covers the byte readers `natAt` and `bytesFrom`.
- **That the host builds room state as the model does.** `Comms.State` defines the status and power of every member as a fold of the room's events, and each step of the fold is the kernel's own permission and membership answer. The kernel does not run the fold: a host must, and nothing checks that it does.
- **The fold over a set of events.** `Comms.State` folds a list in a given order. That the order `Comms.Order` gives makes the result the same on every peer is not stated as a theorem. That applying an event twice changes nothing was tried and is not proved.
- **One byte form for every event.** The theorems cover one word, one list of words and pairs of addresses. That two different well-formed events never share bytes is not stated as one theorem, and that two ascending lists with the same addresses are equal is not proved.
- **Heads in general.** That every cited head stops being a head and every other head stays is proved for a room with one head only; the general statements were tried and are not proved.
- **Redaction over any history.** That a redaction stays in force is proved for the next redaction that arrives, not by induction over every later one; order and redelivery are proved for neighbours at the front of the list. The model does not check that the redactor sent the event ("own" is an input). The kernel answers who may redact, not what a redacted event shows.
- **Reading an event, in full.** The read-back theorems are about words, for an event laid out with four-word addresses. That `readable` accepts the bytes of every such event with a canonical form is not one theorem: it would join them to `decodingUndoesEncoding`, which holds for words below 2^64. That a byte length is whole words is proved for eight and nine bytes, not for every length. Room, sender, device, target and content are four words by position; nothing else checks them.
- **That the host sends as the model does.** `Comms.Send` says when an event is composed and in what order it is signed, stored and announced. The kernel answers the order of the three steps and whether an event may be composed. It returns that answer, not the bytes, and it refuses a redaction, which `Comms.Rules` does not know; `Comms.Redact::mayCompose` is not routed.
- **Room settings as events.** The required power and whether the room is open are fixed for the fold. Events that change them, and a required power per action, are not modelled.
- **The ban race.** A ban and an event from the banned member that do not see each other are settled by rank; the security argument is not proved.
- **The planted-defect check** was run in a scaffold before this repository existed, not through this gate.

## Assumed

- BLAKE3 is collision resistant and the host computes it correctly. The kernel is told two addresses to compare; it does not hash.
- Signatures cannot be forged and the host checks them correctly.
- Prism ID's verdict on a device is correct. The kernel takes it as a flag and restates none of stitch's model.
- Encryption hides content from anyone without the epoch key.
- The network eventually delivers every event to every member.

## Not done

- No host: nothing stores events, moves bytes, encrypts or draws a screen. The send path is modelled; receiving, and reading an event back into fields, are not.
- Knock, space-restricted joins, reporting, presence, per-user synced data and profiles are not in the model.
- Hosted-prover runs made while developing are diagnostics; only the build workflow's run is cited above.
