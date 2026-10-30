import assert from "node:assert/strict";
import test from "node:test";
import { InputReplay } from "../src/index.js";
import { fingerprint, sequences } from "./helpers.js";

function step(state, entry) {
  return { x: state.x + entry.input.dx };
}

test("the documented prediction and reconciliation numbers", () => {
  const queue = new InputReplay();
  queue.push({ sequence: 1, input: { dx: 2 } });
  queue.push({ sequence: 2, input: { dx: 3 } });
  queue.push({ sequence: 3, input: { dx: 4 } });

  const predicted = queue.replay({ x: 0 }, step);
  assert.equal(predicted.state.x, 9);
  assert.equal(predicted.applied.length, 3);
  assert.equal(queue.size, 3);
  assert.deepEqual(sequences(predicted.applied), [1, 2, 3]);

  const corrected = queue.acknowledge({
    sequence: 1,
    state: { x: 10 },
    step
  });
  assert.equal(corrected.status, "acknowledged");
  assert.equal(corrected.state.x, 17);
  assert.deepEqual(sequences(corrected.dropped), [1]);
  assert.deepEqual(sequences(corrected.applied), [2, 3]);
  assert.equal(queue.lastSequence, 1);
  assert.equal(queue.nextSequence, 4);
  assert.equal(queue.size, 2);
  assert.equal(queue.oldestSequence, 2);
  assert.equal(queue.newestSequence, 3);

  const again = queue.acknowledge({
    sequence: 1,
    state: { x: 10 },
    step
  });
  assert.equal(again.status, "duplicate");
  assert.equal(again.state.x, 17);
  assert.deepEqual(again.dropped, []);
  assert.equal(queue.size, 2);

  const late = queue.acknowledge({
    sequence: 0,
    state: { x: 0 },
    step
  });
  assert.equal(late.status, "stale");
  assert.equal(late.state, null);
  assert.equal(queue.lastSequence, 1);
  assert.equal(queue.size, 2);

  const skip = queue.push({ sequence: 5, input: { dx: 1 } });
  assert.equal(skip.status, "out-of-order");
  assert.equal(queue.nextSequence, 4);
});

test("the documented wrap and overflow numbers", () => {
  const wrapped = new InputReplay({ modulus: 16, capacity: 4 });
  wrapped.push({ sequence: 15, input: { dx: 1 } });
  wrapped.push({ sequence: 0, input: { dx: 2 } });
  wrapped.push({ sequence: 1, input: { dx: 4 } });
  const across = wrapped.acknowledge({
    sequence: 15,
    state: { x: 100 },
    step
  });
  assert.equal(across.status, "acknowledged");
  assert.equal(across.state.x, 106);
  assert.deepEqual(sequences(across.dropped), [15]);
  assert.deepEqual(sequences(across.applied), [0, 1]);
  assert.equal(wrapped.nextSequence, 2);

  const limited = new InputReplay({ modulus: 16, capacity: 2 });
  limited.push({ sequence: 1, input: { dx: 1 } });
  limited.push({ sequence: 2, input: { dx: 1 } });
  const full = limited.push({ sequence: 3, input: { dx: 1 } });
  assert.equal(full.status, "overflow");
  assert.equal(limited.size, 2);
  assert.equal(limited.nextSequence, 3);
  assert.deepEqual(sequences(limited.pending()), [1, 2]);
});

test("replay does not change the queue and folds in stored order", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  queue.push({ sequence: 1, input: { dx: 2 } });
  queue.push({ sequence: 2, input: { dx: 3 } });
  const before = fingerprint(queue);
  const first = queue.replay(10, (state, entry) => state + entry.input.dx);
  const second = queue.replay(10, (state, entry) => state + entry.input.dx);
  assert.equal(first.state, 15);
  assert.deepEqual(first, second);
  assert.equal(first.applied[0], queue.pending()[0]);
  assert.deepEqual(fingerprint(queue), before);
  const empty = new InputReplay().replay({ x: 1 }, () => {
    throw new Error("unused");
  });
  assert.deepEqual(empty, { state: { x: 1 }, applied: [] });
});

test("the same operations on two queues produce the same results", () => {
  function run() {
    const queue = new InputReplay({ modulus: 16, capacity: 4 });
    queue.push({ sequence: 14, input: { dx: 1 } });
    queue.push({ sequence: 15, input: { dx: 1 } });
    queue.push({ sequence: 0, input: { dx: 1 } });
    const acked = queue.acknowledge({
      sequence: 15,
      state: 5,
      step: (state, entry) => state + entry.input.dx
    });
    return {
      status: acked.status,
      state: acked.state,
      dropped: sequences(acked.dropped),
      applied: sequences(acked.applied),
      pending: sequences(queue.pending()),
      lastSequence: queue.lastSequence,
      nextSequence: queue.nextSequence
    };
  }
  assert.deepEqual(run(), run());
});
