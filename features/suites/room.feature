Feature: room

  The room kernel in app/: every decision a peer takes about a room, as a
  function in the LexLean model, and the theorems the Lean kernel checks
  about each.

  @RK-01 @build
  Scenario: An event is admitted only when its address matches, it is signed, its device may sign, its parents are known and it is permitted
    Given the admission model in app/src/Comms/Admission.lex.tex
    When the Lean kernel checks the theorems of AdmissionProofs during prismpm verify
    Then an event failing any one of the five conditions is refused
    And an event meeting all five is admitted

  @RK-02 @build
  Scenario: Only a joined member with the required power writes, and nobody removes a member of equal or higher power
    Given the permission rule in app/src/Comms/Rules.lex.tex
    When the Lean kernel checks the theorems of RulesProofs during prismpm verify
    Then a banned member is permitted nothing
    And invite, kick, ban, unban, send and power change need a joined sender
    And kick and ban are refused against a member of equal or higher power

  @RK-03 @build
  Scenario: Candidates for a state key are in a strict total order by rank then address, and the word-by-word comparison of the kernel is that order
    Given the order in app/src/Comms/Order.lex.tex
    When the Lean kernel checks the theorems of OrderProofs during prismpm verify
    Then rank then address is transitive, total and never both ways
    And for words below 2^64 the word-by-word comparison agrees with it

  @RK-04 @build
  Scenario: The resolved state does not depend on the order or repetition of delivery
    Given the resolver in app/src/Comms/Resolve.lex.tex
    When the Lean kernel checks the theorems of ResolveProofs during prismpm verify
    Then exchanging two neighbouring events anywhere gives the same state
    And delivering an event twice gives the same state as once

  @RK-05 @build
  Scenario: A member holds no key from before joining unless history is shared, and none from removal onward
    Given the key epochs in app/src/Comms/Epoch.lex.tex
    When the Lean kernel checks the theorems of EpochProofs during prismpm verify
    Then a joiner holds no earlier key when history is not shared
    And a removed member holds no key from the removal onward

  @RK-06 @build
  Scenario: A call connects only through an answer, an ended call stays ended, and the two sides never both yield when calls cross
    Given the call machine in app/src/Comms/Call.lex.tex
    When the Lean kernel checks the theorems of CallProofs during prismpm verify
    Then a caller reaches connected only on an answer
    And an ended call stays ended whatever arrives
    And two crossed calls never both yield

  @RK-07 @build
  Scenario: A permitted ban leaves the member banned, a refused event changes nothing, and only joining makes a member
    Given the membership step in app/src/Comms/Member.lex.tex
    When the Lean kernel checks the theorems of MemberProofs during prismpm verify
    Then a permitted ban leaves the status banned
    And a refused event leaves the status as it was
    And no action but joining produces a joined member

  @RK-08 @build
  Scenario: Equal heads move no bytes and content already held is not requested again
    Given the sync decisions in app/src/Comms/Sync.lex.tex
    When the Lean kernel checks the theorems of SyncProofs during prismpm verify
    Then two peers with the same head exchange nothing
    And an address the store holds is left out of the request

  @RK-09 @build
  Scenario: The kernel answers each of its six questions with the function the theorems are about, and invalid request for anything else
    Given the kernel in app/src/RoomKernel.lex.tex
    When prismpm verify replays the acceptance vectors in the compiled guest
    Then admit, permit, order, key, call and member requests are answered by the modelled functions
    And any other request is answered invalid request
