Feature: room

  The room kernel in app/: every decision a peer takes about a room, as a
  function in the LexLean model, and the theorems the Lean kernel checks
  about each. A step of the form "<name> in <file> states <statement>" or
  "<name> in <file> contains <text>" is a pin: the test for the scenario's ID
  checks it against the model, to the end of the line.

  @RK-01 @build
  Scenario: An event is admitted only when its address matches, it is signed, its device may sign, its parents are known and it is permitted
    Given the admission model in app/src/Comms/Admission.lex.tex
    When the Lean kernel checks the theorems of AdmissionProofs during prismpm verify
    Then tamperedEventRefused in Comms/AdmissionProofs.lex.tex states ((Comms.Admission::admitted 0 signatureValid deviceMaySign parentsKnown permitted) = false)
    And unsignedEventRefused in Comms/AdmissionProofs.lex.tex states ((Comms.Admission::admitted addressMatches 0 deviceMaySign parentsKnown permitted) = false)
    And removedDeviceRefused in Comms/AdmissionProofs.lex.tex states ((Comms.Admission::admitted addressMatches signatureValid 0 parentsKnown permitted) = false)
    And orphanEventRefused in Comms/AdmissionProofs.lex.tex states ((Comms.Admission::admitted addressMatches signatureValid deviceMaySign 0 permitted) = false)
    And unpermittedEventRefused in Comms/AdmissionProofs.lex.tex states ((Comms.Admission::admitted addressMatches signatureValid deviceMaySign parentsKnown 0) = false)
    And soundEventAdmitted in Comms/AdmissionProofs.lex.tex states ((Comms.Admission::admitted 1 1 1 1 1) = true)

  @RK-02 @build
  Scenario: Only a joined member with the required power writes, and nobody removes a member of equal or higher power
    Given the permission rule in app/src/Comms/Rules.lex.tex
    When the Lean kernel checks the theorems of RulesProofs during prismpm verify
    Then bannedMemberDoesNothing in Comms/RulesProofs.lex.tex states ((Comms.Rules::permitted action 4 senderPower targetStatus targetPower required open grantedPower) = false)
    And onlyJoinedMembersWrite in Comms/RulesProofs.lex.tex states (((Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower) && ((2 <=? action) && ((senderStatus <? 2) || (2 <? senderStatus)))) = false)
    And cannotRemoveEqualOrHigher in Comms/RulesProofs.lex.tex states (((Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower) && (((action =? 3) || (action =? 4)) && (senderPower <=? targetPower))) = false)

  @RK-03 @build
  Scenario: Candidates for a state key are in a strict total order by rank then address, and the word-by-word comparison of the kernel is that order
    Given the order in app/src/Comms/Order.lex.tex
    When the Lean kernel checks the theorems of OrderProofs during prismpm verify
    Then orderIsTransitive in Comms/OrderProofs.lex.tex states (((Comms.Order::precedes aRank aKappa bRank bKappa) && ((Comms.Order::precedes bRank bKappa cRank cKappa) && ((Comms.Order::precedes cRank cKappa aRank aKappa) || (Comms.Order::same aRank aKappa cRank cKappa)))) = false)
    And wideOrderMatchesPackedAddress in Comms/OrderProofs.lex.tex states ((((wordsBounded l0 l1 l2 l3) && (wordsBounded r0 r1 r2 r3)) && ((Comms.Order::precedesWide leftRank l0 l1 l2 l3 rightRank r0 r1 r2 r3) && ((Comms.Order::precedes rightRank (packed r0 r1 r2 r3) leftRank (packed l0 l1 l2 l3)) || (Comms.Order::same leftRank (packed l0 l1 l2 l3) rightRank (packed r0 r1 r2 r3))))) = false)

  @RK-04 @build
  Scenario: The resolved state does not depend on the order or repetition of delivery, and neither does the place of an event in the order
    Given the resolver in app/src/Comms/Resolve.lex.tex
    When the Lean kernel checks the theorems of ResolveProofs during prismpm verify
    Then neighboursSwapAnywhere in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::resolve (Comms.Resolve::joined before (cons earlier (cons later after))) seed) = (Comms.Resolve::resolve (Comms.Resolve::joined before (cons later (cons earlier after))) seed))
    And redeliveryChangesNothing in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::resolve (cons event (cons event rest)) seed) = (Comms.Resolve::resolve (cons event rest) seed))
    And place in Comms/Resolve.lex.tex contains | List.cons head rest => ((ahead key head) + (place key rest))
    And placeIgnoresArrivalPosition in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::place key (Comms.Resolve::joined before (cons event after))) = ((Comms.Resolve::ahead key event) + (Comms.Resolve::place key (Comms.Resolve::joined before after))))
    And arrivalOrderChangesNoPlace in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::place key (Comms.Resolve::joined before (cons earlier (cons later after)))) = (Comms.Resolve::place key (Comms.Resolve::joined before (cons later (cons earlier after)))))
    And earlierEventIsNeverPlacedLater in Comms/ResolveProofs.lex.tex states (((a <? b) && ((Comms.Resolve::place b arrivals) <? (Comms.Resolve::place a arrivals))) = false)
    And eventIsNotAheadOfItself in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::ahead key key) = 0)
    And earlierEventIsAheadOfALater in Comms/ResolveProofs.lex.tex states (((a <? b) && ((Comms.Resolve::ahead b a) =? 0)) = false)
    And heldEarlierEventIsPlacedFirst in Comms/ResolveProofs.lex.tex states (((a <? b) && ((Comms.Resolve::place b arrivals) <? ((Comms.Resolve::place a arrivals) + (Comms.Resolve::copies a arrivals)))) = false)

  @RK-05 @build
  Scenario: A member holds no key from before joining unless history is shared, and none from removal onward
    Given the key epochs in app/src/Comms/Epoch.lex.tex
    When the Lean kernel checks the theorems of EpochProofs during prismpm verify
    Then joinerCannotReadEarlier in Comms/EpochProofs.lex.tex states (((Comms.Epoch::holdsKey joinedAt leftAt messageEpoch 0) && (messageEpoch <? joinedAt)) = false)
    And removedMemberCannotReadLater in Comms/EpochProofs.lex.tex states (((Comms.Epoch::holdsKey joinedAt leftAt messageEpoch historyShared) && (leftAt <=? messageEpoch)) = false)

  @RK-06 @build
  Scenario: A call connects only through an answer, an ended call stays ended, and the two sides never both yield when calls cross
    Given the call machine in app/src/Comms/Call.lex.tex
    When the Lean kernel checks the theorems of CallProofs during prismpm verify
    Then callerConnectsOnlyWhenAnswered in Comms/CallProofs.lex.tex states ((((Comms.Call::step 1 signal) =? 3) && ((signal <? 3) || (3 <? signal))) = false)
    And endedCallStaysEnded in Comms/CallProofs.lex.tex states ((Comms.Call::step 4 signal) = 4)
    And crossedCallsNeverBothYield in Comms/CallProofs.lex.tex states (((Comms.Call::yields ownOffer otherOffer) && (Comms.Call::yields otherOffer ownOffer)) = false)

  @RK-07 @build
  Scenario: A permitted ban leaves the member banned, a refused event changes nothing, and only joining makes a member
    Given the membership step in app/src/Comms/Member.lex.tex
    When the Lean kernel checks the theorems of MemberProofs during prismpm verify
    Then permittedBanTakesEffect in Comms/MemberProofs.lex.tex states ((Comms.Member::applied 1 4 targetStatus) = 4)
    And refusedEventChangesNothing in Comms/MemberProofs.lex.tex states ((Comms.Member::applied 0 action targetStatus) = targetStatus)
    And onlyJoiningMakesAMember in Comms/MemberProofs.lex.tex states ((((Comms.Member::nextStatus action targetStatus) =? 2) && ((0 <? action) && ((targetStatus <? 2) || (2 <? targetStatus)))) = false)

  @RK-08 @build
  Scenario: Equal heads move no bytes and content already held is not requested again
    Given the sync decisions in app/src/Comms/Sync.lex.tex
    When the Lean kernel checks the theorems of SyncProofs during prismpm verify
    Then equalHeadsMoveNothing in Comms/SyncProofs.lex.tex states ((Comms.Sync::bytesMove head head) = false)
    And heldContentIsNotFetchedAgain in Comms/SyncProofs.lex.tex states ((Comms.Sync::wanted (cons kappa offered) (cons kappa rest)) = (Comms.Sync::wanted offered (cons kappa rest)))

  @RK-09 @build
  Scenario: The kernel answers each of its twelve questions with the function the theorems are about, and invalid request for anything else
    Given the kernel in app/src/RoomKernel.lex.tex
    When prismpm verify replays the acceptance vectors in the compiled guest
    Then admitAnswer in RoomKernel.lex.tex contains (if (Comms.Admission::admitted (flag (sameAddress value 1 33))
    And permitAnswer in RoomKernel.lex.tex contains (if (Comms.Rules::permitted (natAt value 1 1 0)
    And leftPrecedes in RoomKernel.lex.tex contains (Comms.Order::precedesWide (natAt value 1 8 0)
    And keyAnswer in RoomKernel.lex.tex contains (if (Comms.Epoch::holdsKey (natAt value 1 8 0)
    And route in RoomKernel.lex.tex contains (if ((operation =? 1) && (length =? 69)) then (admitAnswer value)
    And route in RoomKernel.lex.tex contains (if ((operation =? 2) && (length =? 37)) then (permitAnswer value)
    And route in RoomKernel.lex.tex contains (if ((operation =? 3) && (length =? 81)) then (orderAnswer value)
    And route in RoomKernel.lex.tex contains (if ((operation =? 4) && (length =? 26)) then (keyAnswer value)
    And route in RoomKernel.lex.tex contains (if ((operation =? 5) && (length =? 3)) then (callName (Comms.Call::step (natAt value 1 1 0) (natAt value 2 1 0)))
    And route in RoomKernel.lex.tex contains (if ((operation =? 6) && (length =? 4)) then (statusName (Comms.Member::applied (natAt value 1 1 0) (natAt value 2 1 0) (natAt value 3 1 0)))
    And redactAnswer in RoomKernel.lex.tex contains (if (Comms.Redact::allowed (natAt value 1 1 0)
    And headsAnswer in RoomKernel.lex.tex contains (if (Comms.Sync::bytesMove (flag (sameAddress value 1 33)) 1)
    And route in RoomKernel.lex.tex contains (if ((operation =? 7) && (length =? 27)) then (redactAnswer value)
    And route in RoomKernel.lex.tex contains (if ((operation =? 8) && (length =? 3)) then (sendName (Comms.Send::instruction (Comms.Send::advance (natAt value 1 1 0) (natAt value 2 1 0))))
    And route in RoomKernel.lex.tex contains (if ((operation =? 9) && (length =? 65)) then (headsAnswer value)
    And composeAnswer in RoomKernel.lex.tex contains ((Comms.Event::readable words) && (Comms.Send::mayCompose (Comms.Event::wordAt words 0) (Comms.Event::wordAt words 1)
    And eventWords in RoomKernel.lex.tex contains (wordsFrom value header (prim quotient (prim subtract length header : Nat) 8 0 : Nat))
    And route in RoomKernel.lex.tex contains (if ((operation =? 10) && (28 <=? length)) then (composeAnswer value length)
    And redactionAnswer in RoomKernel.lex.tex contains ((Comms.Event::readable words) && (Comms.Redact::composes (Comms.Event::wordAt words 1) (Comms.Event::wordAt words 0)
    And route in RoomKernel.lex.tex contains (if ((operation =? 11) && (27 <=? length)) then (redactionAnswer value length)
    And createAnswer in RoomKernel.lex.tex contains ((Comms.Event::shaped words) && (Comms.Create::mayCreate (Comms.Event::wordAt words 0) (Comms.Event::wordAt words 1)
    And route in RoomKernel.lex.tex contains (if ((operation =? 12) && (201 <=? length)) then (createAnswer value length)
    And route in RoomKernel.lex.tex contains else (prim utf8_encode "invalid request" : Bytes)
    And dispatch in RoomKernel.lex.tex contains (route (natAt value 0 1 0) (Foundation.Bytes::byteLength value) value)
    And application in RoomKernel.lex.tex contains response := 0x61646d6974746564})
    And application in RoomKernel.lex.tex contains request := 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000, response := 0x696e76616c69642072657175657374})

  @RK-10 @build
  Scenario: The membership and power of a room are its events folded by one step, the step is the one the kernel answers, and no history takes a status out of range or a power above the creator's
    Given the fold of a room's events in app/src/Comms/State.lex.tex
    When the Lean kernel checks the theorems of StateProofs during prismpm verify
    Then state in Comms/State.lex.tex contains | List.cons head rest => (step field (member =? (subjectOf head)) (actionOf head) (state 0 (senderOf head) creator creatorPower required open rest) (state 1 (senderOf head) creator creatorPower required open rest) (state 0 member creator creatorPower required open rest) (state 1 member creator creatorPower required open rest) required open (grantedOf head))
    And statusStepIsTheKernelStep in Comms/StateProofs.lex.tex states ((Comms.State::step 0 isSubject action senderStatus senderPower targetStatus targetPower required open grantedPower) = (Comms.Member::applied (if (isSubject && (Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower)) then 1 else 0) action targetStatus))
    And powerStepIsTheKernelStep in Comms/StateProofs.lex.tex states ((Comms.State::step 1 isSubject action senderStatus senderPower targetStatus targetPower required open grantedPower) = (if (isSubject && (Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower)) then (Comms.Member::nextPower action targetPower grantedPower) else targetPower))
    And eventChangesOnlyItsSubjectsStatus in Comms/StateProofs.lex.tex states (((member =? (Comms.State::subjectOf event)) || ((Comms.State::state 0 member creator creatorPower required open (cons event rest)) =? (Comms.State::state 0 member creator creatorPower required open rest))) = true)
    And eventChangesOnlyItsSubjectsPower in Comms/StateProofs.lex.tex states (((member =? (Comms.State::subjectOf event)) || ((Comms.State::state 1 member creator creatorPower required open (cons event rest)) =? (Comms.State::state 1 member creator creatorPower required open rest))) = true)
    And bannedSenderChangesNothing in Comms/StateProofs.lex.tex states ((Comms.State::step field isSubject action 4 senderPower targetStatus targetPower required open grantedPower) = (if (field =? 0) then targetStatus else targetPower))
    And onlyAnUnbanLiftsABan in Comms/StateProofs.lex.tex states (((not (action =? 5)) && (not ((Comms.State::step 0 isSubject action (if (action <? 2) then 4 else senderStatus) senderPower 4 targetPower required open grantedPower) =? 4))) = false)
    And statusStaysInRangeAfterAnyHistory in Comms/StateProofs.lex.tex states ((4 <? (Comms.State::state 0 member creator creatorPower required open events)) = false)
    And noPowerAboveTheCreator in Comms/StateProofs.lex.tex states ((creatorPower <? (Comms.State::state 1 member creator creatorPower required open events)) = false)

  @RK-11 @build
  Scenario: An event's bytes are its words at eight bytes each, decoding returns every word below 2^64 unchanged, a list of addresses has one accepted order with no address twice, and the fields of a laid-out event are read back from its words with nothing left over
    Given the event bytes in app/src/Comms/Event.lex.tex
    When the Lean kernel checks the theorems of EventProofs during prismpm verify
    Then layout in Comms/Event.lex.tex contains body: (cons version (cons action (joined room (joined sender (joined device (joined target (cons granted (joined content (cons (count parents) (cons (count authorities) (joined parents authorities)))))))))))
    And decode in Comms/Event.lex.tex contains body: (decodeFrom bytes 7 0)
    And decodingUndoesEncoding in Comms/EventProofs.lex.tex states ((Comms.Event::decodeFrom (Comms.Event::encode words) 7 0) = (Comms.Event::normal words))
    And wordSurvivesItsBytes in Comms/EventProofs.lex.tex states ((Comms.Event::rebuilt word) = (Comms.Event::reduced word))
    And boundedWordIsUnchanged in Comms/EventProofs.lex.tex states (((word <? 18446744073709551616) && (not ((Comms.Event::reduced word) =? word))) = false)
    And bytesSurviveTheirWord in Comms/EventProofs.lex.tex states ((((b0 <? 256) && ((b1 <? 256) && ((b2 <? 256) && ((b3 <? 256) && ((b4 <? 256) && ((b5 <? 256) && ((b6 <? 256) && (b7 <? 256)))))))) && (not (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 72057594037927936 0 : Nat)) =? b0) && (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 281474976710656 0 : Nat)) =? b1) && (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 1099511627776 0 : Nat)) =? b2) && (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 4294967296 0 : Nat)) =? b3) && (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 16777216 0 : Nat)) =? b4) && (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 65536 0 : Nat)) =? b5) && (((Comms.Event::low (prim quotient (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7) 256 0 : Nat)) =? b6) && ((Comms.Event::low (Comms.Event::wordOf b0 b1 b2 b3 b4 b5 b6 b7)) =? b7)))))))))) = false)
    And everyWordIsEightBytes in Comms/EventProofs.lex.tex states ((Comms.Event::count (Comms.Event::encode words)) = (prim multiply 8 (Comms.Event::count words) : Nat))
    And repeatedAddressRefused in Comms/EventProofs.lex.tex states ((Comms.Event::ascending (cons a0 (cons a1 (cons a2 (cons a3 (cons a0 (cons a1 (cons a2 (cons a3 rest))))))))) = false)
    And addressesHaveOneOrder in Comms/EventProofs.lex.tex states (((Comms.Event::ascending (cons a0 (cons a1 (cons a2 (cons a3 (cons b0 (cons b1 (cons b2 (cons b3 (nil Nat)))))))))) && (Comms.Event::ascending (cons b0 (cons b1 (cons b2 (cons b3 (cons a0 (cons a1 (cons a2 (cons a3 (nil Nat))))))))))) = false)
    And partAddressRefused in Comms/EventProofs.lex.tex states ((Comms.Event::ascending (cons a0 (cons a1 (cons a2 (nil Nat))))) = false)
    And wrongVersionRefused in Comms/EventProofs.lex.tex states ((Comms.Event::canonical 2 action parents authorities) = false)
    And readable in Comms/Event.lex.tex contains body: ((shaped words) && (canonical (wordAt words 0) (wordAt words 1) (project (parentsOf words) items) (project (authoritiesOf words) items)))
    And shaped in Comms/Event.lex.tex contains body: ((25 <=? (count words)) && (((count (project (parentsOf words) items)) =? (wordAt words 23)) && (((count (project (authoritiesOf words) items)) =? (wordAt words 24)) && ((count (project (leftoverOf words) items)) =? 0))))
    And takeReturnsTheFront in Comms/EventProofs.lex.tex states ((project (Comms.Event::take (Comms.Event::joined front back) (Comms.Event::count front)) items) = front)
    And skipReturnsTheRest in Comms/EventProofs.lex.tex states ((project (Comms.Event::skip (Comms.Event::joined front back) (Comms.Event::count front)) items) = back)
    And takeReturnsAll in Comms/EventProofs.lex.tex states ((project (Comms.Event::take words (Comms.Event::count words)) items) = words)
    And skipLeavesNothing in Comms/EventProofs.lex.tex states ((project (Comms.Event::skip words (Comms.Event::count words)) items) = (nil Nat))
    And versionIsReadBack in Comms/EventProofs.lex.tex states ((Comms.Event::wordAt (cons version rest) 0) = version)
    And actionIsReadBack in Comms/EventProofs.lex.tex states ((Comms.Event::wordAt (Comms.Event::layout version action (cons r0 (cons r1 (cons r2 (cons r3 (nil Nat))))) (cons s0 (cons s1 (cons s2 (cons s3 (nil Nat))))) (cons d0 (cons d1 (cons d2 (cons d3 (nil Nat))))) (cons t0 (cons t1 (cons t2 (cons t3 (nil Nat))))) granted (cons c0 (cons c1 (cons c2 (cons c3 (nil Nat))))) parents authorities) 1) = action)
    And grantedPowerIsReadBack in Comms/EventProofs.lex.tex states ((Comms.Event::wordAt (Comms.Event::layout version action (cons r0 (cons r1 (cons r2 (cons r3 (nil Nat))))) (cons s0 (cons s1 (cons s2 (cons s3 (nil Nat))))) (cons d0 (cons d1 (cons d2 (cons d3 (nil Nat))))) (cons t0 (cons t1 (cons t2 (cons t3 (nil Nat))))) granted (cons c0 (cons c1 (cons c2 (cons c3 (nil Nat))))) parents authorities) 18) = granted)
    And parentsAreReadBack in Comms/EventProofs.lex.tex states ((project (Comms.Event::parentsOf (Comms.Event::layout version action (cons r0 (cons r1 (cons r2 (cons r3 (nil Nat))))) (cons s0 (cons s1 (cons s2 (cons s3 (nil Nat))))) (cons d0 (cons d1 (cons d2 (cons d3 (nil Nat))))) (cons t0 (cons t1 (cons t2 (cons t3 (nil Nat))))) granted (cons c0 (cons c1 (cons c2 (cons c3 (nil Nat))))) parents authorities)) items) = parents)
    And authoritiesAreReadBack in Comms/EventProofs.lex.tex states ((project (Comms.Event::authoritiesOf (Comms.Event::layout version action (cons r0 (cons r1 (cons r2 (cons r3 (nil Nat))))) (cons s0 (cons s1 (cons s2 (cons s3 (nil Nat))))) (cons d0 (cons d1 (cons d2 (cons d3 (nil Nat))))) (cons t0 (cons t1 (cons t2 (cons t3 (nil Nat))))) granted (cons c0 (cons c1 (cons c2 (cons c3 (nil Nat))))) parents authorities)) items) = authorities)
    And nothingIsLeftOver in Comms/EventProofs.lex.tex states ((project (Comms.Event::leftoverOf (Comms.Event::layout version action (cons r0 (cons r1 (cons r2 (cons r3 (nil Nat))))) (cons s0 (cons s1 (cons s2 (cons s3 (nil Nat))))) (cons d0 (cons d1 (cons d2 (cons d3 (nil Nat))))) (cons t0 (cons t1 (cons t2 (cons t3 (nil Nat))))) granted (cons c0 (cons c1 (cons c2 (cons c3 (nil Nat))))) parents authorities)) items) = (nil Nat))
    And shortEventIsRefused in Comms/EventProofs.lex.tex states ((Comms.Event::shaped (nil Nat)) = false)

  @RK-12 @build
  Scenario: An event is composed only when its action is permitted and its form is canonical, the sent event replaces the head it cites, and a send is stored only once signed and announced only once stored
    Given the send path in app/src/Comms/Send.lex.tex
    When the Lean kernel checks the theorems of SendProofs during prismpm verify
    Then compose in Comms/Send.lex.tex contains body: (if (mayCompose version action senderStatus senderPower targetStatus targetPower required open grantedPower parents authorities) then (Comms.Event::encode event) else (nil Nat))
    And composedExactlyWhenPermittedAndCanonical in Comms/SendProofs.lex.tex states ((Comms.Send::mayCompose version action senderStatus senderPower targetStatus targetPower required open grantedPower parents authorities) = ((Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower) && (Comms.Event::canonical version action parents authorities)))
    And bannedSenderComposesNothing in Comms/SendProofs.lex.tex states ((Comms.Send::mayCompose version action 4 senderPower targetStatus targetPower required open grantedPower parents authorities) = false)
    And wrongVersionComposesNothing in Comms/SendProofs.lex.tex states ((Comms.Send::mayCompose 2 action senderStatus senderPower targetStatus targetPower required open grantedPower parents authorities) = false)
    And sentEventBecomesAHead in Comms/SendProofs.lex.tex states ((Comms.Sync::holds (Comms.Send::headsAfter heads cited kappa) kappa) = true)
    And soleHeadIsReplaced in Comms/SendProofs.lex.tex states ((Comms.Send::headsAfter (cons head (nil Nat)) (cons head (nil Nat)) kappa) = (cons kappa (nil Nat)))
    And announcedOnlyAfterStored in Comms/SendProofs.lex.tex states ((((Comms.Send::advance phase report) =? 4) && (not ((phase =? 3) || (phase =? 4)))) = false)
    And storedOnlyAfterSigned in Comms/SendProofs.lex.tex states ((((Comms.Send::advance phase report) =? 3) && (not ((phase =? 2) || (phase =? 3)))) = false)
    And sendNeverStepsBack in Comms/SendProofs.lex.tex states (((Comms.Send::advance phase report) <? phase) = false)
    And wrongReportChangesNothing in Comms/SendProofs.lex.tex states (((not (report =? phase)) && (not ((Comms.Send::advance phase report) =? phase))) = false)
    And announceIsAskedOnlyOnceStored in Comms/SendProofs.lex.tex states ((((Comms.Send::instruction phase) =? 3) && (not (phase =? 3))) = false)

  @RK-13 @build
  Scenario: Only a joined member with the power to send redacts, their own event with that alone and another's only with the redaction power; a redacted event shows no content and is not fetched, in whatever order redactions arrive, a redaction changes no member's status or power, and only an allowed event of action 8 is composed as a redaction
    Given the redaction rules in app/src/Comms/Redact.lex.tex
    When the Lean kernel checks the theorems of RedactProofs during prismpm verify
    Then allowed in Comms/Redact.lex.tex contains body: ((senderStatus =? 2) && ((required <=? senderPower) && ((own =? 1) || (redactPower <=? senderPower))))
    And fetched in Comms/Redact.lex.tex contains body: (if (Comms.Sync::holds redacted event) then false else (if (Comms.Sync::holds store content) then false else true))
    And onlyJoinedMembersRedact in Comms/RedactProofs.lex.tex states (((not (senderStatus =? 2)) && (Comms.Redact::allowed senderStatus senderPower required redactPower own)) = false)
    And ownEventNeedsOnlySendingPower in Comms/RedactProofs.lex.tex states (((senderStatus =? 2) && ((required <=? senderPower) && ((own =? 1) && (not (Comms.Redact::allowed senderStatus senderPower required redactPower own))))) = false)
    And anothersEventNeedsPower in Comms/RedactProofs.lex.tex states (((not (own =? 1)) && ((senderPower <? redactPower) && (Comms.Redact::allowed senderStatus senderPower required redactPower own))) = false)
    And redactionNeedsSendingPower in Comms/RedactProofs.lex.tex states (((senderPower <? required) && (Comms.Redact::allowed senderStatus senderPower required redactPower own)) = false)
    And redactionNeedsCanonicalForm in Comms/RedactProofs.lex.tex states ((Comms.Redact::mayRedact 2 senderStatus senderPower required redactPower own parents authorities) = false)
    And bannedMemberRedactsNothing in Comms/RedactProofs.lex.tex states ((Comms.Redact::allowed 4 senderPower required redactPower own) = false)
    And redactedContentIsGone in Comms/RedactProofs.lex.tex states ((Comms.Redact::shown (cons event rest) event content) = 0)
    And laterRedactionUndoesNone in Comms/RedactProofs.lex.tex states ((Comms.Redact::shown (cons other (cons event rest)) event content) = 0)
    And redeliveredRedactionChangesNothing in Comms/RedactProofs.lex.tex states ((Comms.Redact::shown (cons again (cons again rest)) event content) = (Comms.Redact::shown (cons again rest) event content))
    And redactionOrderChangesNothing in Comms/RedactProofs.lex.tex states ((Comms.Redact::shown (cons earlier (cons later rest)) event content) = (Comms.Redact::shown (cons later (cons earlier rest)) event content))
    And redactionTouchesOnlyItsEvent in Comms/RedactProofs.lex.tex states (((other =? event) || ((Comms.Redact::shown (cons other rest) event content) =? (Comms.Redact::shown rest event content))) = true)
    And redactedContentIsNotFetched in Comms/RedactProofs.lex.tex states ((Comms.Redact::fetched (cons event rest) event content store) = false)
    And redactionChangesNoMember in Comms/RedactProofs.lex.tex states ((Comms.State::step field isSubject 8 senderStatus senderPower targetStatus targetPower required open grantedPower) = (if (field =? 0) then targetStatus else targetPower))
    And composes in Comms/Redact.lex.tex contains body: ((action =? 8) && (mayRedact version senderStatus senderPower required redactPower own parents authorities))
    And onlyARedactionIsComposedAsOne in Comms/RedactProofs.lex.tex states (((Comms.Redact::composes action version senderStatus senderPower required redactPower own parents authorities) && (not (action =? 8))) = false)
    And composedRedactionIsAllowed in Comms/RedactProofs.lex.tex states (((Comms.Redact::composes action version senderStatus senderPower required redactPower own parents authorities) && (not (Comms.Redact::allowed senderStatus senderPower required redactPower own))) = false)

  @RK-14 @build
  Scenario: A room is created by one event that cites nothing and names no room; its creator starts joined with the creator's power, a named target starts invited and may join, and nobody else is a member
    Given the creation rules in app/src/Comms/Create.lex.tex
    When the Lean kernel checks the theorems of CreateProofs during prismpm verify
    Then mayCreate in Comms/Create.lex.tex contains body: ((version =? 1) && ((action =? 9) && ((unnamed r0 r1 r2 r3) && (((Comms.Event::count parents) =? 0) && ((Comms.Event::count authorities) =? 0)))))
    And statusAtCreation in Comms/Create.lex.tex contains body: (if (isCreator =? 1) then 2 else (if ((isDirect =? 1) && (isInvitee =? 1)) then 1 else 0))
    And powerAtCreation in Comms/Create.lex.tex contains body: (if (isCreator =? 1) then creatorPower else 0)
    And direct in Comms/Create.lex.tex contains body: (if (unnamed t0 t1 t2 t3) then 0 else 1)
    And creationCitesNothing in Comms/CreateProofs.lex.tex states (((Comms.Create::mayCreate version action r0 r1 r2 r3 parents authorities) && (not (((Comms.Event::count parents) + (Comms.Event::count authorities)) =? 0))) = false)
    And creationNamesNoRoom in Comms/CreateProofs.lex.tex states (((Comms.Create::mayCreate version action r0 r1 r2 r3 parents authorities) && (not (Comms.Create::unnamed r0 r1 r2 r3))) = false)
    And creationIsNoOtherEvent in Comms/CreateProofs.lex.tex states (((Comms.Create::mayCreate version action r0 r1 r2 r3 parents authorities) && (Comms.Event::canonical version action parents authorities)) = false)
    And onlyVersionOneCreates in Comms/CreateProofs.lex.tex states ((Comms.Create::mayCreate 2 action r0 r1 r2 r3 parents authorities) = false)
    And creatorIsJoined in Comms/CreateProofs.lex.tex states ((Comms.Create::statusAtCreation 1 isInvitee isDirect) = 2)
    And directInviteeIsInvited in Comms/CreateProofs.lex.tex states (((isCreator =? 1) || ((Comms.Create::statusAtCreation isCreator 1 1) =? 1)) = true)
    And nobodyElseIsAMember in Comms/CreateProofs.lex.tex states (((isCreator =? 1) || ((isInvitee =? 1) || ((Comms.Create::statusAtCreation isCreator isInvitee isDirect) =? 0))) = true)
    And roomWithoutInviteeHasOnlyItsCreator in Comms/CreateProofs.lex.tex states (((isCreator =? 1) || ((isDirect =? 1) || ((Comms.Create::statusAtCreation isCreator isInvitee isDirect) =? 0))) = true)
    And onlyTheCreatorHoldsPower in Comms/CreateProofs.lex.tex states (((isCreator =? 1) || ((Comms.Create::powerAtCreation isCreator creatorPower) =? 0)) = true)
    And namedTargetMakesARoomDirect in Comms/CreateProofs.lex.tex states (((Comms.Create::unnamed t0 t1 t2 t3) || ((Comms.Create::direct t0 t1 t2 t3) =? 1)) = true)
    And directInviteeMayJoin in Comms/CreateProofs.lex.tex states ((Comms.Rules::permitted 0 (Comms.Create::statusAtCreation 0 1 1) senderPower targetStatus targetPower required open grantedPower) = true)
    And strangerJoinsOnlyAnOpenRoom in Comms/CreateProofs.lex.tex states ((Comms.Rules::permitted 0 (Comms.Create::statusAtCreation 0 0 isDirect) senderPower targetStatus targetPower required 0 grantedPower) = false)
    And creationIsTheEmptyHistoryStatus in Comms/CreateProofs.lex.tex states ((Comms.State::state 0 member creator creatorPower required open (nil (List Nat))) = (Comms.Create::statusAtCreation (if (member =? creator) then 1 else 0) 0 0))
    And creationIsTheEmptyHistoryPower in Comms/CreateProofs.lex.tex states ((Comms.State::state 1 member creator creatorPower required open (nil (List Nat))) = (Comms.Create::powerAtCreation (if (member =? creator) then 1 else 0) creatorPower))

  @RK-15 @build
  Scenario: An event is folded after every parent: its depth is one more than its deepest parent's, a shallower event precedes a deeper one and has the smaller ordering key, and of two held events the one with the smaller key is placed first
    Given the fold order in app/src/Comms/Fold.lex.tex
    When the Lean kernel checks the theorems of FoldProofs during prismpm verify
    Then depthOf in Comms/Fold.lex.tex contains | List.cons head rest => (Comms.Resolve::merge (head + 1) (depthOf rest))
    And eventWithoutParentsHasDepthZero in Comms/FoldProofs.lex.tex states ((Comms.Fold::depthOf (nil Nat)) = 0)
    And parentIsShallower in Comms/FoldProofs.lex.tex states ((parent <? (Comms.Fold::depthOf (Comms.Resolve::joined before (cons parent after)))) = true)
    And shallowerEventPrecedes in Comms/FoldProofs.lex.tex states (((shallow <? deep) && (not (Comms.Order::precedes shallow shallowKappa deep deepKappa))) = false)
    And shallowerEventHasSmallerKey in Comms/FoldProofs.lex.tex states (((shallow <? deep) && ((shallowKappa <? (Comms.Order::addressBound)) && ((deepKappa <? (Comms.Order::addressBound)) && ((Comms.Order::orderingKey deep deepKappa) <=? (Comms.Order::orderingKey shallow shallowKappa))))) = false)
    And heldEarlierEventIsPlacedFirst in Comms/ResolveProofs.lex.tex states (((a <? b) && ((Comms.Resolve::place b arrivals) <? ((Comms.Resolve::place a arrivals) + (Comms.Resolve::copies a arrivals)))) = false)
