import assert from "node:assert/strict";
import test from "node:test";
import { ACKNOWLEDGED, DUPLICATE, STALE, InputReplay } from "../src/index.js";
import { fill, fingerprint, sequences } from "./helpers.js";

function sumStep(state, entry) {
  return state + entry.input.dx;
}

test("an acknowledgement drops the prefix and replays the suffix in order", () => {
  const queue = new InputReplay({ modulus: 32, capacity: 8 });
  const calls = [];
  queue.push({ sequence: 4, input: { dx: 1 } });
  queue.push({ sequence: 5, input: { dx: 10 } });
  queue.push({ sequence: 6, input: { dx: 100 } });
  const kept = queue.pending();
  const result = queue.acknowledge({
    sequence: 5,
    state: 7,
    step(state, entry) {
      calls.push({ state, sequence: entry.sequence, input: entry.input });
      return state + entry.input.dx;
    }
  });
  assert.equal(result.status, ACKNOWLEDGED);
  assert.equal(result.state, 107);
  assert.deepEqual(sequences(result.dropped), [4, 5]);
  assert.deepEqual(sequences(result.applied), [6]);
  assert.equal(result.dropped[0], kept[0]);
  assert.equal(result.dropped[1], kept[1]);
  assert.equal(result.applied[0], kept[2]);
  assert.deepEqual(calls, [{ state: 7, sequence: 6, input: { dx: 100 } }]);
  assert.equal(result.lastSequence, 5);
  assert.equal(result.nextSequence, 7);
  assert.equal(result.size, 1);
  assert.equal(queue.lastSequence, 5);
  assert.equal(queue.nextSequence, 7);
  assert.equal(queue.oldestSequence, 6);
  assert.equal(queue.newestSequence, 6);
  assert.equal(queue.pending()[0], kept[2]);
  result.dropped.push(kept[2]);
  result.applied.pop();
  assert.deepEqual(sequences(queue.pending()), [6]);
});

test("the corrected state replaces a local prediction that diverged from the server", () => {
  const queue = new InputReplay();
  const step = (state, entry) => ({ x: state.x + entry.input.dx, y: state.y + entry.input.dy });
  queue.push({ sequence: 1, input: { dx: 1, dy: 0 } });
  queue.push({ sequence: 2, input: { dx: 1, dy: 0 } });
  queue.push({ sequence: 3, input: { dx: 0, dy: 5 } });
  const local = queue.replay({ x: 0, y: 0 }, step);
  assert.deepEqual(local.state, { x: 2, y: 5 });
  assert.equal(queue.size, 3);
  const corrected = queue.acknowledge({
    sequence: 2,
    state: { x: 9, y: 4 },
    step
  });
  assert.deepEqual(corrected.state, { x: 9, y: 9 });
  assert.deepEqual(sequences(corrected.applied), [3]);
  assert.equal(queue.size, 1);
});

test("a duplicate acknowledgement replays from the new state and drops nothing", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  fill(queue, 1, 3);
  const first = queue.acknowledge({ sequence: 1, state: 10, step: sumStep });
  assert.equal(first.state, 12);
  const pending = queue.pending();
  let calls = 0;
  const again = queue.acknowledge({
    sequence: 1,
    state: 50,
    step(state, entry) {
      calls += 1;
      return sumStep(state, entry);
    }
  });
  assert.equal(again.status, DUPLICATE);
  assert.equal(again.state, 52);
  assert.deepEqual(again.dropped, []);
  assert.deepEqual(sequences(again.applied), [2, 3]);
  assert.equal(again.applied[0], pending[0]);
  assert.equal(calls, 2);
  assert.equal(queue.lastSequence, 1);
  assert.equal(queue.size, 2);
  assert.equal(queue.nextSequence, 4);
});

test("a stale acknowledgement does not call step and does not move the cursors", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  fill(queue, 2, 3);
  queue.acknowledge({ sequence: 3, state: 0, step: sumStep });
  const before = fingerprint(queue);
  let calls = 0;
  const late = queue.acknowledge({
    sequence: 2,
    state: 99,
    step: () => {
      calls += 1;
      return 0;
    }
  });
  assert.equal(late.status, STALE);
  assert.equal(late.state, null);
  assert.deepEqual(late.dropped, []);
  assert.deepEqual(late.applied, []);
  assert.equal(late.lastSequence, 3);
  assert.equal(calls, 0);
  assert.deepEqual(fingerprint(queue), before);

  const ambiguous = queue.acknowledge({
    sequence: 3 + 8,
    state: 1,
    step: () => {
      calls += 1;
      return 1;
    }
  });
  assert.equal(ambiguous.status, STALE);
  assert.equal(calls, 0);
  assert.deepEqual(fingerprint(queue), before);
});

test("an acknowledgement ahead of the newest input drops the queue", () => {
  const queue = new InputReplay({ modulus: 32, capacity: 8 });
  fill(queue, 1, 3);
  let calls = 0;
  const ahead = queue.acknowledge({
    sequence: 6,
    state: { x: 4 },
    step: () => {
      calls += 1;
      return { x: 0 };
    }
  });
  assert.equal(ahead.status, ACKNOWLEDGED);
  assert.deepEqual(ahead.state, { x: 4 });
  assert.equal(ahead.state, queue.replay(ahead.state, () => ({ x: 0 })).state);
  assert.deepEqual(sequences(ahead.dropped), [1, 2, 3]);
  assert.deepEqual(ahead.applied, []);
  assert.equal(calls, 0);
  assert.equal(queue.size, 0);
  assert.equal(queue.lastSequence, 6);
  assert.equal(queue.nextSequence, 7);
  assert.equal(queue.oldestSequence, null);
  assert.equal(queue.push({ sequence: 6, input: { dx: 1 } }).status, STALE);
  assert.equal(queue.push({ sequence: 7, input: { dx: 1 } }).status, "stored");
});

test("the first acknowledgement can land before, inside, or after an unconfirmed queue", () => {
  const behind = new InputReplay({ modulus: 16, capacity: 4 });
  fill(behind, 4, 3);
  const early = behind.acknowledge({ sequence: 2, state: 10, step: sumStep });
  assert.equal(early.status, ACKNOWLEDGED);
  assert.equal(early.state, 13);
  assert.deepEqual(early.dropped, []);
  assert.deepEqual(sequences(early.applied), [4, 5, 6]);
  assert.equal(behind.lastSequence, 2);
  assert.equal(behind.nextSequence, 7);
  assert.equal(behind.size, 3);

  const inside = new InputReplay({ modulus: 16, capacity: 4 });
  fill(inside, 4, 3);
  const middle = inside.acknowledge({ sequence: 4, state: 10, step: sumStep });
  assert.deepEqual(sequences(middle.dropped), [4]);
  assert.deepEqual(sequences(middle.applied), [5, 6]);
  assert.equal(middle.state, 12);

  const exact = new InputReplay({ modulus: 16, capacity: 4 });
  fill(exact, 4, 3);
  let calls = 0;
  const done = exact.acknowledge({
    sequence: 6,
    state: 8,
    step: () => {
      calls += 1;
      return 0;
    }
  });
  assert.equal(done.state, 8);
  assert.equal(calls, 0);
  assert.equal(exact.size, 0);
  assert.equal(exact.nextSequence, 7);
});

test("acknowledgements on an empty queue move the next sequence forward", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  let calls = 0;
  const step = () => {
    calls += 1;
    return 1;
  };
  const first = queue.acknowledge({ sequence: 5, state: 20, step });
  assert.equal(first.status, ACKNOWLEDGED);
  assert.equal(first.state, 20);
  assert.equal(calls, 0);
  assert.equal(queue.lastSequence, 5);
  assert.equal(queue.nextSequence, 6);
  assert.equal(queue.size, 0);

  const duplicate = queue.acknowledge({ sequence: 5, state: 21, step });
  assert.equal(duplicate.status, DUPLICATE);
  assert.equal(duplicate.state, 21);
  assert.equal(calls, 0);
  assert.equal(queue.nextSequence, 6);

  const stale = queue.acknowledge({ sequence: 4, state: 0, step });
  assert.equal(stale.status, STALE);
  assert.equal(stale.state, null);
  assert.equal(queue.lastSequence, 5);

  const forward = queue.acknowledge({ sequence: 12, state: 3, step });
  assert.equal(forward.status, ACKNOWLEDGED);
  assert.equal(queue.lastSequence, 12);
  assert.equal(queue.nextSequence, 13);

  const halfway = queue.acknowledge({ sequence: 4, state: 3, step });
  assert.equal(halfway.status, STALE);
  assert.equal(queue.lastSequence, 12);
  assert.equal(calls, 0);
});

test("state is returned by reference when nothing is replayed and undefined is allowed", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 2 });
  const state = { x: 1 };
  queue.push({ sequence: 1, input: { dx: 1 } });
  const result = queue.acknowledge({
    sequence: 1,
    state,
    step: () => {
      throw new Error("unused");
    }
  });
  assert.equal(result.state, state);
  const empty = new InputReplay({ modulus: 16, capacity: 2 });
  const withUndefined = empty.acknowledge({
    sequence: 0,
    state: undefined,
    step: (value) => value
  });
  assert.equal(withUndefined.state, undefined);
});

test("the acknowledgement object is not mutated", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 2 });
  queue.push({ sequence: 1, input: { dx: 1 } });
  const step = (state) => state;
  const ack = Object.freeze({ sequence: 1, state: 5, step, note: "keep" });
  const result = queue.acknowledge(ack);
  assert.equal(result.state, 5);
  assert.equal(ack.note, "keep");
  assert.equal(ack.sequence, 1);
});
