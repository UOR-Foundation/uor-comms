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
  Scenario: The resolved state does not depend on the order or repetition of delivery
    Given the resolver in app/src/Comms/Resolve.lex.tex
    When the Lean kernel checks the theorems of ResolveProofs during prismpm verify
    Then neighboursSwapAnywhere in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::resolve (Comms.Resolve::joined before (cons earlier (cons later after))) seed) = (Comms.Resolve::resolve (Comms.Resolve::joined before (cons later (cons earlier after))) seed))
    And redeliveryChangesNothing in Comms/ResolveProofs.lex.tex states ((Comms.Resolve::resolve (cons event (cons event rest)) seed) = (Comms.Resolve::resolve (cons event rest) seed))

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
  Scenario: The kernel answers each of its six questions with the function the theorems are about, and invalid request for anything else
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
    And route in RoomKernel.lex.tex contains else (prim utf8_encode "invalid request" : Bytes)
    And dispatch in RoomKernel.lex.tex contains (route (natAt value 0 1 0) (Foundation.Bytes::byteLength value) value)
    And application in RoomKernel.lex.tex contains response := 0x61646d6974746564})
    And application in RoomKernel.lex.tex contains request := 0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000, response := 0x696e76616c69642072657175657374})
