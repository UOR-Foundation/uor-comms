// The host: it stores, hashes, signs and passes bytes on, and asks the kernel for every decision.
//
// What it is given, and trusts no further than stated:
//   kernel     the room kernel's questions (`kernel.mjs` over the verified holo)
//   hash       BLAKE3 of bytes, 32 bytes out
//   store      bytes by address (`store.mjs`)
//   signer     { sign(bytes), verify(bytes, signature, sender, device) }
//   verdict    (sender, device) => whether Prism ID says that device may sign for that identity
//   transport  { announce(message), fetch(address) }; `receive` is what a peer's announce reaches
//
// Three things here are computed, not asked: an event's depth (the rule is `Comms.Fold::depthOf`),
// a member's standing at creation, and the power a change of power leaves. Each is named where it occurs.
import { decodeContent, KIND } from "./content.mjs";
import { ACTION, ZERO, decode, encode, hex, isZero } from "./event.mjs";

const ABSENT = Object.freeze({ status: 0, power: 0 });
// Room settings by key (`Comms.Settings`): the target's first word names one, `granted` holds a number,
// `content` the address of a name, description or picture. Defaults are the kernel's (`defaultOf`).
const SETTING = Object.freeze({ name: 0, description: 1, picture: 2, open: 3, settings: 4, redact: 5 });
const POWER_KEYS = Object.freeze({ invite: 12, kick: 13, ban: 14, unban: 15, send: 16, setPower: 17, redact: 5, settings: 4 });
const KEYS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17];
const requiredKey = (action) => 10 + action; // `Comms.Settings::requiredKey`
const CREATOR_POWER = 100;
// Events held for a missing parent, at most; the oldest is dropped first. Not a model rule.
const HELD_LIMIT = 1000;
// A timeline window's default and largest size; not model rules.
const TIMELINE_LIMIT = 50;
const TIMELINE_MAX = 1000;
const CREATED = new Set(["created", "created direct"]);
const PHASE = Object.freeze({ sign: 1, store: 2, announce: 3 });
const changesNoMember = (action) => action === ACTION.send || action === ACTION.redact || action === ACTION.create
  || action === ACTION.change;
/** A setting's key as the target of a change: the key in the first word, the rest zero. */
const keyTarget = (key) => { const t = new Uint8Array(32); new DataView(t.buffer).setBigUint64(0, BigInt(key)); return t; };
const keyOf = (target) => Number(new DataView(target.buffer, target.byteOffset, 8).getBigUint64(0));
/** Folded state: members by identity, and the room's changed settings by key. */
const newState = () => Object.assign(new Map(), { settings: new Map() });

const citedBy = (fields) => [...fields.parents, ...fields.authorities, ...(fields.action === ACTION.redact ? [fields.target] : [])];

class Refused extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Refused";
    this.reason = reason;
  }
}

export function open({ identity, device, kernel, hash, store, signer, verdict, transport }) {
  const rooms = new Map();
  const orphans = new Map();
  const listeners = new Set();
  // One admission at a time: an event checked while its parent is being admitted would otherwise be
  // held after the parent had already retried the held events, and wait for an unrelated admission.
  let admitting = Promise.resolve();
  const serially = (message) => {
    const run = admitting.then(() => admit(message));
    admitting = run.catch(() => {});
    return run;
  };

  const standing = (state, member) => state.get(hex(member)) ?? ABSENT;

  // The kernel's defaults, asked once (`Comms.Settings::defaultOf`, operation 23).
  let defaults = null;
  const defaultsReady = () => (defaults ??= Promise.all(KEYS.map(async (key) => [key, await kernel.defaultOf(key)]))
    .then((pairs) => new Map(pairs)));
  const valueOf = async (state, key) => state.settings.get(key)?.value ?? (await defaultsReady()).get(key);

  /** The room's settings as the kernel's questions take them, for one action: its required power. */
  async function roomFor(state, action) {
    const required = action === ACTION.redact ? requiredKey(ACTION.send) : requiredKey(action);
    return {
      required: action >= ACTION.invite && action <= ACTION.redact ? await valueOf(state, required) : 0,
      open: (await valueOf(state, SETTING.open)) === 1,
      redact: await valueOf(state, SETTING.redact),
    };
  }

  /** Whether a change of setting is composed against a state (`Comms.Settings::changeComposes`, operation 22). */
  async function settingComposes(state, sender, bytes, direct) {
    return kernel.setting(standing(state, sender), await valueOf(state, SETTING.settings), direct, bytes);
  }

  /**
   * Whether `left` is folded before `right`: by depth, then address, compared by the kernel.
   * Depth is `Comms.Fold::depthOf`; `parentPrecedesItsEvent` proves a parent is folded first.
   */
  async function before(left, right) {
    return (await kernel.order(left.depth, left.address, right.depth, right.address)) === "right";
  }

  /** One step of the fold: the kernel says whether the event is permitted and what it leaves. */
  async function apply(state, event, direct) {
    const { fields } = event;
    if (fields.action === ACTION.create) {
      const answer = await kernel.create(event.bytes);
      if (!CREATED.has(answer)) return;
      // Not a kernel answer yet: `Comms.Create::statusAtCreation` and `powerAtCreation`. In a direct
      // room both parties hold the creator's power (`directPartiesHaveEqualPower`).
      state.set(hex(fields.sender), { status: 2, power: CREATOR_POWER });
      if (answer === "created direct") state.set(hex(fields.target), { status: 1, power: CREATOR_POWER });
      return;
    }
    if (fields.action === ACTION.change) {
      // A refused change keeps the value (`aRefusedChangeKeepsTheValue`); a permitted one sets it.
      if (await settingComposes(state, fields.sender, event.bytes, direct)) {
        state.settings.set(keyOf(fields.target), { value: Number(fields.granted), content: fields.content });
      }
      return;
    }
    if (changesNoMember(fields.action)) return;
    const subject = fields.action < 2 ? fields.sender : fields.target;
    const sender = standing(state, fields.sender);
    const target = standing(state, subject);
    const permitted = (await kernel.permit(fields.action, sender, target, await roomFor(state, fields.action), fields.granted))
      && (await kernel.direct(fields.action, direct));
    const status = await kernel.memberStep(permitted, fields.action, target.status);
    // Not a kernel answer yet: `Comms.Member::nextPower`.
    const power = permitted && fields.action === ACTION.setPower ? Number(fields.granted) : target.power;
    state.set(hex(subject), { status, power });
  }

  async function fold(events, direct) {
    const state = newState();
    for (const event of events) await apply(state, event, direct);
    return state;
  }

  /** The state the events an event cites define: the fold of its ancestors. */
  async function stateBefore(room, parents) {
    const cited = parents.map(hex);
    if (cited.length === room.heads.size && cited.every((key) => room.heads.has(key))) return room.state;
    const seen = new Set();
    const walk = [...cited];
    while (walk.length > 0) {
      const key = walk.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      walk.push(...room.events.get(key).fields.parents.map(hex));
    }
    return fold(room.order.filter((event) => seen.has(hex(event.address))), Boolean(room.direct));
  }

  async function insert(room, event) {
    let low = 0;
    let high = room.order.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (await before(room.order[middle], event)) low = middle + 1;
      else high = middle;
    }
    room.order.splice(low, 0, event);
    if (low === room.order.length - 1) await apply(room.state, event, Boolean(room.direct));
    else room.state = await fold(room.order, Boolean(room.direct));
  }

  async function permitted(room, fields, bytes) {
    if (fields.action === ACTION.create) return CREATED.has(await kernel.create(bytes));
    const state = await stateBefore(room, fields.parents);
    if (fields.action === ACTION.change) return settingComposes(state, fields.sender, bytes, Boolean(room.direct));
    if (fields.action === ACTION.redact) {
      // The target is cited, so it is held: whether it is the sender's own is read from it.
      const own = hex(room.events.get(hex(fields.target)).fields.sender) === hex(fields.sender);
      return (await kernel.redaction(standing(state, fields.sender), await roomFor(state, ACTION.redact), own, bytes))
        && kernel.direct(fields.action, Boolean(room.direct));
    }
    const subject = fields.action < 2 ? fields.sender : fields.target;
    return (await kernel.compose(standing(state, fields.sender), standing(state, subject), await roomFor(state, fields.action), bytes))
      && kernel.direct(fields.action, Boolean(room.direct));
  }

  /** The one way an event enters a room, whether a peer sent it or this device wrote it. */
  async function admit({ address: claimed, bytes, signature }) {
    const fields = decode(bytes);
    if (!fields) return { admitted: false, reason: "malformed" };
    const address = hash(bytes);
    const creates = fields.action === ACTION.create;
    const roomKey = hex(creates ? address : fields.room);
    const room = rooms.get(roomKey);
    if (room?.events.has(hex(address))) return { admitted: true, address, known: true };
    // A redaction waits for the event it redacts, as an event waits for its parents.
    const cited = citedBy(fields);
    const parentsKnown = creates ? cited.length === 0 : Boolean(room) && cited.every((a) => room.events.has(hex(a)));
    const checks = {
      signatureValid: await signer.verify(bytes, signature, fields.sender, fields.device),
      deviceMaySign: await verdict(fields.sender, fields.device),
      parentsKnown,
      permitted: parentsKnown && (await permitted(room, fields, bytes)),
    };
    const answer = await kernel.admit(claimed, address, checks);
    if (answer === "held") {
      orphans.set(hex(address), { address: claimed, bytes, signature });
      if (orphans.size > HELD_LIMIT) orphans.delete(orphans.keys().next().value);
      return { admitted: false, reason: "parents unknown", held: true };
    }
    if (answer !== "admitted") {
      orphans.delete(hex(address));
      // Named by the first check that failed: the host's own checks, then the kernel's rule.
      const reason = hex(claimed) !== hex(address) ? "tampered" : !checks.signatureValid ? "signature"
        : !checks.deviceMaySign ? "device" : "not allowed";
      return { admitted: false, reason, checks };
    }
    await store.put(bytes, address);
    await store.putEvent?.({ address, bytes, signature });
    const target = room ?? { id: address, events: new Map(), order: [], heads: new Set(), state: newState(), contents: new Map(), redacted: new Set(),
      direct: creates && !isZero(fields.target) ? [fields.sender, fields.target] : null };
    rooms.set(roomKey, target);
    // `Comms.Fold::depthOf`: one more than the deepest parent, 0 with none.
    const depth = fields.parents.reduce((most, a) => Math.max(most, target.events.get(hex(a)).depth + 1), 0);
    const event = { address, bytes, signature, fields, depth };
    target.events.set(hex(address), event);
    // A message's content, and a settings change's name, description or picture, may be fetched by members.
    const namesContent = (action, content) => (action === ACTION.send || action === ACTION.change) && !isZero(content);
    if (namesContent(fields.action, fields.content)) {
      const naming = target.contents.get(hex(fields.content)) ?? new Set();
      target.contents.set(hex(fields.content), naming.add(hex(address)));
    }
    // `Comms.Redact`: the set of redacted events only grows, whatever order redactions arrive in.
    if (fields.action === ACTION.redact) {
      target.redacted.add(hex(fields.target));
      const redacted = target.events.get(hex(fields.target));
      if (namesContent(redacted.fields.action, redacted.fields.content)) await withdraw(redacted.fields.content);
    }
    for (const parent of fields.parents) target.heads.delete(hex(parent));
    target.heads.add(hex(address));
    await insert(target, event);
    orphans.delete(hex(address));
    for (const listener of listeners) listener({ room: target.id, address });
    for (const waiting of [...orphans.values()]) await admit(waiting);
    return { admitted: true, address };
  }

  /** Sign, store and announce, in the order the kernel gives. `onStep` hears each step as it ends. */
  async function publish(bytes, onStep) {
    const message = { address: hash(bytes), bytes, signature: null };
    let instruction = await kernel.sendStep(1, 0);
    while (instruction !== "nothing") {
      const phase = PHASE[instruction];
      if (instruction === "sign") message.signature = await signer.sign(bytes);
      if (instruction === "store") {
        const result = await serially(message);
        if (!result.admitted) throw new Refused(result.reason);
      }
      if (instruction === "announce") await transport.announce(message);
      onStep?.(instruction, message.address);
      instruction = await kernel.sendStep(phase, phase);
    }
    return message.address;
  }

  async function act(roomId, action, { target = ZERO, granted = 0, content = ZERO, onStep } = {}) {
    const room = rooms.get(hex(roomId));
    if (!room) throw new Refused("unknown room");
    const fields = { action, room: roomId, sender: identity, device, target, granted, content,
      parents: [...room.heads].map((key) => room.events.get(key).address) };
    const bytes = encode(fields);
    const subject = action < 2 ? identity : target;
    const settings = await roomFor(room.state, action);
    const allowed = await kernel.compose(standing(room.state, identity), standing(room.state, subject), settings, bytes);
    if (!allowed) {
      const why = await kernel.reason(action, standing(room.state, identity), standing(room.state, subject), settings, granted);
      throw new Refused(why === "permitted" ? "malformed" : why);
    }
    if (!(await kernel.direct(action, Boolean(room.direct)))) throw new Refused("direct");
    return publish(bytes, onStep);
  }

  /** Whether any room names this content only in redacted messages: then it is not kept or fetched. */
  const onlyRedacted = (content) => {
    let named = false;
    for (const room of rooms.values()) {
      const naming = room.contents.get(hex(content));
      if (!naming) continue;
      named = true;
      if ([...naming].some((event) => !room.redacted.has(event))) return false;
    }
    return named;
  };

  /** Deletes redacted content from the store, unless an unredacted message still names the same bytes. */
  async function withdraw(content) {
    if (!onlyRedacted(content)) return;
    read.delete(hex(content));
    await store.delete?.(content);
  }

  // Content read and judged once per address: its fields, or null when the kernel refuses it.
  const read = new Map();
  async function contentAt(address) {
    const key = hex(address);
    if (read.has(key)) return read.get(key);
    // The store only: a page draws from what this device holds; fetching is `content`'s.
    const bytes = onlyRedacted(address) ? null : await store.get(address);
    if (!bytes) return undefined; // not held yet: asked again next time
    // `newer`: a newer version or kind (`Comms.Content::newer`), shown as a message this engine cannot read.
    const answer = await kernel.content(bytes);
    const fields = answer === "refused" ? null : answer === "newer" ? { unknown: true, version: bytes[0], kind: bytes[1] } : decodeContent(bytes);
    read.set(key, fields);
    return fields;
  }

  /** The redaction this identity would send now, and whether the kernel admits it (`Comms.Redact::composes`). */
  async function redaction(roomId, address) {
    const room = rooms.get(hex(roomId));
    if (!room) throw new Refused("unknown room");
    const target = room.events.get(hex(address));
    if (!target) throw new Refused("unknown event");
    const parents = [...room.heads].map((key) => room.events.get(key).address);
    const bytes = encode({ action: ACTION.redact, room: roomId, sender: identity, device, target: target.address, parents });
    const me = standing(room.state, identity);
    const own = hex(target.fields.sender) === hex(identity);
    return { room, bytes, me, allowed: await kernel.redaction(me, await roomFor(room.state, ACTION.redact), own, bytes) };
  }

  /** The change of setting this identity would send now, and whether the kernel admits it. */
  async function settingChange(roomId, setting, value, keep = false) {
    const room = rooms.get(hex(roomId));
    if (!room) throw new Refused("unknown room");
    let key;
    let granted = 0;
    let content = ZERO;
    if (setting in SETTING && SETTING[setting] <= SETTING.picture) {
      key = SETTING[setting];
      // Asking (`mayChangeSetting`) only names the bytes; changing stores them.
      if (value !== null) content = keep ? await store.put(value) : hash(value);
    } else if (setting === "open") {
      key = SETTING.open;
      granted = value ? 1 : 0;
    } else if (setting.startsWith("power.") && setting.slice(6) in POWER_KEYS) {
      key = POWER_KEYS[setting.slice(6)];
      granted = value;
    } else {
      throw new Refused("unknown setting");
    }
    if (!Number.isInteger(granted) || granted < 0) throw new Refused("malformed");
    const parents = [...room.heads].map((k) => room.events.get(k).address);
    const bytes = encode({ action: ACTION.change, room: roomId, sender: identity, device, target: keyTarget(key), granted, content, parents });
    return { room, bytes, allowed: await settingComposes(room.state, identity, bytes, Boolean(room.direct)) };
  }

  const api = {
    Refused,
    /** Creates a room and returns its address. With `target` the room is direct and the target invited. */
    async createRoom({ target = ZERO, onStep } = {}) {
      // A group room's creating event carries a random salt in its content field (no rule reads it), so
      // each room has its own address. A direct room has none: a second one with the same person is the first.
      const salt = isZero(target) ? crypto.getRandomValues(new Uint8Array(32)) : undefined;
      const bytes = encode({ action: ACTION.create, sender: identity, device, target, content: salt });
      if (!CREATED.has(await kernel.create(bytes))) throw new Refused("malformed");
      return publish(bytes, onStep);
    },
    createDirect(target, options = {}) {
      if (isZero(target)) throw new Refused("a direct room names a target");
      return this.createRoom({ ...options, target });
    },
    join: (room, options) => act(room, ACTION.join, options),
    leave: (room, options) => act(room, ACTION.leave, options),
    invite: (room, target, options) => act(room, ACTION.invite, { ...options, target }),
    kick: (room, target, options) => act(room, ACTION.kick, { ...options, target }),
    ban: (room, target, options) => act(room, ACTION.ban, { ...options, target }),
    unban: (room, target, options) => act(room, ACTION.unban, { ...options, target }),
    setPower: (room, target, granted, options) => act(room, ACTION.setPower, { ...options, target, granted }),
    /**
     * Redacts an event of the room: the event stays, its content is no longer shown or served. Your own
     * with the power to send; another member's only with the room's redaction power (`Comms.Redact`).
     */
    async redact(roomId, address, { onStep } = {}) {
      const { room, bytes, allowed, me } = await redaction(roomId, address);
      if (!allowed) {
        // `Comms.Redact::allowed` asks what sending asks, and the redaction power for another's event:
        // so the send rule's refusal names the cause, and when it permits, the power is what is missing.
        const why = await kernel.reason(ACTION.send, me, me, await roomFor(room.state, ACTION.send), 0);
        throw new Refused(why === "permitted" ? "not allowed" : why);
      }
      return publish(bytes, onStep);
    },
    /** Whether `redact` would be accepted now: the kernel's answer on the redaction this identity would send. */
    async mayRedact(roomId, address) {
      return (await redaction(roomId, address)).allowed;
    },
    /**
     * A room's settings now: `name`, `description` and `picture` (content addresses, or null), `open`
     * (anyone with the room's address may join) and `power` (the power each action needs, and `settings`,
     * the power to change settings). A setting never changed holds the kernel's default.
     */
    async state(roomId) {
      const room = rooms.get(hex(roomId));
      if (!room) throw new Refused("unknown room");
      const content = (key) => {
        const held = room.state.settings.get(key)?.content;
        return held && !isZero(held) ? held : null;
      };
      const power = {};
      for (const [name, key] of Object.entries(POWER_KEYS)) power[name] = await valueOf(room.state, key);
      return { name: content(SETTING.name), description: content(SETTING.description), picture: content(SETTING.picture),
        open: (await valueOf(room.state, SETTING.open)) === 1, power, direct: Boolean(room.direct) };
    },
    /**
     * Changes one setting by event. `setting` is `name`, `description` or `picture` with content bytes
     * (stored, the event carries their address) or null to clear; `open` with a boolean; or `power.<x>`
     * for x in invite, kick, ban, unban, send, setPower, redact, settings, with a number.
     */
    async changeSetting(roomId, setting, value, { onStep } = {}) {
      const { room, bytes, allowed } = await settingChange(roomId, setting, value, true);
      if (!allowed) {
        // The send rule names banned and not joined; below the room's settings power is needs power;
        // anything else the change rule refuses is not allowed. Naming the reason is host code, not modelled.
        const me = standing(room.state, identity);
        const why = await kernel.reason(ACTION.send, me, me, await roomFor(room.state, ACTION.send), 0);
        const below = me.power < (await valueOf(room.state, SETTING.settings));
        throw new Refused(why === "permitted" || why === "needs power" ? (below ? "needs power" : "not allowed") : why);
      }
      return publish(bytes, onStep);
    },
    /** Whether `changeSetting` would be accepted now: the kernel's answer on the change this identity would send. */
    async mayChangeSetting(roomId, setting, value) {
      return (await settingChange(roomId, setting, value)).allowed;
    },
    /** Sends content. The content is stored by address; the event carries only the address. */
    async send(room, contentBytes, options) {
      if (["refused", "newer"].includes(await kernel.content(contentBytes))) throw new Refused("content");
      const content = await store.put(contentBytes);
      return act(room, ACTION.send, { ...options, content });
    },
    /** What a peer's announce reaches. */
    receive: serially,
    /** Rebuilds every room from the events the store kept, admitting each again. Returns the number of rooms. */
    async restore() {
      // Parents first, so each event is checked once: a store returns events by address, and an event
      // admitted before its parent is held and checked again with every later admission.
      const kept = (await store.events?.()) ?? [];
      const byAddress = new Map(kept.map((m) => [hex(m.address), m]));
      const done = new Set();
      for (const start of kept) {
        const stack = [[start, false]];
        while (stack.length) {
          const [message, ready] = stack.pop();
          const key = hex(message.address);
          if (done.has(key)) continue;
          if (ready) { done.add(key); await serially(message); continue; }
          stack.push([message, true]);
          const fields = decode(message.bytes);
          for (const cited of fields ? citedBy(fields) : []) {
            const parent = byAddress.get(hex(cited));
            if (parent && !done.has(hex(cited))) stack.push([parent, false]);
          }
        }
      }
      return rooms.size;
    },
    /** True when the browser cleared the store this engine was opened on. */
    evicted: Boolean(store.evicted),
    /** The content behind an address: from the store, else fetched and checked against the address. */
    async content(address) {
      if (onlyRedacted(address)) return null;
      const held = await store.get(address);
      if (held) return held;
      const fetched = await transport.fetch(address);
      if (!fetched) return null;
      await store.put(fetched, address);
      return fetched;
    },
    rooms: () => [...rooms.values()].map((room) => room.id),
    /** Whether an admitted message of the room names this content address: what a peer may fetch. */
    carries(roomId, address) {
      const room = rooms.get(hex(roomId));
      return [...(room?.contents.get(hex(address)) ?? [])].some((event) => !room.redacted.has(event));
    },
    /**
     * This identity's events no peer holds yet, oldest first: `{ room, address }`. Empty when the
     * transport cannot say (it has no `delivered`). The sync on connect delivers them; `retry` asks again.
     */
    outbox() {
      if (!transport.delivered) return [];
      return [...rooms.values()].flatMap((room) => room.order
        .filter((e) => hex(e.fields.sender) === hex(identity) && !transport.delivered(e.address))
        .map((e) => ({ room: room.id, address: e.address })));
    },
    /** Announces one of this engine's events again. */
    async retry(address) {
      for (const room of rooms.values()) {
        const event = room.events.get(hex(address));
        if (event) return transport.announce({ address: event.address, bytes: event.bytes, signature: event.signature });
      }
      throw new Refused("unknown event");
    },
    /**
     * What this identity may do in a room, toward `target` (itself when absent), as the kernel offers it.
     * `setPower` is answered for granting `granted` (0 when absent): ask once per level the page offers.
     * Room settings are the same for every room until they become events; then this reads the room's.
     */
    async offered(roomId, target = identity, { granted = 0 } = {}) {
      const room = rooms.get(hex(roomId));
      if (!room) return [];
      const names = Object.keys(ACTION);
      const me = standing(room.state, identity);
      const them = standing(room.state, target);
      // `Comms.Queue::offered` takes one required power for every action; each action has its own
      // (`Comms.Settings`), so the queue is asked once per distinct power and each action read from its own.
      const actions = [];
      const asked = new Map();
      for (let action = ACTION.join; action <= ACTION.setPower; action += 1) {
        const settings = await roomFor(room.state, action);
        const key = `${settings.required}:${settings.open}`;
        if (!asked.has(key)) asked.set(key, await kernel.queue(me, them, settings, Boolean(room.direct), granted));
        if (asked.get(key).includes(action)) actions.push(action);
      }
      return actions.map((action) => names[action]);
    },
    /** The direct room this identity shares with `target`, or null, so one is reused, not duplicated. */
    findDirect(target) {
      const pair = [hex(identity), hex(target)].sort().join();
      const found = [...rooms.values()].find((room) => room.direct && room.direct.map(hex).sort().join() === pair);
      return found?.id ?? null;
    },
    members(roomId) {
      const room = rooms.get(hex(roomId));
      return room ? [...room.state].map(([member, { status, power }]) => ({ member, status, power })) : [];
    },
    /** One admitted event of a room as it travels, or null. */
    eventOf(roomId, address) {
      const event = rooms.get(hex(roomId))?.events.get(hex(address));
      return event ? { address: event.address, bytes: event.bytes, signature: event.signature } : null;
    },
    /** Every admitted event of a room as it travels (address, bytes, signature), in the fold order. */
    eventsOf(roomId) {
      const room = rooms.get(hex(roomId));
      return room ? room.order.map(({ address, bytes, signature }) => ({ address, bytes, signature })) : [];
    },
    /** This engine's identity and device. */
    identity,
    device,
    /**
     * A window of a room's events in the fold order (depth, then address: `Comms.Fold`), oldest first:
     * at most `limit` events just before the event `before`, or the newest when `before` is absent.
     * `hasMore` is true when earlier events exist. Taking the slice is host code, not a model rule.
     */
    timeline(roomId, { before, limit = TIMELINE_LIMIT } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX) throw new Refused("limit");
      const room = rooms.get(hex(roomId));
      if (!room) throw new Refused("unknown room");
      let end = room.order.length;
      if (before !== undefined) {
        const anchor = room.events.get(hex(before));
        if (!anchor) throw new Refused("unknown event");
        end = room.order.indexOf(anchor);
      }
      const start = Math.max(0, end - limit);
      const events = room.order.slice(start, end)
        .map(({ address, fields, depth }) => ({ address, depth, ...fields, redacted: room.redacted.has(hex(address)) }));
      return { events, hasMore: start > 0 };
    },
    /**
     * A window of a room's messages as a page shows them, newest last, with edits and reactions applied.
     * Rules here are host code, not model rules: an edit counts only from the message's sender and the
     * last in the fold order wins; a reaction counts once per member and key; a redacted message, edit
     * or reaction is left out, as is content the kernel refuses. `missing` counts events whose content
     * no store or peer could give, so they could not be placed. Throws as `timeline` does.
     */
    async messages(roomId, { before, limit = TIMELINE_LIMIT } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > TIMELINE_MAX) throw new Refused("limit");
      const room = rooms.get(hex(roomId));
      if (!room) throw new Refused("unknown room");
      const sends = room.order.filter((e) => e.fields.action === ACTION.send && !room.redacted.has(hex(e.address)));
      const contents = await Promise.all(sends.map((e) => contentAt(e.fields.content)));
      const shown = [];
      const byAddress = new Map();
      let missing = 0;
      sends.forEach((event, i) => {
        const content = contents[i];
        if (content === undefined) missing += 1;
        if (content?.unknown) {
          const message = { address: event.address, sender: event.fields.sender, unknown: true, version: content.version, kind: content.kind };
          shown.push(message); // not in byAddress: what an unknown kind relates to is unknown too
          return;
        }
        if (!content || content.kind !== KIND.message) return;
        const message = { address: event.address, sender: event.fields.sender, sent: Number(content.sent),
          text: content.text, mentions: content.mentions, everyone: content.everyone, forwarded: content.forwarded,
          replyTo: content.relates, edited: null, reactions: {}, mine: {} };
        shown.push(message);
        byAddress.set(hex(event.address), message);
      });
      sends.forEach((event, i) => {
        const content = contents[i];
        const message = content?.relates && byAddress.get(hex(content.relates));
        if (!message) return;
        if (content.kind === KIND.edit && hex(event.fields.sender) === hex(message.sender)) {
          Object.assign(message, { text: content.text, mentions: content.mentions, everyone: content.everyone, edited: event.address });
        }
        if (content.kind === KIND.reaction) {
          const members = new Set(message.reactions[content.key] ?? []);
          message.reactions[content.key] = [...members.add(hex(event.fields.sender))];
          if (hex(event.fields.sender) === hex(identity)) (message.mine[content.key] ??= []).push(event.address);
        }
      });
      let end = shown.length;
      if (before !== undefined) {
        end = shown.findIndex((m) => hex(m.address) === hex(before));
        if (end < 0) throw new Refused("unknown event");
      }
      const start = Math.max(0, end - limit);
      return { messages: shown.slice(start, end), hasMore: start > 0, missing };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  // A transport that needs the engine (to hand on what it receives, and to know who may see a room) binds here.
  transport.bind?.(api);
  return api;
}
