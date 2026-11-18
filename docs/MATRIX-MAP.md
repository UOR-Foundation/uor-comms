# Matrix map

Phase 1 output. It records what Matrix specifies, what Element builds on it, and which jobs a server does today. It proposes no design; the last sections list the inputs and decisions Phase 2 starts from.

Nothing here is proved or tested. Every entry in parts A to E cites the file or page it was read from. Items that could not be checked are listed under "Not verified".

## Sources

| Source | Version read | Read how |
|---|---|---|
| Matrix specification | release v1.19, commit `b9c3d5ed`, dated 2026-07-08 | local clone, all of `content/`, parts of `data/` |
| Matrix proposals (group calls) | GitHub, 2026-11-18 | MSC4143, MSC4195, MSC4354, MSC4140, MSC3401 |
| Element | element.io, docs.element.io, matrix.org blog, element-hq READMEs, 2026-11-18 | web pages through a summarising fetcher |
| Prism ID | `prism/identity/4`, stitch commit `68a9222a` as pinned in Foundry `identity/stitch.lock` | `identity/PROTOCOL.md`, `identity/README.md` |
| Hologram | commit `12bc8cb0`, 2026-11-18 | README, `specs/refactor/04-networks.md`, `BENCHMARKS.md`, `CONFORMANCE.md`, `crates/hologram-net` |
| kappa-registry | commit `bd231d0c`, 2026-11-07 | README, `crates/kappa-core` label, compute and encryption sources |

## Matrix in brief

A user has an account on one homeserver and one or more devices. Users talk in rooms. A room is a graph of signed events replicated across every homeserver that has a member in it. Each event names its parents and the events that authorise it. Some events set room state (membership, permissions, name); the rest are messages. When servers disagree about state, a fixed algorithm resolves it. Clients never see the graph: each talks to its own homeserver over the Client-Server API and receives one linear stream.

There are five APIs. Client-Server is the one applications use. Server-Server replicates rooms between homeservers. Application Service lets bridges and bots act for many users. Identity Service maps emails and phone numbers to user IDs. Push Gateway carries notifications to vendor push services.

## Findings that shape the design

1. **The seam is the Client-Server API.** A server must support every module; a client sees one HTTP service, one event format and one resumable stream. Anything that answers those endpoints with those semantics is a homeserver as far as the client can tell (part A, section 3).
2. **Users hold no event-signing key.** Every event is signed by the sender's homeserver. A homeserver can sign any event as any of its users, and nothing in the event tells the difference (part C, section 7, item 7). An identity whose devices sign for themselves removes this trust entirely.
3. **Content addressing is already at the core, on SHA-256.** An event ID is the hash of the event. In room version 12, the default, the room ID is the hash of the creating event (part C, sections 1 and 5).
4. **The spec does not claim that room state converges.** It says servers are "more likely to converge". The algorithm depends on inputs that differ between servers: whether an authorising event was rejected locally, and unverified timestamps that break ties. Comparing two infinite power levels is undefined (part C, section 4 and "Ambiguities"). A convergence proof must first fix these inputs.
5. **A hash mismatch redacts, it does not reject.** A relaying server may strip an event's content and pass on the remainder, which still verifies (part C, section 7, item 12).
6. **Completeness is trusted, not proved.** Nothing shows that a server returned all events or the true latest ones (part C, section 7, item 9).
7. **Sliding sync is not in v1.19.** Only the original `/sync` is specified, and it orders by arrival time, not graph order (part A). Element X depends on sliding sync (part E, section 1).
8. **There are no group calls in v1.19.** Voice and video are specified for two devices only, and the spec does not say whether media is end-to-end encrypted. The group-call proposals merged in October 2026 require a media forwarding server per homeserver and have no peer-to-peer media path (part D, sections 2 and 3).
9. **Encryption is optional for clients.** The server cannot read encrypted content but can withhold or replay it, and it distributes device keys, so device verification is what stops it inserting a fake device (part D, section 1).
10. **Some features are plain signed events; others are server behaviour.** Replies, edits, reactions, threads, mentions and space links need a server only to store and order them. Push, offline delivery, media, history visibility, presence, typing and all per-user private data are things the server does (part B, "What depends on a server most").
11. **History visibility is a read-time filter.** Nothing in the events stops a peer that holds the data from reading it; only encryption does (part B).
12. **Media is named by its origin server, not its content.** An `mxc://` address stops resolving when that server is gone (part B).
13. **Element shows the server to the user in 24 places**, from the sign-in server picker to "ask your homeserver administrator" for recovery. Element's stated direction is to hide the picker (part E, section 7).
14. **Published scale figures are thin.** Calls: "several hundred" participants with a forwarding server, up to 500 on one machine. No figure for the largest room or for sync time was found (part E, section 8).

## The server role ledger

This is the design problem for Phase 2: each row is a job that must move to peers or be removed.

| Role | What the homeserver does today | What relies on it | Detail |
|---|---|---|---|
| Identity | Allocates `@user:server`; authenticates the user; binds tokens to devices; signs every event of its users with the server's key; stores and serves device keys, key backup and secret storage | Login, devices, cross-signing distribution, account recovery, email and phone lookup | A sections 1 to 2; C section 7; D sections 1 and 5 |
| Storage | Keeps full room history and state, profiles, filters, account data, read markers, tags, push rules; hosts media | Scroll-back, search, new-device history, every private per-user setting, media | A section 3; B "Storage and lookup" |
| Ordering | Turns the event graph into one stream per account by arrival time; sets parents, depth and timestamp on events it creates; computes resolved state | `/sync`, unread counts, thread lists, state at any point | A section 2; C sections 1 and 4 |
| Relay | Sends each event to every server in the room; carries typing, presence, receipts, device-list changes and device-to-device messages; holds them for offline devices | All delivery, key sharing, call signalling | C section 6; D section 1 |
| Discovery | Resolves server names; resolves room aliases; publishes room and user directories; hands out call relay credentials and media transport addresses | Joining by address, finding people and rooms, call setup | A section 2; C section 6; D sections 2 and 3 |
| Push | Evaluates push rules against every event; calls the push gateway, which calls the vendor push service | Waking a sleeping phone | B "Awareness"; D section 6 |
| Media forwarding | Fetches and proxies media between servers; relays call media when peers cannot connect directly; forwards group-call media (proposal) | Attachments, calls behind restrictive networks, group calls | B; D sections 2 and 3 |
| Enforcement | Runs the checks on every received event, the authorisation rules and state resolution; filters by history visibility; applies rate limits, server bans and policy-server checks; runs timers for call leave | Permissions, moderation, privacy of history, abuse control | C sections 3, 4 and 6; B "Safety" |

Which guarantees already hold without trusting any server, and which do not, is set out in part C, section 7, "Guarantees by source".

## Inputs fixed by the owner for Phase 2

These were given during Phase 1 and read at the versions in "Sources". Each lists what it supplies and what it does not.

**Prism ID is the user identity.** One identity across the UOR ecosystem, taken from stitch at the pinned commit and not restated.
- Supplies: a self-held identity with a signed device log; adding a device by link and six-digit code; removing a device; recovery by kit and guardians; a per-application session; a key that only the identity's devices can open.
- Replaces in Matrix: the account on a host, login, device management, cross-signing, new-device sign-in, key backup and secret storage.
- Does not supply: message encryption between different users, confirming that a contact's identity is theirs, finding other users.
- Depends on: stitch's relay, today `https://ntfy.sh`, to link and sync devices. It can withhold or delay but not read or forge. It keeps messages for 30 minutes.

**Content addressing with BLAKE3, hash first.** The wire carries a content address; bytes move only when the receiver lacks them.
- A hash does not carry new content: a new message or media frame must travel once to each receiver.
- A hash is not encryption: a guessable plaintext can be confirmed from its hash. Content is encrypted first and the ciphertext is what gets addressed.

**Hologram supplies the network and byte transport.**
- Supplies: a content store with native, browser and bare-metal backends; a sync contract (fetch, announce, discover); peer lookup by hash distance over TCP and QUIC; verified multi-source fetch of large content, measured at 1.0 to 1.4 GB/s; BLAKE3 measured at about 6 GB/s on one thread; networks whose membership and policy are themselves content.
- Not yet shipped: the encrypted network tier; browser peers finding each other without out-of-band exchange or a gateway; a rule for who keeps content when its only holder leaves; spam resistance on public networks. The network crate is not published.

**kappa-registry supplies storage and persistence.**
- Supplies: typed edges between content addresses; tags with compare-and-swap; monotonic sequences; multi-object transactions; range-based set reconciliation that costs in proportion to the difference; signed roots with inclusion and absence proofs; framed encryption at rest that verifies without the key; a Veilid peer-to-peer transport adapter.
- Conflicts with the brief: it is shipped as a server and peers are configured as HTTP addresses; `kappa-core` does not build for the browser; its default hash is SHA-256, with BLAKE3 supported but not default; it has its own identity system, including a passkey module for the retired `prism/identity/1`.

## Open decisions

1. Repository name, and whether it is public.
2. Whether an optional, untrusted, always-on peer is acceptable (a relay or a registry node that holds ciphertext only). Without one, there is no delivery while every device involved is offline, no waking a sleeping phone, and no connection between two peers that both sit behind restrictive networks.
3. Whether an unmodified Matrix client must be able to connect, or whether equivalent features behind a stable contract are enough.
4. Whether the first target is the browser. Prism ID and Prism apps run there; `kappa-core` does not yet.
5. Which store is the contract where Hologram's and kappa-registry's overlap.
6. How BLAKE3 becomes the only address when kappa-registry defaults to SHA-256 and Matrix event IDs are SHA-256.
7. What happens to kappa-registry's own identity system now that Prism ID is the identity.

## Not verified

- Rendered spec URLs: anchors were derived from headings, not opened on spec.matrix.org.
- The list of what Element minimally needs from a server is inferred from the spec's feature profiles; the spec publishes no such list.
- Element: pages were read through a summarising fetcher, so quoted labels may differ from the page. The user guide PDF, the QR-login proposal text and two documentation pages could not be fetched. Items marked "unverified, from memory" in part E were stated by no page read.
- Group-call proposals MSC3401 and MSC4354 were read from their pull-request pages only.
- Trust statements marked "(inferred)" in part D are conclusions, not quotations.
- Hologram and kappa-registry were read, not run. kappa-registry's design reference `docs/kappa-registry.md` is named in its README but absent from the clone. Whether Hologram and kappa-registry write BLAKE3 labels identically was not checked.
- `npx prism-code@latest setup` has not been run; it belongs to Phase 2.

## Parts

- A. Client-Server API core, sync and login, and the seam
- B. Feature modules
- C. Data model and federation
- D. Encryption, calls and the side APIs
- E. Element user experience

---

# A. Matrix v1.19: Client-Server API core, sync and login model, and the seam

Source: local clone of matrix-spec at tag v1.19. Every entry is read from the files named; nothing is from memory.

Abbreviations used in citations:
- OV = `content/_index.md` (rendered at https://spec.matrix.org/v1.19/)
- CS = `content/client-server-api/_index.md` (rendered at https://spec.matrix.org/v1.19/client-server-api/)
- API = `data/api/client-server/` (OpenAPI files, rendered inline in CS)

Endpoint paths are relative to `/_matrix/client/v3` unless a different prefix is shown.

## 1. Architecture in brief

| Concept | What the spec says | Citation |
|---|---|---|
| Purpose | Open APIs for synchronising extensible JSON objects ("events") between clients, servers and services; favours availability and partition tolerance over consistency. | OV "Architecture", https://spec.matrix.org/v1.19/#architecture |
| Users | An account identified by `@localpart:domain`, namespaced to the homeserver that allocated it. | OV "Users", https://spec.matrix.org/v1.19/#users |
| Devices | One per client instance, identified by a `device_id` unique within the user. Used mainly to hold end-to-end encryption keys and to revoke access. | OV "Devices", https://spec.matrix.org/v1.19/#devices |
| Homeservers | Each stores the communication history and account information for all its clients and synchronises history with other homeservers. No single homeserver owns a room. | OV "Architecture", https://spec.matrix.org/v1.19/#architecture |
| Rooms | A conceptual place identified by `!opaque_id:domain`; the domain only namespaces the ID, the room does not live there. Room data is replicated to every participating homeserver. | OV "Room structure", https://spec.matrix.org/v1.19/#room-structure |
| Events | All data is an event with a globally namespaced `type` (`m.` reserved). Two kinds in a room: message events (one-off activity) and state events (key/value keyed by `type` + `state_key`). Bodies are untrusted. | OV "Events", https://spec.matrix.org/v1.19/#events |
| Event graph | Events form a DAG per room; each event names its parents; `depth` is strictly greater than its parents'. Conflicting state is merged by a state resolution algorithm; events are signed by the originating server and pushed full-mesh. | OV "Event Graphs", https://spec.matrix.org/v1.19/#event-graphs and "Room structure" |
| Room aliases | `#alias:domain`, a mutable pointer to a room ID, resolved by asking the alias's domain; the answer includes servers to join via. | OV "Room Aliases", https://spec.matrix.org/v1.19/#room-aliases |
| Identity (3PIDs) | Email or phone numbers can be linked to a user ID through identity servers. Optional. | OV "Identity", https://spec.matrix.org/v1.19/#identity |
| Profiles, private user data | Public key/value data per account; private key/value data per account. | OV "Profiles", "Private User Data", https://spec.matrix.org/v1.19/#profiles |

The five APIs. The overview page lists them without describing all five; the one-liners below come from the overview where it speaks and otherwise from each API's own front-matter description.

| API | Purpose | Citation |
|---|---|---|
| Client-Server | Clients send events, control rooms and synchronise history with their homeserver. | OV "Architecture"; CS front matter |
| Server-Server (Federation) | Homeservers replicate room event graphs to each other with eventual consistency, backfill history, and query profiles and presence. | OV "Architecture"; `content/server-server-api.md` front matter |
| Application Service | A standard way to add server-side behaviour (gateways, bridges) to a homeserver; services observe and inject events. | `content/application-service-api.md` front matter and "Application Services" |
| Identity Service | Establishes, validates and answers lookups of mappings between 3PIDs and Matrix user IDs. | OV "Identity"; `content/identity-service-api.md` front matter |
| Push Gateway | The homeserver forwards information about received events to a gateway, which hands a notification to the vendor push provider. | `content/push-gateway-api.md` "Overview" |

## 2. Client-Server API core

| Capability | What it does | Citation | Server role today |
|---|---|---|---|
| Transport baseline | JSON objects over HTTP, UTF-8, HTTPS recommended; servers must answer CORS pre-flight for browser clients. | CS "API Standards", https://spec.matrix.org/v1.19/client-server-api/#api-standards ; "Web Browser Clients", https://spec.matrix.org/v1.19/client-server-api/#web-browser-clients | none |
| Server discovery (.well-known) | Client splits the user ID at the first colon, fetches `https://hostname/.well-known/matrix/client`, reads `m.homeserver.base_url` (and optional `m.identity_server.base_url`), then validates by calling `/versions`. Done at login time only. The file may be served by any web server, not the homeserver. `/.well-known/matrix/support` (v1.10) gives admin contacts. | CS "Server Discovery" and "Well-known URIs"; API `wellknown.yaml`, `support.yaml`. https://spec.matrix.org/v1.19/client-server-api/#well-known-uris , https://spec.matrix.org/v1.19/client-server-api/#getwell-knownmatrixclient | discovery |
| Versions | `GET /_matrix/client/versions` returns `versions` (list of `vX.Y`) and optional `unstable_features` (namespaced booleans for not-yet-specified features). Unauthenticated; may return more when authenticated (v1.10). | CS "API Versions"; API `versions.yaml`. https://spec.matrix.org/v1.19/client-server-api/#api-versions , https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientversions | discovery |
| Capabilities | `GET /capabilities` advertises optional or state-dependent behaviour. Defined: `m.change_password`, `m.forget_forced_upon_leave`, `m.room_versions`, `m.profile_fields`, `m.set_displayname`, `m.set_avatar_url`, `m.3pid_changes`, `m.get_login_token`. Not for unstable features. | CS "Capabilities negotiation"; API `capabilities.yaml`. https://spec.matrix.org/v1.19/client-server-api/#capabilities-negotiation | discovery, enforcement (auth or policy) |
| Authentication: choice of API | Since v1.15 two APIs exist: legacy and OAuth 2.0. A homeserver may support one or both; they are mutually incompatible, so a client must stay with the API that issued its token. Discover legacy with `GET /login`, OAuth with `GET /_matrix/client/v1/auth_metadata`; unsupported returns 404 `M_UNRECOGNIZED`. | CS "Client Authentication", "Authentication API discovery". https://spec.matrix.org/v1.19/client-server-api/#client-authentication , https://spec.matrix.org/v1.19/client-server-api/#authentication-api-discovery | identity, enforcement (auth or policy) |
| Authentication: legacy login | `GET /login` lists flows; `POST /login` with `m.login.password` (identifier `m.id.user`, 3PID or phone), `m.login.token`, or `m.login.application_service` returns `access_token`, `device_id`, `user_id`, optional `refresh_token`. SSO redirects through the SSO module, then `m.login.token`. `POST /logout`, `/logout/all` invalidate. `POST /_matrix/client/v1/login/get_token` (v1.7) mints a login token for another device. HTML fallback at `/_matrix/static/client/login/`. | CS "Legacy API" > "Login"; API `login.yaml`, `login_token.yaml`, `logout.yaml`. https://spec.matrix.org/v1.19/client-server-api/#legacy-login , https://spec.matrix.org/v1.19/client-server-api/#post_matrixclientv3login | identity, enforcement (auth or policy) |
| Authentication: User-Interactive Authentication (UIA) | For sensitive endpoints the server answers 401 with `flows`, `params`, `session`; the client resubmits with an `auth` object per stage until done. Types: `m.login.password`, `.recaptcha`, `.sso`, `.email.identity`, `.msisdn`, `.dummy`, `.registration_token`, `.terms` (v1.11), `m.oauth` (v1.17). The stated goal: "ANY client can log in to ANY homeserver". | CS "User-Interactive Authentication API", "Authentication types". https://spec.matrix.org/v1.19/client-server-api/#user-interactive-authentication-api | identity, enforcement (auth or policy) |
| Authentication: OAuth 2.0 API | Precisely what v1.19 specifies: an API "based on" OAuth 2.0 (RFC 6749) "with a few features from OpenID Connect". Steps: server metadata discovery at `GET /_matrix/client/v1/auth_metadata`; dynamic client registration (RFC 7591) with strict redirect URI rules; authorisation code grant with PKCE S256; device authorisation grant (RFC 8628, v1.18); mandatory refresh token grant with short-lived access tokens; token revocation (RFC 7009) as logout. Two scope tokens only: `urn:matrix:client:api:*` (full access) and `urn:matrix:client:device:<device_id>` (client allocates the device ID). User ID is learned from `/account/whoami`. UIA endpoints are unusable with OAuth tokens, except cross-signing key upload via `m.oauth`. The spec notes it does not yet cover all legacy use cases. The only OpenID Connect elements found are `prompt=create` and the `prompt_values_supported` metadata; no ID token, userinfo or OIDC discovery document is specified in this section. | CS "OAuth 2.0 API" and subsections; API `oauth_server_metadata.yaml`. https://spec.matrix.org/v1.19/client-server-api/#oauth-20-api , https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv1auth_metadata , https://spec.matrix.org/v1.19/client-server-api/#grant-types , https://spec.matrix.org/v1.19/client-server-api/#scope | identity, enforcement (auth or policy) |
| OAuth 2.0 aware clients | Compatibility mode (v1.18): a legacy-only client uses `m.login.sso` with `oauth_aware_preferred`, passes `action=login|register`, and sends users to the account management URL. | CS "OAuth 2.0 aware clients". https://spec.matrix.org/v1.19/client-server-api/#oauth-20-aware-clients | identity |
| Registration | Legacy: `POST /register` (UIA; kinds user or guest), `/register/available`, `/register/email|msisdn/requestToken`. OAuth: the client cannot register an account; the user does it in the homeserver web UI, optionally signalled with `prompt=create`. Application services may always use `/register` (v1.17). | CS "Account registration", "User registration"; API `registration.yaml`. https://spec.matrix.org/v1.19/client-server-api/#account-registration , https://spec.matrix.org/v1.19/client-server-api/#post_matrixclientv3register | identity, storage, enforcement (auth or policy) |
| Account management | Legacy: `POST /account/password`, `POST /account/deactivate`, 3PID endpoints under `/account/3pid` (add, bind, delete, unbind), `GET /account/whoami`. OAuth: all of it happens in the homeserver web UI via `account_management_uri` with actions such as `org.matrix.devices_list`, `org.matrix.account_deactivate` (v1.18). Admin-imposed locking (v1.12) and suspension (v1.13) return `M_USER_LOCKED` / `M_USER_SUSPENDED`. | CS "Account management", "Legacy API" > "Account management", "OAuth 2.0 API" > "Account management", "Account moderation", "Adding Account Administrative Contact Information", "Current account information". https://spec.matrix.org/v1.19/client-server-api/#account-management , https://spec.matrix.org/v1.19/client-server-api/#oauth-20-account-management , https://spec.matrix.org/v1.19/client-server-api/#account-moderation | identity, storage, enforcement (auth or policy) |
| Devices and access/refresh tokens | Access tokens are opaque, sent as `Authorization: Bearer` (query parameter deprecated v1.11). Each access and refresh token is bound to one device; reusing a `device_id` invalidates its previous tokens. Refresh (v1.3): legacy `POST /refresh`, OAuth refresh grant; the old refresh token stays valid until the new token is first used. `M_UNKNOWN_TOKEN` with `soft_logout: true` means re-authenticate and keep local state (keys); without it, discard state. Device listing/renaming/deletion (`/devices`, `/delete_devices`) is in the Device Management module. | CS "Using access tokens", "Relationship between access tokens and devices", "Refreshing access tokens", "Soft logout". https://spec.matrix.org/v1.19/client-server-api/#using-access-tokens , https://spec.matrix.org/v1.19/client-server-api/#relationship-between-access-tokens-and-devices , https://spec.matrix.org/v1.19/client-server-api/#refreshing-access-tokens , https://spec.matrix.org/v1.19/client-server-api/#soft-logout | identity, storage, enforcement (auth or policy) |
| Filtering | `POST /user/{userId}/filter` stores a filter server-side and returns a `filter_id`; `GET .../filter/{filterId}` reads it. Filters shape what event-returning APIs send. | CS "Filtering"; API `filter.yaml`. https://spec.matrix.org/v1.19/client-server-api/#filtering , https://spec.matrix.org/v1.19/client-server-api/#post_matrixclientv3useruseridfilter | storage |
| Lazy loading of members | `lazy_load_members` on a `RoomEventFilter` makes `/sync`, `/messages` and `/context` send only the membership events of the senders in the response; servers may skip ones already sent unless `include_redundant_members`. Full list on demand via `/rooms/{roomId}/members?at=`. | CS "Lazy-loading room members". https://spec.matrix.org/v1.19/client-server-api/#lazy-loading-room-members | storage, relay |
| Sync model: /sync and since tokens | The server "linearises" the event graph into one stream per client. `GET /sync` without `since` returns recent events per room plus state at the start of the timeline; each response carries `next_batch`, passed back as `since`. With `timeout` the server holds the request open (long-polling). Other parameters: `filter`, `full_state`, `set_presence`, `use_state_after` (v1.16). Ordering is by arrival time at the homeserver, which can differ from graph order, so clients de-duplicate by event ID. | CS "Events" and "Syncing"; API `sync.yaml`. https://spec.matrix.org/v1.19/client-server-api/#syncing , https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv3sync | ordering, storage, relay |
| Sync model: response sections | `rooms.join|invite|knock|leave`. A joined room has `summary` (`m.heroes`, member counts), `state` or `state_after` (v1.16), `timeline` (`events`, `limited`, `prev_batch`), `ephemeral` (typing, receipts), `account_data`, `unread_notifications`, `unread_thread_notifications` (v1.4). Invited and knocked rooms carry stripped state. Top level: `presence`, `account_data`, `to_device`, `device_lists`, `device_one_time_keys_count`. | API `sync.yaml` (rendered under "Syncing"); CS "Stripped state". https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv3sync , https://spec.matrix.org/v1.19/client-server-api/#stripped-state | ordering, storage, relay, push |
| Sync model: gaps and /messages backfill | If too many events arrived, the timeline is `limited`: only the newest events plus a state delta across the gap. The client fills the gap with `GET /rooms/{roomId}/messages?from=<since>&to=<prev_batch>`; `dir=b|f` is required, `from` optional since v1.3, default `limit` 10. `prev_batch` also pages older history. | CS "Syncing", "Getting events for a room"; API `message_pagination.yaml`. https://spec.matrix.org/v1.19/client-server-api/#syncing , https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv3roomsroomidmessages | ordering, storage |
| Sliding sync | Not in v1.19 (MSC only). No match for "sliding" in `content/` or `data/api/client-server/`; the only sync endpoints are `/sync` and the deprecated `/events`, `/initialSync`, `/rooms/{roomId}/initialSync`. | API `sync.yaml`, `old_sync.yaml`, `room_initial_sync.yaml`. https://spec.matrix.org/v1.19/client-server-api/#syncing | none |
| Event format seen by clients | Homeservers convert the room-version-specific federation format into one client format: `event_id`, `type`, `sender`, `origin_server_ts`, `content`, `room_id`, optional `state_key`, `unsigned` (`age`, `transaction_id`, `prev_content`, `redacted_because`, `membership`). Max 65536 bytes in federation format. | CS "Room event format", "Size limits"; API `definitions/client_event.yaml`. https://spec.matrix.org/v1.19/client-server-api/#room-event-format , https://spec.matrix.org/v1.19/client-server-api/#size-limits | enforcement (auth or policy), storage |
| Room creation | `POST /createRoom`; the server writes `m.room.create` (the graph root), `m.room.power_levels`, `m.room.join_rules` and events implied by `preset`, `initial_state`, `invite`, `invite_3pid`, `room_version`, `creation_content`, `is_direct`, `power_level_content_override`. Room type lives in `m.room.create` (`m.space`). | CS "Creation", "Types"; API `create_room.yaml`. https://spec.matrix.org/v1.19/client-server-api/#creation , https://spec.matrix.org/v1.19/client-server-api/#post_matrixclientv3createroom | storage, ordering, enforcement (auth or policy) |
| Room aliases | `PUT|GET|DELETE /directory/room/{roomAlias}`, `GET /rooms/{roomId}/aliases`. Aliases are scoped to one homeserver's domain; servers must resolve remote aliases over federation. Rooms keep no alias list; `m.room.canonical_alias` is advisory and must be re-checked. | CS "Room aliases"; API `directory.yaml`. https://spec.matrix.org/v1.19/client-server-api/#room-aliases , https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv3directoryroomroomalias | discovery, storage |
| Published room directory | Optional per-server list. `GET|PUT /directory/list/room/{roomId}` (visibility `public`/`private`), `GET|POST /publicRooms`. Visibility is independent of join rules and history visibility. `GET /_matrix/client/v1/room_summary/{roomIdOrAlias}` (v1.15) and `POST /user_directory/search` sit alongside. | CS "Published room directory", "Room Summaries", "User Directory"; API `list_public_rooms.yaml`, `room_summary.yaml`, `users.yaml`. https://spec.matrix.org/v1.19/client-server-api/#published-room-directory | discovery |
| Membership | States: unrelated, knocking, invited, joined, banned; join rules `public`, `invite`, `knock`, `restricted`, `knock_restricted`. Endpoints: `GET /joined_rooms`, `POST /rooms/{roomId}/invite`, `/join`, `POST /join/{roomIdOrAlias}`, `POST /knock/{roomIdOrAlias}`, `/leave`, `/forget`, `/kick`, `/ban`, `/unban`. Each is an `m.room.member` state change; permissions come from `m.room.power_levels`; the server must verify restricted-join conditions. | CS "Room membership", "Joining rooms", "Leaving rooms", "Permissions". https://spec.matrix.org/v1.19/client-server-api/#room-membership , https://spec.matrix.org/v1.19/client-server-api/#post_matrixclientv3joinroomidoralias | enforcement (auth or policy), ordering, relay, storage |
| Sending events, transaction IDs | Message events: `PUT /rooms/{roomId}/send/{eventType}/{txnId}` returns `event_id`. State events: `PUT /rooms/{roomId}/state/{eventType}/{stateKey}` (no txnId). A `txnId` is scoped to one device and one endpoint; a repeat on the same path must return the original response. Scope survives token refresh; scoped to devices since v1.7. The sender sees its `transaction_id` echoed in `unsigned`. | CS "Transaction identifiers", "Sending events to a room"; API `room_send.yaml`, `room_state.yaml`. https://spec.matrix.org/v1.19/client-server-api/#transaction-identifiers , https://spec.matrix.org/v1.19/client-server-api/#put_matrixclientv3roomsroomidsendeventtypetxnid | ordering, storage, relay, enforcement (auth or policy) |
| Redaction | `PUT /rooms/{roomId}/redact/{eventId}/{txnId}`, or since v1.18 an `m.room.redaction` through `/send` in all room versions. The server strips non-protocol keys permanently and serves the pruned event with `redacted_because`; the algorithm is defined per room version; clients should prune locally too. | CS "Redactions". https://spec.matrix.org/v1.19/client-server-api/#redactions , https://spec.matrix.org/v1.19/client-server-api/#put_matrixclientv3roomsroomidredacteventidtxnid | enforcement (auth or policy), storage, relay |
| Room state and event reads | `GET /rooms/{roomId}/state`, `/state/{eventType}/{stateKey}`, `/members`, `/joined_members`, `/event/{eventId}`, `/_matrix/client/v1/rooms/{roomId}/timestamp_to_event` (v1.6). | CS "Getting events for a room"; API `rooms.yaml`, `room_event_by_timestamp.yaml`. https://spec.matrix.org/v1.19/client-server-api/#getting-events-for-a-room | storage |
| Profiles | `GET /profile/{userId}`, `GET|PUT|DELETE /profile/{userId}/{keyName}` (delete and arbitrary fields v1.16). On a display name or avatar change the homeserver itself emits an `m.room.member` event into every room the user is in and a presence update. Servers must allow lookup for users sharing a room and should query remote servers over federation. | CS "Profiles" and "Server behaviour"; API `profile.yaml`. https://spec.matrix.org/v1.19/client-server-api/#profiles | storage, relay, identity |
| Rate limiting | Homeservers should rate limit; refusal is HTTP 429 with `M_LIMIT_EXCEEDED` and a `Retry-After` header (`retry_after_ms` deprecated v1.10). | CS "Rate limiting". https://spec.matrix.org/v1.19/client-server-api/#rate-limiting | enforcement (auth or policy) |
| Error model | Every error is a JSON object with mandatory `errcode` and `error`. Codes are namespaced (`M_` for the spec). Clients act on `errcode`, falling back to HTTP status for `M_UNKNOWN`. `M_UNRECOGNIZED` with 404/405 marks an unimplemented endpoint or method. Newer: `M_USER_LIMIT_EXCEEDED` (v1.18), `M_UNKNOWN_DEVICE` (v1.17). | CS "Standard error response", "Common error codes", "Other error codes". https://spec.matrix.org/v1.19/client-server-api/#standard-error-response | enforcement (auth or policy) |
| Modules (named only) | The core delegates to modules another map covers: Instant Messaging, Content Repository, Send-to-Device, Device Management, End-to-End Encryption, Secrets, Push Notifications, Presence, Receipts, Typing, Read Markers, History Visibility, Client Config (account data), Server Side Search, SSO login, Direct Messaging, Spaces, Threading, Third-party Invites, and others. A compliant server must support all modules. | CS "Modules", "Feature Profiles". https://spec.matrix.org/v1.19/client-server-api/#modules | none |

## 3. The seam

### Why any client works against any homeserver

The client never sees the distributed system. It sees one HTTP+JSON service at one base URL that presents a single linear stream of events per account. Four things are fixed by the spec and together form the contract.

1. A fixed endpoint set under `/_matrix/client/`. Modules are "strictly defined", not optional extensions: "A compliant server implementation MUST support all modules" (CS "Modules", https://spec.matrix.org/v1.19/client-server-api/#modules). Clients, by contrast, implement a feature profile (Web, Mobile, Desktop, CLI, Embedded).

2. Versioning and negotiation. The whole spec has one version `vX.Y`; Y changes are backwards compatible or "managed". Endpoints are versioned individually in the path (`/v3/sync`, `/v1/auth_metadata`), so one endpoint can move without touching others. Deprecated features must still be implemented by any server that advertises a version containing them, and are removable only after a further proposal (OV "Specification Versions", "Endpoint versioning", "Deprecation policy", https://spec.matrix.org/v1.19/#specification-versions). The client reads `GET /_matrix/client/versions`, picks the endpoints valid for a version both sides support, and treats `unstable_features` as opt-in previews (CS "API Versions"). Optional behaviour within a version is read from `/capabilities`; a missing endpoint answers `M_UNRECOGNIZED`.

3. One event schema. Homeservers convert every room version's federation format into the single client event format, so the client does not need to know the room version to parse a timeline (CS "Room event format", https://spec.matrix.org/v1.19/client-server-api/#room-event-format). Event types are namespaced and open; unknown types still flow through. Clients must validate content as untrusted.

4. One auth contract. An opaque bearer token bound to a device, obtained through a discoverable flow list (`GET /login`, UIA `flows`) or OAuth 2.0 metadata. The server chooses how users authenticate; the client only follows the advertised flow (CS "User-Interactive Authentication API" > "Overview").

Add discovery (`.well-known` from the user ID's domain) and a uniform error object, and a client needs no server-specific code.

### What a full-featured client cannot work without

This list is derived from the core sections above and the Feature Profiles table (modules Required for Web, Mobile and Desktop); the spec does not publish a "minimum for Element" list, so the selection is an inference, not a quotation.

| Need | Endpoints and behaviour | Citation |
|---|---|---|
| Find and probe the server | `/.well-known/matrix/client`, `/_matrix/client/versions`, `/capabilities` | CS "Server Discovery", "Capabilities negotiation" |
| Obtain and keep a session | `GET`/`POST /login` or `/auth_metadata` + OAuth grants; refresh; logout or revocation; `/account/whoami`; correct `M_UNKNOWN_TOKEN` and `soft_logout` handling | CS "Client Authentication" |
| Receive everything | Long-polled `/sync` with a durable `since` token; stored filters with lazy loading; `limited` + `prev_batch`; `/rooms/{roomId}/messages` for gaps and scroll-back; `/members`, `/state` | CS "Syncing", "Filtering" |
| Send | `/send/{eventType}/{txnId}` with idempotent retry and `transaction_id` echo; `/state/{eventType}/{stateKey}`; `/redact` | CS "Sending events to a room", "Transaction identifiers", "Redactions" |
| Rooms and people | `/createRoom`, join/invite/leave/kick/ban/knock/forget, alias resolution, `/publicRooms`, `/profile`, `/user_directory/search` | CS "Rooms", "User Data" |
| Required modules (named only) | Content Repository, Instant Messaging, Direct Messaging, Presence, Receipts, Typing, History Visibility, Room Upgrades, Mentions, Ignoring Users, VoIP; Push for Mobile. End-to-End Encryption, Send-to-Device and Device Management are listed Optional in the table, yet `/sync` reserves `to_device`, `device_lists` and `device_one_time_keys_count` for them. | CS "Feature Profiles" > "Summary", https://spec.matrix.org/v1.19/client-server-api/#summary |

### What the client assumes the server does on its behalf

| Assumed duty | Evidence in the spec | Citation |
|---|---|---|
| Ordering | The server linearises the partially ordered event graph into a stream, orders by arrival time, issues opaque position tokens, assigns `event_id` and `origin_server_ts`, and computes state deltas across gaps. | CS "Events", "Syncing" |
| Persistence | The homeserver "stores the communication history and account information for all of its clients"; clients may be stateless and lazy-load. Filters, profiles, account data and device records live on the server. | OV "Architecture"; CS front matter |
| Fan-out | One `PUT` from the client; the homeserver appends to the graph, signs, and replicates to every participating server, and delivers to the user's other devices through their `/sync`. Profile changes are fanned into every room by the server. | OV "Architecture"; CS "Events on Change of Profile Information" |
| Authorisation and validation | Power levels, join rules, restricted-join checks, redaction pruning, size limits, rate limits, account locks and suspension are enforced by the server; the client only reads the result. | CS "Permissions", "Restricted rooms", "Redactions", "Size limits", "Account moderation" |
| Wake-up and push | Long-poll hold on `/sync`; unread counts computed server-side in `unread_notifications`; offline delivery via the Push Notifications module and Push Gateway API. | API `sync.yaml`; `content/push-gateway-api.md` "Overview" |
| Key distribution | `/sync` carries `to_device` messages, `device_lists` changes and one-time-key counts; the server stores and hands out device keys (End-to-End Encryption and Send-to-Device modules). | API `sync.yaml` top-level properties |
| Media hosting | Upload and download go through the homeserver's Content Repository module (`/_matrix/media/v3/upload` is named in the core as a non-JSON exception). | CS "API Standards" |
| Search and directories | Server Side Search module; published room directory; user directory search; alias resolution across federation. | CS "Modules", "Published room directory", "User Directory", "Room aliases" |
| Identity | The homeserver allocates the user ID in its own namespace, authenticates the user, binds tokens to devices, and optionally proxies 3PID binding to an identity server chosen in `m.identity_server` account data. | OV "Users"; CS "Relationship between access tokens and devices", "Notes on identity servers" |

Consequence for a serverless design: the seam is the Client-Server API itself. Anything that answers these endpoints with these semantics (a stable linear stream with resumable tokens, idempotent sends, the client event format, a bearer-token session, and the module endpoints) is a homeserver as far as the client can tell. The duties in the last table are what must be re-homed onto peers.

## Absent or notable in v1.19

- Sliding sync: not in v1.19 (MSC only).
- OAuth 2.0 API: present since v1.15, but not a full OpenID Connect profile; only `prompt=create` is borrowed. Legacy login and UIA remain specified and are not marked deprecated.
- No endpoint lets an OAuth-authenticated client register an account or manage it in-app; both are delegated to the homeserver's web UI.
- The overview page gives no one-line purpose for the Application Service or Push Gateway APIs; those lines were taken from the APIs' own pages.
- "Room Events" in the core is marked "work in progress" in the spec text.


---

# B. Client-Server API feature modules (Matrix v1.19)

Source: local clone of the spec at release v1.19. File paths are relative to `content/client-server-api/` unless they start with `content/` or `data/`. `U:` is the rendered URL; every anchor is derived from the heading text in the source file, not checked against the live site. Endpoint paths omit the `/_matrix/client/v3` prefix unless another version is shown.

Not covered here (see part D): `end_to_end_encryption.md`, `secrets.md`, `send_to_device.md`, `voip_events.md`. `modules/index.md` is an empty stub.

Server role vocabulary: storage, ordering, relay, discovery, identity, push, media forwarding, enforcement, none.

## Membership and permissions

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Membership states | A user is unrelated, knocking, invited, joined or banned in a room; only joined users send and receive events, except rejecting an invite, knocking and retracting a knock. All of it is `m.room.member` state with a `membership` value. | `_index.md` "Room membership". U: `https://spec.matrix.org/v1.19/client-server-api/#room-membership` | storage: holds room state. enforcement: checks each transition against the room version's authorisation rules. relay: sends the member event to other servers. |
| Join rules | `m.room.join_rules` is one of `public`, `invite`, `knock`, `restricted`, `knock_restricted` (schema enum also lists `private`). It decides whether an invite is needed. | `_index.md` "Room membership"; `data/event-schemas/schema/m.room.join_rules.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#mroomjoin_rules` | enforcement: refuses joins the rule forbids. storage: state event. |
| Invite | `POST /rooms/{roomId}/invite` sets the target's membership to `invite`; required level is `invite` in power levels (default 0). | `_index.md` "Joining rooms"; `m.room.power_levels.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#joining-rooms` | relay: delivers the invite to the invitee's server. enforcement: power-level check. identity: resolves the user ID to a server. |
| Join | `POST /rooms/{roomId}/join` or `POST /join/{roomIdOrAlias}`. | `_index.md` "Joining rooms". U: `https://spec.matrix.org/v1.19/client-server-api/#joining-rooms` | discovery: resolves alias and finds a server already in the room. enforcement: join rule check. storage and ordering: adds the event to the room graph. |
| Knock | `POST /knock/{roomIdOrAlias}` requests an invite (room versions 7+). A member with invite permission accepts by inviting; kick or ban rejects; `/leave` retracts. Servers may auto-accept the resulting invite. | `_index.md` "Knocking on rooms"; `content/rooms/_index.md` "Feature matrix". U: `https://spec.matrix.org/v1.19/client-server-api/#knocking-on-rooms` | relay: carries the knock to a server in the room. enforcement: join rule and membership checks. |
| Restricted joins | With `restricted` (v8+) or `knock_restricted` (v10+), a user joins without invite if they are a joined member of a room listed in `allow` (only condition: `m.room_membership`). Checked at join time only. | `_index.md` "Restricted rooms", "Conditions". U: `https://spec.matrix.org/v1.19/client-server-api/#restricted-rooms` | enforcement: a server in the room MUST verify the condition and vouches for the join (`join_authorised_via_users_server`, `content/rooms/fragments/v8-auth-rules.md`). |
| Leave and forget | `POST /rooms/{roomId}/leave` stops delivery, rejects an invite or retracts a knock; `/forget` hides the room from `/sync`. | `_index.md` "Leaving rooms". U: `https://spec.matrix.org/v1.19/client-server-api/#leaving-rooms` | storage: membership and per-user forgotten flag. enforcement: must be invited or joined first. |
| Kick | `POST /rooms/{roomId}/kick` sets another user to `leave`; needs the `kick` level (default 50). The user may rejoin if the room is not invite-only. | `_index.md` "Leaving rooms"; `m.room.power_levels.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#leaving-rooms` | enforcement: power-level check. relay: fans the event out. |
| Ban and unban | `POST /rooms/{roomId}/ban` sets membership `ban`; the user cannot join or be invited until `/unban`. Needs the `ban` level (default 50). | `_index.md` "Banning users in a room". U: `https://spec.matrix.org/v1.19/client-server-api/#banning-users-in-a-room` | enforcement: power-level check, and refusal of later joins. storage: ban is room state. |
| Power levels | `m.room.power_levels` maps users to integers and sets thresholds: `events`, `events_default` (0), `state_default` (50), `invite` (0), `kick`, `ban`, `redact` (50), `notifications.room` (50). A user can raise others only up to their own level. In room version 12+ creators have infinite, immutable power and are not listed. | `_index.md` "Permissions"; `data/event-schemas/schema/m.room.power_levels.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#permissions`, `https://spec.matrix.org/v1.19/client-server-api/#mroompower_levels` | enforcement: every server checks each event against the levels at that point in the graph. ordering: conflicting state is resolved by the room version algorithm. |

## Conversation

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Instant messaging | `m.room.message` with a required `msgtype` and text `body`; optional HTML in `formatted_body` (`org.matrix.custom.html`, restricted tag list). Room `m.room.name`, `m.room.topic`, `m.room.avatar`, `m.room.pinned_events` are state. Clients queue per room, retry with backoff, and match local echo by transaction ID. | `modules/instant_messaging.md` "Instant Messaging". U: `https://spec.matrix.org/v1.19/client-server-api/#instant-messaging` | storage and ordering: persists events and assigns timeline order. relay: fans out to member servers. enforcement: SHOULD reject messages lacking `msgtype` or `body` (400). |
| Message types | Schemas present: `m.text`, `m.emote`, `m.notice`, `m.image`, `m.file`, `m.audio`, `m.video`, `m.location`, `m.key.verification.request`, `m.server_notice`. Media types carry an `mxc://` `url`; captions use `filename` plus `body`. Spoilers and LaTeX maths are HTML attributes. No poll or voice-message type exists in v1.19. | `modules/instant_messaging.md` "m.room.message msgtypes", "Media captions"; `data/event-schemas/schema/m.room.message$*.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#mroommessage-msgtypes` | none beyond messaging; media types depend on the content repository. |
| Rich replies | `m.relates_to.m.in_reply_to.event_id` points at the replied-to event; no `rel_type`. Text fallbacks were removed in v1.13; the replied-to sender may be put in `m.mentions`. | `modules/rich_replies.md` "Rich replies". U: `https://spec.matrix.org/v1.19/client-server-api/#rich-replies` | none: client-rendered. Replies are not returned by the relations API. |
| Mentions | `m.mentions` holds `user_ids` and a `room` flag; the default push rules `.m.rule.is_user_mention` and `.m.rule.is_room_mention` turn it into a highlight. Body-text matching rules were removed in v1.17. | `modules/mentions.md` "User and room mentions". U: `https://spec.matrix.org/v1.19/client-server-api/#user-and-room-mentions` | push: evaluates the mention rules, including the sender's `notifications.room` level. For encrypted events the client evaluates after decrypting. |
| Edits (event replacements) | An event with `rel_type: m.replace` and `m.new_content` replaces the original's content. Valid only for same room, sender and type, non-state events, and not an edit of an edit. Latest edit wins by `origin_server_ts`, then largest event ID. | `modules/event_replacements.md` "Event replacements", "Validity of replacement events". U: `https://spec.matrix.org/v1.19/client-server-api/#event-replacements` | storage: keeps all revisions. ordering: bundles the most recent valid edit under `unsigned.m.relations` but must not rewrite the original. |
| Reactions (annotations) | `m.reaction` with `rel_type: m.annotation` and a `key` (emoji). Clients count per key, one per sender; changing a reaction means redacting and resending. | `modules/event_annotations.md` "Event annotations and reactions". U: `https://spec.matrix.org/v1.19/client-server-api/#event-annotations-and-reactions` | enforcement: rejects a duplicate from the same user (`M_DUPLICATE_ANNOTATION`). No server aggregation; duplicates can still arrive from other servers. |
| Reference relations | `rel_type: m.reference` links an event to another with no implied meaning (used by key verification). | `modules/reference_relations.md` "Reference relations". U: `https://spec.matrix.org/v1.19/client-server-api/#reference-relations` | storage: bundles a `chunk` of child event IDs on the parent. |
| Relations API and aggregation | `GET /_matrix/client/v1/rooms/{roomId}/relations/{eventId}[/{relType}[/{eventType}]]` lists children; `m.relates_to` must be in cleartext so the server can see it. | `_index.md` "Forming relationships between events", "Aggregations of child events", "Relationships API". U: `https://spec.matrix.org/v1.19/client-server-api/#forming-relationships-between-events` | storage and ordering: indexes children, bundles aggregations, excludes ignored users. Clients are still told to aggregate locally. |
| Threads | `rel_type: m.thread` always points at the thread root; threads cannot nest. `is_falling_back` adds a reply for older clients. `GET /_matrix/client/v1/rooms/{roomId}/threads` lists roots. | `modules/threading.md` "Threading", "Querying threads in a room". U: `https://spec.matrix.org/v1.19/client-server-api/#threading` | storage and ordering: bundles `latest_event`, `count`, `current_user_participated`; serves the thread list. enforcement: SHOULD reject a thread started on a related event (400). |
| Redaction | `m.room.redaction` strips an event to protocol-required keys, permanently. `PUT /rooms/{roomId}/redact/{eventId}/{txnId}`, or since v1.18 plain `/send`. Own events need the level for `m.room.redaction`; others' need `redact` (50). | `_index.md` "Redactions"; `m.room.power_levels.yaml`; algorithm in `content/rooms/`. U: `https://spec.matrix.org/v1.19/client-server-api/#redactions` | enforcement: decides whether to accept the redaction. storage: serves the stripped event thereafter and may delete the content. |
| Stickers | `m.sticker` is an image shown inline without controls, with `body`, `url` and `info`; recommended 512x512 or smaller. | `modules/stickers.md` "Sticker Messages". U: `https://spec.matrix.org/v1.19/client-server-api/#sticker-messages` | none beyond messaging and media. |
| Image packs (new in v1.19) | `m.room.image_pack` state events (one per `state_key`) define named emoticons and stickers by shortcode. `m.image_pack.rooms` account data enables a room's pack everywhere; canonical parent spaces' packs are also offered. Emoticons are sent as `<img data-mx-emoticon src="mxc://...">`. | `modules/image_packs.md` "Image packs". U: `https://spec.matrix.org/v1.19/client-server-api/#image-packs` | storage: room state and account data. enforcement: MAY check shortcode grammar on local sends, MUST NOT reject federated ones. Packs are unencrypted, so the server sees them. |
| Recent emoji (v1.18) | `m.recent_emoji` global account data: an ordered list of emoji with counters, capped at about 100, shared across devices. | `modules/recent_emoji.md` "Recently used emoji". U: `https://spec.matrix.org/v1.19/client-server-api/#recently-used-emoji` | storage: account data only. |

## Organisation

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Direct messages | A DM is an ordinary room. The inviter passes `is_direct` to `/createRoom`; both sides record the room under `m.direct` account data. Not limited to two people. | `modules/dm.md` "Direct Messaging". U: `https://spec.matrix.org/v1.19/client-server-api/#direct-messaging` | storage: account data. relay: must copy `is_direct` into the invite member event. |
| Spaces | A space is a room with type `m.space`. `m.space.child` (in the space) and `m.space.parent` (in the child) state events, each with `via` servers, form the tree; `order` sorts children. A parent claim counts only with a matching child event or sufficient sender power in the parent. | `modules/spaces.md` "Spaces", "Managing rooms/spaces included in a space". U: `https://spec.matrix.org/v1.19/client-server-api/#spaces` | storage: state events. |
| Space hierarchy | `GET /_matrix/client/v1/rooms/{roomId}/hierarchy` walks the tree depth-first and returns names and details of rooms the user has not joined. | `modules/spaces.md` "Discovering rooms within spaces". U: `https://spec.matrix.org/v1.19/client-server-api/#discovering-rooms-within-spaces` | discovery: fetches unknown child rooms from other servers, caches, and filters per user. |
| Room tags | `m.tag` room account data maps tag names (`m.favourite`, `m.lowpriority`, `m.server_notice`, `u.*`) to an `order` between 0 and 1. Private to the user. `GET/PUT/DELETE /user/{userId}/rooms/{roomId}/tags[/{tag}]`. | `modules/tags.md` "Room Tagging". U: `https://spec.matrix.org/v1.19/client-server-api/#room-tagging` | storage: per-user account data synced to devices. |
| Room upgrades | `POST /rooms/{roomId}/upgrade` creates a replacement room with a `predecessor`, copies listed state, moves local aliases, sends `m.room.tombstone` and raises power levels in the old room. Members are not moved; they follow the tombstone. | `modules/room_upgrades.md` "Room Upgrades". U: `https://spec.matrix.org/v1.19/client-server-api/#room-upgrades` | enforcement: checks permission to send the tombstone. storage: performs the whole multi-step copy on the user's behalf and migrates tags and push rules on join. |
| Room previews | A non-member can read a `world_readable` room with `GET /rooms/{roomId}/initialSync` then `GET /events?room_id=`. | `modules/room_previews.md` "Room Previews". U: `https://spec.matrix.org/v1.19/client-server-api/#room-previews` | storage and relay: serves events to a non-member. enforcement: only events sent while visibility was `world_readable`. |
| Guest access | An account registered with `kind=guest` may use a fixed subset of endpoints and join rooms whose `m.room.guest_access` is `can_join`. Guest status is not shared between servers. | `modules/guest_access.md` "Guest Access". U: `https://spec.matrix.org/v1.19/client-server-api/#guest-access` | identity: issues guest accounts. enforcement: endpoint allow-list, and must remove guests when the event changes. Each server is trusted to do this. |
| History visibility | `m.room.history_visibility` is `world_readable`, `shared` (default), `invited` or `joined`, applied as of when each event was sent. | `modules/history_visibility.md` "Room History Visibility". U: `https://spec.matrix.org/v1.19/client-server-api/#room-history-visibility` | enforcement: the server alone decides which stored events it returns to a user. |
| Mutual rooms (new in v1.19) | `GET /_matrix/client/v1/mutual_rooms?user_id=` returns room IDs shared with another user, paginated by `next_batch`. | `modules/mutual_rooms.md` "Mutual Rooms"; `data/api/client-server/mutual_rooms.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#mutual-rooms` | discovery: intersects memberships it already stores. |

## Awareness

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Read receipts | `POST /rooms/{roomId}/receipt/{receiptType}/{eventId}` sets an "up to here" marker. `m.read` is public, `m.read.private` is visible only to the sender; each may be unthreaded, `main`, or per thread root. Arrives as an ephemeral `m.receipt` in `/sync`. | `modules/receipts.md` "Receipts", "Private read receipts", "Threaded read receipts". U: `https://spec.matrix.org/v1.19/client-server-api/#receipts` | storage: latest receipt per user, type and thread. relay: batches and sends `m.read` to other servers as EDUs; never `m.read.private`. No integrity checks, since receipts sit outside the event graph. |
| Fully read marker | `m.fully_read` room account data marks the last event the user has dealt with; set only through `POST /rooms/{roomId}/read_markers`, which can set receipts in the same call. | `modules/read_markers.md` "Fully read markers". U: `https://spec.matrix.org/v1.19/client-server-api/#fully-read-markers` | storage: account data. enforcement: blocks direct writes (405). |
| Unread marker (v1.12) | `m.marked_unread` room account data `{unread: true}` flags a room for later; written directly by clients. | `modules/read_markers.md` "Unread markers". U: `https://spec.matrix.org/v1.19/client-server-api/#unread-markers` | storage: account data only. |
| Typing | `PUT /rooms/{roomId}/typing/{userId}` with a timeout, resent every 20-30 s. Others receive an ephemeral `m.typing` listing all current typers, which replaces their previous list. | `modules/typing_notifications.md` "Typing Notifications". U: `https://spec.matrix.org/v1.19/client-server-api/#typing-notifications` | relay: holds the current typer list with timeouts and fans it out; nothing persisted and not part of the event graph. |
| Presence | `online`, `unavailable` or `offline`, plus `last_active_ago`, `currently_active` and a status message. `PUT/GET /presence/{userId}/status`. Sent to everyone sharing a room. | `modules/presence.md` "Presence". U: `https://spec.matrix.org/v1.19/client-server-api/#presence` | relay: sends `m.presence` to interested users. identity: aggregates per-device activity into one state, tracks last activity and applies the idle timeout itself. |
| Push rules | Per-user ordered rules (`override`, `content`, `room`, `sender`, `underride`) with conditions (`event_match`, `event_property_is`, `event_property_contains`, `room_member_count`, `sender_notification_permission`) and actions (`notify`, `set_tweak` sound or highlight). Server defaults start with `.m.rule.`. Managed under `/pushrules/global/...`; exposed as `m.push_rules` account data. | `modules/push.md` "Push Rules", "Predefined Rules", "Push Rules: API". U: `https://spec.matrix.org/v1.19/client-server-api/#push-rules` | storage: the ruleset; direct account-data writes are refused. push: evaluates rules for each local user on every new event. |
| Push notifications | A client registers a pusher (`POST /pushers/set`) naming a push gateway URL and a vendor token. The homeserver posts to the gateway, which calls APNS or GCM. `GET /notifications` lists past ones; unread counts ride in `/sync`, partitioned per thread, and are cleared by read receipts. | `modules/push.md` "Push Notifications", "Client behaviour", "Receiving notifications", "Server behaviour". U: `https://spec.matrix.org/v1.19/client-server-api/#push-notifications` | push: the only party awake when the device is not; sends HTTP to the gateway and computes unread counts. For encrypted events it cannot read content, so clients re-evaluate after decrypting. |

## Storage and lookup

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Content repository | Upload returns `mxc://<server-name>/<media-id>`: `POST /_matrix/media/v3/upload`, or reserve first with `POST /_matrix/media/v1/create` then `PUT .../upload/{serverName}/{mediaId}`. Download and thumbnails use the authenticated `/_matrix/client/v1/media/download|thumbnail/...`; the unauthenticated paths are deprecated since v1.11. Also `/media/preview_url` and `/media/config`. | `modules/content_repo.md` "Content repository", "Matrix Content (`mxc://`) URIs", "Thumbnails". U: `https://spec.matrix.org/v1.19/client-server-api/#content-repository` | storage: holds the bytes under an opaque ID it assigns. media forwarding: the recipient's server fetches from the origin server and caches. Also generates thumbnails and URL previews, and enforces size and quota limits. |
| Server-side search | `POST /search` does full-text search over `content.body`, room name and topic across rooms the user has been in, ordered by `rank` or `recent`, grouped by `room_id` or `sender`. Encrypted rooms are excluded. | `modules/search.md` "Server Side Search". U: `https://spec.matrix.org/v1.19/client-server-api/#server-side-search` | storage: maintains the index. enforcement: returns only events the user may see. |
| Event context | `GET /rooms/{roomId}/context/{eventId}` returns events just before and after a given event. | `modules/event_context.md` "Event Context". U: `https://spec.matrix.org/v1.19/client-server-api/#event-context` | storage and ordering: needs the ordered timeline. enforcement: visibility filter. |
| Account data (client config) | Arbitrary typed JSON per user, global or per room, synced to all devices via `/sync`. `PUT/GET /user/{userId}/account_data/{type}` and `/user/{userId}/rooms/{roomId}/account_data/{type}`. No inheritance from global to room. | `modules/account_data.md` "Client Config". U: `https://spec.matrix.org/v1.19/client-server-api/#client-config` | storage: private per-user store, pushed to each device. enforcement: rejects writes to `m.fully_read` and `m.push_rules` (405). |

## Devices and accounts

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Device management | List, rename and delete devices: `GET /devices`, `GET/PUT/DELETE /devices/{deviceId}`, `POST /delete_devices`. Deleting invalidates that device's access token. Display names are public. | `modules/device_management.md` "Device Management". U: `https://spec.matrix.org/v1.19/client-server-api/#device-management` | identity: the server is the registry of a user's devices and tokens. enforcement: should demand extra authentication to delete. |
| OpenID | `POST /user/{userId}/openid/request_token` returns a token a third-party service exchanges with the homeserver, over federation, for the user's ID. | `modules/openid.md` "OpenID"; `data/api/client-server/openid.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#openid` | identity: the homeserver vouches for the user. |
| SSO login | With `m.login.sso` the client opens `GET /login/sso/redirect[/{idpId}]?redirectUrl=`; the homeserver sends the browser to the external identity provider, then back with a `loginToken` used at `/login` as `m.login.token`. Also usable inside user-interactive authentication. Tied to the legacy authentication API. | `modules/sso_login.md` "SSO client login/authentication", "Client login via SSO". U: `https://spec.matrix.org/v1.19/client-server-api/#sso-client-loginauthentication` | identity: delegates authentication, hosts the callback, mints the short-lived token. enforcement: must guard the redirect against CSRF and phishing. |
| Server administration | `GET /admin/whois/{userId}` shows a user's devices and sessions; `GET/PUT /_matrix/client/v1/admin/suspend/{userId}` and `/admin/lock/{userId}` read and set account suspension and locking. How someone becomes an admin is unspecified. | `modules/admin.md` "Server Administration"; `data/api/client-server/admin.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#server-administration` | identity and enforcement: server-local operator power over accounts. |
| Server notices | The server keeps one room per user, tagged `m.server_notice`, and posts `m.room.message` with `msgtype: m.server_notice` (specified type: `m.server_notice.usage_limit_reached`). Pinned notices are the active ones. The invite cannot be rejected. | `modules/server_notices.md` "Server Notices". U: `https://spec.matrix.org/v1.19/client-server-api/#server-notices` | identity: the server itself is the sender. enforcement: blocks rejecting the invite (`M_CANNOT_LEAVE_SERVER_NOTICE_ROOM`). |
| Ignore users | `m.ignored_user_list` account data. Events and invites from listed users stop arriving; their state events still do. | `modules/ignore_users.md` "Ignoring Users". U: `https://spec.matrix.org/v1.19/client-server-api/#ignoring-users` | enforcement: filters `/sync` and aggregations per user, and may reject the invite. storage: account data. |
| Invite permission (v1.18) | `m.invite_permission_config` account data with `default_action: block` rejects all invites; senders get `M_INVITE_BLOCKED`. Only all-or-nothing blocking is specified. | `modules/invite_permission.md` "Invite permission". U: `https://spec.matrix.org/v1.19/client-server-api/#invite-permission` | enforcement: the invitee's server answers 403 on the client and federation invite endpoints and hides stored invites from `/sync`. |

## Safety

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Report content | `POST /rooms/{roomId}/report/{eventId}`, `POST /rooms/{roomId}/report`, `POST /users/{userId}/report`. Event reports require the reporter to be joined; room and user reports must not. | `modules/report_content.md` "Reporting Content". U: `https://spec.matrix.org/v1.19/client-server-api/#reporting-content` | enforcement: reports go to the reporter's own server operator, who handles them however they wish. Nothing reaches room moderators or other servers by specification. |
| Moderation policy lists | A room whose state holds `m.policy.rule.user`, `.room`, `.server` events: a glob `entity`, a `recommendation` (only `m.ban`) and a `reason`. Subscribing and acting on rules are left to implementations. | `modules/moderation_policies.md` "Moderation policy lists". U: `https://spec.matrix.org/v1.19/client-server-api/#moderation-policy-lists` | storage: ordinary room state. None otherwise: "Servers have no additional requirements". |
| Policy servers (v1.18) | `m.room.policy` state names a server, which must have a joined user in the room, that checks every event before it reaches the room. Clients can look it up at `/.well-known/matrix/policy_server`. Users with enough power can clear the event at once. | `modules/policy_servers.md` "Policy Servers". U: `https://spec.matrix.org/v1.19/client-server-api/#policy-servers` | enforcement: a designated always-reachable party signs events; other servers request that signature. Signing protocol is in the Server-Server API, not read here. |
| Server ACLs | `m.room.server_acl` state with allow and deny globs and `allow_ip_literals` bars whole servers from a room. | `modules/server_acls.md` "Server Access Control Lists (ACLs) for rooms". U: `https://spec.matrix.org/v1.19/client-server-api/#server-access-control-lists-acls-for-rooms` | enforcement: each server MUST refuse events from denied servers; effective only if every server in the room complies. |

## Outside world

| Feature | What the user gets and how it works | Citation | Server role today |
|---|---|---|---|
| Third-party invites | Invite by email or similar: `POST /rooms/{roomId}/invite` with `id_server`, `medium`, `address`. If the identity server knows a Matrix ID, a normal invite follows; if not, it stores the invite and the homeserver emits `m.room.third_party_invite` with a token and public key. On later binding the invitee's server exchanges it for a signed `m.room.member` invite. | `modules/third_party_invites.md` "Third-party invites", "Server behaviour". U: `https://spec.matrix.org/v1.19/client-server-api/#third-party-invites` | identity: an identity server maps address to user, holds pending invites and signs the proof. discovery: lookup. enforcement: all servers verify the signature; the admitting server also checks `key_validity_url`. |
| Third-party networks (bridges) | Application services bridge other platforms into rooms. Clients query `GET /thirdparty/protocols`, `/protocol/{protocol}`, `/location[/{protocol}]`, `/user[/{protocol}]` to find bridged locations and users. | `modules/third_party_networks.md` "Third-party Networks"; `data/api/client-server/third_party_lookup.yaml`. U: `https://spec.matrix.org/v1.19/client-server-api/#third-party-networks` | discovery: answers lookups from its application services. relay: the application service ferries messages both ways. |

## What depends on a server most

- Push notifications: a sleeping device can only be woken by an always-on party that sees each event, evaluates the rules and calls the gateway (`modules/push.md` "Server behaviour").
- Offline delivery and history: `/sync`, event context, search, thread lists and bundled aggregations all assume one store that has the whole ordered timeline and answers on demand.
- Media: `mxc://` names the origin server, not the content; bytes exist only while that server, or a cache of it, is up.
- History visibility, previews, guest access, ignore lists and invite blocking are filters applied by the server at read time; nothing in the events themselves stops a peer holding the data from reading it.
- Presence and typing: the server aggregates devices, runs the idle and typing timeouts, and fans out; neither is in the event graph.
- Private read receipts, fully-read markers, tags, `m.direct`, push rules and all account data rely on a private per-user store that syncs devices.
- Identity functions: device registry and token revocation, SSO, OpenID, guest accounts, admin suspend and lock, server notices all make the homeserver the authority for the account.
- Third-party invites need an identity server online to look up, store and sign; policy servers need a designated signer online for every event.
- Restricted joins need a server already in the room to verify and vouch for the join.
- Room upgrades and space hierarchy are multi-step jobs the server performs for the user, including cross-server fetches.

Least dependent: replies, edits, reactions, threads, references, mentions metadata, stickers, image packs, policy lists and space links are plain signed events that clients already interpret themselves; the server only stores, orders and bundles them.


---

# C. Matrix v1.19 data model and federation

Source: local clone of the Matrix spec, release v1.19. Nothing here is written from memory; where the spec is silent or inconsistent it is marked **[silent]** or **[ambiguous]**.

## Citation legend

Every citation is `[FILE "Heading" #anchor]`. The rendered URL is the file's base URL plus the anchor.

| Tag | Spec file | Rendered base URL |
|---|---|---|
| SS | `content/server-server-api.md` | https://spec.matrix.org/v1.19/server-server-api/ |
| V12 | `content/rooms/v12.md` (with `content/rooms/fragments/*`) | https://spec.matrix.org/v1.19/rooms/v12/ |
| V11 | `content/rooms/v11.md` | https://spec.matrix.org/v1.19/rooms/v11/ |
| RV | `content/rooms/_index.md` | https://spec.matrix.org/v1.19/rooms/ |
| APP | `content/appendices.md` | https://spec.matrix.org/v1.19/appendices/ |
| API | `data/api/server-server/*.yaml` (rendered inline in SS under the endpoint anchor) | https://spec.matrix.org/v1.19/server-server-api/ |
| CS | `content/client-server-api/_index.md`, `data/event-schemas/schema/*.yaml` | https://spec.matrix.org/v1.19/client-server-api/ |

Heading anchors are those the spec itself links to where available. Endpoint anchors (`#get_matrix...`) follow the spec's own pattern; those the spec text does not itself link to are inferred from that pattern and were not checked against the rendered site.

---

## 1. Room as a replicated event graph

1. Three kinds of server-to-server traffic exist. PDUs are "broadcast from one homeserver to any others that have joined the same room", are persisted, and "record the history of messages and state for a room". EDUs are pushed between pairs of servers, "are not persisted and are not part of the history of a room". Queries are single request/response snapshots. [SS front-matter description, top of page]
2. EDUs "do not have an ID, a room ID, or a list of 'previous' IDs". An EDU is `{edu_type, content}`. [SS "EDUs" #edus; API `definitions/edu.yaml`]
3. Delivery responsibility: "it is the responsibility of the originating server of a PDU to deliver that event to its recipient servers", but because PDUs are signed by the origin they can be delivered "through third-party servers". [SS front-matter]
4. Each PDU contains one room event. `prev_events` "identifies the 'parents' of the event, and thus establishes a partial ordering on events within the room by linking them into a Directed Acyclic Graph". The sender "should populate this field with all of the events in the room for which it has not yet seen a child". [SS "PDUs" #pdus]
5. `auth_events` "identifies the set of events which give the sender permission to send the event". It is empty for `m.room.create`. [SS "Auth events selection" #auth-events-selection]
6. v12 PDU fields [V12 "Event format" #event-format; API `definitions/pdu_v12.yaml` and `components/*`]:

| Field | Definition in the schema | Required |
|---|---|---|
| `room_id` | Room identifier. "Omitted from `m.room.create` events." | yes (schema lists it as required; see ambiguity A1) |
| `sender` | User ID of the sender | yes |
| `origin_server_ts` | "Timestamp in milliseconds on origin homeserver when this event was created" | yes |
| `type` | Event type | yes |
| `state_key` | "If this key is present, the event is a state event, and it will replace previous events with the same `type` and `state_key` in the room state" | no |
| `content` | Object | yes |
| `prev_events` | Event IDs of "the most recent events in the room that the homeserver was aware of". At most 20 | yes |
| `auth_events` | Event IDs of the authorising events. At most 10 | yes |
| `depth` | "The maximum depth of the `prev_events`, plus one." Less than 2^53 - 1; clamps at the limit | yes |
| `hashes` | `{sha256: <content hash>}` | yes |
| `signatures` | Map server name -> key ID -> signature | yes |
| `unsigned` | Data "not covered by the `signatures`", e.g. `age` | no |

7. `depth` and `origin_server_ts` are asserted by the origin. **[silent]** No check on receipt verifies either against `prev_events` or a clock; neither appears in the authorisation rules. `origin_server_ts` is nevertheless used as a tie-break in state resolution (section 4) and in key-validity checks (section 2).
8. State event vs message event: an event is a state event exactly when `state_key` is present. [API `components/pdu_base.yaml`]
9. Room state: "a map of `(event_type, state_key)` to `event_id`. Each room starts with an empty state, and each state event which is accepted into the room updates the state". [SS "Room State Resolution" #room-state-resolution]
10. State before and after an event: for message event E, S'(E) = S(E); for state event E, S'(E) is S(E) with the entry for E's `(event_type, state_key)` replaced by E's `event_id`. S(E) is the resolution of {S'(E_i)} over E's `prev_events`. [V12 "State resolution" #state-resolution]
11. Event ID (v4 through v12): "the reference hash of the event encoded using URL-safe unpadded Base64", prefixed with `$`. The event ID is not a field of the PDU; it is computed. [V12 "Event IDs" #event-ids; fragment `v4-event-ids.md`]
12. Room ID (v12): "the event ID of the `m.room.create` event using `!` as the sigil instead of `$`". The create event carries no `room_id` (auth rule 1.2 rejects one that does). [APP "Room IDs" #room-ids; V12 "Authorisation rules" #authorisation-rules]
13. Size: a complete event "MUST NOT be larger than 65536 bytes" as Canonical JSON in federation format including signatures; `state_key` and `type` at most 255 bytes each. [CS "Size limits" #size-limits]

## 2. Encoding, hashes, signatures, redaction, identifiers

### Canonical JSON

1. "The shortest UTF-8 JSON encoding with dictionary keys lexicographically sorted by Unicode codepoint." Numbers "must be integers in the range `[-(2**53)+1, (2**53)-1]`", no exponents or decimals, and "negative zero `-0` MUST NOT appear". Floats are not permitted. [APP "Canonical JSON" #canonical-json]
2. The grammar removes insignificant whitespace and redundant escapes; only `\b \t \n \f \r \" \\` and `\u000X`/`\u001X` for remaining ASCII control characters are escaped. [APP "Grammar" #grammar]
3. From room version 6, servers "MUST strictly enforce" this; over federation the non-conforming event is discarded. [V12 "Canonical JSON" #canonical-json; fragment `v6-canonical-json.md`]

### Content hash

4. Remove `unsigned`, `signatures` and `hashes`; encode as Canonical JSON; SHA-256. Stored unpadded-Base64 in `hashes.sha256`. It "covers the complete event including the unredacted contents". [SS "Calculating the content hash for an event" #calculating-the-content-hash-for-an-event; SS "Adding hashes and signatures to outgoing events" #adding-hashes-and-signatures-to-outgoing-events]

### Reference hash

5. (1) Redact the event. (2) Remove `signatures` and `unsigned`. (3) Canonical JSON. (4) SHA-256. Because `hashes` survives redaction, the reference hash commits to the content hash. [SS "Calculating the reference hash for an event" #calculating-the-reference-hash-for-an-event]

### Signing

6. Signing JSON: remove `signatures` and `unsigned`, encode canonically, sign, store the unpadded-Base64 signature at `signatures[entity][algorithm:key_id]`. The only supported algorithm is `ed25519`. "The `unsigned` object and the `signatures` object are not covered by the signature." [APP "Signing Details" #signing-details]
7. Signing an event: compute the content hash into `hashes`; redact the event; sign the redacted form with "the server's signing key"; copy the signature back onto the full event. [SS "Adding hashes and signatures to outgoing events" #adding-hashes-and-signatures-to-outgoing-events]
8. Who signs: "Events must be signed by the server denoted by the `sender` property." [V12 "Authorisation rules" #authorisation-rules]. No user or device key is involved in event signing.

### Checking

9. Checking a signature (seven steps): entry for the entity exists; drop unknown algorithms; look up verification keys "either from a local cache or by consulting a trusted key server"; decode Base64; remove `signatures` and `unsigned`; encode canonically; verify. Any failure fails the check. [APP "Checking for a Signature" #checking-for-a-signature]
10. On a received event: redact, then check signatures "from the originating server". "For room versions 3 and later, unless the event is a 3rd party invite, only the signature(s) from the originating server (the server the `sender` belongs to) are required." Signatures from unknown or expired keys are skipped; keys "known to have expired prior to the event's `origin_server_ts` are ignored". [SS "Validating hashes and signatures on received events" #validating-hashes-and-signatures-on-received-events]
11. Then the content hash is recomputed and compared. "If the hash check fails, then it is assumed that this is because we have only been given a redacted version"; the receiver "should use the redacted copy it calculated rather than the full copy it received". A hash mismatch is therefore not a rejection. [same heading]
12. Key validity (v5+): `valid_until_ts` from the key response must be "at least as large as the `origin_server_ts`" of the event; servers "MUST use the lesser of `valid_until_ts` and 7 days into the future". [V12 "Signing key validity period" #signing-key-validity-period; fragment `v5-signing-requirements.md`]

### Redaction algorithm (v11 and v12)

13. Top-level keys that survive: `event_id`, `type`, `room_id`, `sender`, `state_key`, `content`, `hashes`, `signatures`, `depth`, `prev_events`, `auth_events`, `origin_server_ts`. [V12 "Redactions" #redactions; fragment `v11-redactions.md`]
14. `content` keys that survive, by type; all other content is stripped [same]:

| Type | Kept `content` keys |
|---|---|
| `m.room.member` | `membership`, `join_authorised_via_users_server`, and `third_party_invite.signed` |
| `m.room.create` | all keys |
| `m.room.join_rules` | `join_rule`, `allow` |
| `m.room.power_levels` | `ban`, `events`, `events_default`, `invite`, `kick`, `redact`, `state_default`, `users`, `users_default` |
| `m.room.history_visibility` | `history_visibility` |
| `m.room.redaction` | `redacts` |

15. Applying a redaction is separate from authorising the redaction event. A server applies it only when both events are seen and valid and either the redaction sender's power level is at least the redact level, or "the domain of the redaction event's `sender` matches that of the original event's `sender`". [V12 "Handling redactions" #handling-redactions; fragment `v3-handling-redactions.md`]
16. Redacted events still count in state: "a redacted `join` event will still result in the user being considered joined". [SS "Rejection" #rejection]

### Identifier grammar

| Identifier | Grammar | Citation |
|---|---|---|
| Server name | `hostname [ ":" port ]`; hostname is IPv4, bracketed IPv6, or DNS name of 1-255 chars from digits, letters, `-`, `.`. Case-sensitive | [APP "Server Name" #server-name] |
| User ID | `"@" localpart ":" server_name`; localpart non-empty from `a-z 0-9 . _ = - / +`; at most 255 bytes total. Historical IDs with other characters must still be accepted in events | [APP "User Identifiers" #user-identifiers; "Historical User IDs" #historical-user-ids] |
| Room ID | `!opaque_id`; in v12 the create event's ID with sigil `!`; earlier versions `!localpart:domain`, at most 255 bytes | [APP "Room IDs" #room-ids] |
| Event ID | `$opaque_id`; v4+ URL-safe unpadded Base64 of the reference hash; at most 255 bytes; case-sensitive | [APP "Event IDs" #event-ids] |
| Room alias | `#room_alias:domain`; localpart any non-surrogate codepoint except `:` and NUL; at most 255 bytes | [APP "Room Aliases" #room-aliases] |
| Signing key ID | `algorithm:version`, version matching `[a-zA-Z0-9_]` | [API `definitions/keys.yaml`, rendered at SS #get_matrixkeyv2server] |
| Device ID | **[silent]** in the appendices; no grammar is given there | - |
| Room version | 1-32 codepoints from `a-z 0-9 . -`; opaque, unordered | [RV "Room version grammar" #room-version-grammar] |

## 3. Authorisation rules, room version 12

Source for this whole section: [V12 "Authorisation rules" #authorisation-rules], except where noted. Numbering follows the rendered page.

### Preliminaries

- The auth-relevant state types are `m.room.create`, `m.room.member`, `m.room.join_rules`, `m.room.power_levels`, `m.room.third_party_invite`.
- "Power levels are inferred from defaults when not explicitly supplied."
- Room creators: the `sender` of `m.room.create` plus any user IDs in `content.additional_creators`. Their power level "is infinitely high" and they "cannot be demoted".
- Definitions [SS "Definitions" #definitions]: required power level of a type comes from `events`, else `state_default` (state events) or `events_default` (others). Invite level defaults to 0; kick, ban and redact levels default to 50. Target user is the `state_key` of an `m.room.member` event.
- Further defaults [CS `m.room.power_levels` #mroompower_levels]: `users_default` 0, `events_default` 0, `state_default` 50. That schema also says that with no power-levels event "the room's creator has a power level of 100"; in v12 the creator rule above supersedes this.
- The redact level "is **not** considered by the auth rules".
- "The `m.room.create` event MUST NOT be selected for `auth_events`"; the `room_id` implies it.

### Auth events selection

[SS "Auth events selection" #auth-events-selection] For a non-create event, `auth_events` should be this subset of room state: the create event (not in v12); the current `m.room.power_levels`, if any; the sender's current `m.room.member`, if any; and, when the type is `m.room.member`: the target's current member event, if any; the current `m.room.join_rules` if `membership` is `join`, `invite` or `knock`; the `m.room.third_party_invite` whose `state_key` matches `content.third_party_invite.signed.token` if membership is `invite` with a `third_party_invite`; the member event of `content.join_authorised_via_users_server` if membership is `join` and that key is present.

### The rules

1. If type is `m.room.create`:
   1. If it has any `prev_events`, reject.
   2. If the event has a `room_id`, reject.
   3. If `content.room_version` is present and is not a recognised version, reject.
   4. If `additional_creators` is present in `content` and is not an array of strings each passing the same user ID validation applied to `sender`, reject.
   5. Otherwise, allow.
2. If the event's `room_id` is not an event ID for an accepted (not rejected) `m.room.create` event, with the sigil `!` instead of `$`, reject.
3. Considering the event's `auth_events`:
   1. If there are duplicate entries for a given `type` and `state_key` pair, reject.
   2. If there are entries whose `type` and `state_key` don't match those specified by the auth events selection algorithm, reject. (`m.room.create` must not be selected.)
   3. If there are entries which were themselves rejected under the checks performed on receipt of a PDU, reject.
   4. If any event in `auth_events` has a `room_id` which does not match that of the event being authorised, reject. (The source numbers this item "5"; see A2.)
4. If the `content` of the `m.room.create` event in the room state has `m.federate` set to `false`, and the `sender` domain of the event does not match the `sender` domain of the create event, reject.
5. If type is `m.room.member`:
   1. If there is no `state_key` property, or no `membership` property in `content`, reject.
   2. If `content` has a `join_authorised_via_users_server` key: if the event is not validly signed by the homeserver of the user ID denoted by the key, reject.
   3. If `membership` is `join`:
      1. If the only previous event is an `m.room.create` and the `state_key` is the sender of the `m.room.create`, allow.
      2. If the `sender` does not match `state_key`, reject.
      3. If the `sender` is banned, reject.
      4. If the `join_rule` is `invite` or `knock` then allow if membership state is `invite` or `join`.
      5. If the `join_rule` is `restricted` or `knock_restricted`:
         1. If membership state is `join` or `invite`, allow.
         2. If the `join_authorised_via_users_server` key in `content` is not a user with sufficient permission to invite other users or is not a joined member of the room, reject.
         3. Otherwise, allow.
      6. If the `join_rule` is `public`, allow.
      7. Otherwise, reject.
   4. If `membership` is `invite`:
      1. If `content` has a `third_party_invite` property:
         1. If target user is banned, reject.
         2. If `content.third_party_invite` does not have a `signed` property, reject.
         3. If `signed` does not have `mxid` and `token` properties, reject.
         4. If `mxid` does not match `state_key`, reject.
         5. If there is no `m.room.third_party_invite` event in the current room state with `state_key` matching `token`, reject.
         6. If `sender` does not match `sender` of the `m.room.third_party_invite`, reject.
         7. If any signature in `signed` matches any public key in the `m.room.third_party_invite` event, allow. The keys are in its `content` as a single `public_key` and a list `public_keys`.
         8. Otherwise, reject.
      2. If the `sender`'s current membership state is not `join`, reject.
      3. If target user's current membership state is `join` or `ban`, reject.
      4. If the `sender`'s power level is greater than or equal to the invite level, allow.
      5. Otherwise, reject.
   5. If `membership` is `leave`:
      1. If the `sender` matches `state_key`, allow if and only if that user's current membership state is `invite`, `join`, or `knock`.
      2. If the `sender`'s current membership state is not `join`, reject.
      3. If the target user's current membership state is `ban`, and the `sender`'s power level is less than the ban level, reject.
      4. If the `sender`'s power level is greater than or equal to the kick level, and the target user's power level is less than the `sender`'s power level, allow.
      5. Otherwise, reject.
   6. If `membership` is `ban`:
      1. If the `sender`'s current membership state is not `join`, reject.
      2. If the `sender`'s power level is greater than or equal to the ban level, and the target user's power level is less than the `sender`'s power level, allow.
      3. Otherwise, reject.
   7. If `membership` is `knock`:
      1. If the `join_rule` is anything other than `knock` or `knock_restricted`, reject.
      2. If `sender` does not match `state_key`, reject.
      3. If the `sender`'s current membership is not `ban`, `invite`, or `join`, allow.
      4. Otherwise, reject.
   8. Otherwise, the membership is unknown. Reject.
6. If the `sender`'s current membership state is not `join`, reject.
7. If type is `m.room.third_party_invite`: allow if and only if `sender`'s current power level is greater than or equal to the invite level.
8. If the event type's required power level is greater than the `sender`'s power level, reject.
9. If the event has a `state_key` that starts with an `@` and does not match the `sender`, reject.
10. If type is `m.room.power_levels`:
    1. If any of `users_default`, `events_default`, `state_default`, `ban`, `redact`, `kick`, or `invite` in `content` are present and not an integer, reject.
    2. If either of `events` or `notifications` in `content` are present and not an object with values that are integers, reject.
    3. If the `users` property in `content` is not an object with keys that are valid user IDs with values that are integers, reject.
    4. If the `users` property in `content` contains the `sender` of the `m.room.create` event or any of the `additional_creators` (if present), reject.
    5. If there is no previous `m.room.power_levels` event in the room, allow.
    6. For `users_default`, `events_default`, `state_default`, `ban`, `redact`, `kick`, `invite`, check if they were added, changed or removed. For each alteration: (1) if the current value is higher than the `sender`'s current power level, reject; (2) if the new value is higher than the `sender`'s current power level, reject.
    7. For each entry being changed in, or removed from, `events` or `notifications`: if the current value is greater than the `sender`'s current power level, reject.
    8. For each entry being added to, or changed in, `events` or `notifications`: if the new value is greater than the `sender`'s current power level, reject.
    9. For each entry being changed in, or removed from, `users`, other than the `sender`'s own entry: if the current value is greater than or equal to the `sender`'s current power level, reject.
    10. For each entry being added to, or changed in, `users`: if the new value is greater than the `sender`'s current power level, reject.
    11. Otherwise, allow. (The source numbers this second "10"; see A2.)
11. Otherwise, allow.

### Consequences stated by the spec

- A non-member may only join a public room, or accept or reject an invitation (apart from the initial create/join).
- To unban, power level must be at least both the kick and ban levels and greater than the target's.
- Kick and ban require the target's level to be strictly less than the sender's (5.5.4, 5.6.2). Creators, being infinite, can therefore never be kicked or banned by a non-creator. **[silent]** The spec does not say how two infinite levels compare (creator against creator under 5.5.4, 5.6.2, 10.9).
- **[ambiguous]** Rule 5.3.5.2 reads "is not a user with sufficient permission to invite", with no separate rule for an absent key under a restricted join rule; an absent key presumably fails this test, but the text does not say so.
- **[ambiguous]** Rule 10.3 as written rejects when `users` is absent ("is not an object"), whereas 10.1 and 10.2 say "present and not". Whether an absent `users` is rejected is not stated.

## 4. State resolution (v2 algorithm as modified in v12)

Source: [V12 "State resolution" #state-resolution; "Definitions" #definitions; "Algorithm" #algorithm; "Rejected events" #rejected-events].

### Definitions

1. Input: a set of room states {S_1, S_2, ...}, each a map from `(event_type, state_key)` to a state event.
2. Power event: a state event of type `m.room.power_levels` or `m.room.join_rules`, or an `m.room.member` whose `membership` is `leave` or `ban` and whose `sender` does not match the `state_key`.
3. Unconflicted state map: pairs (K, V) where K "is present in every S_i with the same value V". Conflicted state set: every other V. A key present in only some S_i is therefore conflicted.
4. Auth chain of E: all of E's auth events, recursively, "stretching back to the start of the room".
5. Auth difference: with C_i the union of the auth chains of all events in S_i, the auth difference is the union of the C_i minus their intersection.
6. Conflicted state subgraph (new in v12): "the union of all such paths between any pair of events in the conflicted state set (including endpoints)" along `auth_events` edges.
7. Full conflicted set (changed in v12): "the union of the conflicted state set, the conflicted state subgraph, and the auth difference".
8. Reverse topological power ordering: "the lexicographically smallest topological ordering based on the DAG formed by auth events", earliest first, where x < y if (a) x's sender has greater power level than y's sender "when looking at their respective `auth_event`s"; or (b) equal power and x's `origin_server_ts` is less; or (c) equal power and timestamp and x's `event_id` is less. Computable with Kahn's algorithm, picking the smallest candidate at each step.
9. Mainline of a power-levels event P: the list P_0 = P, P_1, ..., P_n obtained by repeatedly taking the `m.room.power_levels` event in the `auth_events` of P_i. The mainline position of an event e is the index i of the first power-levels event reached by walking the same way from e (starting from e's auth events, not e itself) that lies on P's mainline; infinity if none.
10. Mainline ordering based on P: x < y if (a) x's mainline position is greater than y's; or (b) equal positions and x's `origin_server_ts` is less; or (c) equal positions and timestamps and x's `event_id` is less.
11. Iterative auth checks: given an initial state and a sorted list of state events, apply each event to the state "if the state event is allowed by the authorisation rules"; otherwise ignore it. If a key needed by the rules "is not present in the state, then the appropriate state event from the event's `auth_events` is used if the auth event is not rejected".

### Algorithm

1. Let X be all power events in the full conflicted set. For each such P, add "the events in the auth chain of P which also belong to the full conflicted set". Sort X by reverse topological power ordering.
2. Apply iterative auth checks to that list, "starting from an *empty* state map" (v12; earlier versions started from the unconflicted state map), giving a partially resolved state.
3. Take all remaining events of the full conflicted set and order them "by the mainline ordering based on the power level in the partially resolved state".
4. Apply iterative auth checks to the partial state and that list.
5. Replace any entry "with the event with the same key from the *unconflicted state map*, if such an event exists". The result is the resolved state.

### Rejected events

6. Events rejected for failing auth "based on the state at the event (rather than based on their auth chain) are handled as usual by the algorithm". Events rejected against their auth chain should not appear at all. "Rejected auth events are deliberately excluded from use in the iterative auth checks, as auth events aren't re-authed."

### What the spec says about determinism and convergence

7. There is no convergence theorem and no stated determinism guarantee. The only statements are informal: including state-rejected events "helps ensure that different servers' view of state is more likely to converge", and "Convergence of state is a desirable property as it ensures that all users in the room have a (mostly) consistent view". Divergence "can lead to bifurcation of the room". [V12 "Rejected events" #rejected-events, rationale box]
8. The threat model lists "Unrecoverable Consistency Violations" (a "split-brain" state) as a threat without stating a mitigation. [APP "Threat: Unrecoverable Consistency Violations" #threat-unrecoverable-consistency-violations]
9. Inputs the result depends on, as far as the text determines them: the set of state maps; the `auth_events` graph of every event in them (hence the server must hold the full auth chains); each event's `sender`, `type`, `state_key`, `content`, `origin_server_ts` and `event_id`; the authorisation rules of the room version; and each auth event's rejected or not-rejected status. The last is local knowledge: the rationale admits "rejection state of an event may be different" between servers.
10. **[silent]** Which power-levels event step 3 uses when the partial state has none (all mainline positions would be infinite). **[silent]** How step 2, from an empty state, finds the create event in v12, since the fallback is "the event's `auth_events`" and v12 forbids the create event there; presumably via `room_id`, but the text does not say. **[silent]** How "power level of the sender when looking at their respective auth_events" treats v12 creators; presumably infinite. **[silent]** Behaviour if a needed auth event is missing locally.

## 5. Room versions

[RV "Complete list of room versions" #complete-list-of-room-versions; RV "Feature matrix" #feature-matrix; per-version files `content/rooms/vN.md`]

| Version | What changed | Stable | Default |
|---|---|---|---|
| 1 | Initial version; original state resolution; event IDs `$random:domain` | yes | no |
| 2 | State Resolution Version 2 | yes | no |
| 3 | Event ID is the reference hash (standard Base64); redaction conditions leave the auth rules and become "handling redactions" | yes | no |
| 4 | Event ID uses URL-safe Base64 | yes | no |
| 5 | Enforces signing key validity periods (`valid_until_ts`) | yes | no |
| 6 | Strict Canonical JSON; `m.room.aliases` special rule and redaction meaning removed; `notifications` power-level checks added | yes | no |
| 7 | Knocking (`knock` join rule and membership) | yes | no |
| 8 | `restricted` join rule, `join_authorised_via_users_server`; flagged as having redaction issues, v9 preferred | yes | no |
| 9 | Redaction keeps `join_authorised_via_users_server` | yes | no |
| 10 | Integer-only power levels; `knock_restricted` join rule | yes | no |
| 11 | Redaction clarified: `origin`, `membership`, `prev_state` no longer kept; create keeps all `content`; redaction keeps `redacts`; power levels keeps `invite`. `creator` dropped from create content | yes | no |
| 12 | Room ID is hash of create event; creators with infinite power and `additional_creators`; state resolution changes (empty start, conflicted state subgraph) | yes | **yes** |

"Servers SHOULD use **room version 12** as the default room version when creating new rooms." Versions have "no implicit ordering or hierarchy" and their principles "are immutable once placed in the specification". [RV intro and #complete-list-of-room-versions]

## 6. Federation mechanics

### Discovery and transport

1. Transport is JSON over HTTPS; the destination "must provide a TLS certificate signed by a known Certificate Authority". [SS "TLS" #tls]
2. Resolving a server name, in order: (1) IP literal: use it, port given or 8448. (2) Hostname with explicit port: resolve by CNAME/AAAA/A. (3) Otherwise fetch `https://<hostname>/.well-known/matrix/server`; if valid, `m.server` gives a delegated host, resolved by literal, explicit port, SRV `_matrix-fed._tcp`, deprecated SRV `_matrix._tcp`, then address records with port 8448. (4) If well-known failed: SRV `_matrix-fed._tcp.<hostname>`. (5) Deprecated SRV `_matrix._tcp.<hostname>`. (6) Address records, port 8448. The certificate must be valid for the delegated hostname in step 3 and for the original hostname in steps 4-6. [SS "Resolving server names" #resolving-server-names]
3. The spec's reason for requiring the certificate: "DNS is insecure (not all domains have DNSSEC), so the target of the delegation must prove that it is a valid delegate for `<hostname>` via TLS." Server identity therefore rests on DNS plus the public CA system. [same]
4. Key publication: each server publishes `verify_keys` (valid for requests and events) and `old_verify_keys` (events only, with `expired_ts`) plus `valid_until_ts` at `GET /_matrix/key/v2/server`, self-signed. [SS "Publishing Keys" #publishing-keys; API `definitions/keys.yaml`]
5. Notaries: any server may be queried at `/_matrix/key/v2/query` for another server's keys; the notary "will additionally sign the response". A server "may query multiple notary servers to ensure that they all report the same public keys"; "each server is free to pick which notary servers they trust". Notaries may serve cached keys for offline servers. [SS "Retrieving server keys" #retrieving-server-keys; "Querying Keys Through Another Server" #querying-keys-through-another-server]
6. Domain takeover: "the new controller of the domain can masquerade as the previous owner". [SS "Security considerations" #security-considerations]

### Request authentication

7. Every request is signed: the JSON `{method, uri, origin, destination, content}` is signed with the origin's key and sent as `Authorization: X-Matrix origin=...,destination=...,key=...,sig=...`. A `destination` that does not match the receiver gets 401. [SS "Request Authentication" #request-authentication]
8. **[ambiguous]** The parameter list names the fourth parameter `signature`; the example header and code use `sig`. [same]
9. Responses are authenticated only by the TLS server certificate. [SS "Response Authentication" #response-authentication]

### Transactions

10. `PUT /_matrix/federation/v1/send/{txnId}` carries `origin`, `origin_server_ts`, at most 50 PDUs and at most 100 EDUs. A transaction "is meaningful only to the pair of homeservers that exchanged it". The sender "must wait and retry for a 200 OK response before sending a transaction with a different `txnId`". The response reports a per-event result; a rejected PDU must not fail the transaction. [SS "Transactions" #transactions; API `transactions.yaml` #put_matrixfederationv1sendtxnid; SS "Rejection" #rejection]

### Checks on a received PDU

11. In order [SS "Checks performed on receipt of a PDU" #checks-performed-on-receipt-of-a-pdu]:

| # | Check | On failure |
|---|---|---|
| 1 | Valid per the room version's event format | dropped |
| 2 | Signature checks | dropped |
| 3 | Hash checks | "redacted before being processed further" |
| 4 | Auth rules against the event's own `auth_events` | rejected |
| 5 | Auth rules against the state before the event | rejected |
| 6 | Auth rules against the current state of the room | soft failed |
| 7 | Policy Server validation, if the room uses one (added v1.18) | soft failed |

12. Rejected: "should neither be relayed to clients nor be included as a prev event in any new events generated by the server". Later events that reference it "should be allowed if they still pass the auth rules"; state is computed without the rejected event. [SS "Rejection" #rejection]
13. Soft failed: "should not be relayed to the client nor be referenced by new events created by the homeserver", but otherwise handled as usual and participates in state resolution. "Current state" means "the resolved state across all forward extremities", which is per-server and arrival-order dependent. [SS "Soft failure" #soft-failure]

### Fetching history and state

14. `GET /backfill/{roomId}`: starting from event IDs `v`, returns those PDUs and the ones that preceded them, up to `limit`. The requester picks a server it "thinks may have more". [SS "Backfilling and retrieving missing events" #backfilling-and-retrieving-missing-events; API `backfill.yaml` #get_matrixfederationv1backfillroomid]
15. `POST /get_missing_events/{roomId}`: "a breadth-first walk of the `prev_events` for the `latest_events`, ignoring any events in `earliest_events` and stopping at the `limit`" (default 10; `min_depth` default 0). [API `backfill.yaml` #post_matrixfederationv1get_missing_eventsroomid]
16. `GET /state/{roomId}?event_id=`: "the fully resolved state for the room, prior to considering any state changes induced by the requested event", with the full auth chain. `GET /state_ids/{roomId}` returns the same as IDs. `GET /event/{eventId}` returns one event. `GET /event_auth/{roomId}/{eventId}` returns an event's auth chain. [SS "Retrieving events" #retrieving-events; SS "Retrieving event authorisation information" #retrieving-event-authorisation-information; API `events.yaml`, `event_auth.yaml`]
17. **[silent]** The spec does not say what a server must do to verify a `/state` answer, nor when to call `/get_missing_events` versus `/state_ids` for a gap.

### Joining

18. A server already in the room generates, signs and emits the member event itself. Otherwise: `/query/directory` (alias to room ID and candidate servers), `GET /make_join/{roomId}/{userId}?ver=` (resident returns an event template and `room_version`), then `PUT /send_join`. [SS "Joining Rooms" #joining-rooms; API `joins-v1.yaml` #get_matrixfederationv1make_joinroomiduserid]
19. Before signing the template the joining server MUST verify `room_id`, `sender`, `state_key`, `type` and `content.membership`; otherwise discard. It adds or replaces `origin`, `origin_server_ts` and `event_id`. [same]
20. `PUT /v2/send_join/{roomId}/{eventId}`: the resident validates (signature, type `m.room.member`, membership `join`, sender on the origin server, `state_key` equals `sender`), "adds its signature to this event and accepts it into the room's event graph", sends it to the other servers, and returns `state` ("the resolved current room state prior to the join event") and `auth_chain`. [SS "Joining Rooms" #joining-rooms; API `joins-v2.yaml` #put_matrixfederationv2send_joinroomideventid]
21. Partial-state join: `omit_members=true` (added v1.6) lets the resident omit `m.room.member` events from `state` and redundant events from `auth_chain`, setting `members_omitted` and returning `servers_in_room`. **[silent]** v1.19 has no "faster joins" section; it does not say how the joiner later completes the state or authorises events while it lacks members. [API `joins-v2.yaml`]
22. Restricted rooms: the resident must check the joiner satisfies a condition of `m.room.join_rules`; errors `M_UNABLE_TO_AUTHORISE_JOIN`, `M_UNABLE_TO_GRANT_JOIN`, or 403. The server owning `join_authorised_via_users_server` must sign the event. [SS "Restricted rooms" #restricted-rooms; API `joins-v2.yaml`]
23. The joiner trusts the resident for the initial state. The spec acknowledges "a third server gives an incorrect version of the state when a server joins a room via it (either due to being faulty or malicious)". [V12 "Rejected events" #rejected-events]

### Invites, knocks, leaves

24. Invite: for a remote user, `PUT /v2/invite/{roomId}/{eventId}` sends the invite event, `room_version` and `invite_room_state`; the invited server validates and signs. "Once the event has been signed by both the inviting homeserver and the invited homeserver, it can be sent to all of the servers in the room." [SS "Inviting to a room" #inviting-to-a-room; API `invites-v2.yaml` #put_matrixfederationv2inviteroomideventid]
25. Knock: `/make_knock` and `/send_knock`, mirroring the join handshake, with the same template checks and resident validation. Knocks are retracted by leaving. [SS "Knocking upon a room" #knocking-rooms; API `knocks.yaml`]
26. Leave or reject: `/make_leave` then `/send_leave`, because a remote invite or knock "do[es] not involve the server in the graph". [SS "Leaving Rooms (Rejecting Invites)" #leaving-rooms-rejecting-invites]
27. Third-party invites: an identity server binds an email or phone to a Matrix ID; the room stores its public keys in `m.room.third_party_invite`, and the later invite is checked against those keys "without having to rely on a third-party server". [SS "Third-party invites" #third-party-invites; "Verifying the invite" #verifying-the-invite]

### EDUs

| EDU | Meaning and receiver duty | Citation |
|---|---|---|
| `m.typing` | `{room_id, user_id, typing}`; receiver should verify the user is in the room and belongs to the sending server | [SS "Typing Notifications" #typing-notifications] |
| `m.presence` | Presence updates for users the receiver "would be interested in" | [SS "Presence" #presence] |
| `m.receipt` | Per room, per user: the event read up to, with `ts` and optional `thread_id`; only listed entries are updated | [SS "Receipts" #receipts] |
| `m.device_list_update` | One device change per EDU, with `stream_id` and `prev_id`, forming a DAG; an unknown `prev_id` forces a resync | [SS "Device Management" #device-management] |
| `m.signing_key_update` | A user's cross-signing keys changed | [SS "End-to-End Encryption" #end-to-end-encryption] |
| `m.direct_to_device` | To-device messages: user -> device (or `*`) -> body, with `message_id` for idempotence | [SS "Send-to-device messaging" #send-to-device-messaging] |

### Queries and directories

28. Devices and keys: `GET /user/devices/{userId}` (initial device list and `stream_id`), `POST /user/keys/query` (device identity keys), `POST /user/keys/claim` (one-time keys; "each one-time key is returned at most once"). These "proxy much of the client's request through to federation". [SS "Device Management" #device-management; "End-to-End Encryption" #end-to-end-encryption; API `user_devices.yaml`, `user_keys.yaml`]
29. `GET /query/directory` resolves an alias only on the server named in the alias; `GET /query/profile` only on the user's own server. [SS "Querying for information" #querying-for-information; API `query.yaml` #get_matrixfederationv1querydirectory]
30. Media: for `mxc://{ServerName}/{MediaID}`, "servers MUST download the media from `ServerName`" using `/_matrix/federation/v1/media/download` and `/media/thumbnail`. Media is not content-addressed; the only source is the origin server. [SS "Content Repository" #content-repository]
31. Public rooms: `GET`/`POST /publicRooms` list a server's own published directory; since v1.19 "the server determines the order of the rooms". [SS "Published Room Directory" #published-room-directory; API `public_rooms.yaml`]
32. Spaces: `GET /hierarchy/{roomId}`. [SS "Spaces" #spaces]

### Server ACLs

33. `m.room.server_acl` is evaluated per request: no ACL event, allow; IP literal with `allow_ip_literals` false, deny; match in `deny`, deny; match in `allow`, allow; otherwise deny. ACLs "do not restrict the events relative to the room DAG via authorisation rules, but instead act purely at the network layer". [CS `m.room.server_acl` #mroomserver_acl]
34. The listed federation endpoints (make/send join, leave, knock, invite, state, state_ids, backfill, event_auth, get_missing_events) MUST be protected; in `/send`, ACLs apply per PDU and to `m.typing` and `m.receipt`. [SS "Server Access Control Lists (ACLs)" #server-access-control-lists-acls]

### Policy servers (added v1.18)

35. A room uses a Policy Server when current state has a valid `m.room.policy` event (empty state key, string `via`, `public_keys.ed25519`) and the `via` server has at least one joined user. [SS "Determining if a Policy Server is enabled in a room" #determining-if-a-policy-server-is-enabled-in-a-room]
36. All servers "MUST ask that Policy Server for a signature before sending an event" via `POST /_matrix/policy/v1/sign`. The signature uses the key in room state, key ID `ed25519:policy_server`, so it can be checked offline. [SS "Validating Policy Server signatures" #validating-policy-server-signatures; API `room_policy.yaml` #post_matrixpolicyv1sign]
37. The recommendation "does *not* affect the authorization rules"; a missing or invalid signature leads to soft failure or refusing to send. The `m.room.policy` state event with empty state key is itself exempt. [same]

## 7. What a server does in the data model

| Role | What the homeserver concretely does | Citation |
|---|---|---|
| Storage | Persists PDUs, the full auth chains and state needed for auth and resolution; serves them at `/event`, `/state`, `/state_ids`, `/backfill`, `/get_missing_events`, `/event_auth` | [SS front-matter; #retrieving-events; #backfilling-and-retrieving-missing-events] |
| Ordering | Sets `prev_events` to its forward extremities, `depth`, and `origin_server_ts` on events it creates; computes resolved state at merges | [SS #pdus; V12 #state-resolution] |
| Relay | Origin delivers each PDU to every server in the room in transactions; resident relays joins, knocks, leaves; third parties may forward signed PDUs | [SS front-matter; #transactions; #joining-rooms] |
| Discovery | Resolves server names by well-known, SRV and DNS; resolves aliases it owns to room ID plus candidate servers; publishes a room directory | [SS #resolving-server-names; #querying-for-information; #published-room-directory] |
| Identity | Owns the user namespace `@local:domain`; holds the one signing key that signs every event of its users; publishes that key; serves its users' device lists and keys; answers profile queries | [V12 #authorisation-rules; SS #publishing-keys; #device-management] |
| Push / fan-out to clients | Decides what reaches its own clients: withholds rejected and soft-failed events, applies redactions. Push notification delivery itself is outside the files read **[silent here]** | [SS #rejection; #soft-failure; V12 #handling-redactions] |
| Media forwarding | Fetches remote media from the origin server named in the `mxc://` URI and serves it locally | [SS #content-repository] |
| Enforcement | Runs the seven receipt checks, auth rules, state resolution, server ACLs, restricted-join conditions, policy-server checks | [SS #checks-performed-on-receipt-of-a-pdu; #server-access-control-lists-acls; #policy-servers] |

### Guarantees by source

Hold from hashes and signatures alone, given the signer's public key:

1. Event integrity: the event ID is the hash of the redacted event, which contains the content hash; any change to a protected field changes the ID. [SS #calculating-the-reference-hash-for-an-event; V12 #event-ids]
2. Graph integrity: `prev_events` and `auth_events` are event IDs, so an event commits to its ancestry and its authorisation evidence. [API `components/auth_events_prev_events_v4.yaml`]
3. Room identity (v12): the room ID is the hash of the create event, so the creator set and room version are fixed by the ID. [APP #room-ids; V12 #authorisation-rules]
4. Origin authenticity at server granularity: the event was signed by a key of the sender's server. [SS #validating-hashes-and-signatures-on-received-events]
5. Authorisation relative to cited evidence: check 4 can be re-run by anyone holding the event and its auth chain. [SS #checks-performed-on-receipt-of-a-pdu]
6. Third-party-invite and policy-server signatures, whose keys live in room state. [SS #verifying-the-invite; #validating-policy-server-signatures]

Depend on trusting a server or outside infrastructure:

7. User authenticity. Events are "signed by the server denoted by the `sender`"; users hold no event-signing key. A homeserver can sign any event as any of its users, and nothing in the event distinguishes that from the user's act. [V12 #authorisation-rules]
8. The binding of server name to key rests on TLS certificate authorities, DNS, and optionally notaries the server chooses to trust. [SS #resolving-server-names; #retrieving-server-keys; #security-considerations]
9. Completeness and liveness: no mechanism proves a server returned all events, all state, or the true forward extremities; `/state`, `/backfill` and `send_join` answers are taken from the responding server. [V12 #rejected-events rationale; SS #backfilling-and-retrieving-missing-events]
10. Timestamps and depth: `origin_server_ts` and `depth` are unverified origin claims, yet timestamps break ties in state resolution. [V12 #definitions]
11. What a user sees: rejection relay, soft failure, redaction application and policy-server enforcement are local "should" decisions by the user's own server. [SS #rejection; #soft-failure]
12. Hash mismatch is recoverable, not fatal: a server may strip content and pass on the redacted form, which still verifies. Content availability therefore depends on the relaying server. [SS #validating-hashes-and-signatures-on-received-events]
13. EDUs, device lists, key queries, profiles and media carry no event signature; they are trusted on the authenticated request from the owning server. [SS #edus; #device-management; #content-repository]

## Ambiguities and inconsistencies found

- A1. `components/room_id_v12.yaml` marks `room_id` required yet says it is "Omitted from `m.room.create` events", and auth rule 1.2 rejects a create event that has one.
- A2. Source numbering in V12 auth rules: rule 3 items are numbered 1, 2, 3, 5; rule 10 has two items numbered 10. The v12 note says creator protection "is reflected in rule 10.4", which matches.
- A3. `Authorization` header: parameter list says `signature`, examples say `sig`.
- A4. `pdu_base.yaml` requires `depth` but defines it only in `depth_v6.yaml`; the join text still tells the joiner to set `origin`, a field absent from the v11/v12 PDU schema.
- A5. State resolution gaps listed in section 4, item 10.
- A6. Comparison of two infinite creator power levels is undefined (section 3).
- A7. No device ID grammar in the appendices; no "faster joins" procedure beyond the `omit_members` parameter.
- A8. Endpoint anchors not linked by the spec text itself are inferred, not verified against the rendered site.


---

# D. Encryption, calls and the three side APIs (Matrix v1.19)

Source: local clone at tag `v1.19` (commit b9c3d5ed). Proposals were read from GitHub on 2026-11-18 and are marked "proposal, not in v1.19".

Citation shorthand (file, then rendered base URL; the heading anchor follows `#`):

| Tag | Spec file | Rendered base |
|---|---|---|
| E2EE | `content/client-server-api/modules/end_to_end_encryption.md` | https://spec.matrix.org/v1.19/client-server-api/ |
| SEC | `content/client-server-api/modules/secrets.md` | same |
| TOD | `content/client-server-api/modules/send_to_device.md` | same |
| VOIP | `content/client-server-api/modules/voip_events.md` | same |
| PUSHMOD | `content/client-server-api/modules/push.md` | same |
| OLM | `content/olm-megolm/olm.md` | https://spec.matrix.org/v1.19/olm-megolm/olm/ |
| MEG | `content/olm-megolm/megolm.md` | https://spec.matrix.org/v1.19/olm-megolm/megolm/ |
| S2S | `content/server-server-api.md` | https://spec.matrix.org/v1.19/server-server-api/ |
| AS | `content/application-service-api.md` | https://spec.matrix.org/v1.19/application-service-api/ |
| IS | `content/identity-service-api.md` | https://spec.matrix.org/v1.19/identity-service-api/ |
| PG | `content/push-gateway-api.md` | https://spec.matrix.org/v1.19/push-gateway-api/ |

Anchors are derived from the headings in the source files; they were not each opened in a browser. Where a trust statement is my inference from the mechanism rather than a sentence in the spec, it is marked "(inferred)".

## 1. Encryption

The spec's own summary: rooms can be created "whose conversation contents are not decryptable or interceptable on any of the participating homeservers" (E2EE #end-to-end-encryption). The server still sees who talks to whom, when, in which room, event types of state events, and device lists.

| Item | What it does | Trust placed in the server | Citation | Server role today |
|---|---|---|---|---|
| Device identity keys | Each device has one Ed25519 signing key (its fingerprint) and, for Olm, one Curve25519 identity key. Public parts are uploaded as a self-signed JSON object with `/keys/upload`. | Server is the only directory. It cannot forge a device's signature, but "server admins can trivially create new devices for users"; only the cross-signing check exposes an injected device. It can also omit a device (inferred). | E2EE #device-keys, #uploading-keys, #recommended-client-behaviour | storage (public keys); discovery (`/keys/query`); identity (binds device to user ID) |
| One-time and fallback keys | Devices upload signed Curve25519 one-time keys; another user claims one per new Olm session via `/keys/claim`. A fallback key is handed out, unconsumed, when one-time keys run out. | Server must hand each one-time key out once; a server that reuses one, or exhausts them to force the fallback, enables replay ("sessions started using fallback keys could be vulnerable to replay attacks"). It cannot substitute keys, since they are signed by the device key. It can withhold. | E2EE #one-time-and-fallback-keys, #key-management-api | storage; enforcement (single-use); relay over federation |
| Key query | `/keys/query` returns a user's device keys and cross-signing keys; across servers it is proxied by federation. | Same as device identity keys: answers are signed by devices, completeness is not guaranteed. | E2EE #overview, #key-management-api; S2S #end-to-end-encryption | discovery; relay |
| Device list tracking | Clients cache each peer's device list and refresh on `device_lists.changed` in `/sync`, or `/keys/changes` after being offline. Between servers, `m.device_list_update` EDUs form a per-user chain, resynced with `/user/keys/query`. | Client depends entirely on the server to say that a list changed. A silent server leaves a new device without keys, or a removed device still receiving them (inferred). | E2EE #tracking-the-device-list-for-a-user, #e2e-extensions-to-sync; S2S #device-management | discovery; ordering (EDU chain); relay |
| Olm (`m.olm.v1.curve25519-aes-sha2`) | Pairwise double ratchet, an implementation of Signal's. Setup is Triple Diffie-Hellman over both identity keys and both one-time keys; a DH ratchet advances the root key on each reply and an HMAC chain yields one key per message. AES-256-CBC with 8-byte HMAC-SHA-256. | Server carries ciphertext only. Decrypted payload must name sender, recipient and both Ed25519 keys, which blocks unknown-key-share; clients MUST also prove the Curve25519 key belongs to the sender via cross-signing. Server can drop or delay; a dropped message corrupts the session, repaired with a new session and `m.dummy`. | OLM #the-olm-algorithm, #the-olm-protocol, #message-authentication-concerns; E2EE #molmv1curve25519-aes-sha2 | relay (to-device); none for content |
| Megolm (`m.megolm.v1.aes-sha2`): ratchet | Group ratchet: each sender has an outbound session of a 32-bit counter, an Ed25519 key and four 256-bit hash-ratchet parts that only wind forward. Each message is AES-CBC encrypted, MACed, and signed. | Ciphertext "can be stored on the (untrusted) server". Server can replay (clients must track indices), withhold, or show different members different messages ("Lack of Transcript Consistency"). It cannot move a message to another room because `room_id` is inside the ciphertext. | MEG #overview, #the-megolm-ratchet-algorithm, #limitations; E2EE #mmegolmv1aes-sha2 | storage (ciphertext events); ordering (room DAG); relay |
| Megolm: session sharing | The sender sends the session key in an `m.room_key` event, Olm-encrypted, to each recipient device. Receivers MUST accept sessions only over Olm. | Security reduces to the Olm channel and to the device list being honest. Sender SHOULD NOT send to non-cross-signed devices; it may send `m.room_key.withheld` instead. | E2EE #mmegolmv1aes-sha2, #reporting-that-decryption-keys-are-withheld; MEG #dependency-on-secure-channel-for-key-exchange | relay (to-device) |
| Megolm: rotation rules | Sender MUST start a new session after `rotation_period_ms` (recommended default one week) or `rotation_period_msgs` (100), when any user or device that may hold the key leaves, and (new in 1.19) when history visibility changes the `shared_history` flag. | Rotation is triggered by membership the client observes through the server; a server that hides a leave delays rotation (inferred). | E2EE #mmegolmv1aes-sha2; schema `data/event-schemas/schema/m.room.encryption.yaml` | ordering (membership state) |
| Megolm: new member | Can decrypt from the ratchet index they were given onward, not earlier, "without reversing the hash function". Earlier history arrives only by key bundle (history sharing), key forwarding from own devices, or backup. | None beyond the above. | MEG #the-megolm-ratchet-algorithm | none |
| Megolm: removed member | Keeps every key already received, so can still decrypt everything in those sessions, including later messages in a session not yet rotated (no backward secrecy). Cannot decrypt sessions created after rotation. | Server decides whether the departed user still receives ciphertext. | MEG #lack-of-backward-secrecy; E2EE #mmegolmv1aes-sha2 | enforcement (stops delivery after leave) |
| `m.room.encryption` | State event that turns encryption on and names the algorithm and rotation periods. | An ordinary state event, ordered and resolved by servers. The files read do not state whether it can be reversed; not verified here. | E2EE #mroomencryption | ordering; storage |
| `m.room.encrypted` | Wrapper event type for both Olm (to-device) and Megolm (room) ciphertext. Cleartext `sender_key` and `device_id` are deprecated since 1.3 and MUST NOT be used to identify the source because "a malicious server ... could change these values". | Envelope fields are untrusted; `session_id` is the lookup key. | E2EE #mroomencrypted, #mmegolmv1aes-sha2 | storage; relay |
| Encrypted attachments | File is encrypted with a single-use AES-256-CTR key and uploaded; the key, IV and SHA-256 of the ciphertext travel inside the Megolm-encrypted event. | Server stores an opaque blob. It cannot read it or alter it undetected (hash MUST be verified); it can delete or withhold. | E2EE #sending-encrypted-attachments | storage (media repository) |
| Cross-signing | Three Ed25519 keys per user: master (identity), self-signing (signs own devices), user-signing (signs other users' master keys, visible only to its owner). Verifying one master key covers all of a user's devices. | Server stores public keys and signatures and filters which signatures each user may see. It can present a replaced master key, so clients must notify on any change; it "could construct" a device ID colliding with a key ID, so clients MUST compare public keys, not IDs. Without out-of-band verification this is trust on first use. | E2EE #cross-signing, #key-and-signature-security | storage; discovery; enforcement (signature visibility) |
| Device verification: framework | `request`, `ready`, `start`, `done`, `cancel` messages. Between users they go in the direct-message room; between one user's devices, to-device. | "There is no way to do it within Matrix without trusting the administrators of the homeservers"; an out-of-band channel is required. Server only carries messages. | E2EE #device-verification, #key-verification-framework | relay |
| SAS (`m.sas.v1`) | Hash commitment, ephemeral Curve25519 ECDH, then both sides show a short string (decimal or emoji) the humans compare; MACs then bind the device and master keys. | A relaying server that interferes gets one guess in 2^n; a mismatch exposes it. | E2EE #short-authentication-string-sas-verification | relay |
| QR (`m.qr_code.*`, `m.reciprocate.v1`) | QR encodes both master keys and a random secret; one scan verifies both directions, the second by a human confirmation. | Same as SAS; the scan is the out-of-band channel. | E2EE #qr-codes | relay |
| Server-side key backup | Megolm session keys are encrypted to a Curve25519 backup public key (`m.megolm_backup.v1.curve25519-aes-sha2`: ephemeral ECDH, HKDF, AES-CBC) and uploaded under `/room_keys`. | Server cannot read keys. The MAC is computed over an empty string because of a libolm bug, so ciphertext is not authenticated (spec points to MSC4048); encryption is to a public key, so the server could insert entries (inferred). It can delete or roll back. Clients must check `auth_data` is signed by the master key. The `m.key_backup` on/off preference is "server-controlled". | E2EE #server-side-key-backups, #backup-algorithm-mmegolm_backupv1curve25519-aes-sha2, #key-backup-enabled-preference | storage; enforcement (which duplicate key to keep) |
| Secret storage (SSSS) | Secrets (cross-signing private keys, backup key) are AES-CTR encrypted and HMACed under a key from a recovery key or PBKDF2 passphrase, and kept in account data. | "The server should not be able to see" them. Server can withhold, delete, or serve an old copy (inferred); a weak passphrase is open to offline guessing by the server (inferred). | SEC #storage, #msecret_storagev1aes-hmac-sha2, #deriving-keys-from-passphrases | storage (account data) |
| Secret sharing | A device asks its sibling devices with `m.secret.request`; a verified sibling answers with Olm-encrypted `m.secret.send`. | Relay only. | SEC #sharing | relay (to-device) |
| Key requests and forwarding | A device missing a Megolm key sends `m.room_key_request`; another device may reply with `m.forwarded_room_key` or `m.room_key.withheld`. Only between verified devices of the same user. | Spec calls key sharing "a big attack vector"; safety rests on device verification, not the server. | E2EE #key-requests | relay (to-device) |
| History sharing between users (new in 1.19) | Before inviting, the inviter bundles the room's "shareable" sessions (`shared_history: true`), uploads the bundle as an encrypted attachment and sends `m.room_key_bundle` to the invitee's cross-signed devices. | Tracking the flag per session "prevents an attack where a malicious homeserver can incorrectly flag history as shared". The invitee has only the inviter's word for the keys. Server may expire the bundle. | E2EE #sharing-keys-between-users | storage (bundle blob); relay |
| Key export file | Manual passphrase-encrypted file of sessions (PBKDF2, AES-CTR, HMAC). | None; offline. | E2EE #key-exports | none |
| To-device messaging | `PUT /sendToDevice` delivers a message to named devices outside the room history, "exactly once"; the server queues until the device's next `/sync` and deletes on the following one. Between servers it is an `m.direct_to_device` EDU. | Server can drop, delay or reorder; content is opaque only when the client Olm-encrypts it. Sender user ID is asserted by the server. | TOD #send-to-device-messaging; S2S #send-to-device-messaging | storage (queue until delivered); relay; ordering (arrival order) |
| Dehydrated devices | Absent. No occurrence of "dehydrat" anywhere under `content/` or `data/` at v1.19. | n/a | none (grep) | none |

## 2. Voice and video, one to one

v1.19: "only two-party communication is supported ... Calls can take place in rooms with multiple members, but only two devices can take part" (VOIP #voice-over-ip). Signalling is ordinary room message events; media is WebRTC.

| Item | What it does | Citation | Server role today |
|---|---|---|---|
| `m.call.invite` | Caller sends an SDP offer with `call_id`, `party_id`, `version` and a `lifetime` in ms; optional `invitee` targets one user. Receivers judge validity from the event's `age`, so wrong client clocks do not matter; 90 s is the minimum recommended lifetime. | VOIP #mcallinvite, #call-event-liveness, #invitees | relay; ordering; storage (room event); the server supplies `age` |
| `m.call.candidates` | Batches of ICE candidates; an empty candidate marks the end. | VOIP #mcallcandidates, #ice-candidate-batching, #end-of-candidates | relay; storage |
| `m.call.answer` | Callee device sends the SDP answer. Several of the callee's devices may answer. | VOIP #mcallanswer, #client-behaviour | relay; storage |
| `m.call.select_answer` | Caller names the `selected_party_id` it chose; other answering devices stand down. | VOIP #mcallselect_answer | relay; storage |
| `m.call.negotiate` | Either side renegotiates mid-call with a new offer or answer and its own `lifetime`. The callee is the "polite" party, per WebRTC perfect negotiation. | VOIP #mcallnegotiate, #politeness | relay; storage |
| `m.call.sdp_stream_metadata_changed` | Announces mute state or stream purpose changes without renegotiation. | VOIP #streams | relay; storage |
| `m.call.reject` | Callee declines on all its devices. | VOIP #mcallreject | relay; storage |
| `m.call.hangup` | Ends the call with a `reason` (`ice_timeout`, `ice_failed`, `invite_timeout`, `user_hangup`, `user_media_failed`, `user_busy`, `unknown_error`). A peer leaving the room counts as a hangup. | VOIP #mcallhangup, #behaviour-on-room-leave | relay; storage |
| Party identifiers | Each device picks a `party_id` per call; a party is `(user_id, party_id)`. It separates a device's own echo, competing answers and candidate streams. | VOIP #party-identifiers | none |
| Glare | If both sides invite at once in the same room, the call with the lexicographically lesser `call_id` wins; a client still preparing its invite drops it and accepts the incoming one. | VOIP #glare | none (client rule; depends on both seeing both events) |
| ICE, STUN, TURN and `GET /_matrix/client/v3/voip/turnServer` | The homeserver "MAY provide a TURN server"; the endpoint returns `username`, `password`, `uris` (`turn:`/`turns:`) and `ttl`. STUN is not mentioned separately. | VOIP #server-behaviour; `data/api/client-server/voip.yaml` | discovery (TURN address); enforcement (issues short-lived TURN credentials) |
| Media path | Peer to peer by WebRTC, or through the TURN relay when direct paths fail. The homeserver never carries media. Codecs defer to the WebRTC spec. | VOIP #voice-over-ip, #supported-codecs | none (homeserver); media forwarding (TURN server, a separate always-on host) |
| Is media end-to-end encrypted | The module does not say. It only notes that signalling may be encrypted in an encrypted room. WebRTC itself mandates DTLS-SRTP between the two peers, and the fingerprints ride in the SDP, so media is end-to-end only as far as the signalling is authentic: in an unencrypted room the homeserver could swap fingerprints (inferred, not in the spec). | VOIP #call-event-liveness (only mention of encryption) | none |
| Security note | "Calls should only be placed to rooms with one other user in them", else another member can answer. | VOIP #security-considerations | none |

## 3. Group calls

### What v1.19 says

Nothing normative. A search of `content/` and `data/` for "MatrixRTC", "m.rtc", "m.call.member", "livekit", "group call", "SFU", "sticky" and "delayed event" finds only two things: the VoIP sentence above allowing one peer to be "a multi-point conferencing unit", and a passage in `content/proposals.md` (https://spec.matrix.org/v1.19/proposals/) using video conferencing as an example of something that could either be specified as SFU semantics or left to widgets. There is no MatrixRTC event, endpoint or key format in v1.19.

### Proposals (all "proposal, not in v1.19")

MSC4143, MSC4195 and MSC4354 are shown on GitHub as merged (accepted) on 20 to 21 October 2026, after v1.19 was cut; 4143 and 4195 carry the label "spec-pr-missing". MSC4140 is merged. MSC3401 is closed without merging.

| Item | What it does | Citation | Server role |
|---|---|---|---|
| Slot (MSC4143) | A room state event `m.rtc.slot`, state key `{application_type}#{application_slot_id}` (for example `m.call#room`), with `status` open or closed. It is the place a call can happen. | https://github.com/matrix-org/matrix-spec-proposals/pull/4143 | storage; ordering (room state) |
| Session and membership (MSC4143) | A session has no ID; it exists "through the temporal overlap of `m.rtc.member` events". Each participant device sends `m.rtc.member` with `slot_id`, a per-join random `member.id`, `application`, and `transports` (`published`, `can_subscribe`). | same | storage; ordering; relay |
| Sticky events (MSC4354) | `m.rtc.member` MUST be sent as a sticky event: a room event the server keeps delivering to joining or catching-up clients for a bounded time (one hour recommended; implementations cap at one hour). The client re-sends before expiry. Details beyond the PR page and implementation notes were not read. | https://github.com/matrix-org/matrix-spec-proposals/pull/4354 | storage; relay; enforcement (expiry) |
| Delayed events (MSC4140) | "Dead man's switch": the client schedules a leave event with `PUT /rooms/{roomId}/delayed_event/...` (`delay_ms`) and keeps calling `restart`. If the client vanishes, the homeserver holds the timer and sends the leave. | https://github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/4140-delayed-events-futures.md | enforcement (timer); ordering |
| Finding the transport (MSC4143) | `GET /_matrix/client/v1/rtc/transports` on the user's own homeserver returns an ordered list of transports. `.well-known` discovery is listed as a rejected alternative. | PR 4143 | discovery |
| LiveKit transport (MSC4195) | Transport object `{type: "m.livekit", url}` where `url` is the SFU WebSocket address. Each publisher SHOULD use its own homeserver's SFU and advertises it in its membership; subscribers connect to each publisher's SFU. "This approach removes the need for an SFU election process." | https://github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/4195-matrixrtc-livekit.md | discovery; media forwarding (SFU) |
| Authorising with the SFU (MSC4195) | Client calls `POST /_matrix/client/v1/rtc/livekit/get_token` with `url`, `room_id`, `slot_id`, `member_id`; the homeserver checks room membership and returns a LiveKit JWT. For another server's SFU the request is forwarded over federation. Room name and participant identity are unpadded base64 SHA-256 hashes of `[room_id, slot_id]` and `[sender, member.id]`. The server should eject participants who leave or are banned. | same | enforcement (membership check, token minting); identity; relay (federated token request) |
| Delegated leave (MSC4195) | `POST .../rtc/livekit/delegate_delayed_leave` lets the homeserver, informed by the SFU, keep restarting the delayed leave and fire it on disconnect. Works only with a local SFU. | same | enforcement |
| Media E2EE keys (MSC4143, MSC4195) | Type `m.per_member`: every member generates its own media key and sends it as an Olm-encrypted to-device `m.rtc.encryption_key` (`room_id`, `member_id`, `media_key{index,key}`) only to devices that sent a matching `m.rtc.member`. Keys rotate on membership change. LiveKit frame encryption derives keys by HKDF. Stated limitation: no per-sender authentication, so any key holder could forge another's frames. The SFU forwards encrypted frames and sees who sends to whom and when. | PR 4143; MSC4195 file | relay (to-device); media forwarding (SFU, ciphertext only) |
| Earlier design (MSC3401) | `m.call` and `m.call.member` state events; full mesh by default with `m.call.*` signalling sent to-device over Olm, optional `m.foci` for an SFU. Superseded by MSC4143. Read from the PR page only; the proposal file returned 404. | https://github.com/matrix-org/matrix-spec-proposals/pull/3401 | storage; relay |
| Element Call today | "Native Matrix video conferencing application" on MatrixRTC with a LiveKit SFU and a "MatrixRTC Authorization Service" (`lk-jwt-service`) that gives the client the SFU URL and a JWT. It runs standalone or as a widget inside Element Web and Element X. The README shows unstable names: `GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports` returning `rtc_transports` with `type: "livekit"` and `livekit_service_url`, and legacy `org.matrix.msc3401.call.member` state events with `foci_preferred`. It claims end-to-end encryption without describing it; TURN is not mentioned. | https://github.com/element-hq/element-call (README, branch `livekit`) | as above |

Always-on parties in this design: each participant's homeserver (membership events, sticky delivery, the leave timer, to-device key relay, token minting); at least one LiveKit SFU, publicly reachable, for every homeserver whose users publish media; the authorisation service that shares a secret with that SFU. There is no peer-to-peer media path in MSC4195; full mesh existed only in the unmerged MSC3401.

## 4. Application Service API

Purpose, in the spec's words: the other APIs "leave little room for custom server-side behaviour such as gateways, filters, or extensible hooks". In practice: bridges to other networks and bots. Application services "are passive and can only observe events"; they can inject events but not block or modify them.

| Item | What it does | Citation | Server role today |
|---|---|---|---|
| Registration | A YAML file given to the homeserver administrator with `id`, `url`, `as_token`, `hs_token`, `sender_localpart`, `namespaces`. HTTP self-registration was removed as a security risk. | AS #registration | enforcement (admin-configured trust); identity |
| Namespaces | Regexes over user IDs, room aliases and room IDs. "Exclusive" namespaces bar everyone else from creating entities there. User namespaces match local users only. | AS #registration | enforcement (namespace ownership) |
| Transactions | Homeserver pushes matching events, linearised, to `PUT /_matrix/app/v1/transactions/{txnId}` with the `hs_token`; it queues and retries with the same ID. Optional ephemeral data (presence, typing, receipts) since 1.13. | AS #pushing-events, #pushing-ephemeral-data | relay; ordering (linearises); storage (retry queue) |
| Queries | Homeserver asks the service whether an unknown user or alias in its namespace exists; the service creates it on demand while the homeserver blocks. | AS #querying | discovery; relay |
| Masquerading | Service calls the Client-Server API with its `as_token` plus `user_id` (and since 1.17 `device_id`) to act as any user in its namespace; `/register` with `m.login.application_service` creates passwordless users. Device and cross-signing management skip interactive auth. | AS #identity-assertion, #server-admin-style-permissions, #device-management, #cross-signing | identity (accepts the assertion); enforcement |
| Timestamp massaging | `ts` query parameter sets `origin_server_ts`; DAG order is unchanged. | AS #timestamp-massaging | ordering |
| Third-party lookups | Service declares protocols; clients search remote users and locations (for example IRC channels) through the homeserver, and the service can publish its own room directory. | AS #third-party-networks, #published-room-directories | discovery; relay |
| Ping | Round-trip check that the homeserver can reach the service (since 1.7). | AS #pinging | none |

Note for the design: an application service is a privileged co-process of one homeserver. On encryption the E2EE module says a bridge bot may encrypt on behalf of other users and clients must then show a warning (E2EE #recommended-client-behaviour).

## 5. Identity Service API

An identity server stores "identifier X represents the same user as identifier Y" for email addresses and phone numbers, and signs its answers.

| Item | What it does | Citation | Server role today |
|---|---|---|---|
| Lookup with hashing | Client fetches a pepper from `/hash_details`, hashes `"<address> <medium> <pepper>"` with SHA-256 (URL-safe unpadded base64) and posts the hashes to `/lookup`; the server returns matching Matrix IDs. A `none` algorithm sends cleartext. | IS #association-lookup, #sha256, #none | discovery (3PID to user ID); storage |
| Limits of hashing | The spec says hashing is "not perfect"; phone numbers are easily reversed by rainbow table, and clients should distrust servers that rarely rotate the pepper. | IS #security-considerations | none |
| Validation sessions | `/requestToken` makes the server send a token by email or SMS; `/submitToken` proves control. Sessions last 24 hours from last change. | IS #establishing-associations, #email-associations, #phone-number-associations | enforcement (proof of control); identity |
| Binding | After validation the client `/bind`s the 3PID to a Matrix ID. The link is proved one way only: "a user can associate *any* Matrix user ID with a validated 3PID". | IS #establishing-associations, #general | storage; identity |
| Invitation storage | Stores an invite addressed to an unbound 3PID; when the owner binds, the identity server notifies the homeserver with a signed `/3pid/onbind`. | IS #invitation-storage | storage; relay; identity (signs) |
| Ephemeral invitation signing | Signs on behalf of clients that cannot; "less secure than the client doing it itself". | IS #ephemeral-invitation-signing | identity |
| Keys | Long-term Ed25519 keys, published for signature checks. | IS #key-management | identity |
| Authentication and terms | Its own access tokens; any call may fail with `M_TERMS_NOT_SIGNED` until the user accepts terms via `/terms`. | IS #authentication, #terms-of-service | enforcement (policy) |

The spec's own statements on status and centralisation: identity servers "are treated as reliable oracles. They do not necessarily provide evidence that they have validated associations, but claim to have done so. Establishing the trustworthiness of an individual identity server is left as an exercise for the client" (IS #general-principles). The introduction describes "a globally federated cluster of trusted 'identity servers'" and says "Usage of an IS is not required" (`content/_index.md`, https://spec.matrix.org/v1.19/#identity). No federation or replication protocol between identity servers appears in the Identity Service API file, so the "federated cluster" is described but not specified.

## 6. Push Gateway API

One endpoint. The homeserver decides what to notify; the gateway only translates.

| Item | What it does | Citation | Server role today |
|---|---|---|---|
| Pusher | The client registers with its device vendor, gets a routing token (`pushkey`), then creates a pusher on its homeserver with `POST /pushers/set`, naming the gateway URL and `app_id`. A pusher is "a worker on the homeserver", one per device. | PUSHMOD #push-notifications | storage (pusher, push rules); push |
| Push rules | For each new event the homeserver evaluates each local user's rules, updates unread counts and may call the gateway. | PUSHMOD #push-rules, #server-behaviour | enforcement (policy); push |
| `POST /_matrix/push/v1/notify` | Homeserver sends a `notification`: `event_id`, `room_id`, `type`, `sender`, `sender_display_name`, `room_name`, `room_alias`, `user_is_target`, `prio`, `content`, `counts` (`unread`, `missed_calls`) and `devices` (`app_id`, `pushkey`, `pushkey_ts`, `data`, `tweaks`). The gateway replies with `rejected` pushkeys, which the homeserver must drop. Retries use exponential backoff. | PG #homeserver-behaviour; `data/api/push-gateway/push_notifier.yaml` | push; relay |
| `event_id_only` format | With `format: "event_id_only"` only `event_id`, `room_id`, `counts` and `devices` are sent. | PG #homeserver-behaviour | push |
| Path of a notification | Homeserver to push gateway (run by the app developer) to push provider (run by the device vendor, for example APNS) to device. APNS needs the developer's private key, so "each app must have its own push gateway". | PG #overview; PUSHMOD #recommendations-for-apns | push; relay |
| Content exposure | In the full format the gateway and vendor see sender, room, type and `content`; for an encrypted room that content is ciphertext (inferred). The spec advises that "message content shouldn't be sent in the push itself where possible"; the gateway should send a "sync" command instead. | PUSHMOD #security-considerations | none |

Always-on parties for push: the homeserver (to notice the event while the device sleeps), the app developer's gateway, and the vendor's push service.

## Not verified

- Rendered anchors were built from headings, not clicked.
- Whether `m.room.encryption` can be undone: not stated in the files read.
- MSC3401 and MSC4354 were read from their PR pages, not the proposal text. Sticky-event behaviour above comes partly from implementation notes.
- Element Call's self-hosting and encryption documents could not be fetched; only the README was read.
- Statements marked "(inferred)" are consequences of the mechanism, not quotations.


---

# E. Element user experience, from public sources

Read on 2026-11-18. Every row cites the page it was read from. "Inferred" marks my conclusion from what was read. "Unverified, from memory" marks things no fetched page stated. Pages were read through a summarising fetch tool, so quoted labels are as that tool returned them; check the source before copying a label into a spec.

Source keys used below:

| Key | URL |
|---|---|
| HOME | https://element.io/en |
| APP | https://element.io/app (same content at https://element.io/labs/element-x) |
| ESS | https://element.io/server-suite |
| HELP | https://element.io/help |
| FEAT | https://element.io/features |
| DV | https://element.io/features/device-verification |
| IGN | https://element.io/blog/element-x-ignition/ (2023-09-21) |
| PREP | https://element.io/blog/preparing-our-customers-for-a-new-era-of-secure-communication/ (2023-09-13) |
| LIFT | https://element.io/blog/we-have-lift-off-element-x-call-and-server-suite-are-ready/ (2024-09-20) |
| MASX | https://element.io/blog/mas-migration-unleashes-element-x-on-matrix-org (2025-04-10) |
| VIBES | https://element.io/blog/new-element-web-and-desktop-apps-have-distinct-element-x-vibes (2025-09-23) |
| XPRO | https://element.io/blog/element-x-and-pro-updates-a-glimpse-into-the-future/ (2025-11-12) |
| CALL25 | https://element.io/blog/element-call-redefining-conferencing-for-privacy-scale-and-sovereignty/ (2025-12-17) |
| CALLB3 | https://element.io/blog/element-call-beta-3/ (2023-07-11) |
| SPX | https://element.io/blog/spaces-has-landed-on-element-x/ (2026-03-30) |
| SECT | https://element.io/blog/organise-your-chats-your-way-with-sections/ (2026-07-16) |
| M2023 | https://matrix.org/blog/2023/09/matrix-2-0/ |
| M2024 | https://matrix.org/blog/2024/10/29/matrix-2.0-is-here/ |
| NSS | https://matrix.org/blog/2024/11/14/moving-to-native-sliding-sync/ |
| MORG | https://matrix.org/blog/2025/04/morg-now-running-mas/ |
| MXX | https://www.matrix.org/ecosystem/clients/element-x/ |
| GH-WEB | https://github.com/element-hq/element-web |
| GH-CFG | https://github.com/element-hq/element-web/blob/develop/docs/config.md |
| GH-IOS | https://github.com/element-hq/element-x-ios |
| GH-AND | https://github.com/element-hq/element-x-android |
| GH-CALL | https://github.com/element-hq/element-call |
| D-ONB | https://docs.element.io/latest/element-support/quick-start-guide/onboarding/ |
| D-LEFT | https://docs.element.io/latest/element-support/quick-start-guide/the-left-panel/ |
| D-MID | https://docs.element.io/latest/element-support/quick-start-guide/the-middle-panel/ |
| D-RIGHT | https://docs.element.io/latest/element-support/quick-start-guide/the-right-panel/ |
| D-FAQ | https://docs.element.io/latest/element-support/quick-start-guide/frequently-asked-questions/ |
| D-ACCT | https://docs.element.io/latest/element-support/understanding-your-element-accounts/ |
| D-CREATE | https://docs.element.io/latest/element-support/matrix-account-management/creating-a-matrix-account/ |
| D-VERIFY | https://docs.element.io/latest/element-support/device-verification/how-to-verify-devices/ |
| D-RECOV | https://docs.element.io/latest/element-support/device-verification/how-to-ensure-you-have-a-recovery-key/ |
| D-ROOMSET | https://docs.element.io/latest/element-support/matrix-rooms/managing-a-room-room-settings/ |
| D-ROOMADV | https://docs.element.io/latest/element-support/matrix-rooms/managing-a-room-advanced-room-management/ |
| D-ROOMS | https://docs.element.io/latest/element-support/matrix-rooms/understanding-matrix-rooms/ |
| D-SPACES | https://docs.element.io/latest/element-support/matrix-spaces/understanding-matrix-spaces/ |
| D-NOTIF | https://docs.element.io/latest/element-support/element-webdesktop-client-settings/notification-settings/ |
| D-SESS | https://docs.element.io/latest/element-support/element-webdesktop-client-settings/sessions/ |
| D-ABOUT | https://docs.element.io/latest/element-support/element-webdesktop-client-settings/help-about/ |
| D-PUSH | https://docs.element.io/latest/element-support/element-androidios-client-settings/understanding-push-notifications/ |
| D-RTC | https://docs.element.io/latest/element-server-suite-pro/configuring-components/matrix-rtc/configuring/ |
| D-EMSX | https://docs.element.io/latest/element-cloud-documentation/element-x-status-on-ems-cloud/ |

## 1. Product lineup

| App | Platform | Status | What it needs from the server | Source |
|---|---|---|---|---|
| Element Web | Browser; hosted copy at app.element.io | Current. Built on matrix-js-sdk. Supports last 2 versions of Chrome, Firefox, Edge, Safari; mobile web is community-supported only | Any Matrix homeserver. Sliding sync is still a Labs option on web (as of 2025-09) | GH-WEB, VIBES |
| Element Desktop | macOS, Windows, Linux | Current. Same client as Web in a desktop shell | Same as Web | GH-WEB, APP |
| Element X iOS | iOS 18+ | Current; "next-generation" client, total rewrite on the Matrix Rust SDK; recommended for new users | Sliding sync (see below); OIDC auth via Matrix Authentication Service (MAS) on servers that delegate auth; MatrixRTC backend for calls | GH-IOS, IGN, NSS, D-EMSX |
| Element X Android | Android 7+ (SDK 24) | Current; same description | Same | GH-AND |
| Element Classic (iOS, Android, F-Droid) | Mobile | Legacy. Renamed "Element Classic" in late 2025. Still in stores because some customers and communities have not migrated. No sunset date announced as of 2025-11-12 | Legacy sync and password login via compatibility APIs | APP, XPRO, MASX |
| Element Pro | Mobile and desktop | Current; workplace client built on Element X, paired with ESS Pro | ESS Pro | XPRO |
| Element Call | Web app (call.element.io) and embedded in Element X and Web/Desktop | In use but still labelled beta as of 2025-12-17 | LiveKit media server (an SFU: a server that forwards each participant's media to the others) plus a MatrixRTC authorisation service, advertised by the homeserver | GH-CALL, CALL25, LIFT |

Server requirements for Element X, as read:

- Sliding sync is required. "It works out of the box with any existing Matrix account on a homeserver with Sliding Sync support" (IGN). Element X dropped the older proxy-based variant on 2025-01-17 and requires the native form (MSC4186); users on the old form were logged out to log in again (NSS). Native support is in Synapse from 1.114 (M2024).
- Auth: Element said Element X "will in future only support the new native OIDC authentication" (PREP, 2023). The EMS cloud page says hosts using traditional password authentication are compatible with Element X, and hosts using SSO need MAS first (D-EMSX). Inferred: MAS is mandatory only where login is delegated; password-only servers still work.
- matrix.org moved to MAS on 2025-04-07, which is when Element X became usable there (MORG, MASX).
- Calls need the MatrixRTC backend (D-RTC).

## 2. User journeys

### Onboarding

| Step | What the user sees | App | Source |
|---|---|---|---|
| Start | "Create Account" or sign in | Web/Desktop | D-ONB, D-CREATE |
| Pick server | A current homeserver name with "Edit" beside it; the user can enter another homeserver URL. After choosing, the client shows that server's sign-up methods | Web/Desktop | D-ONB, D-CREATE |
| Register | Username, password, email, "Register"; or GitHub, Google, GitLab, Facebook, Apple where the server offers them | Web/Desktop | D-ONB |
| Username | Becomes the Matrix ID `@username:example.com`. "Choose carefully, it isn't possible to change your MXID". Display name can change later | Web/Desktop | D-CREATE |
| Email | Optional or required at the server administrator's choice; used for password reset and being discoverable by contacts | All | D-CREATE, HELP |
| Policies | Server's privacy policy/terms: tick box, "Accept"; then a verification email | Web/Desktop | D-CREATE, D-ONB |
| Sign in | Email or username plus password; lands on Home | Web/Desktop | D-ONB |
| New account on Classic | A notice telling the user to download Element X | Classic | MASX |
| Login on MAS servers | The password is entered only at the auth server, never in the client; account management lives on a web page (account.matrix.org for matrix.org) | X, Web | M2024, MORG |
| QR login on a new device | Scan a QR code shown by an existing signed-in client; this logs in and sets up encryption with no server name, username, password or recovery key typed. Element X scans; Web/Desktop shows the code under "link new device" when the server runs MAS | X, Web | M2024, LIFT |
| Confirm identity | In Element X, verifying the new device is mandatory at login ("Confirm your identity" screen; "Can't confirm" leads to a reset) | X | D-VERIFY, D-RECOV |

QR login was listed as not yet enabled on matrix.org in April 2025 (MORG). Whether it is enabled there now is unverified. The MSC4108 text could not be fetched (404).

First run: the docs describe only arriving at Home, then a secure backup prompt (D-ONB). Element X first-run screens (notification permission, analytics opt-in) are unverified, from memory.

### Room list

| Element | Behaviour | Source |
|---|---|---|
| Filters (Element X; Web from v1.12.0) | Single-select: Unreads, People, Rooms, Favourites. A mirrored 2025 feature list also shows Invites as a filter in Element X (secondary source, low confidence) | VIBES |
| Sections (Web, 2026-07) | Favourites, Low Priority and Chats became default sections replacing the filter buttons; custom sections via "+" then "New section"; drag a room in or "Move to Section"; sections collapse and show an unread marker | SECT |
| Badges | Unread counts; an @ icon for mentions or keyword matches; a marker for activity in muted rooms; active call marker; muted marker | VIBES |
| Favourites / Low priority | Favourites pinned to top, low priority to bottom, "historical" for rooms the user left | D-FAQ, D-LEFT |
| Invites | Private rooms are joined by accepting an invite. Space invites in Element X preview description, member count, inviter and an "External" badge | D-LEFT, SPX |
| Create / explore | "+" next to Rooms; compass icon to explore public rooms, where the user must select the right server | D-LEFT |

### Timeline

| Feature | What was read | Source |
|---|---|---|
| Reply, edit, remove, forward, quote | Hover actions on Web; edits and removals are visible to the room | D-MID |
| Reactions | Hover, smiley face | D-MID |
| Threads | Replies leave the main timeline; a thread panel lists them; unread shown as a dot, never a count; read state across devices described as unreliable in the threads beta; needs homeserver support (Synapse 1.55+) | D-MID, D-FAQ |
| Threads on Element X | Labs option in 2025-11; listed as stable on matrix.org's client page (date of that page unknown) | XPRO, MXX |
| Read receipts | Avatars to the right of a message; hover or tap for times | D-FAQ |
| Polls, static location | In Element X since 2023; "Poll History" in room settings on Web | IGN, D-ROOMSET |
| Live location, widgets, legacy calls | Classic only as of 2025-04 | MASX |
| Voice messages | Microphone in the composer | D-MID |
| Files/media | Drag and drop, paperclip, paste; "Files" list in room info | D-MID, D-RIGHT |
| Link previews | "URL Previews" toggle in room settings, per user or room default | D-ROOMSET |
| Sender names | Colour-coded in Element X | IGN |
| Typing indicators, message bubbles | Not described on any page read. Typing notifications were listed as planned for Element X in 2023 (IGN). Current state unverified, from memory: both exist |  |

### Composer

Rich text is the default in Element X with a Markdown option in advanced settings (IGN). On Web, selecting text offers bold, italics, strikethrough, code block, quote (D-MID). Mentions: type a name or "@", Tab autocompletes (D-MID, D-FAQ). Drafts are saved automatically in Element X (LIFT). Slash commands and the emoji picker were not described on any page read (unverified, from memory: Web supports commands such as /invite, /kick, /ban, /me).

### Spaces

A space groups rooms; a room can sit in several spaces and spaces can nest. Selecting a space filters the list to its rooms (D-SPACES). Element X has a Spaces tab with a "Discovery" view, a space filter on the chat list, room creation attached to a space or "spaceless", and rooms joinable by any space member (SPX). Room access options on Web: "Private (invite only)", "Public", "Space members" (D-ROOMSET).

### Search, people, DMs

Search bar finds people and rooms already in the user's lists (D-LEFT). Message search is per room or across rooms; in encrypted rooms it works on Desktop only, when "Message search" is enabled (D-FAQ). Start a chat with "+" next to People, then a username or Matrix ID (D-LEFT). A conversation with one person is marked a Direct Chat and listed under People (D-ROOMS). Invite by Matrix ID or email address (D-FAQ).

### Room settings, roles, moderation

Roles are numeric: Default 0, Moderator 50, Admin 100, or a custom level. Each action has a required level; defaults include invite 0, remove users 50, ban 50, remove others' messages 50, change permissions 100, enable encryption 100, "Change server ACLs" 100 (D-ROOMSET). Admins can demote themselves but not other admins (D-ROOMADV). Moderation read: remove a member from Room Info; "Banned Users" list with unban; remove a message; "Report content" from the message menu, with reports going to the homeserver's administrators (D-ROOMADV, D-ROOMSET, D-FAQ). History visibility changes apply only to future messages (D-ROOMSET). Export chat as HTML, text or JSON (D-RIGHT).

## 3. Encryption as experienced

| Topic | What the user experiences | Source |
|---|---|---|
| Default | Encryption applies only in rooms where it is enabled; enabling needs Admin | HELP, D-ROOMSET |
| "Device" | Every login is a separate device needing its own verification, even on the same phone | HELP, D-FAQ |
| Verify own new device | Either enter the recovery key or accept a prompt on an already verified device, then scan a QR code or compare emoji; a green shield confirms | D-ONB, HELP, DV |
| Verify another user | Their profile, "verify", compare emoji or QR over another channel. First contact is pinned automatically (trust on first use) | D-ONB, HELP, M2024 |
| Recovery key | A 48-character key; Settings, "Encryption", "Get recovery key". Restores identity and history if all devices are lost; also verifies new devices | HELP, D-RECOV |
| Key storage | On by default; message keys are encrypted on the device, then stored on the homeserver. With it off, a new device cannot decrypt history | HELP, D-FAQ |
| New device, history | With key storage on, history decrypts on the new device. With no verified device and no recovery key, the user must reset identity, loses history, and contacts are notified | HELP, D-VERIFY |
| Shields | Room shield green when every device is trusted, red when one is not; grey shields for keys that cannot be traced to the sender (restored from backup, deleted device) | D-FAQ, M2024 |
| Identity reset warning | Contacts are alerted; if they had verified the user, messaging is blocked until they re-verify or withdraw verification | HELP |
| "Unable to decrypt" | Means the device lacks the key. Remedies: restore from key backup, key request to the user's other devices, manual key import | D-FAQ |
| "Key storage is out of sync" | App asks for the recovery key; described as rare | HELP |
| Direction | "Invisible encryption": unverified devices will be excluded from sending and receiving (MSC4153); rollout date postponed, one month's notice promised | M2024, D-VERIFY |

## 4. Calls

| Topic | What was read | Source |
|---|---|---|
| Engine | Element Call on MatrixRTC, LiveKit SFU as media backend; enabled by default in Element X and Web/Desktop; used for 1:1 as well as group | M2024, LIFT, GH-CALL |
| Starting | Call icons in the room header; an ad hoc call in any room | D-MID, CALL25 |
| Incoming on Web | A banner; join directly or go through a lobby to set camera and microphone | CALL25 |
| Ringing | "ringing, declining and handset mode" were listed as remaining work for 1:1 in 2025-12. Whether Element X rings today is unverified | CALL25 |
| Controls | Screen share, emoji reactions, raise hand, picture-in-picture, voice/video switch, mute, end-of-call rating | CALL25, GH-CALL |
| Layouts | Grid with draggable tiles; spotlight starts automatically on screen share; mobile has a persistent presenter tile | CALLB3, CALL25 |
| Room display | Active-call marker on the room in the list | VIBES |
| Guests | Standalone link; guests without an account can only subscribe | CALL25, GH-CFG |
| Encryption | Encrypted rooms get encrypted calls | M2024 |
| Sizes claimed | Full mesh 7 to 10 (2023); "up to 100 participants" with SFU (2023); "hundreds of users" (2023); one standard VPS hosts up to 500 participants (2025). The README gives no number | CALLB3, M2023, CALL25, GH-CALL |
| Infrastructure | Each homeserver runs its own SFU; an authoriser checks identity through federation APIs; clients find the SFU through the homeserver's `.well-known`; TURN/STUN and UDP ports required | CALL25, D-RTC |
| Legacy | Classic's calls do not interoperate with MatrixRTC calls; Web can still be configured for Jitsi | M2024, GH-CFG |
| OS integration | CallKit reported present in 2025-12 after being disabled under iOS 18 in 2024 | CALL25, M2024 |

## 5. Notifications

| Topic | What was read | Source |
|---|---|---|
| Account defaults | Per event type: Off, On (popup, no sound), Noisy (highlight plus sound or vibration). Synced to the account | D-NOTIF, HELP |
| Per room | "Mute", "Mentions only", "All messages", "All messages (Noisy)" | D-NOTIF, HELP |
| Mentions and keywords | Display name and username trigger by default; extra keywords under "Mentions & keywords" | D-FAQ, D-NOTIF |
| Desktop | "Enable desktop notifications for this session", "Show message in desktop notification"; browser permission needed | D-NOTIF |
| Email | "Enable email notifications" toggle | HELP |
| Per device | Push toggle per session in the Sessions list | D-SESS |
| Mobile push path | App gets a push key from Apple or Google, registers a pusher on the homeserver; homeserver calls a push gateway (Sygnal); gateway calls APNs or FCM; device receives | D-PUSH |
| Push content | "Encrypted push notifications" in Element X. How the app wakes and decrypts is not described in the pages read (unverified, from memory: the push carries an event ID and the app fetches and decrypts it) | IGN |

## 6. Offline and multi-device

- Sending: Element X resends automatically when a message fails because of connectivity, and saves drafts (LIFT). A Matrix Conference 2024 SDK talk lists queueing messages while offline and saving pending messages to disk; read only as a search-result summary, not the slides.
- How an unsent message is drawn (spinner, "Sending", retry) was not described on any page read. Unverified, from memory: a sending state, then a failed state with retry.
- Reading offline: no page read states what is readable offline. Inferred from the local-storage design of the Rust SDK: previously synced rooms are viewable. Unverified.
- Cross-device state: notification defaults sync to the account (D-NOTIF). Thread read state does not sync reliably in the beta (D-FAQ). Identity trust decisions were not synced between devices in 2024 (M2024). Sections: sync not stated (SECT).
- Each device is a separate session listed with Verified, Unverified, or "Inactive for 90 days or longer" (D-SESS).
- Speed: "instant login, instant launch and instant sync" is the stated goal, enabled by sliding sync, which makes cost independent of the number of rooms (IGN, M2023). The old sync could return 100 MB on first login and 10 MB after days offline (M2023).

## 7. Where the user sees the server

| # | Point in the UX | What shows | Source |
|---|---|---|---|
| 1 | Sign-up and sign-in | Homeserver name with "Edit"; field for another homeserver URL. Operators can remove the picker in config | D-ONB, D-CREATE, GH-CFG |
| 2 | Sign-up options | Vary by server: social logins, email required or not, terms to accept | D-CREATE |
| 3 | User ID | `@username:server`, permanent, tied to the server it was created on | D-CREATE, D-ACCT |
| 4 | Starting a chat, inviting | User types a Matrix ID or an email address | D-LEFT, D-FAQ |
| 5 | Room address | Alias ending in a server name; "Local Addresses" versus "Published Addresses"; "Main Address" | D-ROOMSET, D-FAQ |
| 6 | Room directory | "Publish this room to the public in example.com's room directory?"; explore requires picking a server | D-FAQ, D-LEFT, GH-CFG |
| 7 | Room advanced settings | "Internal Room ID", room version | D-ROOMSET |
| 8 | Permissions | "Change server ACLs" | D-ROOMSET |
| 9 | Space invite | "External" badge for other organisations | SPX |
| 10 | Feature gating by server | Threads need Synapse 1.55+; Element X needs sliding sync; QR login needs MAS; calls need the RTC backend. The exact error text shown when a server lacks a feature was not found in any page read | D-FAQ, IGN, M2024, D-RTC |
| 11 | Auth web page | Login and account management on the server's own site (account.matrix.org) | MORG |
| 12 | Password reset and recovery | "Ask your homeserver administrator" | D-FAQ, HELP |
| 13 | Abuse reports and policies | Each homeserver sets its own; reports go to that server's administrators | D-FAQ, HELP |
| 14 | Key storage | Encrypted keys are held "on your homeserver" | D-FAQ |
| 15 | Help & About | Homeserver and identity server details; "Your Access Token" | D-ABOUT |
| 16 | Identity server | A second server for finding contacts by email; chosen from account data, `.well-known`, or config | GH-CFG, D-CREATE |
| 17 | Integration manager | A third server for widgets, bridges and bots | GH-CFG, D-RIGHT |
| 18 | Calls | SFU per homeserver; Jitsi domain default `meet.element.io`; users from non-allowlisted servers are subscribe-only | CALL25, GH-CFG |
| 19 | Maps | Map tile server set by config or the homeserver | GH-CFG |
| 20 | Push | Push gateway URL registered per device | D-PUSH |
| 21 | Share links | `matrix.to` links, or the operator's own web client | GH-CFG |
| 22 | Room deletion | "Rooms across multiple homeservers will only be deleted from your homeserver" | D-ROOMADV |
| 23 | Multiple account types | Hosting account versus Matrix account; ID on `one.ems.host` while the server setting is `one.element.io` | D-ACCT |
| 24 | Migration events | Forced logout when the server sync method changed (2025-01-17) | NSS |

Element's own stated direction is to hide point 1: with QR login, users do not need to know "which server they're connecting to" (LIFT).

## 8. Performance and scale claims

| Claim | Date | Source |
|---|---|---|
| Element X "over 6000 times faster than classic Element when resyncing after you've been offline" | 2023-09-21 | IGN |
| Element X "20,000 times faster and smoother than its predecessor"; site copy says "Up to 20,000 times faster than other Matrix-based apps". No method given | 2024-09-20; site read 2026-11 | LIFT, APP |
| Old sync: 100 MB initial response, 10 MB incremental after a few days offline | 2023-09 | M2023 |
| Public network: 111,873,374 Matrix IDs, about 17.3 million rooms, 64,256 servers (from servers that report) | 2023-09 | M2023 |
| matrix.org auth migration: 110M users and 45M access tokens moved in under 30 minutes | 2025-04-08 | MORG |
| "200M+ users worldwide", "100K+ deployments", "60M+" largest public deployment, "800K+" largest commercial | read 2026-11 | HOME |
| "125M+ users", "50M+" largest public, "500K+" largest commercial (older figures still on another page) | read 2026-11 | ESS |
| Calls: mesh 7 to 10; SFU 100; LiveKit "several hundred" | 2023-07-11 | CALLB3 |
| Calls: one standard VPS hosts up to 500 participants; "more than 139 years of cumulative meeting time" | 2025-12-17 | CALL25 |
| Largest room size | No figure found in any page read |  |
| Sync, login or launch times in seconds | No figure found; only "instant" |  |

## Gaps

Could not fetch: the user guide PDF (https://static.element.io/pdfs/element-user-guide.pdf, over the size limit); MSC4108 text (404); the docs page on Web security and privacy settings is a "WIP" stub; a docs page on the Classic-to-Pro mobile FAQ (404). https://element.io/user-guide is only a table of contents. The GitHub READMEs for Element X state no server requirements and no feature list; requirements above come from blogs and docs.

Unverified, from memory: typing indicators, message bubbles, slash commands, emoji picker, unsent-message display, offline reading, push wake-and-decrypt, Element X first-run screens, current ringing behaviour, the exact wording of "server does not support" errors, identity-server consent prompts.


---

