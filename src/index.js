export const MIN_MODULUS = 8;
export const MAX_MODULUS = 4294967296;
export const DEFAULT_MODULUS = 65536;
export const DEFAULT_CAPACITY = 64;
export const MAX_CAPACITY = DEFAULT_MODULUS / 2 - 2;

export const STORED = "stored";
export const DUPLICATE = "duplicate";
export const STALE = "stale";
export const OVERFLOW = "overflow";
export const OUT_OF_ORDER = "out-of-order";
export const ACKNOWLEDGED = "acknowledged";

export const PUSH_STATUSES = Object.freeze([STORED, DUPLICATE, STALE, OVERFLOW, OUT_OF_ORDER]);
export const ACK_STATUSES = Object.freeze([ACKNOWLEDGED, DUPLICATE, STALE]);

const OPTIONS_MESSAGE = "options must be an object";
const MODULUS_MESSAGE = `modulus must be a power of two from ${MIN_MODULUS} to ${MAX_MODULUS}`;
const INPUT_MESSAGE = "input must be an object";
const ACK_MESSAGE = "acknowledgment must be an object";
const STATE_MESSAGE = "state must be present";
const STEP_MESSAGE = "step must be a function";

function capacityMessage(limit) {
  return `capacity must be an integer from 1 to ${limit}`;
}

function sequenceMessage(modulus) {
  return `sequence must be an integer from 0 to ${modulus - 1}`;
}

function assertObject(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
}

function readOptional(object, key) {
  if (!Object.hasOwn(object, key)) {
    return undefined;
  }
  return object[key];
}

function isPowerOfTwo(value) {
  let cursor = value;
  while (cursor > 1) {
    if (cursor % 2 !== 0) {
      return false;
    }
    cursor = cursor / 2;
  }
  return cursor === 1;
}

function capacityLimit(modulus) {
  return modulus / 2 - 2;
}

function readModulus(options) {
  const value = readOptional(options, "modulus");
  if (value === undefined) {
    return DEFAULT_MODULUS;
  }
  if (
    !Number.isInteger(value) ||
    value < MIN_MODULUS ||
    value > MAX_MODULUS ||
    !isPowerOfTwo(value)
  ) {
    throw new RangeError(MODULUS_MESSAGE);
  }
  return value;
}

function readCapacity(options, modulus) {
  const limit = capacityLimit(modulus);
  const value = readOptional(options, "capacity");
  if (value === undefined) {
    if (DEFAULT_CAPACITY > limit) {
      throw new RangeError(capacityMessage(limit));
    }
    return DEFAULT_CAPACITY;
  }
  if (!Number.isInteger(value) || value < 1 || value > limit) {
    throw new RangeError(capacityMessage(limit));
  }
  return value;
}

function readSequence(record, modulus) {
  if (!Object.hasOwn(record, "sequence")) {
    throw new RangeError(sequenceMessage(modulus));
  }
  const value = record.sequence;
  if (!Number.isInteger(value) || value < 0 || value > modulus - 1) {
    throw new RangeError(sequenceMessage(modulus));
  }
  if (value === 0) {
    return 0;
  }
  return value;
}

function forwardDelta(from, to, modulus) {
  const delta = (to - from) % modulus;
  if (delta < 0) {
    return delta + modulus;
  }
  return delta;
}

function compare(sequence, origin, modulus) {
  const delta = forwardDelta(origin, sequence, modulus);
  if (delta === 0) {
    return "equal";
  }
  const half = modulus / 2;
  if (delta < half) {
    return "after";
  }
  if (modulus - delta < half) {
    return "before";
  }
  return "ambiguous";
}

function advance(sequence, modulus) {
  const next = sequence + 1;
  if (next === modulus) {
    return 0;
  }
  return next;
}

function hasGrowthRoom(sequence, newest, size, capacity, modulus) {
  const future = (newest + (capacity - size)) % modulus;
  return forwardDelta(sequence, future, modulus) + 1 < modulus / 2;
}

function splitQueue(entries, sequence, modulus) {
  const dropped = [];
  const kept = [];
  let dropping = true;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const relation = compare(entry.sequence, sequence, modulus);
    if (relation === "ambiguous") {
      return null;
    }
    if (relation === "after") {
      dropping = false;
      kept.push(entry);
    } else if (!dropping) {
      return null;
    } else {
      dropped.push(entry);
    }
  }
  return { dropped, kept };
}

function applyStep(state, step, entries) {
  let current = state;
  const applied = [];
  for (let index = 0; index < entries.length; index += 1) {
    current = step(current, entries[index]);
    applied.push(entries[index]);
  }
  return {
    state: current,
    applied
  };
}

export class InputReplay {
  #modulus;
  #capacity;
  #entries = [];
  #lastSequence = null;
  #nextSequence = null;

  constructor(options = {}) {
    assertObject(options, OPTIONS_MESSAGE);
    this.#modulus = readModulus(options);
    this.#capacity = readCapacity(options, this.#modulus);
  }

  get modulus() {
    return this.#modulus;
  }

  get capacity() {
    return this.#capacity;
  }

  get size() {
    return this.#entries.length;
  }

  get lastSequence() {
    return this.#lastSequence;
  }

  get nextSequence() {
    return this.#nextSequence;
  }

  get oldestSequence() {
    if (this.#entries.length === 0) {
      return null;
    }
    return this.#entries[0].sequence;
  }

  get newestSequence() {
    if (this.#entries.length === 0) {
      return null;
    }
    return this.#entries[this.#entries.length - 1].sequence;
  }

  reset() {
    this.#entries = [];
    this.#lastSequence = null;
    this.#nextSequence = null;
  }

  pending() {
    return this.#entries.slice();
  }

  push(record) {
    assertObject(record, INPUT_MESSAGE);
    const sequence = readSequence(record, this.#modulus);
    const input = Object.hasOwn(record, "input") ? record.input : undefined;
    if (this.#contains(sequence)) {
      return this.#pushResult(DUPLICATE);
    }
    if (this.#nextSequence === null || sequence === this.#nextSequence) {
      if (this.#entries.length === this.#capacity) {
        return this.#pushResult(OVERFLOW);
      }
      this.#entries.push(
        Object.freeze({
          sequence,
          input
        })
      );
      this.#nextSequence = advance(sequence, this.#modulus);
      return this.#pushResult(STORED);
    }
    if (compare(sequence, this.#nextSequence, this.#modulus) === "after") {
      return this.#pushResult(OUT_OF_ORDER);
    }
    return this.#pushResult(STALE);
  }

  acknowledge(ack) {
    assertObject(ack, ACK_MESSAGE);
    const sequence = readSequence(ack, this.#modulus);
    if (!Object.hasOwn(ack, "state")) {
      throw new RangeError(STATE_MESSAGE);
    }
    if (!Object.hasOwn(ack, "step") || typeof ack.step !== "function") {
      throw new TypeError(STEP_MESSAGE);
    }
    const state = ack.state;
    const step = ack.step;

    if (this.#lastSequence !== null && sequence === this.#lastSequence) {
      const replayed = applyStep(state, step, this.#entries);
      return this.#view(DUPLICATE, replayed.state, [], replayed.applied);
    }

    if (
      this.#lastSequence !== null &&
      compare(sequence, this.#lastSequence, this.#modulus) !== "after"
    ) {
      return this.#view(STALE, null, [], []);
    }

    const split = splitQueue(this.#entries, sequence, this.#modulus);
    if (split === null) {
      return this.#view(STALE, null, [], []);
    }

    if (
      split.dropped.length === 0 &&
      this.#entries.length > 0 &&
      !hasGrowthRoom(sequence, this.#newest(), this.#entries.length, this.#capacity, this.#modulus)
    ) {
      return this.#view(STALE, null, [], []);
    }

    const replayed = applyStep(state, step, split.kept);
    this.#entries = split.kept;
    this.#lastSequence = sequence;
    if (split.kept.length === 0) {
      this.#nextSequence = advance(sequence, this.#modulus);
    }
    return this.#view(ACKNOWLEDGED, replayed.state, split.dropped, replayed.applied);
  }

  replay(state, step) {
    if (typeof step !== "function") {
      throw new TypeError(STEP_MESSAGE);
    }
    return applyStep(state, step, this.#entries);
  }

  #newest() {
    return this.#entries[this.#entries.length - 1].sequence;
  }

  #contains(sequence) {
    for (let index = 0; index < this.#entries.length; index += 1) {
      if (this.#entries[index].sequence === sequence) {
        return true;
      }
    }
    return false;
  }

  #pushResult(status) {
    return {
      status,
      size: this.#entries.length,
      nextSequence: this.#nextSequence
    };
  }

  #view(status, state, dropped, applied) {
    return {
      status,
      state,
      dropped,
      applied,
      lastSequence: this.#lastSequence,
      nextSequence: this.#nextSequence,
      size: this.#entries.length
    };
  }
}
