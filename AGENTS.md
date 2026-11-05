# AGENTS.md

Instructions for AI coding agents working with the `neuropile` package.

## What this package is

`neuropile` is a spiking-neuron brain for Node.js. It has a C++17 native
core (Node-API) and a pure-JavaScript fallback, both exposing the same API.

It is **not** a wrapper around a hosted model and **not** a neural-network
library like TensorFlow. It is a simulation: spiking neurons across 16 brain
regions, neuromodulators, needs, affect, motor intent, associative memory,
concepts, working memory, metacognition, homeostasis, and beliefs. The brain
can grow new neurons.

## Read this first

The bundled docs are version-matched to the installed package. Read the file
that matches what you are doing — they are short and written for agents.

| You are doing | Read |
| --- | --- |
| Writing your first brain | `docs/getting-started.md` |
| Looking up a method or option | `docs/api.md` |
| Copy-paste a use case | `docs/patterns.md` |
| Debugging something surprising | `docs/gotchas.md` |
| Understanding the model | `docs/concepts.md` |

`llms.txt` is a short index of all of the above.

## The three things that will bite you

**1. `hear()` also remembers.** It stores the utterance as an episodic
memory. Pass `{ remember: false }` to skip that.

**2. Growth numbers are not exact.** Region sizes round to multiples of 1000,
so `startNeurons: 20000` starts at 19,020 neurons. Set `growthBatch`
explicitly if you need an exact count.

**3. Reading state can have side effects.** `emotionalState()` and
`behaviorState()` decay the needs as a side effect. Use the `valence`,
`arousal`, and `drive` getters when you want a side-effect-free read.

Full details in `docs/gotchas.md`.

## The design principle

**The brain ships with structure and no opinions. The world supplies the
opinions.**

This is the rule everything else follows from:

- There are no seeded concepts. A new brain has zero, and
  `emotionOf('danger')` returns `null`.
- Nothing is good or bad until the environment says so, through
  `brain.ground()` or through `valence` / `arousal` / `approach` on a
  detection or interaction.
- Affect attaches to **features**, not words, so it generalises. Teach the
  brain that "hot, burning" hurts and it will fear a word it has never been
  told about, as long as that word shares the features.
- Relatedness is learned from co-occurrence, never declared.
- **Drives belong to the body, not the brain.** A brain has no needs until
  the caller declares them. There is no built-in hunger, energy, or joy,
  and no built-in food.

If you add a behaviour that assumes a good thing or a bad thing, it belongs
in the world description, not in the brain.

## Declaring drives

`lib/drives.js` and the `Drive` struct in `src/neuropile_core.hpp` hold the
homeostatic system. A drive declares how fast it decays, when it starts to
hurt, when it is an emergency, what movement costs it, and what satisfies it.

The vocabulary that satisfies a drive comes from the schema, so a world can
use any words it likes. `satisfiedBy` is matched against an interaction's
`label`, or its `note` when no label is given.

```js
new Brain({
  drives: {
    fuel: { decay: 0.01, threshold: 0.3, satisfiedBy: ['diesel'] },
  },
});
```

Unknown drive names are ignored rather than silently created: a body
cannot have a drive it never declared.


## The API shape you need to know

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.01 }); // 15,024 neurons - fast to build
brain.start(10);                           // tick at 10 Hz

brain.hear('hello');
brain.tick(5);

brain.state();    // everything, as a plain object
brain.context();  // compact text block for an LLM prompt
```

- `Brain` is the high-level object: the core plus the cognitive layers. Use
  this unless you specifically want the raw substrate.
- `BrainCore` is the spiking substrate alone.
- `createCore(options)` picks native or JS using the same logic as `Brain`.
- `brain.native` tells you which core is active. `nativeAvailable` is a
  module-level boolean.
- `Grounding` is the layer that binds the world to concepts.

## How the substrate learns

Hebbian plasticity runs on co-activation alone. Dopamine modulates the
learning rate rather than gating it, so a brain that has merely watched the
world has already changed.

The co-activation window is measured in **ticks**, not wall-clock time.
This is deliberate: a wall-clock window meant learning depended on how fast
the host happened to be running. Keep it in ticks.

Two things make the substrate actually learn, and both are easy to break:

- **`inject()` must fire.** It used to only raise the membrane potential,
  so a stimulus arriving through `inject()` never spiked and never learned.
- **Wiring must be evenly distributed.** `_wireRegions` used to pick source
  neurons at random, which left most of them with no outgoing synapse.
  Activity could not propagate.

A pattern also has to be rich enough to move the network. A handful of
indices is not enough for anything to co-activate.

## Conventions in this codebase

- **The C++ and JS cores must stay in sync.** They implement the same API.
  The test suite runs every behaviour against both and asserts they agree. If
  you change one, change both, or the tests fail.
- **The cognitive layers are pure JavaScript.** Everything in `lib/` except
  `engine.js` and `brain.js` runs above the substrate and can be changed
  without recompiling the addon.
- **`lib/brain.js` is the JS core; `src/neuropile_core.cpp` is the native
  one.** They are line-for-line parallel. Keep them that way.
- **The native addon version is synced from `package.json` at load time** in
  `index.js`. Do not hardcode a version string in `src/addon.cpp`.
- **Comments explain *why*, not *what*.** Match the existing tone.
- **`lib/patterns.js` and `soundPattern()` in the native core must agree
  exactly.** There is a test asserting it. The encoding is a sparse
  distributed code, not a hash, because a hash cannot represent similarity
  and therefore cannot support learning that generalises.
- **Do not hoist arrays out of loops by accident, and do not index into
  `brain.engine.synapseWeights` in a loop.** Each access crosses the native
  boundary. Copy it once with `Float32Array.from(...)` and compare the copy.

## Working on this repo

```bash
npm install            # builds the native addon if a toolchain is present
npm run build          # rebuild the native addon
npm test               # full suite, both cores
npm run test:native    # native compatibility test only
npm run benchmark      # native vs JS comparison
```

The test suite skips the native tests when the addon is not built, rather
than failing. That is intentional — the JS fallback must stay usable without
a compiler.

Node 18+. C++17 for the native core. Python 3 for `node-gyp`.

### Releasing

```bash
npm run release           # patch bump
npm run release -- minor  # minor bump
```

That bumps the version, commits, tags, and pushes. The push triggers
`.github/workflows/publish.yml`, which compares the version against the npm
registry and publishes only if it is new there.

Never publish by hand. Never push a version bump without the tag — the
workflow keys off the version in `package.json`.

## Conventions for new code

- Match the existing style: 2-space indent, semicolons, single quotes,
  `'use strict'` at the top of every file.
- Every new public method needs a type definition in `index.d.ts` and an
  entry in `docs/api.md`.
- If you add a method to `BrainCore`, add it to the JS core, the native
  core, `index.d.ts`, the `CORE_PROXY_METHODS` list in `index.js` if it should
  be proxied, and `docs/api.md`.
- Numbers in the docs must be verifiable by running the code. If you state a
  neuron count, a default, or a threshold, check it first.

## Things not to do

- Do not add runtime dependencies. `node-addon-api` is the only one, and it
  is build-time only.
- Do not make the native addon required. The JS fallback is a first-class
  path.
- Do not hardcode values that already have a default in one place.
- Do not rename the `engine`, `regions`, or `core` properties — they are
  public API.
- **Do not seed concepts or opinions.** No built-in list of good and bad
  words, no built-in reward for any particular label. If the brain needs to
  know that something is pleasant, the world tells it.
- **Do not hardcode needs, drives, or what satisfies them.** There is no
  built-in hunger, energy, joy, or food. The body declares its drives and
  the world says what satisfies them.
- **Do not gate plasticity behind dopamine.** Co-activation is sufficient on
  its own. Reward and punishment modulate the rate; they do not enable it.
- **Do not use wall-clock time for simulation windows.** Anything the
  simulation reasons about — refractory periods, co-activation, decay —
  should be measured in ticks, so behaviour does not depend on how fast the
  host is running.

