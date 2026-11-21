# UOR Comms

**An experimental, serverless messaging engine with a modeled room kernel and an early JavaScript host.** The project explores how peers can agree on room membership, permissions, event admission, ordering, and messaging decisions without relying on a central room server.

**Status: active development, not a production-ready messenger.** The repository contains a LexLean room model, Lean proofs of specific properties, acceptance vectors, and host-level tests. It does **not** establish end-to-end encrypted messaging, finished Prism ID integration, or general internet/NAT connectivity. Read [the evidence and open boundaries](docs/STATUS.md) before relying on any security or deployment claim.

## Why this exists

When a central server is the authority for a conversation, clients depend on that server's view of membership, permissions, and event order. UOR Comms explores a different boundary: the room's decisions are specified in [LexLean](https://github.com/UOR-Foundation/lexlean), while the host stores, signs, and transfers bytes. A peer checks incoming events against the rules instead of accepting a server's decision.

This is a research and implementation direction, not a claim that an interoperable, fully encrypted Matrix replacement already exists. [Design decisions and alternatives](docs/DESIGN.md) describe the intended system and its unresolved questions.

## What the repository currently contains

| Component | Grounded in | Current evidence and limitation |
| --- | --- | --- |
| **Room kernel** | [LexLean sources](app/src/Comms/) and [request entry point](app/src/RoomKernel.lex.tex) | Models decisions about admission, permissions, ordering, membership, content, and settings. Proof statements cover specific rules, not every host operation. |
| **Claim and test register** | [model/ids.toml](model/ids.toml), [room scenarios](features/suites/room.feature), [conformance tests](crates/conformance/tests/contract.rs) | Tracks declared capabilities and tests. The [generated conformance document](CONFORMANCE.md) is a projection, not independent execution evidence. |
| **Host prototype** | [host/README.md](host/README.md), [host code](host/), [host tests](host/test.mjs) | Creates rooms and handles messages between peers in a test environment. Host behavior is not automatically proved by the kernel's Lean theorems. |
| **Browser storage and transport** | [host/store.mjs](host/store.mjs), [host/transport.mjs](host/transport.mjs), [transport tests](host/transport.test.mjs) | The project records IndexedDB persistence and WebRTC tests between local browser pages. These do not establish reliable connectivity across real networks or NATs. |
| **Page and publication source** | [site/](site/) and [Pages workflow](.github/workflows/pages.yml) | Contains the browser page and deployment machinery. Source presence does not establish that a public messenger is usable or that its current deployment passed acceptance. |

The detailed [status and evidence record](docs/STATUS.md) distinguishes **proved**, **tested**, **assumed**, **not proved**, and **not done**. Consult it for claim scope and the referenced run; this README does not elevate the existence of source code or a CI workflow into a verified product guarantee.

## Known boundaries

- **Encryption:** the design calls for post-quantum room-key handling, but the current host status explicitly says message content is not encrypted. Do not use this prototype for confidential conversations.
- **Identity:** Prism ID integration is not wired into the host. The prototype uses caller-supplied device trust and signing inputs; [host/README.md](host/README.md) describes this temporary trust boundary.
- **Networking:** browser transport has been tested in a limited local environment. Internet-wide reachability, relay availability, mobile wakeup, and operation behind arbitrary NATs are not established.
- **Proof scope:** kernel-specific Lean theorems and vector replays are not proofs of browser security, correct host implementation, cryptography, or network delivery.
- **Feature scope:** planned features such as group calls, rich media, and other Matrix-style behavior must not be inferred from the design alone.

## Developer quick start

This is a **source-level verification path**, not an end-user messenger install. You need Git and a development environment with the tools provided by the SDK selected in [prismpm.lock](prismpm.lock). The repository provides a [devcontainer configuration](.devcontainer/devcontainer.json). Commands below are defined in [Justfile](Justfile); they have **not** been executed as part of this README update.

```sh
git clone https://github.com/UOR-Foundation/uor-comms.git
cd uor-comms

# Run inside the configured development environment.
just vv
```

`just vv` is the repository's full acceptance recipe. It includes formatting, model and template checks, lint, workspace tests, dependency checks, room-kernel verification, and host tests. A successful run qualifies only the scope covered by those checks.

For a narrower development iteration inside that environment:

```sh
just app   # verify/build the modeled room kernel
just host  # test the host against a built room-kernel holo
```

See [AGENTS.md](AGENTS.md) for workflow requirements, including the authoritative model and regeneration rules. Do not edit [CONFORMANCE.md](CONFORMANCE.md) by hand; its source is the model register and it is generated by `just model-write`.

## Kernel operations

The [room-kernel entry point](app/src/RoomKernel.lex.tex) models distinct
questions, with the host translating requests into its byte-oriented
interface. These groups summarize its **current source-level interface**,
not an independently verified network protocol or product feature set:

| Area | Questions modeled |
| --- | --- |
| Event admission | Admit an event, check action permission, order candidates, compare heads |
| Room state | Step membership, hold an epoch key, create a room, restrict direct-room actions, change settings, read defaults |
| Messages | Compose an event, read message content, permit and compose a redaction, sequence a send |
| Decisions | List offered actions, explain refusals |
| Planned calling and peer coordination | Step calls, choose call shape, choose relay-tree parent and media layer, permit forwarders and mailboxes |

The precise request codes, field layouts, answer values and acceptance
vectors are maintained in [`RoomKernel.lex.tex`](app/src/RoomKernel.lex.tex).
Use [`host/kernel.mjs`](host/kernel.mjs) to inspect the host's encoding
of those requests. A modeled call operation is **not** evidence that
voice or video calling is available to users.

## Everyday development commands

These recipes are declared in [Justfile](Justfile); their execution
status must be established by an actual run, not by this document.

| Command | Purpose |
| --- | --- |
| `just vv` | Full repository acceptance gate |
| `just app` | Verify and build the modeled room kernel |
| `just host` | Test the host against the kernel holo |
| `just bdd` | Run the conformance meta-gate during scenario development |
| `just new-capability <ID> <level> <suite> "<statement>"` | Scaffold a registered claim, scenario and failing test |
| `just model-write` | Regenerate the model-derived conformance document |
| `just fmt` | Format the Rust workspace |

For automated build and publication *definitions*, inspect the
[build workflow](.github/workflows/build.yml) and
[Pages workflow](.github/workflows/pages.yml). The workflows being
present does not imply that a particular deployment or artifact passed
their gates. The original generic-template onboarding and frame
description are not project-specific guarantees.

## Architecture and navigation

1. **Model:** [`app/src/Comms/`](app/src/Comms/) contains the room rules and proof modules. [`app/src/RoomKernel.lex.tex`](app/src/RoomKernel.lex.tex) is the request/response entry point.
2. **Host:** [`host/`](host/) moves and persists bytes, calls the kernel, and provides a developing browser transport. Its [README](host/README.md) documents the interface and remaining assumptions.
3. **Evidence:** [`model/`](model/), [`features/`](features/), and [`crates/conformance/`](crates/conformance/) hold registered claims, scenarios, and tests.
4. **Browser source:** [`site/`](site/) contains the web page and runtime assets; [`.github/workflows/`](.github/workflows/) contains the automation.
5. **Design and status:** [DESIGN](docs/DESIGN.md) records decisions and open design work; [STATUS](docs/STATUS.md) records proof/test limitations; [MATRIX-MAP](docs/MATRIX-MAP.md) documents the external Matrix study and its evidence limits.

## Contributing, authority, and license

Read [AGENTS.md](AGENTS.md), [TEMPLATE-CONTRACT.md](TEMPLATE-CONTRACT.md), and [VERIFICATION.md](VERIFICATION.md) before changing source or acceptance criteria. The room model and claim register own the project-specific semantic assertions; the inherited SDK and template policy retain their own authority. A documentation change is not permission to modify generated evidence or relax the gate.

The repository carries [MIT](LICENSE-MIT) and [Apache-2.0](LICENSE-APACHE) license texts. See its workspace metadata for the declared dual-license expression.
