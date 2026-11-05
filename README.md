# neuropile

A native C++ spiking-neuron brain with a clean Node.js API.

The neuropil is the dense woven tissue where a brain actually computes. This
package is that tissue — not a wrapper around someone else's model. It ships a
real spiking substrate (16 brain regions, a wiring table, neuromodulators,
needs, affect, motor intent) plus the cognitive layers that sit on top of it
(associative memory, concepts, working memory, a parameter genome,
metacognition, homeostasis, explicit beliefs).

It plugs into chat apps, games, agents, robots, or anything else that can call
JavaScript.

---

## Documentation

https://neuropile-docs.vercel.app/

## Contents

- [Highlights](#highlights)
- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [The two layers](#the-two-layers)
  - [Neural core (`BrainCore`)](#1-neural-core-braincore)
  - [High-level `Brain`](#2-high-level-brain)
- [Growth (neurogenesis)](#growth-neurogenesis)
- [Persistence](#persistence)
- [Cognitive layers](#cognitive-layers)
- [Examples](#examples)
- [API reference](#api-reference)
- [Performance](#performance)
- [Environment variables](#environment-variables)
- [Releasing](#releasing)
- [Development](#development)
- [License](#license)

---

## For AI agents

This package ships documentation designed to be read by an AI coding agent
rather than a human skimming for the one API they need.

| File | Purpose |
| --- | --- |
| [`llms.txt`](./llms.txt) | Short index of everything. Start here. |
| [`AGENTS.md`](./AGENTS.md) | How to work *in* this repo. Conventions, build, test, release. |
| [`docs/getting-started.md`](./docs/getting-started.md) | First brain in five minutes. |
| [`docs/api.md`](./docs/api.md) | Every export, method, and option. |
| [`docs/patterns.md`](./docs/patterns.md) | Copy-paste recipes. |
| [`docs/gotchas.md`](./docs/gotchas.md) | What will surprise you. |
| [`docs/concepts.md`](./docs/concepts.md) | How the neural model works. |
| [`docs/llms-full.txt`](./docs/llms-full.txt) | All of the above in one file. |

The `llms` and `llmsFull` fields in `package.json` point at `llms.txt` and
`docs/llms-full.txt` respectively, so agents that follow that convention find
them automatically.

---

## Highlights

- **Native core** — spiking neurons, region wiring, neuromodulators, needs,
  affect, motor intent, sensory encoding, and consolidation in C++17 via
  Node-API.
- **Growth** — neurogenesis. The brain starts at a size you choose and grows
  toward a ceiling, wiring new neurons in as it goes without losing anything
  it has already learned.
- **Pure-JS fallback** — the same API works with no compiler installed.
- **Cognitive layers** — associative memory, concepts, working memory, a
  parameter genome, metacognition, homeostasis, and explicit beliefs.
- **Persistence** — full snapshot/restore, gzip-compressed save/load.
- **Zero runtime dependencies** apart from `node-addon-api`, which is only
  needed to build.

---

## Install

```bash
npm install neuropile
```

`npm install` tries to compile the native addon with `node-gyp`. If no C++17
toolchain is available it prints a notice and installs the JavaScript fallback
instead. Both paths expose the same API.

To build the native core explicitly:

```bash
npm run build
```

**Requirements:** Node.js 18+, Python 3, and a C++17 compiler
(MSVC Build Tools on Windows, Xcode Command Line Tools on macOS, GCC/Clang on
Linux).

### npm 12 and install scripts

npm 12 blocks dependency install scripts by default, which includes the
`node-gyp` build. If you install `neuropile` and find the JS fallback in use
(`require('neuropile').nativeAvailable === false`), approve the build script:

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

---

## Quick start

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.1 }); // 154,000 neurons at the default size
brain.start(10);                           // tick at 10 Hz

brain.hear('hello, warm friend');
brain.remember('the fire is warm and safe', {
  entities: ['fire', 'warm'],
  emotion: 'happy',
  type: 'episodic',
  turnId: 1,
});

brain.tick(5);
console.log(brain.state());
console.log(brain.context()); // model-ready context block
```

ESM works too:

```js
import { Brain } from 'neuropile';
```

---

## How it works

```
sensory / vision / audio
        │
        ▼
  BrainCore (C++ or JS)  ── spiking neurons, 16 regions, dopamine/NE
        │
        ├── emotionalState / behaviorState / motorIntent
        │
        ├── MemoryCortex      associative, decaying, reafference-biased
        ├── ConceptNet        sensory + emotional grounding of words
        ├── WorkingMemory     7 attention slots + shared focus
        ├── Genome            tunable personality/plasticity parameters
        ├── Metacognition     predicts, scores, adapts its own weights
        ├── Homeostasis       proposes genome trials, accepts or reverts
        └── BeliefStore       explicit claims with provenance
```

The important part is the arrow going *back up*. Memory recall is biased by
`core.reafference()` — the neurons that are firing right now prefer memories
whose encoding pattern overlaps with them. That coupling is what makes the
simulation drive cognition instead of sitting politely beside it.

### The 16 regions

| Region | Role |
| --- | --- |
| `thalamus` | Relay and gating; carries body, need, and motion signals. |
| `hypothalamus` | Drives; converts need pressure into arousal and drive. |
| `amygdala` | Valence and threat; fires on aversive input. |
| `sensory` | General somatosensory and auditory channel. |
| `visual` | Visual channel, also used for object detections. |
| `hippocampus` | Memory encoding target. |
| `temporal` | Consolidation target — long-term storage of encoded traces. |
| `association` | Integration, concept grounding, reafference readout. |
| `prefrontal` | Inhibition, deliberation, self-awareness. |
| `acc` | Conflict detection; feeds uncertainty. |
| `basalGanglia` | Action selection and motor gating. |
| `motor` | Movement output, organised into four directional quadrants. |
| `cerebellum` | Motor refinement and coordination. |
| `vta` | Dopamine source. |
| `locusCoeruleus` | Norepinephrine source. |
| `raphe` | Serotonin / stability source. |

Regions are allocated proportionally to a fixed base size, so the brain keeps
its shape as it changes size.

### The spiking engine

Neurons are leaky integrate-and-fire units with:

- A membrane potential that decays each tick.
- A per-region firing threshold.
- A per-region inhibitory fraction (the first N% of a region is inhibitory).
- A 20 ms refractory period.
- Hebbian learning, gated by dopamine — synapses only strengthen while
  dopamine is elevated, and decay otherwise. Reward and punishment therefore
  change *what the brain learns*, not just how it feels.
- Weights clamped to `[-1.5, 1.5]`.

Sparse decay is the key performance trick: only neurons that have actually
received input are updated on a tick, so an idle brain is nearly free.

---

## The two layers

### 1. Neural core (`BrainCore`)

The core is the spiking substrate. It owns the 16 regions, a wiring table of
long-range projections, and neuromodulators (dopamine, norepinephrine).

```js
const { BrainCore } = require('neuropile');

const core = new BrainCore({ neurons: 50000, seed: 42 });

core.integrateWorldState({
  body: { x: 0.5, y: 0.4, speed: 0.2 },
  needs: { hunger: 0.3, energy: 0.6, joy: 0.7 },
  detections: [{ label: 'food', w: 0.8 }],
  interaction: { note: 'feed', x: 0.5, y: 0.4 },
});

core.tick(10);

console.log(core.emotionalState());   // valence, arousal, drive, NE, needs
console.log(core.behaviorState());    // curiosity, uncertainty, readiness...
console.log(core.getMotorIntent());   // { dx, dy, strength }
console.log(core.readInternalState()); // Ω1..Ω5, Ω_da, Ω_ne
```

Useful methods:

| Area | Methods |
| --- | --- |
| Clock | `tick(count)`, `start(hz)`, `stop()` |
| Reward | `reward(strength)`, `punish(strength)` |
| Needs/body | `setNeeds`, `getNeeds`, `getBody`, `move`, `handleInteraction` |
| World | `integrateWorldState(state)` |
| Affect | `emotionalState`, `behaviorState`, `decideBehavior` |
| Attention | `novelty`, `reafference`, `selfAwareness`, `actionSelection` |
| Motor | `getMotorIntent`, `motorQuadrantSize` |
| Readout | `readInternalState`, `neuronMap`, `thought` |
| Input | `perceive`, `perceiveDense`, `perceiveVisual`, `hear`, `hearDense` |
| Memory | `encode`, `encodeDense`, `consolidate`, `consolidateDense` |
| Growth | `grow`, `growTo`, `maybeGrow` |
| Persistence | `snapshot`, `restore`, `region` |

### 2. High-level `Brain`

`Brain` combines the core with the cognitive layers and gives you a single
object to drive.

```js
const { Brain } = require('neuropile');
const brain = new Brain({ sizeGB: 0.1, native: true });

// Perception
brain.hear('the room is cold and quiet');
brain.see(new Uint32Array([1, 2, 3, 500]));
brain.perceive([0.2, 0, 0.9]); // dense sensory vector

// Memory
brain.remember('the room was cold', {
  entities: ['room', 'cold'],
  emotion: 'neutral',
  salience: 0.5,
  type: 'semantic',
});
const memories = brain.recall(['room'], { topN: 5 });
console.log(brain.recallText(['room']));

// Concepts (words are labels on experienced clusters)
brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4, arousal: 0.3, approach: 0.2 }, 'watch', 0.6);
brain.associate('ember', 'fire', 0.4);
console.log(brain.emotionOf('ember')); // { valence, arousal, approach }
console.log(brain.activeConcepts(5));

// Working memory
brain.hold('we are talking about fire', ['fire'], 'input');
brain.focus('fire', ['fire', 'warm'], 'input');
console.log(brain.readWorkingMemory());

// Beliefs
brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.6 });
brain.believe({ topic: 'fire', claim: 'fire is warm', source: 'observation', verified: true });
console.log(brain.deliberate('fire'));

// Metacognition + homeostasis
const record = brain.predict({ intent: 'question', emotion: 'happy' }, 0.6);
brain.observe(record, 'because fire is warm?');
brain.recordTurn({ recalledSalience: 0.4, goalPushed: true, goalResolved: true });
```

`brain.state()` returns the full picture. `brain.context()` returns a compact
text block you can feed to a language model.

---

## Growth (neurogenesis)

A brain can grow. Give it a starting size and a ceiling, and it grows between
them — adding real neurons, wiring them into the circuit, and keeping
everything it has already learned.

```js
const { Brain } = require('neuropile');

const brain = new Brain({
  startNeurons: 20000,   // where the brain begins
  maxNeurons: 200000,    // where it stops growing
  growthBatch: 1000,     // neurons added per growth event
  growthInterval: 100,   // ticks between automatic growth events
});

console.log(brain.neuronCount);    // 19020
brain.tick(100);                   // one growth event fires
console.log(brain.neuronCount);    // 20020
```

> **Note on the numbers.** Region sizes are rounded to multiples of 1000, so
> the real starting size is not exactly `20000` — it is `19020`. With the
> default `growthBatch` (~1% of the starting brain, so `190`) one growth event
> takes it to `19210`. The example above sets `growthBatch: 1000` explicitly,
> which is why it lands on `20020`.

Growth is on by default whenever `maxNeurons` is larger than the starting
size. Set `autoGrow: false` to take manual control.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `startNeurons` | — | Initial size. Alias for `neurons` that reads as intent. |
| `maxNeurons` | start size | Hard ceiling on total neurons. |
| `autoGrow` | `maxNeurons > start` | Grow automatically on tick. |
| `growthBatch` | ~1% of start | Neurons added per growth event. |
| `growthInterval` | `100` | Ticks between growth events. `0` disables the timer. |
| `growthFanout` | `8` | Synapses wired per direction for each new neuron. |
| `growthProfile` | — | Per-region multipliers (object keyed by region name). |

### Methods

```js
brain.grow(500);          // add up to 500 neurons, returns how many grew
brain.growTo(50000);      // grow toward a total, returns how many grew
brain.maybeGrow();        // one automatic step, if the cadence allows it

brain.neuronCount;        // current neuron count
brain.maxNeurons;         // the ceiling
brain.canGrow;            // false once the ceiling is reached
brain.growthProgress;     // 0..1 toward the ceiling
brain.growthEvents;       // how many growth events have happened
```

### How the neurons are added

New neurons are distributed across the 16 regions proportionally to each
region's base size, weighted by a growth profile that favours the plastic
regions (hippocampus and association cortex grow fastest; the neuromodulator
nuclei barely grow at all). The brain keeps its proportions as it grows.

Each newborn neuron is wired into the circuit the same way the original brain
was wired: local recurrent connections inside its own region, plus the
long-range projections from the region's place in the wiring table. Existing
neurons keep their potentials, thresholds and learned synapse weights — the
whole brain is remapped, not rebuilt.

You can steer where growth goes:

```js
const brain = new Brain({
  startNeurons: 20000,
  maxNeurons: 200000,
  growthProfile: {
    hippocampus: 4,    // grow memory capacity faster
    association: 3,
    motor: 0.2,        // barely grow the motor system
  },
});
```

### Persistence and growth

A grown brain saves and loads like any other — the snapshot carries the
current layout, so loading into a fresh core restores the grown size.

```js
brain.save('./agent.neuropile');
const clone = new Brain({ startNeurons: 20000, maxNeurons: 200000 });
clone.load('./agent.neuropile');
console.log(clone.neuronCount);  // the grown size, not the starting size
```

---

## Persistence

```js
brain.save('./agent.neuropile');       // gzip-compressed by default
const clone = new Brain({ sizeGB: 0.1 });
clone.load('./agent.neuropile');

const snap = brain.snapshot();     // plain in-memory object
clone.restore(snap);

await brain.saveAsync('./agent.neuropile');
await clone.loadAsync('./agent.neuropile');
```

Snapshots include the neural engine (potentials, thresholds, synapses,
modulators), needs/body/motor state, memory, concepts, working memory, genome,
metacognition, beliefs, and the homeostasis ledger.

`save(path, { compress: false })` writes plain JSON instead. The loader
auto-detects gzip by its magic bytes, so compressed and uncompressed files are
both readable regardless of how they were written.

---

## Cognitive layers

### MemoryCortex

Associative memory over episodic, semantic, procedural, and utterance traces.
Memories decay over time and are pruned when they fall below a threshold.
Recall is biased by neural reafference — memories whose encoding pattern
matches what is currently firing come first.

```js
brain.remember(content, { entities, emotion, salience, type, turnId });
brain.recall(['room'], { topN: 5 });
brain.recallText(['room']);
brain.recallFact('fire');
brain.forget();   // decay memory and prune concepts
```

### ConceptNet

Words are labels on experienced clusters. A concept accumulates sensory
features, an emotional vector (`valence`, `arousal`, `approach`), and
associations to other concepts.

```js
brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4 }, 'watch', 0.6);
brain.associate('ember', 'fire', 0.4);
brain.emotionOf('ember');
brain.activeConcepts(5);
brain.netEmotion();
```

### WorkingMemory

A dorsolateral-prefrontal analog: seven attention slots with fast decay, plus
a shared focus point. Items expire after 12 seconds unless rehearsed. Sources
are prioritised so that `input` outranks `answer`, which outranks `thought`.

```js
brain.hold(content, entities, 'input');
brain.focus('topic', entities, 'input');
brain.getFocus();
brain.readWorkingMemory();
brain.rehearse(['topic']);
```

### Genome

A single source of truth for every tunable personality and plasticity
parameter, each with a value, bounds, and step size. Neural physics
(refractory period, weight limits) are *substrate*, not parameters, and are
deliberately excluded.

```js
brain.genome.get('emotion_cue');
brain.genome.set('emotion_cue', 0.7);   // clamped to the allowed range
brain.genome.meta('emotion_cue');
```

### Metacognition

Predicts the next internal state before you respond, scores itself after, and
feeds the error back as dopamine. Its cue weights adapt over time rather than
staying static.

```js
const record = brain.predict({ intent: 'question', emotion: 'happy' }, 0.6);
const delta = brain.observe(record, 'because fire is warm?');
```

### Homeostasis

Watches a rolling window of turn metrics. Every 20 turns it looks for the
worst-offending metric, proposes one small parameter mutation, runs a 10-turn
trial, and then accepts or reverts the change. Every decision is written to
the ledger.

```js
brain.recordTurn({ recalledSalience: 0.4, goalPushed: true, goalResolved: true });
brain.tune();          // force an evaluation now
brain.homeostasis.ledger;
```

### BeliefStore

Explicit claims with provenance — kept separate from memories so that a
generated sentence never silently becomes knowledge. Two independent sources
agreeing on the same claim are treated as evidence, not a duplicate.

```js
brain.believe({ topic: 'fire', claim: 'fire is warm', source: 'observation', verified: true });
brain.beliefsAbout('fire');
brain.deliberate('fire');   // clusters evidence, reports alternatives + conclusion
```

---

## Examples

```bash
npm run example:chat    # interactive chat loop
npm run example:game    # agent wanders, gets hungry, eats
npm run example:http    # JSON HTTP API on :8787
npm run example:growth  # neurogenesis demo
npm run benchmark       # native vs JS comparison
```

The HTTP server exposes:

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness plus which core is active. |
| `GET /state` | Full brain state. |
| `GET /context` | Compact context block. |
| `POST /perceive` | `{ text }` or `{ values }`. |
| `POST /remember` | `{ content, ... }`. |
| `POST /recall` | `{ entities }` or `{ query }`. |
| `POST /learn` | `{ word, sensory, emotion, action, strength }`. |
| `POST /believe` | `{ topic, claim, ... }`. |
| `POST /step` | `{ count }` — advance the clock. |
| `POST /interact` | `{ kind, intensity }`. |
| `POST /save` | `{ path }`. |

---

## API reference

### Module exports

| Export | Description |
| --- | --- |
| `Brain` | High-level brain: core + cognitive layers. |
| `BrainCore` | The JavaScript core implementation. |
| `NativeBrainCore` | The native core, or `null` if unavailable. |
| `NeuralEngine` | The JavaScript spiking engine. |
| `NativeNeuralEngine` | The native engine, or `null` if unavailable. |
| `MemoryCortex`, `ConceptNet`, `WorkingMemory` | Cognitive layers. |
| `Genome`, `Metacognition`, `Homeostasis` | Adaptation layers. |
| `BeliefStore` | Explicit belief layer. |
| `createCore(options)` | Build a standalone core with the standard selection logic. |
| `soundPattern(text, size)` | Hash text into a sensory pattern. |
| `labelHash(label)` | Deterministic hash used for detection labels. |
| `persistence` | `save`, `load`, `saveAsync`, `loadAsync`, and the codecs. |
| `save`, `load` | Top-level shortcuts for `persistence.save` / `persistence.load`. |
| `nativeAvailable` | Whether the native addon loaded. |
| `nativeModule` | The raw native module, or `null`. |
| `nativeError` | The load error, if the addon failed to load. |
| `nativePath` | The resolved path of the loaded addon, or `null`. |
| `SENSORY_SIZE` | `400000` — the default sensory region size. |
| `PATTERN_LENGTH` | `200` — indices per sensory pattern. |
| `VERSION` | The package version. |

### `Brain` options

| Option | Default | Meaning |
| --- | --- | --- |
| `sizeGB` | `0.1` | Model size in "GB". `0.1` yields 154,000 neurons. |
| `neurons` | — | Explicit neuron count. Overrides `sizeGB`. |
| `startNeurons` | — | Initial size, alias for `neurons`. |
| `maxNeurons` | start size | Ceiling on total neurons. |
| `autoGrow` | `maxNeurons > start` | Grow automatically on tick. |
| `growthBatch` | ~1% of start | Neurons added per growth event. |
| `growthInterval` | `100` | Ticks between growth events. |
| `growthFanout` | `8` | Synapses wired per direction per new neuron. |
| `growthProfile` | — | Per-region growth multipliers. |
| `synapsesPerNeuron` | `200` | Synapse slots reserved per neuron. |
| `maxConnections` | `50000` | Max sampled connections per wiring rule. |
| `wire` | `true` | Wire the region graph on construction. |
| `seed` | — | Deterministic seed for the JavaScript fallback. |
| `native` | `true` | Set `false` to force the JS core. |
| `core` | — | Supply a pre-built core instead of constructing one. |
| `coreOptions` | — | Options forwarded to the core when using the wrapper. |

### `Brain` properties

`engine`, `regions`, `tickCount`, `valence`, `arousal`, `drive`, `needs`,
`body`, `motorState`, `neuronCount`, `maxNeurons`, `canGrow`,
`growthProgress`, `growthEvents`, `native`, `core`.

### `Brain` methods

| Area | Methods |
| --- | --- |
| Clock | `tick(count)`, `step(count)`, `start(hz)`, `stop()` |
| Growth | `grow(count)`, `growTo(target)`, `maybeGrow()` |
| Perception | `perceive(input, options)`, `hear(text, options)`, `see(input)` |
| Memory | `remember`, `recall`, `recallFact`, `recallText`, `forget` |
| Concepts | `activate`, `learn`, `associate`, `emotionOf`, `activeConcepts`, `netEmotion` |
| Working memory | `hold`, `focus`, `getFocus`, `readWorkingMemory`, `rehearse` |
| Beliefs | `believe`, `beliefsAbout`, `deliberate` |
| Adaptation | `predict`, `observe`, `recordTurn`, `tune` |
| Readout | `emotionalState`, `behaviorState`, `motorIntent`, `state`, `context` |
| Persistence | `snapshot`, `restore`, `save`, `load`, `saveAsync`, `loadAsync` |
| Core passthrough | `reward`, `punish`, `setNeeds`, `getNeeds`, `getBody`, `move`, `integrateWorldState`, `handleInteraction`, `amygdalaActivate`, `startle`, `decideBehavior`, `actionSelection`, `novelty`, `reafference`, `selfAwareness`, `getMotorIntent`, `readInternalState`, `neuronMap`, `thought`, `perceiveDense`, `perceiveVisual`, `hearDense`, `encode`, `encodeDense`, `consolidate`, `consolidateDense`, `motorQuadrantSize`, `region` |

### `Brain.state()`

Returns an object with: `tick`, `native`, `neurons`, `maxNeurons`,
`growthProgress`, `growthEvents`, `emotion`, `behavior`, `motorIntent`,
`concepts`, `netEmotion`, `workingMemory`, `focus`, `memorySize`,
`conceptSize`, `beliefs`, `internal`.

### `Brain.context()`

A compact, model-ready text block — data, not prose:

```
NEURAL tick=5 native=true neurons=154000/154000
AFFECT valence=0.123 arousal=0.074 drive=0.029 ne=0.000
BEHAVIOR curiosity=0.37 uncertainty=0.28 action=0.04 speech=0.04
NEEDS hunger=0.50 energy=0.50 joy=0.50
CONCEPTS warm:0.68 friend:0.53
WORKING MEMORY
[thought] we are talking about fire
MEMORIES
(nothing relevant recalled)
```

### API notes

- `new Brain({ native: false })` forces the JS core even when the addon is
  built. `brain.native` tells you which core is in use.
- `brain.core` is the underlying `BrainCore` (native or JS); `brain.core.engine`
  is the raw `NeuralEngine` with the typed-array neuron state.
- Growth reallocates the engine so the whole brain can be remapped. It is
  cheap at small sizes but not free — for a large brain, prefer growing in
  batches (`growthBatch`) over many tiny events.
- `createCore(options)` returns a standalone core using the same selection
  logic.
- `soundPattern(text, size)` hashes text into 200 neuron indices: a djb2 hash
  (`h = 5381`, `h = h * 31 ^ charCode`) spread with
  `(h ^ j) * 2654435761 % size`. Results are cached, so repeated words are
  free.
- Typed-array views on the native engine point directly at the C++ vectors.
  They stay valid while the owning `BrainCore` is alive.
- The default `sizeGB` is `0.1` (154,000 neurons). For tests and small demos
  use `{ neurons: 5000 }` or `{ sizeGB: 0.01 }` (15,024 neurons).
- `Brain.tick()` also advances working memory, so slots expire on the same
  clock as the neurons.

---

## Performance

The native core is meaningfully faster than the JavaScript fallback, and
**how much** depends on your workload:

| Workload | Speedup |
| --- | --- |
| Agent loop (world state, tick, reafference) | ~2x |
| Compute-heavy spiking (dense firing, encode) | ~10x |

The reason is worth understanding: a mostly-idle spiking brain is not
compute-bound. Most of the time in a realistic loop goes into scanning
regions and crossing the JS/native boundary, and C++ cannot remove those
costs. The native core earns its keep when a lot of neurons are actually
firing.

Run `npm run benchmark` to measure it on your own machine. It takes
`BENCH_NEURONS`, `BENCH_TICKS`, and `BENCH_RUNS` from the environment.

---

## Environment variables

| Variable | Meaning |
| --- | --- |
| `NEUROPILE_NATIVE` | `0` forces the JS fallback in the examples. |
| `NEUROPILE_SIZE_GB` | Model size used by the chat and HTTP examples. |
| `NEUROPILE_STEPS` | Number of steps for the game-loop example. |
| `NEUROPILE_HZ` | Tick rate for the game-loop example. |
| `NEUROPILE_ROUNDS` | Number of rounds for the growth example. |
| `NEUROPILE_START` | Starting neuron count for the growth example. |
| `NEUROPILE_MAX` | Maximum neuron count for the growth example. |

---

## Releasing

Publishing is automated. GitHub Actions watches for a version change and
publishes to npm when it finds one.

### One-time setup

**Option A — OIDC trusted publishing (recommended).** No secret to store and
nothing to rotate. npm mints a short-lived token for each publish, and
attaches a provenance attestation automatically.

1. Go to [npmjs.com → your package → Settings → Trusted Publisher](https://www.npmjs.com/settings/access-tokens)
2. Choose **GitHub Actions** and fill in:
   - Organization or user: `Damian-Mostert`
   - Repository: `neuropile`
   - Workflow filename: `publish.yml`
3. Allow **`npm publish`** under *Allowed actions*.

**Option B — a classic automation token.** Create one with
`npm token create --automation`, then add it to the repository under
*Settings → Secrets and variables → Actions → New repository secret* with the
name `NPM_TOKEN`.

The workflow uses OIDC when no `NPM_TOKEN` secret is present, so you can start
with Option B and switch to Option A later without editing anything.

### Cutting a release

```bash
npm run release           # patch: 0.1.1 -> 0.1.2
npm run release -- minor  # minor: 0.1.1 -> 0.2.0
npm run release -- major  # major: 0.1.1 -> 1.0.0
```

That bumps the version, commits, tags, and pushes. The push triggers the
publish workflow, which compares the new version against the registry and
publishes only if it is not already there.

You can also do it by hand:

```bash
npm version patch
git push --follow-tags
```

### What the publish workflow does

| Step | Why |
| --- | --- |
| Read the version from `package.json` | Single source of truth. |
| Check the npm registry | Skips the publish if the version already exists. |
| `npm ci` | Installs dependencies from the lockfile. |
| `npm run build` | Compiles the native addon. |
| `npm test` | The full suite must pass before anything is published. |
| Verify the addon loads | Catches a broken or mismatched build. |
| `npm publish` | Publishes with provenance. |

### Safety checks

`npm run release` refuses to run when:

- The working tree is dirty, so the tag always matches the commit.
- The current version is already on the registry, since npm rejects
  duplicate versions.

Every publish also runs `scripts/prepublish-check.js`, which fails the publish
if the version is not valid semver, the repository URL points at the wrong
project, a listed file is missing, or the compiled addon reports a different
version than `package.json`.

### Workflows

| File | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/publish.yml` | Push to `main`, tag `v*`, release | Publishes to npm if the version is new. |
| `.github/workflows/ci.yml` | Push to `main`, pull request | Builds and tests on Linux and Windows. |

---

## Development

```bash
npm test            # full suite; native tests skip if the addon is not built
npm run test:native # only the native compatibility test
npm run build       # rebuild the native addon
```

The test suite runs every behaviour against **both** the JavaScript fallback
and the native core, and asserts that the two agree — including on growth
layout. If the addon is not built, the native tests skip rather than fail.

### Project layout

```
src/
  addon.cpp            Node-API bindings
  neuropile_core.cpp   the C++ substrate
  neuropile_core.hpp   region table, wiring, engine, core declarations
lib/
  index.js -> brain.js the JS core
  engine.js            the JS spiking engine
  memory.js            MemoryCortex
  concepts.js          ConceptNet
  working-memory.js    WorkingMemory
  genome.js            Genome
  metacognition.js     Metacognition
  homeostasis.js       Homeostasis
  beliefs.js           BeliefStore
  patterns.js          sensory hashing
  persistence.js       snapshot codecs + save/load
scripts/
  no-native.js         fallback message when the addon cannot be built
  prepublish-check.js  guard that runs before every publish
  release.js           version bump, tag, and push
  gen-llms-full.js     regenerates the single-file AI doc bundle
examples/              runnable demos
test/                  the test suite
docs/                  agent-focused documentation
.github/workflows/     CI and publish automation
llms.txt               AI-readable index of the documentation
AGENTS.md              instructions for coding agents
```

The C++ core and the JS core implement the same API and are checked against
each other by the test suite. The cognitive layers above the core are pure
JavaScript, so they can be swapped or extended without recompiling.

---

## License

MIT © 2026 Damian Mostert

See [LICENSE](./LICENSE).

---