# Getting started with neuropile

Everything you need to run a brain in under five minutes, then go deeper.

## Install

```bash
npm install neuropile
```

Node 18 or newer. That is the only hard requirement.

The package ships a C++17 addon. During `npm install` it tries to compile it
with `node-gyp`. If no compiler is available it prints a short notice and
installs a pure-JavaScript fallback instead. Both expose the identical API, so
your code never needs to care which one is running.

Check which one you got:

```js
const { nativeAvailable } = require('neuropile');
console.log(nativeAvailable); // true = C++ addon, false = JS fallback
```

### If the addon did not build

npm 12 blocks dependency install scripts by default, which includes the
`node-gyp` build. If `nativeAvailable` is `false`, approve the build script:

```bash
npm approve-scripts neuropile
npm rebuild neuropile
```

Or add it to your own `package.json`:

```json
{
  "allowScripts": {
    "neuropile": true
  }
}
```

## Your first brain

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.1 });
```

That creates a brain with **154,000 neurons** spread across 16 regions. That
is a lot of neurons for a first script, and it takes a moment to wire up. For
anything you are iterating on, use a small brain:

```js
const brain = new Brain({ sizeGB: 0.01 }); // 15,024 neurons - fast to build
const brain = new Brain({ neurons: 5000 }); // explicit count
```

Sizing rules of thumb:

| Want | Use |
| --- | --- |
| A quick script or test | `{ neurons: 5000 }` or `{ sizeGB: 0.01 }` |
| A demo or small agent | `{ sizeGB: 0.05 }` |
| A full brain | `{ sizeGB: 0.1 }` (154,000 neurons) |

## The core loop

A brain is a simulation. You feed it input, you advance time, you read the
result.

```js
const brain = new Brain({ sizeGB: 0.01 });

// 1. Give it input
brain.hear('the room is cold and quiet');

// 2. Advance time
brain.tick(5);

// 3. Read the result
console.log(brain.emotionalState()); // { valence, arousal, drive, ... }
console.log(brain.behaviorState());  // { curiosity, uncertainty, ... }
```

`tick(n)` advances the simulation by n steps. Each step runs the spiking
engine, decays the needs, and updates the neuromodulators.

You do not have to call `tick()` manually. `brain.start(hz)` runs a timer that
ticks automatically:

```js
brain.start(10); // ticks at 10 Hz
// ... later
brain.stop();
```

Use manual `tick()` when you want deterministic, step-by-step control. Use
`start()` when the brain should run continuously alongside your app.

## Feeding it things

There are three ways to put information in.

### Words — `hear()`

```js
brain.hear('the fire is warm');
```

`hear()` splits the text into words, hashes each one into a sensory pattern,
drives the thalamus/sensory/amygdala, activates matching concepts, **and
stores the whole utterance as an episodic memory**.

That last part surprises people. If you do not want `hear()` to also remember,
pass `{ remember: false }`.

### Vectors — `perceive()` and `see()`

```js
brain.perceive([0.2, 0, 0.9]);              // dense sensory vector
brain.see(new Uint32Array([1, 2, 3, 500])); // sparse visual indices
```

`perceive()` auto-detects the format: a `Uint32Array`/`Int32Array` is
treated as sparse neuron indices, a plain array is treated as a dense
value vector. Pass `{ channel: 'visual' }` to route to the visual region.

### The world — `integrateWorldState()`

This is the richest input. It takes a snapshot of the world and drives the
appropriate regions.

```js
brain.integrateWorldState({
  body: { x: 0.5, y: 0.4, speed: 0.2 },
  needs: { fuel: 0.3 },
  detections: [{ label: 'food', w: 0.8 }],
  interaction: { label: 'feed', x: 0.5, y: 0.4 },
});
```

| Field | Effect |
| --- | --- |
| `body` | Position, heading, speed. Drives spatial neurons and border alarm. |
| `needs` | Drive values, by name. Only the drives the body declared. |
| `detections` | `{ label, w }` objects. Labels are hashed into visual neurons. Add `valence`, `arousal`, `approach` to tell the brain what a thing is worth. |
| `interaction` | `{ label }` or `{ note }`. `label` is what satisfies a drive. Add `valence`, `arousal`, `approach` to describe how the event felt. |
| `opticFlow` | `{ x, y, magnitude }` — visual motion. |
| `motorHint` | `{ x, y, intensity }` — a suggested direction, used by `selfAwareness()`. |

A new brain has no opinions about anything. If you want it to fear a wolf,
you say so with `valence`:

```js
brain.integrateWorldState({
  detections: [
    { label: 'wolf', w: 0.9, valence: -0.9, arousal: 0.8, approach: -1.0 },
  ],
});
```

## Memory

```js
// Store
brain.remember('the fire is warm and safe', {
  entities: ['fire', 'warm'],
  emotion: 'happy',
  salience: 0.5,
  type: 'episodic',
});

// Recall
const memories = brain.recall(['fire'], { topN: 5 });
console.log(brain.recallText(['fire'])); // human-readable
```

Memory types are `'episodic'`, `'semantic'`, `'procedural'`, and
`'utterance'`.

Recall is **biased by neural reafference**: memories whose encoding pattern
overlaps with the neurons currently firing come first. This is what makes the
simulation drive cognition rather than sit next to it. Pass `{ neural: false }`
to disable it and get purely semantic matching.

Memories do not decay on their own. Call `brain.forget()` to run a decay and
prune pass.

## Concepts

A concept is a label on an experienced cluster. It accumulates sensory
features and an emotional vector.

```js
brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4, arousal: 0.3 }, 'watch', 0.6);
brain.associate('ember', 'fire', 0.4);

console.log(brain.emotionOf('ember')); // { valence, arousal, approach }
console.log(brain.activeConcepts(5));
```

The third argument is the emotional vector, the fourth is an action label,
and the fifth is the learning strength (0..1).

A new brain has no concepts. `emotionOf('ember')` returns `null` until the
brain has met the word.

## Grounding

Grounding is where the world teaches the brain. It binds things to
concepts, and it lets what the brain learns **generalise** to things it
has never been told about.

```js
// This thing is hot and it hurts.
brain.ground('ember', {
  features: { hot: 1.0, burning: 0.9, orange: 0.2 },
  valence: -0.9, arousal: 0.8, approach: -1.0,
});

// A different word, but the same features.
brain.ground('flame', { features: { hot: 1.0, burning: 0.9, orange: 0.2 } });

console.log(brain.emotionOf('flame')); // { valence: -0.476, ... }
```

The brain never learned that flame is a word for fire. It learned that
things which are hot and burning hurt, and flame shares those features.

The weights decide how much a shared feature counts, so a feature that
belongs to things which should not share an opinion can be given a smaller
say:

```js
brain.ground('pebble', { features: { grey: 0.2, hard: 0.9 } });
console.log(brain.emotionOf('pebble')); // near neutral
```

Things seen together become related:

```js
brain.coOccur(['wolf', 'sheep']);

console.log(brain.relatedness('wolf', 'sheep')); // 1.0
console.log(brain.nearest('wolf'));               // [{ label: 'sheep', ... }]
```

## Drives

Homeostatic drives belong to the body, so you declare them when you build
the brain. A brain with none declared has no needs at all.

```js
const brain = new Brain({
  sizeGB: 0.05,
  drives: {
    fuel: {
      decay: 0.01,       // how much it falls per tick
      threshold: 0.3,    // below this it starts to hurt
      critical: 0.1,     // below this it is an emergency
      effort: 0.004,     // what movement costs it
      satisfiedBy: ['diesel', 'charging-station'],
    },
    coolant: { satisfiedBy: 'coolant' },
  },
});
```

The world satisfies them using its own vocabulary:

```js
brain.integrateWorldState({
  interaction: { label: 'diesel', x: 0.8, y: 0.2, valence: 0.7 },
});

console.log(brain.getNeeds().fuel);  // restored
```

## Working memory

A small, fast-decaying attention buffer — 7 slots, 12 second lifetime.

```js
brain.hold('we are talking about fire', ['fire'], 'input');
brain.focus('fire', ['fire', 'warm'], 'input');

console.log(brain.readWorkingMemory());
console.log(brain.getFocus());
```

Source types have different priorities, so the right thing gets evicted
first: `input` (4) > `answer` (3) > `grounding` (2) > `thought` (1) >
`self_speech` (0).

Call `brain.rehearse(['fire'])` to keep items alive.

## Beliefs

Beliefs are explicit claims with provenance, kept separate from memories so a
generated sentence never silently becomes knowledge.

```js
brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.6 });
brain.believe({ topic: 'fire', claim: 'fire is warm', source: 'observation', verified: true });

console.log(brain.deliberate('fire'));
```

`deliberate()` returns `{ topic, evidenceCount, alternatives, concluded,
conclusion }`. It clusters agreeing claims and only concludes when there is
verified evidence or agreement from two or more independent sources.

## Reading the brain

### `brain.state()`

The full picture, as a plain object. Keys: `tick`, `native`, `neurons`,
`maxNeurons`, `growthProgress`, `growthEvents`, `emotion`, `behavior`,
`motorIntent`, `concepts`, `netEmotion`, `workingMemory`, `focus`,
`memorySize`, `conceptSize`, `beliefs`, `internal`.

### `brain.context()`

A compact text block built for an LLM prompt. This is the intended way to
give a language model the brain's state:

```js
const prompt = `You are a character with this inner state:\n\n${brain.context()}`;
```

It emits `NEURAL`, `AFFECT`, `BEHAVIOR`, `NEEDS`, `CONCEPTS`,
`WORKING MEMORY`, `MEMORIES`, and optionally `GENOME LEDGER` and
`METACOGNITION` lines.

### `brain.emotionalState()` / `brain.behaviorState()`

The affect numbers directly.

- `emotionalState()` → `{ valence, arousal, drive, norepinephrine, needs, body }`
- `behaviorState()` → `{ valence, arousal, drive, curiosity, uncertainty, actionReadiness, patience, speechReadiness, researchDrive }`

## Moving the brain

The core produces a motor intent, and you decide how to apply it.

```js
const intent = brain.getMotorIntent(); // { dx, dy, strength }
```

`dx`/`dy` are a normalized direction, `strength` is 0..1. This is the decoded
movement signal — use it to drive a character in a game, a robot, or a
simulated body.

`brain.move(dx, dy, intensity)` moves the brain's internal body and applies
the corresponding motor pulses.

## Saving and loading

```js
brain.save('./agent.neuropile');       // gzip-compressed by default
const clone = new Brain({ sizeGB: 0.01 });
clone.load('./agent.neuropile');

const snap = brain.snapshot();         // plain in-memory object
clone.restore(snap);
```

Async variants exist too: `await brain.saveAsync(path)` and
`await clone.loadAsync(path)`.

The loader auto-detects gzip by its magic bytes, so compressed and
uncompressed files are both readable regardless of how they were written.

## Growing a brain

```js
const brain = new Brain({
  startNeurons: 20000,
  maxNeurons: 200000,
  growthBatch: 1000,
  growthInterval: 100, // ticks between automatic growth events
});

brain.tick(100);       // one growth event fires
console.log(brain.neuronCount); // 20020
```

New neurons are wired into the circuit the same way the original brain was
wired, and everything already learned is preserved. Growth is automatic
whenever `maxNeurons` exceeds the starting size; set `autoGrow: false` for
manual control with `brain.grow(n)` and `brain.growTo(target)`.

Region sizes round to multiples of 1000, so `startNeurons: 20000` actually
starts at 19,020 neurons. See [gotchas](gotchas.md#growth-numbers-are-not-exact).

## Next

- [API reference](api.md) — everything exported, with signatures.
- [Patterns](patterns.md) — copy-paste recipes.
- [Gotchas](gotchas.md) — what will surprise you.
- [Concepts](concepts.md) — how the neural model actually works.
