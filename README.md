# @aneron/input-replay

Client input queue that reconciles prediction by replaying unacknowledged inputs on authoritative state.

## Purpose

`@aneron/input-replay` stores a client's unacknowledged inputs in sequence order. Each input has a sequence number and a caller-supplied value. When an authoritative server state arrives with the last input sequence the server has applied, the queue drops every stored input up to and including that sequence. It then runs the remaining inputs through a caller-supplied step function, starting from that server state. The value returned by the last step is the corrected predicted state.

The default sequence space is 16-bit. Numbers run from `0` through `65535` and then wrap to `0`. A caller can select any power-of-two modulus from `8` through `4294967296`. The queue holds at most a configured number of unacknowledged inputs. A push past that limit returns an overflow result and leaves the queue unchanged.

An acknowledgement of the sequence that is already the latest acknowledgement is a duplicate. It drops nothing and replays the current queue from the supplied state. An acknowledgement that is behind the latest acknowledgement, or that cannot be ordered against the stored inputs, is stale. It does not call the step function and does not change the queue.

The caller passes every state value and the step function. The package does not read a clock, start a timer, draw a random number, read an environment, or open a network connection. It has no runtime dependencies.

## Install

The package is an ES module. It needs Node.js 20 or newer.

```bash
npm install @aneron/input-replay
```

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/input-replay.git
cd input-replay
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

```js
import { InputReplay } from "@aneron/input-replay";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

`dx` below is part of the caller-supplied input value. The queue does not interpret it. The step function adds it to `state.x`.

```js
import { InputReplay } from "@aneron/input-replay";

function step(state, entry) {
  return { x: state.x + entry.input.dx };
}

const queue = new InputReplay();

queue.push({ sequence: 1, input: { dx: 2 } });
queue.push({ sequence: 2, input: { dx: 3 } });
queue.push({ sequence: 3, input: { dx: 4 } });

const predicted = queue.replay({ x: 0 }, step);
```

`predicted.state.x` is `9`. `predicted.applied` has length `3`. `queue.size` stays `3`.

```js
const corrected = queue.acknowledge({
  sequence: 1,
  state: { x: 10 },
  step
});
```

`corrected.status` is `"acknowledged"`. `corrected.state.x` is `17`. `corrected.dropped` sequences are `[1]`. `corrected.applied` sequences are `[2, 3]`. `queue.lastSequence` is `1`. `queue.nextSequence` is `4`. `queue.size` is `2`. `queue.oldestSequence` is `2`. `queue.newestSequence` is `3`.

A second acknowledgement of sequence `1` is a duplicate. The queue replays sequences `2` and `3` again from the supplied state.

```js
const again = queue.acknowledge({
  sequence: 1,
  state: { x: 10 },
  step
});
```

`again.status` is `"duplicate"`. `again.state.x` is `17`. `again.dropped` is empty. `queue.size` stays `2`.

An older acknowledgement is ignored.

```js
const late = queue.acknowledge({
  sequence: 0,
  state: { x: 0 },
  step
});
```

`late.status` is `"stale"`. `late.state` is `null`. `queue.lastSequence` stays `1`. `queue.size` stays `2`.

A push that skips sequence `4` is refused.

```js
const skip = queue.push({ sequence: 5, input: { dx: 1 } });
```

`skip.status` is `"out-of-order"`. `queue.nextSequence` stays `4`.

The same rules cross a wrap. With modulus `16`, sequences `15`, `0`, and `1` are contiguous. Acknowledging `15` from state `{ x: 100 }` drops `15` and applies `dx` values `2` and `4`.

```js
const wrapped = new InputReplay({ modulus: 16, capacity: 4 });

wrapped.push({ sequence: 15, input: { dx: 1 } });
wrapped.push({ sequence: 0, input: { dx: 2 } });
wrapped.push({ sequence: 1, input: { dx: 4 } });

const across = wrapped.acknowledge({
  sequence: 15,
  state: { x: 100 },
  step
});
```

`across.status` is `"acknowledged"`. `across.state.x` is `106`. `across.dropped` sequences are `[15]`. `across.applied` sequences are `[0, 1]`. `wrapped.nextSequence` is `2`.

A full queue refuses the next input. Nothing is evicted.

```js
const limited = new InputReplay({ modulus: 16, capacity: 2 });

limited.push({ sequence: 1, input: { dx: 1 } });
limited.push({ sequence: 2, input: { dx: 1 } });

const full = limited.push({ sequence: 3, input: { dx: 1 } });
```

`full.status` is `"overflow"`. `limited.size` is `2`. `limited.nextSequence` is `3`. `limited.pending()` sequences are `[1, 2]`.

## API

All methods are deterministic. They do not read a clock, a network, or the filesystem. `push` does not mutate the object passed to it. `acknowledge` does not mutate the object passed to it. Stored records are frozen. The input value inside a record is not cloned and is not frozen.

### Constants

| Export             | Value            |
| ------------------ | ---------------- |
| `MIN_MODULUS`      | `8`              |
| `MAX_MODULUS`      | `4294967296`     |
| `DEFAULT_MODULUS`  | `65536`          |
| `DEFAULT_CAPACITY` | `64`             |
| `MAX_CAPACITY`     | `32766`          |
| `STORED`           | `"stored"`       |
| `DUPLICATE`        | `"duplicate"`    |
| `STALE`            | `"stale"`        |
| `OVERFLOW`         | `"overflow"`     |
| `OUT_OF_ORDER`     | `"out-of-order"` |
| `ACKNOWLEDGED`     | `"acknowledged"` |

`PUSH_STATUSES` is a frozen array of the five push status strings, in the order `stored`, `duplicate`, `stale`, `overflow`, `out-of-order`.

`ACK_STATUSES` is a frozen array of the three acknowledgement status strings, in the order `acknowledged`, `duplicate`, `stale`.

`MAX_CAPACITY` is the capacity ceiling for the default modulus. For another modulus `m` the ceiling is `m / 2 - 2`.

### `new InputReplay(options)`

Create a queue. `options` may be omitted. It must be an object and must not be an array. Any other value throws `TypeError` with the message `options must be an object`.

Own fields are read. An omitted field, or a field whose value is `undefined`, uses the default. Unknown fields are ignored. A frozen object and an object with a null prototype are accepted.

| Field      | Default | Accepted values                                                                                                                             |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `modulus`  | `65536` | A power of two from `8` through `4294967296`.                                                                                               |
| `capacity` | `64`    | An integer from `1` through `modulus / 2 - 2`. The default `64` is legal when that ceiling is at least `64`, which starts at modulus `256`. |

A bad `modulus` or `capacity` throws `RangeError`. `modulus` is checked first. The messages are:

- `modulus must be a power of two from 8 to 4294967296`
- `capacity must be an integer from 1 to N`

`N` is the ceiling for the modulus that was accepted. For the default modulus, `N` is `32766`. A modulus below `256` does not accept the default capacity. Pass `capacity` explicitly. Before any input is stored and before any acknowledgement, `size` is `0`, `lastSequence` is `null`, `nextSequence` is `null`, `oldestSequence` is `null`, and `newestSequence` is `null`.

### `queue.push(record)`

Append the next input.

`record` must be an object and must not be an array. Otherwise the method throws `TypeError` with the message `input must be an object`.

| Field      | Required | Meaning                                                                                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sequence` | yes      | An integer from `0` through `modulus - 1`. `-0` is stored as `0`.                                                                                      |
| `input`    | no       | Stored by reference. A missing field, or a field inherited from the prototype, is stored as `undefined`. `0`, `false`, `null`, and `""` stay as given. |

Checks run in this order. The first failure wins. A throw leaves the queue unchanged.

1. `record` is an object.
2. `sequence` is an integer from `0` through `modulus - 1`. Otherwise `RangeError`: `sequence must be an integer from 0 to M`, where `M` is `modulus - 1`.

The return value is a plain object:

| Field          | Meaning                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | One of the `PUSH_STATUSES` strings.                                                                                                                 |
| `size`         | The number of stored inputs after the call.                                                                                                         |
| `nextSequence` | The sequence the next successful push must use, or `null` before the first push and after `reset`, when no acknowledgement has set a cursor either. |

Status values, checked in this order:

| Status           | Meaning                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `"duplicate"`    | That sequence is already stored. The new input value is ignored.                                                              |
| `"stored"`       | The sequence is the first sequence, or it equals `nextSequence`, and `size` is below `capacity`.                              |
| `"overflow"`     | The sequence equals `nextSequence` and `size` is already `capacity`. The input is not stored, and no stored input is evicted. |
| `"out-of-order"` | The sequence is strictly ahead of `nextSequence` and is not stored.                                                           |
| `"stale"`        | The sequence is behind `nextSequence`, or it sits on the halfway boundary. It is not stored.                                  |

Before the first push, and after `reset` when no acknowledgement has been accepted, every in-range sequence is eligible. That push sets `nextSequence` to the following sequence, wrapping to `0` after `modulus - 1`.

After that, the only sequence that can be stored is `nextSequence`. A later `push` of a skipped sequence stays `"out-of-order"` until the missing sequence has been stored or an acknowledgement has moved `nextSequence` past it. `"duplicate"`, `"overflow"`, `"out-of-order"`, and `"stale"` do not change the stored inputs or `nextSequence`.

The input object is not mutated. Extra fields are not copied. The stored record is `{ sequence, input }` and it is frozen. Mutating an object passed as `input` changes the value later returned by `pending`, `acknowledge`, and `replay`.

### `queue.acknowledge(ack)`

Drop acknowledged inputs and replay the ones that remain.

`ack` must be an object and must not be an array. Otherwise the method throws `TypeError` with the message `acknowledgment must be an object`.

| Field      | Required | Meaning                                                                                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `sequence` | yes      | The last input sequence the server has applied. An integer from `0` through `modulus - 1`.                                               |
| `state`    | yes      | The authoritative state after that sequence. The key must be an own property. Any value is kept, including `undefined`, `null`, and `0`. |
| `step`     | yes      | A function `(state, entry) => nextState`. The key must be an own property. `entry` is a stored record.                                   |

Checks run in this order. The first failure wins. A throw leaves the queue unchanged. A throw from `step` also leaves the queue unchanged. Mutations that `step` already made to `state` are not undone.

1. `ack` is an object.
2. `sequence` is an integer from `0` through `modulus - 1`. Otherwise `RangeError` with the same message as `push`.
3. `state` is an own property. Otherwise `RangeError`: `state must be present`.
4. `step` is an own property and a function. Otherwise `TypeError`: `step must be a function`.

The return value is a plain object:

| Field          | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| `status`       | One of the `ACK_STATUSES` strings.                                                        |
| `state`        | The corrected state, or `null` when the status is `"stale"`.                              |
| `dropped`      | Stored records removed by this call, oldest first. Empty for `"duplicate"` and `"stale"`. |
| `applied`      | Stored records passed to `step`, oldest first. Empty for `"stale"`.                       |
| `lastSequence` | The latest accepted acknowledgement after the call.                                       |
| `nextSequence` | The next sequence a push must use after the call.                                         |
| `size`         | The number of stored inputs after the call.                                               |

`step` is called once per applied record, as `step(state, entry)`. The first call receives the `state` from `ack`. Each later call receives the previous return value. The result `state` is the last return value. When nothing is applied, `step` is not called and the result `state` is the `state` from `ack`, the same reference.

`"duplicate"` means `sequence` equals `lastSequence`. The queue is not changed. The remaining inputs are replayed from the supplied state, so a repeated acknowledgement can carry a new authoritative state for the same sequence.

`"stale"` means the acknowledgement is not strictly ahead of `lastSequence`, or it cannot be ordered against the stored inputs, or accepting it would leave the following sequence on the halfway boundary. `step` is not called. `state` is `null`. The queue is not changed.

`"acknowledged"` means the acknowledgement was accepted. Every stored input that is not strictly ahead of `sequence` is dropped. The inputs that are strictly ahead of `sequence` stay stored, in order, and are replayed. `lastSequence` becomes `sequence`. If the queue is empty after the drop, `nextSequence` becomes the sequence after `sequence`. If any input remains, `nextSequence` stays on the sequence after the newest stored input.

An acknowledgement that is strictly ahead of every stored input drops the whole queue and replays nothing. The returned state is the authoritative state. Inputs the queue never stored are not invented.

`step` must not call `push`, `acknowledge`, `replay`, or `reset` on the same queue. The step function is the caller's pure transition from `(state, entry)` to the next state.

### `queue.replay(state, step)`

Fold the stored inputs without dropping them.

`step` must be a function. Otherwise the method throws `TypeError` with the message `step must be a function`. `state` may be any value.

The return value is `{ state, applied }`. `applied` is the stored records, oldest first. `state` is the last return value from `step`, or the `state` argument when the queue is empty. `step` is not called when the queue is empty. A throw from `step` leaves the queue unchanged.

`replay` does not change `size`, `lastSequence`, `nextSequence`, or the stored records. `acknowledge` uses the same fold after it has chosen which records remain.

### `queue.pending()`

Return a new array of the stored records, oldest first. The array is a copy. The records are the frozen objects stored in the queue. Mutating the returned array does not change the queue. Reassigning `sequence` or `input` on a record throws.

### `queue.reset()`

Drop every stored input. Set `lastSequence` and `nextSequence` to `null`. `modulus` and `capacity` stay as constructed. Nothing is returned.

### Getters

| Getter           | Meaning                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `modulus`        | The sequence modulus.                                                                         |
| `capacity`       | The maximum number of stored inputs.                                                          |
| `size`           | The number of stored inputs.                                                                  |
| `lastSequence`   | The latest accepted acknowledgement, or `null` before the first acceptance and after `reset`. |
| `nextSequence`   | The only sequence `push` will store, or `null` when the queue has no cursor.                  |
| `oldestSequence` | The oldest stored sequence, or `null` when the queue is empty.                                |
| `newestSequence` | The newest stored sequence, or `null` when the queue is empty.                                |

`size` is at most `capacity`. Stored sequences are contiguous in modulus order: each sequence is one greater than the previous, wrapping from `modulus - 1` to `0`.

### Errors

`TypeError` means `options`, the push record, or the acknowledgement was not an object, or `step` was not a function.

`RangeError` means a number was missing or outside its range. The `message` strings are stable and are listed above. A `RangeError` or `TypeError` from `push`, `acknowledge`, or `replay` does not change the queue.

## Design

The sequence number is a serial number on a ring of size `modulus`. It wraps from `modulus - 1` to `0`. Comparison uses the forward distance `(to - from) mod modulus`. Distance `0` is the same sequence. A distance from `1` through `modulus / 2 - 1` is strictly ahead. Distance `modulus / 2` is the halfway boundary and is not ahead. A larger distance is behind.

For modulus `16`, distances `1` through `7` are ahead of the origin, distance `8` is the boundary, and distances `9` through `15` are behind. The capacity ceiling for that modulus is `6`.

The ceiling is `modulus / 2 - 2`, so `MAX_CAPACITY` for the default modulus is `32766`. One slot of the forward half is reserved so that an acknowledgement placed immediately before a full queue, and the sequence just after that queue, both stay strictly ahead of each other under the half rule. The queue can accept that next acknowledgement and does not stall on the boundary. An acknowledgement behind the stored run is accepted only when the run can still grow to `capacity` and the sequence after that full run stays strictly ahead of the acknowledgement. A farther acknowledgement is stale. The minimum modulus is `8`, which has a ceiling of `2`. A smaller ring cannot keep a stored input and still move the acknowledgement forward.

`push` extends one contiguous run. The first stored sequence may be any in-range value. Every later stored sequence is exactly the next one. A gap is `"out-of-order"` and is not filled in later by itself. A sequence already in the run is `"duplicate"`. A sequence behind the cursor, including one that was already acknowledged and removed, is `"stale"`.

Overflow refuses the new input. Evicting an unacknowledged input would drop a command the server may still apply, and the replay would skip it. The caller stops producing inputs until an acknowledgement frees a slot, then pushes the same next sequence.

`acknowledge` treats `sequence` as the newest input included in the authoritative state. Stored inputs at or behind that sequence are dropped. Stored inputs strictly ahead of it are replayed in order. The step function is the simulation. The queue does not store the resulting state. The caller keeps the returned value and can pass a later server state on the next acknowledgement.

A duplicate acknowledgement is the same `lastSequence` delivered again. It is not an error. The queue replays whatever is still stored, from the state included in this delivery. A stale acknowledgement is an out-of-order delivery: it is strictly behind `lastSequence`, it is the halfway boundary, or ordering it against the stored run would be ambiguous. It is ignored. A caller that must abandon the cursor calls `reset` and starts a new run.

Sequences `65534`, `65535`, `0`, and `1`, then an acknowledgement of `65535`, leave `0` and `1` queued.

Each `InputReplay` keeps its own state. The module has no mutable shared state. Two queues do not share records.

The same inputs produce the same results. `push`, `acknowledge`, and `replay` do not read a clock, a timer, or a random source.

## License

MIT. Copyright (c) 2026 Vadim Gubin. See [LICENSE](LICENSE).
