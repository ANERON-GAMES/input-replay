import assert from "node:assert/strict";
import test from "node:test";
import { InputReplay } from "../src/index.js";
import { fingerprint, forward, mulberry32, sequences } from "./helpers.js";

function assertQueue(queue, label) {
  const modulus = queue.modulus;
  const half = modulus / 2;
  const pending = queue.pending();
  assert.equal(pending.length, queue.size, label);
  assert.equal(queue.size <= queue.capacity, true, label);
  if (queue.size === 0) {
    assert.equal(queue.oldestSequence, null, label);
    assert.equal(queue.newestSequence, null, label);
    if (queue.lastSequence === null) {
      assert.equal(queue.nextSequence, null, label);
    } else {
      assert.equal(queue.nextSequence, (queue.lastSequence + 1) % modulus, label);
    }
  } else {
    assert.equal(queue.oldestSequence, pending[0].sequence, label);
    assert.equal(queue.newestSequence, pending[pending.length - 1].sequence, label);
    assert.equal(queue.nextSequence, (queue.newestSequence + 1) % modulus, label);
    for (let index = 1; index < pending.length; index += 1) {
      assert.equal(pending[index].sequence, (pending[index - 1].sequence + 1) % modulus, label);
    }
    if (queue.lastSequence !== null) {
      const span = forward(queue.lastSequence, queue.newestSequence, modulus);
      assert.equal(span > 0 && span < half, true, label);
      assert.equal(span + 1 < half, true, label);
      for (const entry of pending) {
        const delta = forward(queue.lastSequence, entry.sequence, modulus);
        assert.equal(delta > 0 && delta < half, true, label);
      }
    }
  }
  let sum = 0;
  for (const entry of pending) {
    sum += entry.input.dx;
  }
  const folded = queue.replay(0, (state, entry) => state + entry.input.dx);
  assert.equal(folded.state, sum, label);
  assert.equal(folded.applied.length, pending.length, label);
}

test("random operations keep the queue ordered and the fold exact", () => {
  const modulus = 16;
  const queue = new InputReplay({ modulus, capacity: 4 });
  const random = mulberry32(0x1a2b3c4d);
  for (let step = 0; step < 500; step += 1) {
    const label = `step ${step}`;
    const roll = random() % 10;
    if (roll <= 3) {
      const sequence = queue.nextSequence === null ? random() % modulus : queue.nextSequence;
      const result = queue.push({ sequence, input: { dx: 1 } });
      assert.equal(
        result.status === "stored" || result.status === "overflow",
        true,
        `${label} ${result.status}`
      );
    } else if (roll <= 6) {
      const before = fingerprint(queue);
      const result = queue.push({ sequence: random() % modulus, input: { dx: 1 } });
      if (result.status !== "stored") {
        assert.deepEqual(fingerprint(queue), before, label);
      }
    } else if (roll <= 8) {
      const sequence = random() % modulus;
      const pending = sequences(queue.pending());
      const before = fingerprint(queue);
      const result = queue.acknowledge({
        sequence,
        state: 100,
        step: (state, entry) => state + entry.input.dx
      });
      if (result.status === "stale") {
        assert.deepEqual(fingerprint(queue), before, label);
        assert.equal(result.state, null, label);
        assert.equal(result.dropped.length, 0, label);
        assert.equal(result.applied.length, 0, label);
      } else {
        let expected = 100;
        for (const entry of result.applied) {
          expected += entry.input.dx;
        }
        assert.equal(result.state, expected, label);
        assert.deepEqual(sequences(queue.pending()), sequences(result.applied), label);
        if (result.status === "acknowledged") {
          assert.deepEqual(
            sequences(result.dropped).concat(sequences(result.applied)),
            pending,
            label
          );
        } else {
          assert.equal(result.status, "duplicate", label);
          assert.deepEqual(sequences(result.dropped), [], label);
          assert.deepEqual(sequences(result.applied), pending, label);
        }
      }
    } else if (random() % 2 === 0) {
      queue.reset();
    } else if (queue.lastSequence !== null) {
      const pending = sequences(queue.pending());
      const result = queue.acknowledge({
        sequence: queue.lastSequence,
        state: 4,
        step: (state, entry) => state + entry.input.dx
      });
      assert.equal(result.status, "duplicate", label);
      let expected = 4;
      for (const entry of result.applied) {
        expected += entry.input.dx;
      }
      assert.equal(result.state, expected, label);
      assert.deepEqual(sequences(result.applied), pending, label);
    }
    assertQueue(queue, label);
  }
});
