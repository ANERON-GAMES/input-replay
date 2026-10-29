import assert from "node:assert/strict";
import test from "node:test";
import { DUPLICATE, OUT_OF_ORDER, OVERFLOW, STALE, STORED, InputReplay } from "../src/index.js";
import { fingerprint } from "./helpers.js";

test("the first push accepts any in-range sequence and keeps the input reference", () => {
  const queue = new InputReplay();
  const payload = { dx: 4 };
  const record = { sequence: -0, input: payload, extra: true };
  const stored = queue.push(record);
  assert.equal(stored.status, STORED);
  assert.equal(stored.size, 1);
  assert.equal(stored.nextSequence, 1);
  assert.deepEqual(record, { sequence: -0, input: payload, extra: true });
  const [entry] = queue.pending();
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(entry.input, payload);
  assert.equal(Object.is(entry.sequence, 0), true);
  assert.deepEqual(Object.keys(entry), ["sequence", "input"]);
  assert.throws(() => {
    entry.sequence = 9;
  }, TypeError);
  const copy = queue.pending();
  copy.pop();
  assert.equal(queue.size, 1);
  assert.equal(queue.pending()[0], entry);
  assert.equal(queue.oldestSequence, 0);
  assert.equal(queue.newestSequence, 0);
});

test("a missing input field is stored as undefined and falsey values are kept", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  queue.push({ sequence: 1 });
  queue.push({ sequence: 2, input: 0 });
  queue.push({ sequence: 3, input: false });
  queue.push({ sequence: 4, input: "" });
  const pending = queue.pending();
  assert.equal(pending[0].input, undefined);
  assert.equal(pending[1].input, 0);
  assert.equal(pending[2].input, false);
  assert.equal(pending[3].input, "");
});

test("falsey and inherited inputs follow the own-property rule", () => {
  const queue = new InputReplay({ modulus: 32, capacity: 6 });
  assert.equal(queue.push({ sequence: 1, input: null }).status, STORED);
  assert.equal(queue.push({ sequence: 2, input: false }).status, STORED);
  const inherited = Object.create({ input: { dx: 9 } });
  inherited.sequence = 3;
  assert.equal(queue.push(inherited).status, STORED);
  const pending = queue.pending();
  assert.equal(pending[0].input, null);
  assert.equal(pending[1].input, false);
  assert.equal(pending[2].input, undefined);
});

test("push accepts only the next sequence and classifies the other results", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 3 });
  assert.equal(queue.push({ sequence: 5, input: { dx: 1 } }).status, STORED);
  const again = queue.push({ sequence: 5, input: { dx: 9 } });
  assert.equal(again.status, DUPLICATE);
  assert.equal(again.size, 1);
  assert.equal(again.nextSequence, 6);
  assert.equal(queue.pending()[0].input.dx, 1);

  assert.equal(queue.push({ sequence: 7, input: { dx: 1 } }).status, OUT_OF_ORDER);
  assert.equal(queue.push({ sequence: 4, input: { dx: 1 } }).status, STALE);
  assert.equal(queue.push({ sequence: 6, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.push({ sequence: 7, input: { dx: 1 } }).status, STORED);
  assert.equal(queue.size, 3);

  const overflow = queue.push({ sequence: 8, input: { dx: 1 } });
  assert.equal(overflow.status, OVERFLOW);
  assert.equal(overflow.size, 3);
  assert.equal(overflow.nextSequence, 8);
  assert.deepEqual(
    queue.pending().map((entry) => entry.sequence),
    [5, 6, 7]
  );

  const ahead = queue.push({ sequence: 9, input: { dx: 1 } });
  assert.equal(ahead.status, OUT_OF_ORDER);
  assert.equal(queue.size, 3);
  assert.equal(queue.push({ sequence: 6, input: { dx: 1 } }).status, DUPLICATE);

  const before = fingerprint(queue);
  assert.equal(queue.push({ sequence: 0, input: { dx: 1 } }).status, STALE);
  assert.deepEqual(fingerprint(queue), before);
});

test("an overflowed sequence can be stored after an acknowledgement frees a slot", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 2 });
  queue.push({ sequence: 1, input: { dx: 1 } });
  queue.push({ sequence: 2, input: { dx: 1 } });
  assert.equal(queue.push({ sequence: 3, input: { dx: 4 } }).status, OVERFLOW);
  const acked = queue.acknowledge({
    sequence: 1,
    state: 10,
    step: (state, entry) => state + entry.input.dx
  });
  assert.equal(acked.state, 11);
  assert.equal(queue.size, 1);
  const stored = queue.push({ sequence: 3, input: { dx: 4 } });
  assert.equal(stored.status, STORED);
  assert.equal(queue.size, 2);
  assert.deepEqual(
    queue.pending().map((entry) => entry.input.dx),
    [1, 4]
  );
});

test("separate queues do not share entries", () => {
  const first = new InputReplay({ modulus: 16, capacity: 4 });
  const second = new InputReplay({ modulus: 16, capacity: 4 });
  first.push({ sequence: 1, input: { dx: 1 } });
  assert.equal(second.size, 0);
  assert.equal(second.nextSequence, null);
  second.push({ sequence: 4, input: { dx: 3 } });
  assert.deepEqual(
    first.pending().map((entry) => entry.sequence),
    [1]
  );
});

test("reset clears the cursors and accepts a new first sequence", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  queue.push({ sequence: 3, input: { dx: 1 } });
  queue.acknowledge({
    sequence: 3,
    state: 1,
    step: (state) => state
  });
  assert.equal(queue.lastSequence, 3);
  assert.equal(queue.nextSequence, 4);
  queue.reset();
  assert.equal(queue.modulus, 16);
  assert.equal(queue.capacity, 4);
  assert.equal(queue.size, 0);
  assert.equal(queue.lastSequence, null);
  assert.equal(queue.nextSequence, null);
  assert.equal(queue.push({ sequence: 9, input: { dx: 2 } }).status, STORED);
  assert.equal(queue.nextSequence, 10);
});
