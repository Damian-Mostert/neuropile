# Gotchas

The behaviours that surprise people. Read this before debugging something that
"should" have worked.

- [A new brain knows nothing](#a-new-brain-knows-nothing)
- [A new brain has no needs](#a-new-brain-has-no-needs)
- [Growth numbers are not exact](#growth-numbers-are-not-exact)
- [`hear()` also remembers](#hear-also-remembers)
- [Memories do not decay on their own](#memories-do-not-decay-on-their-own)
- [`recall()` prefers what is firing right now](#recall-prefers-what-is-firing-right-now)
- [`believe()` takes two different shapes](#believe-takes-two-different-shapes)
- [The native addon may not have built](#the-native-addon-may-not-have-built)
- [`context()` is data, not prose](#context-is-data-not-prose)
- [Working memory is only seven slots](#working-memory-is-only-seven-slots)
- [Calls have side effects on needs](#calls-have-side-effects-on-needs)
- [Growth reallocates the whole engine](#growth-reallocates-the-whole-engine)
- [The brain is stochastic without a seed](#the-brain-is-stochastic-without-a-seed)
- [Typing is a string, not a number](#typing-is-a-string-not-a-number)
- [Small inputs do not move the network](#small-inputs-do-not-move-the-network)

---

## A new brain knows nothing

A brain that has experienced nothing has no concepts, no opinions, and no
affect. This surprises people who expect "brain" to come pre-loaded.

```js
const brain = new Brain({ neurons: 5000 });

brain.emotionOf('danger');  // null
brain.emotionOf('safe');    // null
brain.emotionOf('food');    // null
```

That is deliberate. Whether something is good or bad is a fact about the
world the brain was put in, not a fact about brains, so the world supplies
it. Two ways to do that:

```js
// Say what a thing is worth, and what it feels like.
brain.ground('wolf', {
  features: ['grey', 'wild'],
  valence: -0.9, arousal: 0.8, approach: -1.0,
});

// Or say it as the brain perceives it.
brain.integrateWorldState({
  detections: [{ label: 'wolf', w: 0.9, valence: -0.9, arousal: 0.8 }],
});
```

Because the affect attaches to the **features**, it transfers. Teach the
brain that "hot, burning" hurts and it will fear anything else with those
features, including words it has never seen.

---

## Small inputs do not move the network

Perceiving a handful of neurons barely reaches the rest of the brain. A
pattern needs to be rich enough to drive activity across regions, or
nothing co-activates and nothing is learned.

```js
// Barely does anything.
brain.perceive(new Uint32Array([1, 2, 3]));

// Spreads through the network and starts learning.
const pattern = new Uint32Array(200);
for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 7 + 3) % 400000;
brain.perceive(pattern);
```

`hear()` and `remember()` already produce rich-enough patterns, so they are
the easy path if you just want to watch the brain learn.

---

## A new brain has no needs

Drives belong to the body, so a brain that was not given any has none.
`getNeeds()` returns an empty object, and setting a drive the body does
not have does nothing.

```js
const brain = new Brain({ neurons: 5000 });

brain.getNeeds();            // {}
brain.setNeeds({ hunger: 0.2 });
brain.getNeeds();            // {} - there is no hunger drive
```

Declare them when you build the brain:

```js
const brain = new Brain({
  neurons: 5000,
  drives: {
    hunger: { threshold: 0.4, satisfiedBy: ['feed'] },
    energy: { threshold: 0.3, satisfiedBy: ['rest'] },
  },
});
```

The same rule applies to interactions: there is no built-in vocabulary. What
satisfies a drive is whatever the schema says, matched against the
interaction's `label` (or its `note` when there is no label).

```js
brain.integrateWorldState({
  interaction: { label: 'feed', x: 0.5, y: 0.5, valence: 0.6 },
});
```

---

## Growth numbers are not exact

Region sizes are rounded to multiples of 1000, so the real neuron count is
never exactly what you asked for.

```js
const brain = new Brain({ startNeurons: 20000, maxNeurons: 200000 });
brain.neuronCount; // 19020, not 20000
```

The default `growthBatch` is ~1% of the **actual** start, so:

```js
const brain = new Brain({ startNeurons: 20000, maxNeurons: 200000 });
brain.tick(100);
brain.neuronCount; // 19210 (19020 + 190), not 20020
```

To land on an exact number, set `growthBatch` explicitly:

```js
const brain = new Brain({
  startNeurons: 20000,
  maxNeurons: 200000,
  growthBatch: 1000,
});
brain.tick(100);
brain.neuronCount; // 20020
```

Likewise `sizeGB: 0.1` gives 154,000 neurons and `sizeGB: 0.01` gives 15,024.
Neither is a round number.

**Do not assert exact neuron counts** unless you have set `growthBatch`
explicitly. Assert ranges, or compare relative growth.

---

## `hear()` also remembers

`hear()` is not just input. It hashes the words into sensory patterns,
activates matching concepts, **and stores the whole utterance as an episodic
memory**.

```js
brain.hear('hello');
brain.memory.size; // 1
```

If you want input without the memory side effect:

```js
brain.hear('hello', { remember: false });
```

This matters if you are counting memories, or if the user utterance should
not become a memory the character can later recall out of context.

---

## Memories do not decay on their own

Nothing decays until you call `forget()`.

```js
brain.remember('something', { entities: ['x'] });
brain.tick(1000);
brain.memory.size; // still 1 — no decay happened
```

Decay and pruning happen in `brain.forget()`:

```js
brain.forget();       // decays memory and prunes concepts
```

`forget()` is a single pass, so call it on a schedule if you want continuous
decay:

```js
setInterval(() => brain.forget(), 60_000);
```

Memory types decay at different rates: episodic fastest, semantic slowest.
Utterances decay very slowly.

---

## `recall()` prefers what is firing right now

Recall is biased by neural reafference — the neurons currently firing push
matching memories to the front. This is deliberate, and it is the main reason
the simulation drives cognition.

The consequence: **the same query can return different results depending on
the brain's internal state.**

```js
brain.remember('the fire is warm', { entities: ['fire'] });
brain.recall(['fire']); // may be empty if nothing neural matches
```

If you need deterministic semantic matching:

```js
brain.recall(['fire'], { neural: false });
```

Note that `recall([])` with no entities returns nothing. Use
`{ topN: 5 }` with an empty query only if you want the reafference-only
selection, which is what `brain.context()` does internally.

---

## `believe()` takes two different shapes

The method accepts a claim string or a full object.

```js
// String form - the topic must come from options.
brain.believe('fire is warm', { topic: 'fire', confidence: 0.6 });

// Object form - everything inline.
brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.6 });
```

The string form with no `topic` returns `null` and records nothing.

Two independent sources agreeing on the same claim are treated as evidence,
not a duplicate. Recording the same claim twice from the same source raises
confidence instead of adding a second entry.

---

## The native addon may not have built

```js
const { nativeAvailable } = require('neuropile');
nativeAvailable; // false means the JS fallback is in use
```

This is not an error — the JS fallback has the same API. But it is roughly
10x slower under heavy load, and it is the first thing to check if the brain
feels sluggish.

Common causes:

- No C++17 compiler installed.
- npm 12 blocking install scripts by default.

```bash
npm approve-scripts neuropile
npm rebuild neuropile
```

`require('neuropile').nativeError` holds the actual load error if you need
it.

---

## `context()` is data, not prose

`brain.context()` returns structured lines meant to be parsed and embedded.
It is not a paragraph and it does not address the user.

```
AFFECT valence=0.123 arousal=0.074 drive=0.029 ne=0.000
```

If you want natural language, generate it. Feed `context()` to a model and
ask it to describe the character's feelings in character.

Do not concatenate `context()` directly into a prompt without a delimiter
between it and the user's input, or the model may blur the two together.

---

## Working memory is only seven slots

Capacity is 7, hard-coded. Anything past that evicts the weakest slot.

```js
for (let i = 0; i < 20; i++) brain.hold(`item ${i}`, [`e${i}`], 'thought');
brain.workingMemory.size; // 7
```

Eviction is by source priority first, then by strength:

| Source | Priority |
| --- | --- |
| `input` | 4 |
| `answer` | 3 |
| `grounding` | 2 |
| `thought` | 1 |
| `self_speech` | 0 |

Slots expire after 12 seconds of wall-clock time, not ticks. `rehearse()`
extends them.

---

## Calls have side effects on needs

Reading state is not always free of side effects.

`brain.emotionalState()` calls `_tickNeeds()` internally, which decays
hunger, energy, and joy. `brain.behaviorState()` calls `emotionalState()`, so
it does too.

If you poll `emotionalState()` in a tight loop, the brain will get hungry
much faster than if you only tick it occasionally.

Similarly, `brain.move()` consumes energy and reduces joy. `brain.tick(n)`
decays needs n times.

If you want a stable read, use `brain.valence` / `brain.arousal` /
`brain.drive` — those are plain getters with no side effects.

---

## Growth reallocates the whole engine

Growth is not incremental. It builds a new engine, remaps every neuron and
synapse into it, and swaps it in.

```js
const brain = new Brain({ startNeurons: 20000, maxNeurons: 200000 });
brain.tick(100); // one growth event — full reallocation
```

It is cheap at small sizes but not free. For a large brain, prefer fewer,
bigger growth events:

```js
{ growthBatch: 5000, growthInterval: 100 }
```

over many small ones.

Learned state is preserved: potentials, thresholds, and synapse weights all
survive the remap.

---

## The brain is stochastic without a seed

Wiring, growth distribution, and concept activation all use randomness.

```js
const a = new Brain({ startNeurons: 5000, native: false });
const b = new Brain({ startNeurons: 5000, native: false });
// different wiring, different results
```

For reproducible behaviour, set a seed:

```js
const brain = new Brain({ startNeurons: 5000, seed: 42, native: false });
```

The seed applies to the JavaScript fallback. The native core uses its own
generator, so only use seeds when you have forced `native: false` and are
testing the JS path.

---

## Typing is a string, not a number

Memory types are strings.

```js
brain.remember('x', { type: 'episodic' });   // correct
brain.remember('x', { type: 3 });             // wrong — not a valid type
```

Valid values are `'episodic'`, `'semantic'`, `'procedural'`, and
`'utterance'`.

The same applies to emotion names, working memory source types, and belief
sources — they are all free-form strings, but some are checked for special
behaviour:

- **Emotion**: `'neutral'`, `'happy'`, `'upset'` are read by the
  metacognitive predictor. Other strings are treated as neutral.
- **Interaction kind**: `'feed'`, `'rest'`, `'play'`, `'poke'`, `'danger'`
  have specific effects. Anything else is mildly aversive.
- **Belief source**: any string. `'observation'` and `'internal'` are
  conventions.

---

## Other things worth knowing

- **`brain.tick()` also advances working memory**, so slots expire on the
  same clock as the neurons.
- **`start()` timers are `unref`'d**, so they will not keep your process
  alive. Call `stop()` when you are done anyway.
- **`brain.core.engine`** gives you the raw typed arrays. On the native core
  these point directly at C++ memory and stay valid while the core is alive.
- **`soundPattern()` caches by text**, so hashing the same word repeatedly is
  free.
- **`maxNeurons` is clamped up** to the starting size, never down. Setting
  `maxNeurons` below the start size does not shrink the brain.
