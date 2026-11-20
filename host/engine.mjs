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
import { ACTION, ZERO, decode, encode, hex, isZero } from "./event.mjs";

const ABSENT = Object.freeze({ status: 0, power: 0 });
const SETTINGS = Object.freeze({ required: 0, open: false });
const CREATOR_POWER = 100;
// Events held for a missing parent, at most; the oldest is dropped first. Not a model rule.
const HELD_LIMIT = 1000;
const CREATED = new Set(["created", "created direct"]);
const PHASE = Object.freeze({ sign: 1, store: 2, announce: 3 });
const changesNoMember = (action) => action === ACTION.send || action === ACTION.redact || action === ACTION.create;

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
    if (changesNoMember(fields.action)) return;
    const subject = fields.action < 2 ? fields.sender : fields.target;
    const sender = standing(state, fields.sender);
    const target = standing(state, subject);
    const permitted = (await kernel.permit(fields.action, sender, target, SETTINGS, fields.granted))
      && (await kernel.direct(fields.action, direct));
    const status = await kernel.memberStep(permitted, fields.action, target.status);
    // Not a kernel answer yet: `Comms.Member::nextPower`.
    const power = permitted && fields.action === ACTION.setPower ? Number(fields.granted) : target.power;
    state.set(hex(subject), { status, power });
  }

  async function fold(events, direct) {
    const state = new Map();
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
    if (fields.action === ACTION.redact) return false; // not wired yet
    const state = await stateBefore(room, fields.parents);
    const subject = fields.action < 2 ? fields.sender : fields.target;
    return (await kernel.compose(standing(state, fields.sender), standing(state, subject), SETTINGS, bytes))
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
    const cited = [...fields.parents, ...fields.authorities];
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
    const target = room ?? { id: address, events: new Map(), order: [], heads: new Set(), state: new Map(), contents: new Set(),
      direct: creates && !isZero(fields.target) ? [fields.sender, fields.target] : null };
    rooms.set(roomKey, target);
    // `Comms.Fold::depthOf`: one more than the deepest parent, 0 with none.
    const depth = fields.parents.reduce((most, a) => Math.max(most, target.events.get(hex(a)).depth + 1), 0);
    const event = { address, bytes, signature, fields, depth };
    target.events.set(hex(address), event);
    if (fields.action === ACTION.send) target.contents.add(hex(fields.content));
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
    const allowed = await kernel.compose(standing(room.state, identity), standing(room.state, subject), SETTINGS, bytes);
    if (!allowed) {
      const why = await kernel.reason(action, standing(room.state, identity), standing(room.state, subject), SETTINGS, granted);
      throw new Refused(why === "permitted" ? "malformed" : why);
    }
    if (!(await kernel.direct(action, Boolean(room.direct)))) throw new Refused("direct");
    return publish(bytes, onStep);
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
    /** Sends content. The content is stored by address; the event carries only the address. */
    async send(room, contentBytes, options) {
      if ((await kernel.content(contentBytes)) === "refused") throw new Refused("content");
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
          for (const cited of fields ? [...fields.parents, ...fields.authorities] : []) {
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
      const held = await store.get(address);
      if (held) return held;
      const fetched = await transport.fetch(address);
      if (!fetched) return null;
      await store.put(fetched, address);
      return fetched;
    },
    rooms: () => [...rooms.values()].map((room) => room.id),
    /** Whether an admitted message of the room names this content address: what a peer may fetch. */
    carries: (roomId, address) => Boolean(rooms.get(hex(roomId))?.contents.has(hex(address))),
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
      const actions = await kernel.queue(standing(room.state, identity), standing(room.state, target), SETTINGS, Boolean(room.direct), granted);
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
    timeline(roomId) {
      const room = rooms.get(hex(roomId));
      return room ? room.order.map(({ address, fields, depth }) => ({ address, depth, ...fields })) : [];
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
