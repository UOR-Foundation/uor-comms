// The room kernel's questions, as requests. `dispatch` runs the verified holo (`app.dispatch` of the
// loaded archive). Every decision the host needs is asked here; nothing in `host/` restates a rule.

const STATUS = Object.freeze(["absent", "invited", "joined", "departed", "banned"]);
const decoder = new TextDecoder();

function request(operation, parts) {
  const size = parts.reduce((sum, part) => sum + (part instanceof Uint8Array ? part.length : part[1]), 1);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = operation;
  let offset = 1;
  for (const part of parts) {
    if (part instanceof Uint8Array) {
      out.set(part, offset);
      offset += part.length;
    } else {
      const [value, width] = part;
      if (width === 1) view.setUint8(offset, Number(value));
      else view.setBigUint64(offset, BigInt(value));
      offset += width;
    }
  }
  return out;
}

const flag = (value) => [value ? 1 : 0, 1];

export function kernel(dispatch) {
  const ask = async (operation, parts) => {
    const answer = await dispatch(request(operation, parts));
    return typeof answer === "string" ? answer : decoder.decode(answer);
  };
  // A member's state as the six fields the permission rule reads.
  const rule = (sender, target, room) => [
    [sender.status, 1], [sender.power, 8], [target.status, 1], [target.power, 8], [room.required, 8], flag(room.open),
  ];
  return {
    /** `created`, `created direct` or `refused`. */
    create: (eventBytes) => ask(0x0c, [eventBytes]),
    /** Whether the event may be composed against the state given: `composed` or `refused`. */
    compose: async (sender, target, room, eventBytes) =>
      (await ask(0x0a, [...rule(sender, target, room), eventBytes])) === "composed",
    /** Whether the action is permitted: the rule the fold applies to each event. */
    permit: async (action, sender, target, room, granted) =>
      (await ask(0x02, [[action, 1], [sender.status, 1], [sender.power, 8], [target.status, 1], [target.power, 8],
        [room.required, 8], flag(room.open), [granted, 8]])) === "permitted",
    /** The status a permitted action leaves its subject in. */
    memberStep: async (permitted, action, status) => {
      const name = await ask(0x06, [flag(permitted), [action, 1], [status, 1]]);
      const next = STATUS.indexOf(name);
      if (next < 0) throw new Error(`kernel answered ${name}`);
      return next;
    },
    /** Admission: the five conditions of `Comms.Admission`. The kernel compares the two addresses. */
    /** `admitted`, `held` (a cited event has not arrived) or `refused` (`Comms.Admission::verdict`). */
    admit: (claimed, derived, checks) =>
      ask(0x01, [claimed, derived, flag(checks.signatureValid), flag(checks.deviceMaySign),
        flag(checks.parentsKnown), flag(checks.permitted)]),
    /** `left`, `right` or `same`: which of two (rank, address) candidates comes first. */
    order: (leftRank, leftAddress, rightRank, rightAddress) =>
      ask(0x03, [[leftRank, 8], leftAddress, [rightRank, 8], rightAddress]),
    /** What message content is: `message`, `edit`, `reaction` or `refused` (`Comms.Content::valid`). */
    content: (contentBytes) => ask(0x0d, [contentBytes]),
    /**
     * Why the permission rule refuses an action, by name (`Comms.Reason::refusalOf`): `banned`, `closed`,
     * `not joined`, `needs power`, `not allowed` or `unknown action`; `permitted` when it does not.
     */
    reason: (action, sender, target, room, granted) =>
      ask(0x15, [[action, 1], [sender.status, 1], [sender.power, 8], [target.status, 1], [target.power, 8],
        [room.required, 8], flag(room.open), [granted, 8]]),
    /** Whether an action may happen in a direct room (`Comms.Create::directAllows`): no third member. */
    direct: async (action, isDirect) => (await ask(0x0e, [[action, 1], flag(isDirect)])) === "permitted",
    /** The actions a member may take, by action number (`Comms.Queue::offered`): exactly what the door admits. */
    queue: async (sender, target, room, direct, granted = 0) => {
      const bits = await ask(0x0f, [[sender.status, 1], [sender.power, 8], [target.status, 1], [target.power, 8],
        [room.required, 8], flag(room.open), [granted, 8], flag(direct)]);
      return [...bits].flatMap((bit, action) => (bit === "1" ? [action] : []));
    },
    /** What to do next in a send: `sign`, `store`, `announce` or `nothing`. */
    sendStep: (phase, report) => ask(0x08, [[phase, 1], [report, 1]]),
  };
}
