import assert from "node:assert/strict";
import test from "node:test";
import { InputReplay } from "../src/index.js";
import { assertThrowsUnchanged, fill, fingerprint } from "./helpers.js";

const MODULUS_MESSAGE = "modulus must be a power of two from 8 to 4294967296";

test("the constructor accepts a missing options object and frozen options", () => {
  const plain = new InputReplay();
  assert.equal(plain.modulus, 65536);
  assert.equal(plain.capacity, 64);
  assert.equal(plain.size, 0);
  assert.equal(plain.lastSequence, null);
  assert.equal(plain.nextSequence, null);
  assert.equal(plain.oldestSequence, null);
  assert.equal(plain.newestSequence, null);
  assert.deepEqual(plain.pending(), []);
  assert.deepEqual(Object.keys(plain), []);

  const frozen = new InputReplay(Object.freeze({ modulus: 256, capacity: 8, extra: true }));
  assert.equal(frozen.modulus, 256);
  assert.equal(frozen.capacity, 8);

  const bare = new InputReplay(Object.assign(Object.create(null), { modulus: 32, capacity: 2 }));
  assert.equal(bare.modulus, 32);
  assert.equal(bare.capacity, 2);

  const explicit = new InputReplay({ modulus: undefined, capacity: undefined });
  assert.equal(explicit.modulus, 65536);
  assert.equal(explicit.capacity, 64);
  assert.equal(new InputReplay(undefined).capacity, 64);
});

test("the constructor rejects a non-object options value", () => {
  for (const options of [null, [], 1, "x", true, false, () => {}]) {
    assert.throws(() => new InputReplay(options), {
      name: "TypeError",
      message: "options must be an object"
    });
  }
});

test("modulus must be a power of two inside the supported range", () => {
  for (const modulus of [
    0,
    1,
    2,
    4,
    6,
    7,
    9,
    12,
    24,
    -8,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    "16",
    null,
    true,
    65535,
    4294967295,
    4294967297,
    8589934592
  ]) {
    assert.throws(() => new InputReplay({ modulus }), {
      name: "RangeError",
      message: MODULUS_MESSAGE
    });
  }
  for (const modulus of [8, 16, 128, 256, 65536, 2147483648, 4294967296]) {
    const capacity = modulus < 256 ? 1 : undefined;
    const queue =
      capacity === undefined
        ? new InputReplay({ modulus })
        : new InputReplay({ modulus, capacity });
    assert.equal(queue.modulus, modulus);
  }
});

test("a bad modulus is reported before a bad capacity", () => {
  assert.throws(() => new InputReplay({ modulus: 6, capacity: 0 }), {
    name: "RangeError",
    message: MODULUS_MESSAGE
  });
});

test("capacity must be an integer inside the modulus ceiling", () => {
  assert.throws(() => new InputReplay({ capacity: 32767 }), {
    name: "RangeError",
    message: "capacity must be an integer from 1 to 32766"
  });
  assert.equal(new InputReplay({ capacity: 32766 }).capacity, 32766);
  assert.equal(new InputReplay({ capacity: 1 }).capacity, 1);
  for (const capacity of [0, -1, 1.5, NaN, Infinity, "8", null, true, -0]) {
    assert.throws(() => new InputReplay({ capacity }), {
      name: "RangeError",
      message: "capacity must be an integer from 1 to 32766"
    });
  }
  assert.throws(() => new InputReplay({ modulus: 16 }), {
    name: "RangeError",
    message: "capacity must be an integer from 1 to 6"
  });
  assert.throws(() => new InputReplay({ modulus: 128 }), {
    name: "RangeError",
    message: "capacity must be an integer from 1 to 62"
  });
  assert.equal(new InputReplay({ modulus: 256 }).capacity, 64);
  assert.equal(new InputReplay({ modulus: 16, capacity: 6 }).capacity, 6);
  assert.throws(() => new InputReplay({ modulus: 16, capacity: 7 }), {
    name: "RangeError",
    message: "capacity must be an integer from 1 to 6"
  });
  assert.throws(() => new InputReplay({ modulus: 8, capacity: 3 }), {
    name: "RangeError",
    message: "capacity must be an integer from 1 to 2"
  });
  const widest = new InputReplay({ modulus: 4294967296, capacity: 2147483646 });
  assert.equal(widest.capacity, 2147483646);
  assert.throws(() => new InputReplay({ modulus: 4294967296, capacity: 2147483647 }), {
    name: "RangeError",
    message: "capacity must be an integer from 1 to 2147483646"
  });
});

test("push rejects a non-object and a bad sequence without storing it", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  fill(queue, 1, 1);
  for (const record of [null, [], 1, "x", true, false]) {
    assertThrowsUnchanged(queue, () => queue.push(record), "TypeError", "input must be an object");
  }
  for (const sequence of [-1, 16, 1.5, NaN, Infinity, "1", null, true, 1n, undefined]) {
    assertThrowsUnchanged(
      queue,
      () => queue.push({ sequence, input: { dx: 1 } }),
      "RangeError",
      "sequence must be an integer from 0 to 15"
    );
  }
  assertThrowsUnchanged(
    queue,
    () => queue.push({ input: { dx: 1 } }),
    "RangeError",
    "sequence must be an integer from 0 to 15"
  );
  assert.equal(queue.size, 1);
});

test("acknowledge checks the object, the sequence, the state, and the step in that order", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  fill(queue, 1, 2);
  for (const ack of [null, [], 1, "x", false]) {
    assertThrowsUnchanged(
      queue,
      () => queue.acknowledge(ack),
      "TypeError",
      "acknowledgment must be an object"
    );
  }
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge({ sequence: 99, state: 0, step: () => 0 }),
    "RangeError",
    "sequence must be an integer from 0 to 15"
  );
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge({ state: 0, step: () => 0 }),
    "RangeError",
    "sequence must be an integer from 0 to 15"
  );
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge({ sequence: -1 }),
    "RangeError",
    "sequence must be an integer from 0 to 15"
  );
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge({ sequence: 1, step: "no" }),
    "RangeError",
    "state must be present"
  );
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge({ sequence: 1 }),
    "RangeError",
    "state must be present"
  );
  const inherited = Object.create({ state: 1, step: () => 0 });
  inherited.sequence = 1;
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge(inherited),
    "RangeError",
    "state must be present"
  );
  inherited.state = 1;
  assertThrowsUnchanged(
    queue,
    () => queue.acknowledge(inherited),
    "TypeError",
    "step must be a function"
  );
  for (const step of [undefined, null, 1, "step", {}]) {
    assertThrowsUnchanged(
      queue,
      () => queue.acknowledge({ sequence: 1, state: 0, step }),
      "TypeError",
      "step must be a function"
    );
  }
  const bare = Object.create(null);
  bare.sequence = 1;
  bare.state = { x: 4 };
  bare.step = (state) => state;
  const accepted = queue.acknowledge(bare);
  assert.equal(accepted.status, "acknowledged");
  assert.deepEqual(accepted.state, { x: 4 });
});

test("replay rejects a missing step function and does not require a state object", () => {
  const queue = new InputReplay();
  queue.push({ sequence: 3, input: { dx: 2 } });
  for (const step of [undefined, null, 1, "step", {}]) {
    assertThrowsUnchanged(
      queue,
      () => queue.replay(0, step),
      "TypeError",
      "step must be a function"
    );
  }
  assert.deepEqual(
    queue.replay(undefined, (state, entry) => entry.input.dx),
    {
      state: 2,
      applied: queue.pending()
    }
  );
});

test("a throwing step leaves the queue unchanged", () => {
  const queue = new InputReplay({ modulus: 16, capacity: 4 });
  fill(queue, 1, 3);
  const before = fingerprint(queue);
  let calls = 0;
  assert.throws(
    () =>
      queue.acknowledge({
        sequence: 1,
        state: 0,
        step: () => {
          calls += 1;
          if (calls === 2) {
            throw new Error("stop");
          }
          return 1;
        }
      }),
    { name: "Error", message: "stop" }
  );
  assert.equal(calls, 2);
  assert.deepEqual(fingerprint(queue), before);

  calls = 0;
  assert.throws(
    () =>
      queue.replay(0, () => {
        calls += 1;
        throw new Error("replay-stop");
      }),
    { message: "replay-stop" }
  );
  assert.equal(calls, 1);
  assert.deepEqual(fingerprint(queue), before);
});
