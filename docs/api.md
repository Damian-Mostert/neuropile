# API reference

Complete reference for the `neuropile` package. Every export, every method,
every option.

- [Module exports](#module-exports)
- [Constructor options](#constructor-options)
- [`Brain`](#brain)
  - [Properties](#properties)
  - [Clock](#clock)
  - [Perception](#perception)
  - [Memory](#memory)
  - [Concepts](#concepts)
  - [Working memory](#working-memory)
  - [Beliefs](#beliefs)
  - [Metacognition and homeostasis](#metacognition-and-homeostasis)
  - [Growth](#growth)
  - [Readout](#readout)
  - [Persistence](#persistence)
  - [Core passthrough](#core-passthrough)
- [`BrainCore`](#braincore)
- [Cognitive layer classes](#cognitive-layer-classes)
- [Utilities](#utilities)
- [Types](#types)

---

## Module exports

```js
const neuropile = require('neuropile');
```

| Export | Type | Description |
| --- | --- | --- |
| `Brain` | class | High-level brain: the core plus every cognitive layer. |
| `BrainCore` | class | The JavaScript core implementation. |
| `NativeBrainCore` | class \| null | The native core, or `null` if the addon is unavailable. |
| `NeuralEngine` | class | The JavaScript spiking engine. |
| `NativeNeuralEngine` | class \| null | The native engine, or `null` if unavailable. |
| `MemoryCortex` | class | Associative memory. |
| `ConceptNet` | class | Word grounding. |
| `WorkingMemory` | class | Attention buffer. |
| `Genome` | class | Tunable parameters. |
| `Metacognition` | class | Self-prediction and self-scoring. |
| `Homeostasis` | class | Parameter trial-and-error. |
| `BeliefStore` | class | Explicit claims with provenance. |
| `createCore(options)` | function | Build a standalone core using the standard selection logic. |
| `soundPattern(text, size)` | function | Hash text into a sensory pattern of neuron indices. |
| `labelHash(label)` | function | Deterministic hash used for detection labels. |
| `persistence` | object | `save`, `load`, `saveAsync`, `loadAsync`, `encodeValue`, `decodeValue`, `toSerializable`, `fromSerializable`. |
| `save(brain, path, opts)` | function | Shortcut for `persistence.save`. |
| `load(brain, path)` | function | Shortcut for `persistence.load`. |
| `nativeAvailable` | boolean | Whether the native addon loaded successfully. |
| `nativeModule` | object \| null | The raw native module, or `null`. |
| `nativeError` | Error \| null | The error from the failed load, if any. |
| `nativePath` | string \| null | Resolved path of the loaded addon, or `null`. |
| `SENSORY_SIZE` | number | `400000` — default sensory region size. |
| `PATTERN_LENGTH` | number | `200` — indices per sensory pattern. |
| `VERSION` | string | The package version. |

ESM: `import { Brain } from 'neuropile';` — every named export above is
available.

---

## Constructor options

Accepted by `new Brain(options)` and `new BrainCore(options)`.

| Option | Default | Meaning |
| --- | --- | --- |
| `sizeGB` | `0.1` | Model size. `0.1` yields 154,000 neurons. `0.01` yields 15,024. |
| `neurons` | — | Explicit neuron count. Overrides `sizeGB` when greater than 0. |
| `startNeurons` | — | Initial size. Alias for `neurons` that reads as growth intent. |
| `maxNeurons` | start size | Hard ceiling on total neurons. Clamped up to the start size, never down. |
| `autoGrow` | `maxNeurons > start` | Grow automatically during `tick()`. |
| `growthBatch` | ~1% of start | Neurons added per growth event. |
| `growthInterval` | `100` | Ticks between automatic growth events. `0` disables the timer. |
| `growthFanout` | `8` | Synapses wired per direction for each new neuron. |
| `growthProfile` | object \| array | Per-region growth multipliers. Object is keyed by region name; array is positional. |
| `synapsesPerNeuron` | `200` | Synapse slots reserved per neuron. |
| `maxConnections` | `50000` | Maximum sampled connections per wiring rule. |
| `wire` | `true` | Wire the region graph at construction. |
| `seed` | — | Deterministic seed for the JavaScript fallback. Makes wiring reproducible. |
| `native` | `true` | Set `false` to force the JS core even when the addon is built. |
| `core` | — | Supply a pre-built core instead of constructing one. |
| `coreOptions` | — | Options forwarded to the core when using the `Brain` wrapper. |

---

## `Brain`

```js
const brain = new Brain({ sizeGB: 0.1 });
```

### Properties

All read-only getters.

| Property | Type | Description |
| --- | --- | --- |
| `engine` | `NeuralEngine` | The raw engine with the typed-array neuron state. |
| `regions` | `Region[]` | The 16 regions with `start`, `end`, `size`, `threshold`, `inhibRatio`. |
| `tickCount` | number | Ticks elapsed. |
| `valence` | number | Current emotional valence, roughly -1..1. |
| `arousal` | number | Current arousal. |
| `drive` | number | Current drive. |
| `needs` | object | `{ hunger, energy, joy }`, each 0..1. |
| `body` | object | `{ x, y, heading, speed, energy }`. |
| `motorState` | object | `{ moveX, moveY, lastAction }`. |
| `neuronCount` | number | Current neuron count. |
| `maxNeurons` | number | The growth ceiling. |
| `canGrow` | boolean | `false` once the ceiling is reached. |
| `growthProgress` | number | 0..1 toward the ceiling. |
| `growthEvents` | number | How many growth events have happened. |
| `native` | boolean | Whether the native core is in use. |
| `core` | `BrainCore` | The underlying core. |
| `genome` | `Genome` | The parameter genome. |
| `memory` | `MemoryCortex` | Associative memory. |
| `concepts` | `ConceptNet` | Concept store. |
| `workingMemory` | `WorkingMemory` | Attention buffer. |
| `metacognition` | `Metacognition` | Self-prediction log. |
| `homeostasis` | `Homeostasis` | Parameter trial ledger. |
| `beliefs` | `BeliefStore` | Explicit claims. |

### Clock

| Method | Returns | Description |
| --- | --- | --- |
| `tick(count = 1)` | number | Advance the simulation. Also advances working memory. Returns the new tick count. |
| `step(count = 1)` | number | Alias for `tick`. |
| `start(hz = 10)` | `this` | Start a timer that ticks automatically. The timer is `unref`'d, so it will not hold the process open. |
| `stop()` | `this` | Stop the automatic timer. |

### Perception

| Method | Returns | Description |
| --- | --- | --- |
| `perceive(input, options = {})` | `EmotionalState` | Feed a stimulus. A string is treated as words (same as `hear`). A typed array is sparse indices; a plain array is a dense vector. |
| `hear(text, options = {})` | `EmotionalState` | Hash words into sensory patterns, activate concepts, and store the utterance as an episodic trace. |
| `see(input)` | `EmotionalState` | Perceive into the visual region. |

`perceive` options: `channel` (`'sensory'`, `'visual'`, `'audio'`),
`encode` (boolean, also encode into memory), `encodeStrength` (default `0.8`).

`hear` options: `strength` (default `1.0`), `remember` (default `true` — set
`false` to skip the automatic episodic trace), `entities`, `emotion`,
`salience` (default `0.45`), `encodeNeural` (default `true`).

### Memory

| Method | Returns | Description |
| --- | --- | --- |
| `remember(content, options = {})` | `MemoryNode \| undefined` | Store a memory, encode it into the hippocampus, and ground its words as concepts. |
| `recall(entities = [], options = {})` | `MemoryNode[]` | Recall memories, biased by neural reafference. |
| `recallFact(keyword)` | `MemoryNode[]` | Recall semantic facts matching a keyword. |
| `recallText(entities = [], options = {})` | string | Recall and format as human-readable text. |
| `forget()` | `this` | Run a decay pass on memory and prune concepts. |

`remember` options: `entities` (string[]), `emotion` (default `'neutral'`),
`salience` (default `0.5`), `dopamine` (default `0`), `type` (default
`'semantic'`), `turnId` (default `null`), `encodeNeural` (default `true`),
`consolidate` (boolean), `consolidateStrength` (default `0.5`), `strength`
(default `0.7`), `concepts` (default `true`), `sensory`, `conceptEmotion`.

`recall` options: `emotion` (default `'neutral'`), `topN` (default `8`),
`context` (default `'conversation'`), `neural` (default `true` — set `false`
to disable reafference biasing), `reafferenceTopN` (default `20`).

`recall` also accepts a bare string as the first argument.

### Concepts

| Method | Returns | Description |
| --- | --- | --- |
| `activate(word, strength = 1.0)` | concept \| null | Activate a concept by label. |
| `learn(word, sensory = {}, emotion = {}, action = null, strength = 0.5)` | concept \| null | Teach a word a sensory profile and emotional vector. Also grounds it in the neural substrate. |
| `associate(wordA, wordB, strength = 0.3)` | `EmotionVector \| null` | Link two concepts. |
| `emotionOf(word)` | `EmotionVector \| null` | `{ valence, arousal, approach }` for a word. |
| `activeConcepts(topN = 8)` | `ConceptSnapshot[]` | The most active concepts. |
| `netEmotion()` | `EmotionVector` | The combined emotion of all active concepts. |

### Working memory

| Method | Returns | Description |
| --- | --- | --- |
| `hold(content, entities = [], type = 'thought', strength = 1.0)` | `this` | Put something in attention. |
| `focus(topic, entities = [], source = 'thought', strength = 1.0)` | `Focus \| null` | Set the shared focus point. |
| `getFocus()` | `Focus \| null` | Read the focus. Expires after 12 seconds. |
| `readWorkingMemory(topN)` | `WorkingMemorySlot[]` | Read the slots, strongest first. |
| `rehearse(entities = [])` | `this` | Keep matching items alive. |

### Beliefs

| Method | Returns | Description |
| --- | --- | --- |
| `believe(claim, options = {})` | `Belief \| null` | Record a claim. Also accepts a single object `{ topic, claim, source, confidence, verified }`. |
| `beliefsAbout(topic, limit = 3)` | `Belief[]` | Recall beliefs about a topic. |
| `deliberate(topic)` | `Deliberation` | Cluster evidence and report alternatives plus a conclusion. |

`Deliberation` is `{ topic, evidenceCount, alternatives, concluded, conclusion }`.

### Metacognition and homeostasis

| Method | Returns | Description |
| --- | --- | --- |
| `predict(parsed = {}, reafStrength = 0)` | record | Predict the next internal state before responding. `parsed` is `{ intent, emotion }`. |
| `observe(record, responseText)` | number | Score the prediction against what happened. Returns a dopamine delta, applied to the core. |
| `recordTurn(metrics = {})` | string \| null | Record a turn. Evaluates homeostasis every 20 turns and returns a log line when it does. |
| `tune()` | string \| null | Force a homeostasis evaluation now. |

`recordTurn` metrics: `interrupted`, `recalledSalience`, `goalPushed`,
`goalResolved`.

### Growth

| Method | Returns | Description |
| --- | --- | --- |
| `grow(count)` | number | Add up to `count` neurons. Capped by `maxNeurons`. Returns how many were added. |
| `growTo(target)` | number | Grow toward a total neuron count. Returns how many were added. |
| `maybeGrow()` | number | Apply one automatic growth step if the cadence allows it. |

### Readout

| Method | Returns | Description |
| --- | --- | --- |
| `emotionalState()` | `EmotionalState` | `{ valence, arousal, drive, norepinephrine, needs, body }`. |
| `behaviorState()` | `BehaviorState` | `{ valence, arousal, drive, curiosity, uncertainty, actionReadiness, patience, speechReadiness, researchDrive }`. |
| `motorIntent()` | `MotorIntent` | `{ dx, dy, strength }` — the decoded movement signal. |
| `state()` | object | Everything, as one plain object. |
| `context()` | string | A compact, model-ready text block. |

### Persistence

| Method | Returns | Description |
| --- | --- | --- |
| `snapshot()` | object | A plain in-memory snapshot. |
| `restore(snapshot)` | `this` | Restore from a snapshot. |
| `save(filePath, options)` | string | Write a gzip-compressed snapshot. Returns the resolved path. |
| `load(filePath)` | object | Load a snapshot and apply it. Returns the snapshot. |
| `saveAsync(filePath, options)` | `Promise<string>` | Async save. |
| `loadAsync(filePath)` | `Promise<object>` | Async load. |

`save` options: `compress` (default `true` — set `false` for plain JSON).

### Core passthrough

These are proxied straight to `brain.core`, so they work identically on the
native and JS cores.

| Method | Returns |
| --- | --- |
| `reward(strength = 1.0)` | number — the new dopamine level. |
| `punish(strength = 1.0)` | number — the new dopamine level. |
| `setNeeds(needs)` | `Needs` |
| `getNeeds()` | `Needs` |
| `getBody()` | `Body` |
| `getMotorState()` | `MotorState` |
| `move(dx = 0, dy = 0, intensity = 1.0)` | `Body` |
| `integrateWorldState(state = {})` | `EmotionalState` |
| `handleInteraction(kind, intensity = 1.0)` | `Needs` |
| `amygdalaActivate(threatLevel = 0.5)` | number |
| `startle(strength = 1.0)` | void |
| `decideBehavior(options = {})` | `BehaviorDecision` |
| `actionSelection()` | void |
| `novelty()` | number |
| `reafference(topN = 20)` | `{ indices, strength }` |
| `selfAwareness()` | number |
| `getMotorIntent()` | `MotorIntent` |
| `readInternalState()` | `Record<string, number>` — `Ω1`..`Ω5`, `Ω_acc`, `Ω_bg`, `Ω_hypo`, `Ω_da`, `Ω_ne`. |
| `neuronMap()` | `Record<string, { mean, peak, firing }>` — one entry per region. |
| `thought()` | `Float32Array` — the association region's activation. |
| `perceiveDense(values)` | void |
| `perceiveVisual(input)` | void |
| `hearDense(values)` | void |
| `encode(input, strength = 1.0)` | void — encodes into the hippocampus. |
| `encodeDense(values, strength = 1.0)` | void |
| `consolidate(input, strength = 1.0)` | void — encodes into the temporal cortex. |
| `consolidateDense(values, strength = 1.0)` | void |
| `motorQuadrantSize()` | number |
| `region(name)` | `Region \| null` |

---

## `BrainCore`

The spiking substrate on its own, without the cognitive layers. Use it when
you want raw neural dynamics.

```js
const { BrainCore } = require('neuropile');
const core = new BrainCore({ neurons: 50000, seed: 42 });
```

It has every method in [Core passthrough](#core-passthrough) plus:

| Method | Returns | Description |
| --- | --- | --- |
| `tick(count = 1)` | number | Advance the simulation. |
| `start(hz = 10)` / `stop()` | `this` | Automatic ticking. |
| `snapshot()` / `restore(snapshot)` | object / `this` | Persistence. |
| `grow` / `growTo` / `maybeGrow` | number | Neurogenesis. |
| `perceive` / `perceiveDense` / `perceiveVisual` / `hear` / `hearDense` | void | Raw input. |
| `encode` / `encodeDense` / `consolidate` / `consolidateDense` | void | Raw memory encoding. |

Properties: `engine`, `regions`, `options`, `tickCount`, `valence`, `arousal`,
`drive`, `needs`, `body`, `motorState`, `neuronCount`, `maxNeurons`,
`canGrow`, `growthProgress`, `growthEvents`.

### `decideBehavior(options)`

```js
core.decideBehavior({
  activeGoal: { urgency: 0.8 },
  humanPresent: true,
  pendingSelfSpeech: true,
  tickCount: 120,
  lastSpokeTick: 0,
});
```

Returns the behavior state plus `canSpeak`, `shouldResearch`, `shouldAct`,
and `responseMode` (`'grounded'`, `'speak'`, or `'quiet'`).

### `integrateWorldState(state)`

| Field | Type | Effect |
| --- | --- | --- |
| `body` | `{ x, y, heading, speed, vx, vy }` | Spatial neurons, border alarm, motion signal. |
| `needs` | `{ hunger, energy, joy }` | Drive signals; low needs trigger distress and pain. |
| `detections` | `[{ label, w }]` | Labels are hashed into visual neurons. Salient labels (`self`, `violet-glow`, `cyan-light`, `warm-glow`) also reward. |
| `interaction` | `{ note, x, y, hungerLevel }` | `feed`, `poke`, `aversive`, `danger`, and `food` notes get special handling. |
| `opticFlow` | `{ x, y, magnitude }` | Visual motion into the visual quadrant system. |
| `motorHint` | `{ x, y, intensity, hintMode }` | A suggested direction, consumed by `selfAwareness()`. |

### `handleInteraction(kind, intensity = 1.0)`

Recognised kinds: `feed`, `rest`, `play`, `poke`, `danger`. Anything else is
treated as mildly aversive.

---

## Cognitive layer classes

Each layer can be used standalone.

### `MemoryCortex`

```js
const { MemoryCortex, Genome } = require('neuropile');
const memory = new MemoryCortex(new Genome());
```

| Method | Returns |
| --- | --- |
| `encode(content, entities, emotion, salience, dopamine, type, turnId)` | `MemoryNode \| undefined` |
| `recall(entities, emotion, topN, context)` | `MemoryNode[]` |
| `recallByReafference(neuralIndices, entities, emotion, topN, context)` | `MemoryNode[]` |
| `recallFact(keyword)` | `MemoryNode[]` |
| `format(memories)` | string |
| `decay()` | void |
| `snapshot()` / `restore(snapshot)` | object / `this` |

Property: `size` (node count), `nodes` (the array).

### `ConceptNet`

| Method | Returns |
| --- | --- |
| `activate(word, strength, hopDepth)` | concept \| null |
| `learn(word, sensory, emotion, action, strength)` | concept \| null |
| `associate(wordA, wordB, strength)` | void |
| `emotionOf(word)` | `EmotionVector \| null` |
| `activeConceptsSnapshot(topN)` | `ConceptSnapshot[]` |
| `formatForLLM()` | string \| null |
| `netEmotion()` | `EmotionVector` |
| `prune()` | void |

### `WorkingMemory`

| Method | Returns |
| --- | --- |
| `hold(content, entities, type, strength)` | void |
| `setFocus(topic, entities, source, strength)` | `Focus \| null` |
| `getFocus()` / `clearFocus()` | `Focus \| null` / void |
| `rehearse(entities)` | void |
| `tick()` | void — expires old slots. |
| `read(topN)` | `WorkingMemorySlot[]` |
| `format()` | string |
| `flush()` | void |

### `Genome`

| Method | Returns |
| --- | --- |
| `get(key)` | number \| null |
| `set(key, value)` | boolean — false if the key is unknown. Clamps to bounds. |
| `meta(key)` | `{ value, min, max, step } \| null` |
| `snapshot()` / `restore(snapshot)` | `Record<string, number>` / void |
| `keys()` | string[] |

Parameters: `metacognition_lr`, `emotion_cue`, `novelty_cue`, `arousal_cue`,
`drive_cue`, `salience_emotion_bonus`, `salience_entity_weight`,
`ne_interrupt_threshold`, `memory_decay_rate`, `memory_consolidate_boost`,
`memory_prune_threshold`.

### `Metacognition`

| Method | Returns |
| --- | --- |
| `predict(neuralState, parsed, reafStrength)` | record |
| `observe(record, neuralStateAfter, responseText)` | number — dopamine delta |
| `recentAccuracy()` | number \| null |
| `summary()` | `MetacognitionSummary \| null` |

### `Homeostasis`

| Method | Returns |
| --- | --- |
| `recordTurn(metrics)` | void |
| `evaluate()` | string \| null — a log line describing the trial. |
| `ledgerSummary(n)` | string \| null |

Property: `ledger` — an array of trial records.

### `BeliefStore`

| Method | Returns |
| --- | --- |
| `record({ topic, claim, source, confidence, verified })` | `Belief \| null` |
| `recall(topic, limit)` | `Belief[]` |
| `best(topic)` | `Belief \| null` |
| `deliberate(topic)` | `Deliberation` |

Property: `items` — the array of beliefs.

---

## Utilities

### `createCore(options)`

Builds a standalone `BrainCore`, choosing the native or JS implementation
with the same logic `Brain` uses.

```js
const { createCore } = require('neuropile');
const core = createCore({ startNeurons: 50000, native: false });
```

### `soundPattern(text, size = 400000)`

Hashes text into a `Uint32Array` of 200 neuron indices. A djb2 hash
(`h = 5381`, `h = h * 31 ^ charCode`) spread with
`(h ^ j) * 2654435761 % size`. Results are cached, so repeated words are free.

### `labelHash(label)`

A deterministic 32-bit hash of a lowercase label. Used to place detection
labels into the visual region consistently.

### `persistence`

```js
const { persistence } = require('neuropile');

persistence.save(brain, './agent.neuropile');
persistence.save(brain, './agent.json', { compress: false });
const snapshot = persistence.load(brain, './agent.neuropile');
```

Async variants, inside an async function:

```js
await persistence.saveAsync(brain, './agent.neuropile');
await persistence.loadAsync(brain, './agent.neuropile');
```

`encodeValue` and `decodeValue` preserve typed arrays, `Map`, `Set`, and
`BigInt` through JSON. `toSerializable` and `fromSerializable` wrap a
snapshot in the on-disk envelope.

---

## Types

Full TypeScript definitions are bundled in `index.d.ts` and are picked up
automatically.

```ts
import { Brain, BrainOptions, EmotionalState, BehaviorState } from 'neuropile';

const options: BrainOptions = { sizeGB: 0.05, maxNeurons: 200000 };
const brain = new Brain(options);
const emotion: EmotionalState = brain.emotionalState();
```
