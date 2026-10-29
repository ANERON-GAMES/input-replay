import assert from "node:assert/strict";
import test from "node:test";
import { ACKNOWLEDGED, OUT_OF_ORDER, OVERFLOW, STALE, STORED, InputReplay } from "../src/index.js";
import { fill, fingerprint, sequences } from "./helpers.js";

function sumStep(state, entry) {
  return state + entry.input.dx;
}

test("sequences wrap on the default 16-bit modulus", () => {
  const queue = new InputReplay({ capacity: 4 });
  assert.equal(queue.push({ sequence: 65534, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.push({ sequence: 65535, input: { dx: 2 } }).status, STORED);
  assert.equal(queue.push({ sequence: 0, input: { dx: 4 } }).status, STORED);
  assert.equal(queue.push({ sequence: 1, input: { dx: 8 } }).status, STORED);
  assert.equal(queue.nextSequence, 2);
  const result = queue.acknowledge({ sequence: 65535, state: 10, step: sumStep });
  assert.equal(result.status, ACKNOWLEDGED);
  assert.equal(result.state, 22);
  assert.deepEqual(sequences(result.dropped), [65534, 65535]);
  assert.deepEqual(sequences(result.applied), [0, 1]);
  assert.deepEqual(sequences(queue.pending()), [0, 1]);
  assert.equal(queue.lastSequence, 65535);
  assert.equal(queue.nextSequence, 2);
});

test("a push across the wrap is stale or out of order against the next cursor", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  fill(queue, 14, 2);
  assert.equal(queue.nextSequence, 0);
  assert.equal(queue.push({ sequence: 0, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.push({ sequence: 2, input: { dx: 1 } }).status, OUT_OF_ORDER);
  assert.equal(queue.push({ sequence: 15, input: { dx: 1 } }).status, "duplicate");
  assert.equal(queue.push({ sequence: 8, input: { dx: 1 } }).status, OUT_OF_ORDER);
  assert.equal(queue.push({ sequence: 9, input: { dx: 1 } }).status, STALE);
  assert.equal(queue.push({ sequence: 10, input: { dx: 1 } }).status, STALE);
  assert.equal(queue.nextSequence, 1);
  assert.deepEqual(sequences(queue.pending()), [14, 15, 0]);
});

test("modulus 8 keeps one step of room past a full queue", () => {
  const queue = new InputReplay({ modulus: 8, capacity: 2 });
  fill(queue, 0, 2);
  const before = fingerprint(queue);
  let calls = 0;
  const tooFarBehind = queue.acknowledge({
    sequence: 6,
    state: 1,
    step: () => {
      calls += 1;
      return 0;
    }
  });
  assert.equal(tooFarBehind.status, STALE);
  assert.equal(calls, 0);
  assert.deepEqual(fingerprint(queue), before);

  const behind = queue.acknowledge({ sequence: 7, state: 10, step: sumStep });
  assert.equal(behind.status, ACKNOWLEDGED);
  assert.equal(behind.state, 12);
  assert.deepEqual(sequences(behind.applied), [0, 1]);
  assert.equal(queue.lastSequence, 7);
  assert.equal(queue.size, 2);

  calls = 0;
  const next = queue.acknowledge({
    sequence: 2,
    state: 40,
    step: () => {
      calls += 1;
      return 0;
    }
  });
  assert.equal(next.status, ACKNOWLEDGED);
  assert.equal(next.state, 40);
  assert.equal(calls, 0);
  assert.equal(queue.size, 0);
  assert.equal(queue.lastSequence, 2);
  assert.equal(queue.nextSequence, 3);
  assert.equal(queue.push({ sequence: 3, input: { dx: 5 } }).status, STORED);
});

test("an acknowledgement behind a short queue leaves room to fill capacity", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  queue.push({ sequence: 3, input: { dx: 1 } });
  assert.equal(queue.acknowledge({ sequence: 13, state: 0, step: sumStep }).status, STALE);
  assert.equal(queue.lastSequence, null);
  assert.equal(queue.size, 1);
  const accepted = queue.acknowledge({ sequence: 0, state: 10, step: sumStep });
  assert.equal(accepted.status, ACKNOWLEDGED);
  assert.equal(accepted.state, 11);
  assert.deepEqual(sequences(accepted.applied), [3]);
  assert.equal(queue.push({ sequence: 4, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.push({ sequence: 5, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.push({ sequence: 6, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.push({ sequence: 7, input: { dx: 1 } }).status, OVERFLOW);
  const caughtUp = queue.acknowledge({ sequence: 7, state: 40, step: sumStep });
  assert.equal(caughtUp.status, ACKNOWLEDGED);
  assert.equal(caughtUp.state, 40);
  assert.equal(queue.size, 0);
  assert.equal(queue.lastSequence, 7);
  assert.equal(queue.nextSequence, 8);
});

test("a full 16-modulus queue rejects the halfway acknowledgement and accepts the next one", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 6 });
  fill(queue, 0, 6);
  assert.equal(queue.acknowledge({ sequence: 14, state: 0, step: sumStep }).status, STALE);
  assert.equal(queue.size, 6);
  const behind = queue.acknowledge({ sequence: 15, state: 3, step: sumStep });
  assert.equal(behind.status, ACKNOWLEDGED);
  assert.equal(behind.state, 9);
  assert.equal(queue.lastSequence, 15);
  assert.deepEqual(sequences(queue.pending()), [0, 1, 2, 3, 4, 5]);

  const caughtUp = queue.acknowledge({ sequence: 6, state: 80, step: sumStep });
  assert.equal(caughtUp.status, ACKNOWLEDGED);
  assert.equal(caughtUp.state, 80);
  assert.deepEqual(sequences(caughtUp.dropped), [0, 1, 2, 3, 4, 5]);
  assert.equal(queue.size, 0);
  assert.equal(queue.lastSequence, 6);
  assert.equal(queue.nextSequence, 7);
});

test("the smallest modulus wraps a single outstanding input", () => {
  const queue = new InputReplay({ modulus: 8, capacity: 1 });
  assert.equal(queue.push({ sequence: 7, input: { dx: 2 } }).status, STORED);
  assert.equal(queue.push({ sequence: 0, input: { dx: 2 } }).status, OVERFLOW);
  const acked = queue.acknowledge({ sequence: 7, state: 10, step: sumStep });
  assert.equal(acked.state, 10);
  assert.equal(queue.nextSequence, 0);
  assert.equal(queue.push({ sequence: 0, input: { dx: 9 } }).status, STORED);
  assert.equal(queue.replay(1, sumStep).state, 10);
});

test("a 32-bit modulus wraps from the top sequence back to zero", () => {
  const queue = new InputReplay({ modulus: 4294967296, capacity: 1 });
  assert.equal(queue.push({ sequence: 4294967295, input: { dx: 5 } }).status, STORED);
  assert.equal(queue.nextSequence, 0);
  assert.equal(queue.push({ sequence: 0, input: { dx: 1 } }).status, OVERFLOW);
  let calls = 0;
  const acked = queue.acknowledge({
    sequence: 4294967295,
    state: 10,
    step: () => {
      calls += 1;
      return 0;
    }
  });
  assert.equal(acked.status, ACKNOWLEDGED);
  assert.equal(acked.state, 10);
  assert.equal(calls, 0);
  assert.equal(queue.lastSequence, 4294967295);
  assert.equal(queue.nextSequence, 0);
  assert.equal(queue.size, 0);
  assert.equal(queue.push({ sequence: 0, input: { dx: 7 } }).status, STORED);
  assert.equal(queue.replay(10, sumStep).state, 17);
  assert.equal(queue.push({ sequence: -0, input: { dx: 1 } }).status, "duplicate");
});
