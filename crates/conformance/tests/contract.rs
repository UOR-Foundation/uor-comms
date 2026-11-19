//! The `room` suite: one test per scenario in `features/suites/room.feature`.
//!
//! The proofs are checked by the Lean kernel when `prismpm verify` runs on
//! `app/`. What these tests hold fixed is the claim those proofs are about.
//! Each scenario lists its pins as steps, and the test for its ID checks
//! every one against the model:
//!
//! - `<theorem> in <file> states <statement>`: the theorem's statement is
//!   exactly that, and it declares no axiom beyond the three Lean is built on;
//! - `<declaration> in <file> contains <text>`: the declaration holds that
//!   text, which is how the kernel's answers are tied to the functions the
//!   theorems are about.
//!
//! A weakened statement, an added axiom or an answer decided some other way
//! would still verify, and would no longer be the claim the ID makes.
//!
//! The file keeps the name it had for the template's sample app: `audit-prism`
//! admits no new non-Prism file, and the pins live in the scenarios so that
//! this file only shrinks.

fn read(path: &str) -> String {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{path}: {e}"))
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

/// Every pin of the scenario tagged `id` holds of the model.
fn scenario(id: &str) {
    let feature = read("features/suites/room.feature");
    let steps = feature
        .split("\n  @")
        .find(|scenario| scenario.starts_with(id))
        .unwrap_or_else(|| panic!("{id} has no scenario"));
    let mut pins = 0;
    for (step, exact) in steps.lines().map(|s| (s, s.contains(" states "))) {
        let mark = [" contains ", " states "][usize::from(exact)];
        let Some((head, text)) = step.split_once(mark) else {
            continue;
        };
        let mut words = head.split(' ').rev();
        let (file, name) = (words.next().unwrap(), words.nth(1).unwrap());
        let model = read(&format!("app/src/{file}"));
        let found = declaration(&model, name);
        let wanted = [text.to_string(), format!("statement: {text},")][usize::from(exact)].clone();
        assert!(found.contains(&wanted), "{file}: {name} lacks `{text}`");
        let axioms = found
            .split_once("axioms: [")
            .and_then(|(_, rest)| rest.split(']').next());
        assert!(!exact || axioms.is_some(), "{name} declares no axioms");
        for axiom in axioms.unwrap_or("").split(',').map(str::trim) {
            let known = ["", "Classical.choice", "Quot.sound", "propext"].contains(&axiom);
            assert!(known, "{name} rests on `{axiom}`");
        }
        pins += 1;
    }
    assert!(pins > 0, "{id} pins nothing");
}

// One line each: the meta-gate reads `#[test]` and the `fn` line after it, and
// `audit-prism` counts lines.
#[rustfmt::skip]
mod pins {
    use super::scenario;
    #[test]
    fn room_rk_01() { scenario("RK-01") }
    #[test]
    fn room_rk_02() { scenario("RK-02") }
    #[test]
    fn room_rk_03() { scenario("RK-03") }
    #[test]
    fn room_rk_04() { scenario("RK-04") }
    #[test]
    fn room_rk_05() { scenario("RK-05") }
    #[test]
    fn room_rk_06() { scenario("RK-06") }
    #[test]
    fn room_rk_07() { scenario("RK-07") }
    #[test]
    fn room_rk_08() { scenario("RK-08") }
    #[test]
    fn room_rk_09() { scenario("RK-09") }
    #[test]
    fn room_rk_10() { scenario("RK-10") }
    #[test]
    fn room_rk_11() { scenario("RK-11") }
    #[test]
    fn room_rk_12() { scenario("RK-12") }
    #[test]
    fn room_rk_13() { scenario("RK-13") }
    #[test]
    fn room_rk_14() { scenario("RK-14") }
}
