import assert from "node:assert/strict";

export function fingerprint(queue) {
  return {
    modulus: queue.modulus,
    capacity: queue.capacity,
    size: queue.size,
    lastSequence: queue.lastSequence,
    nextSequence: queue.nextSequence,
    oldestSequence: queue.oldestSequence,
    newestSequence: queue.newestSequence,
    pending: queue.pending().map((entry) => ({
      sequence: entry.sequence,
      input: entry.input
    }))
  };
}

export function sequences(entries) {
  return entries.map((entry) => entry.sequence);
}

export function fill(queue, from, count, dx = 1) {
  const modulus = queue.modulus;
  let sequence = from;
  for (let index = 0; index < count; index += 1) {
    const result = queue.push({ sequence, input: { dx } });
    if (result.status !== "stored") {
      throw new Error(`expected stored at ${sequence}, got ${result.status}`);
    }
    sequence += 1;
    if (sequence === modulus) {
      sequence = 0;
    }
  }
}

export function assertThrowsUnchanged(queue, run, name, message) {
  const before = fingerprint(queue);
  assert.throws(run, {
    name,
    message
  });
  assert.deepEqual(fingerprint(queue), before);
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return mixed >>> 0;
  };
}

export function forward(from, to, modulus) {
  const delta = (to - from) % modulus;
  if (delta < 0) {
    return delta + modulus;
  }
  return delta;
}
