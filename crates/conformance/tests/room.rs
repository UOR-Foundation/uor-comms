//! The `room` suite: one test per scenario in `features/suites/room.feature`.
//!
//! The proofs are checked by the Lean kernel when `prismpm verify` runs on
//! `app/`. What these tests hold fixed is the claim those proofs are about:
//! each theorem's exact statement, that it rests on nothing beyond Lean's
//! three standard axioms, and that the kernel's answers are decided by the
//! functions the theorems are about. A weakened statement, an added axiom or
//! an answer decided some other way would still verify, and would no longer
//! be the claim the ID makes.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

fn model(path: &str) -> String {
    std::fs::read_to_string(root().join("app/src").join(path))
        .unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The declaration named `name`, from its name to the next declaration.
fn declaration<'a>(text: &'a str, name: &str) -> &'a str {
    let start = text
        .find(&format!("name: {name},"))
        .unwrap_or_else(|| panic!("{name} is not declared"));
    let rest = &text[start..];
    let end = ["\ntheorem{", "\ndefinition{", "\n\\end{semanticmodule}"]
        .iter()
        .filter_map(|mark| rest.find(mark))
        .min()
        .unwrap_or(rest.len());
    &rest[..end]
}

/// The theorem `name` in `file` states exactly `statement` and declares no
/// axiom beyond the three Lean itself is built on.
fn pinned(file: &str, name: &str, statement: &str) {
    let text = model(file);
    let theorem = declaration(&text, name);
    assert!(
        theorem.contains(&format!("statement: {statement},")),
        "the statement of {name} changed:\n{theorem}"
    );
    let axioms = theorem
        .split("axioms: [")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .unwrap_or_else(|| panic!("{name} declares no axiom policy"));
    for axiom in axioms.split(',').map(str::trim).filter(|a| !a.is_empty()) {
        assert!(
            ["Classical.choice", "Quot.sound", "propext"].contains(&axiom),
            "{name} rests on {axiom}"
        );
    }
}

/// `RK-01`: An event is admitted only when its address matches, it is signed, its device may sign, its parents are known and it is permitted
#[test]
fn room_rk_01() {
    let file = "Comms/AdmissionProofs.lex.tex";
    pinned(
        file,
        "tamperedEventRefused",
        "((Comms.Admission::admitted 0 signatureValid deviceMaySign parentsKnown permitted) = false)",
    );
    pinned(
        file,
        "unsignedEventRefused",
        "((Comms.Admission::admitted addressMatches 0 deviceMaySign parentsKnown permitted) = false)",
    );
    pinned(
        file,
        "removedDeviceRefused",
        "((Comms.Admission::admitted addressMatches signatureValid 0 parentsKnown permitted) = false)",
    );
    pinned(
        file,
        "orphanEventRefused",
        "((Comms.Admission::admitted addressMatches signatureValid deviceMaySign 0 permitted) = false)",
    );
    pinned(
        file,
        "unpermittedEventRefused",
        "((Comms.Admission::admitted addressMatches signatureValid deviceMaySign parentsKnown 0) = false)",
    );
    pinned(
        file,
        "soundEventAdmitted",
        "((Comms.Admission::admitted 1 1 1 1 1) = true)",
    );
}

/// `RK-02`: Only a joined member with the required power writes, and nobody removes a member of equal or higher power
#[test]
fn room_rk_02() {
    let file = "Comms/RulesProofs.lex.tex";
    pinned(
        file,
        "bannedMemberDoesNothing",
        "((Comms.Rules::permitted action 4 senderPower targetStatus targetPower required open grantedPower) = false)",
    );
    pinned(
        file,
        "onlyJoinedMembersWrite",
        "(((Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower) && ((2 <=? action) && ((senderStatus <? 2) || (2 <? senderStatus)))) = false)",
    );
    pinned(
        file,
        "cannotRemoveEqualOrHigher",
        "(((Comms.Rules::permitted action senderStatus senderPower targetStatus targetPower required open grantedPower) && (((action =? 3) || (action =? 4)) && (senderPower <=? targetPower))) = false)",
    );
}

/// `RK-03`: Candidates for a state key are in a strict total order by rank then address, and the word-by-word comparison of the kernel is that order
#[test]
fn room_rk_03() {
    let file = "Comms/OrderProofs.lex.tex";
    pinned(
        file,
        "orderIsTransitive",
        "(((Comms.Order::precedes aRank aKappa bRank bKappa) && ((Comms.Order::precedes bRank bKappa cRank cKappa) && ((Comms.Order::precedes cRank cKappa aRank aKappa) || (Comms.Order::same aRank aKappa cRank cKappa)))) = false)",
    );
    pinned(
        file,
        "wideOrderMatchesPackedAddress",
        "((((wordsBounded l0 l1 l2 l3) && (wordsBounded r0 r1 r2 r3)) && ((Comms.Order::precedesWide leftRank l0 l1 l2 l3 rightRank r0 r1 r2 r3) && ((Comms.Order::precedes rightRank (packed r0 r1 r2 r3) leftRank (packed l0 l1 l2 l3)) || (Comms.Order::same leftRank (packed l0 l1 l2 l3) rightRank (packed r0 r1 r2 r3))))) = false)",
    );
}

/// `RK-04`: The resolved state does not depend on the order or repetition of delivery
#[test]
fn room_rk_04() {
    let file = "Comms/ResolveProofs.lex.tex";
    pinned(
        file,
        "neighboursSwapAnywhere",
        "((Comms.Resolve::resolve (Comms.Resolve::joined before (cons earlier (cons later after))) seed) = (Comms.Resolve::resolve (Comms.Resolve::joined before (cons later (cons earlier after))) seed))",
    );
    pinned(
        file,
        "redeliveryChangesNothing",
        "((Comms.Resolve::resolve (cons event (cons event rest)) seed) = (Comms.Resolve::resolve (cons event rest) seed))",
    );
}

/// `RK-05`: A member holds no key from before joining unless history is shared, and none from removal onward
#[test]
fn room_rk_05() {
    let file = "Comms/EpochProofs.lex.tex";
    pinned(
        file,
        "joinerCannotReadEarlier",
        "(((Comms.Epoch::holdsKey joinedAt leftAt messageEpoch 0) && (messageEpoch <? joinedAt)) = false)",
    );
    pinned(
        file,
        "removedMemberCannotReadLater",
        "(((Comms.Epoch::holdsKey joinedAt leftAt messageEpoch historyShared) && (leftAt <=? messageEpoch)) = false)",
    );
}

/// `RK-06`: A call connects only through an answer, an ended call stays ended, and the two sides never both yield when calls cross
#[test]
fn room_rk_06() {
    let file = "Comms/CallProofs.lex.tex";
    pinned(
        file,
        "callerConnectsOnlyWhenAnswered",
        "((((Comms.Call::step 1 signal) =? 3) && ((signal <? 3) || (3 <? signal))) = false)",
    );
    pinned(
        file,
        "endedCallStaysEnded",
        "((Comms.Call::step 4 signal) = 4)",
    );
    pinned(
        file,
        "crossedCallsNeverBothYield",
        "(((Comms.Call::yields ownOffer otherOffer) && (Comms.Call::yields otherOffer ownOffer)) = false)",
    );
}

/// `RK-07`: A permitted ban leaves the member banned, a refused event changes nothing, and only joining makes a member
#[test]
fn room_rk_07() {
    let file = "Comms/MemberProofs.lex.tex";
    pinned(
        file,
        "permittedBanTakesEffect",
        "((Comms.Member::applied 1 4 targetStatus) = 4)",
    );
    pinned(
        file,
        "refusedEventChangesNothing",
        "((Comms.Member::applied 0 action targetStatus) = targetStatus)",
    );
    pinned(
        file,
        "onlyJoiningMakesAMember",
        "((((Comms.Member::nextStatus action targetStatus) =? 2) && ((0 <? action) && ((targetStatus <? 2) || (2 <? targetStatus)))) = false)",
    );
}

/// `RK-08`: Equal heads move no bytes and content already held is not requested again
#[test]
fn room_rk_08() {
    let file = "Comms/SyncProofs.lex.tex";
    pinned(
        file,
        "equalHeadsMoveNothing",
        "((Comms.Sync::bytesMove head head) = false)",
    );
    pinned(
        file,
        "heldContentIsNotFetchedAgain",
        "((Comms.Sync::wanted (cons kappa offered) (cons kappa rest)) = (Comms.Sync::wanted offered (cons kappa rest)))",
    );
}

/// `RK-09`: The kernel answers each of its six questions with the function the theorems are about, and invalid request for anything else
#[test]
fn room_rk_09() {
    let kernel = model("RoomKernel.lex.tex");
    for (answer, decided_by) in [
        (
            "admitAnswer",
            "(if (Comms.Admission::admitted (flag (sameAddress value 1 33))",
        ),
        (
            "permitAnswer",
            "(if (Comms.Rules::permitted (natAt value 1 1 0)",
        ),
        (
            "leftPrecedes",
            "(Comms.Order::precedesWide (natAt value 1 8 0)",
        ),
        (
            "keyAnswer",
            "(if (Comms.Epoch::holdsKey (natAt value 1 8 0)",
        ),
        (
            "route",
            "(callName (Comms.Call::step (natAt value 1 1 0) (natAt value 2 1 0)))",
        ),
        (
            "route",
            "(statusName (Comms.Member::applied (natAt value 1 1 0) (natAt value 2 1 0) (natAt value 3 1 0)))",
        ),
    ] {
        assert!(
            declaration(&kernel, answer).contains(decided_by),
            "{answer} must be decided by {decided_by}"
        );
    }
    let route = declaration(&kernel, "route");
    for (operation, length) in [(1, 69), (2, 37), (3, 81), (4, 26), (5, 3), (6, 4)] {
        assert!(
            route.contains(&format!(
                "((operation =? {operation}) && (length =? {length}))"
            )),
            "operation {operation} must be answered only at {length} bytes"
        );
    }
    assert!(
        route.contains("(prim utf8_encode \"invalid request\" : Bytes)"),
        "anything else must be answered invalid request"
    );
    assert!(
        declaration(&kernel, "dispatch")
            .contains("(route (natAt value 0 1 0) (Foundation.Bytes::byteLength value) value)"),
        "dispatch must route on the first byte and the length"
    );
    let vectors = declaration(&kernel, "application")
        .matches("AcceptanceVector {request := 0x")
        .count();
    assert!(
        vectors >= 28,
        "the holo carries {vectors} acceptance vectors"
    );
}
