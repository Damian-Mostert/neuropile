# Concepts

How the brain actually works. You do not need this to use the package, but
it explains why the API behaves the way it does.

- [The shape of the system](#the-shape-of-the-system)
- [The spiking engine](#the-spiking-engine)
- [The 16 regions](#the-16-regions)
- [Wiring](#wiring)
- [Affect](#affect)
- [Needs and the body](#needs-and-the-body)
- [Motor intent](#motor-intent)
- [Reafference](#reafference)
- [Memory](#memory)
- [Concepts](#concepts)
- [Beliefs](#beliefs)
- [Metacognition and homeostasis](#metacognition-and-homeostasis)
- [Growth](#growth)

---

## The shape of the system

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

Two things are worth noticing.

**The split is deliberate.** Everything below `BrainCore` is pure JavaScript.
You can replace or extend the cognitive layers without recompiling the
native addon.

**The arrow goes both ways.** The core does not just sit under the cognitive
layers — the cognitive layers read back from it. `MemoryCortex.recall()` is
biased by `core.reafference()`, and `Metacognition` writes its error signal
back as dopamine through `core.reward()` / `core.punish()`. That feedback
loop is what makes this a brain rather than a database with a mood.

---

## The spiking engine

Neurons are leaky integrate-and-fire units.

| Property | Value |
| --- | --- |
| Membrane potential | `Float32Array`, one per neuron |
| Decay | `0.95` per tick, times a per-neuron `decayRate` |
| Threshold | Per region, 0.08 to 0.35 |
| Inhibitory fraction | Per region, 5% to 35% — the first N% of each region |
| Refractory period | 20 ms |
| Hebbian rate | 0.012 |
| Weight decay | 0.002 |
| Weight bounds | -1.5 to 1.5 |
| Dopamine decay | 0.96 per tick |
| Norepinephrine decay | 0.92 per tick |

**Sparse decay** is the key performance trick. Only neurons that have actually
received input are updated on a tick, tracked in an active list. An idle
brain costs almost nothing, which is why a mostly-quiet brain is not
compute-bound.

**Firing** works like this: a neuron whose potential reaches its threshold
fires, resets to zero, and propagates to its synapse targets. Inhibitory
neurons propagate a negative weight. Firing is gated by the refractory
period, so a neuron cannot fire twice within 20 ms.

**Learning is dopamine-gated.** Hebbian strengthening only happens when
dopamine is outside the ±0.05 band. Otherwise synapses decay.

```js
brain.reward(0.5);   // dopamine up -> synapses strengthen
brain.punish(0.5);   // dopamine down -> synapses weaken
```

This is why reward and punishment change *what the brain learns*, not just
how it feels.

---

## The 16 regions

Regions are allocated proportionally to a fixed base size, so the brain keeps
its shape as it changes size.

| Region | Base size | Role |
| --- | --- | --- |
| `thalamus` | 80,000 | Relay and gating. Carries body, need, and motion signals. |
| `hypothalamus` | 50,000 | Drives. Converts need pressure into arousal and drive. |
| `amygdala` | 40,000 | Valence and threat. Fires on aversive input. |
| `sensory` | 400,000 | Somatosensory and auditory channel. |
| `visual` | 100,000 | Visual channel, also used for object detections. |
| `hippocampus` | 160,000 | Memory encoding target. |
| `temporal` | 200,000 | Consolidation target — long-term storage. |
| `association` | 600,000 | Integration, concept grounding, reafference readout. |
| `prefrontal` | 300,000 | Inhibition, deliberation, self-awareness. |
| `acc` | 120,000 | Conflict detection. Feeds uncertainty. |
| `basalGanglia` | 180,000 | Action selection and motor gating. |
| `motor` | 240,000 | Movement output, in four directional quadrants. |
| `cerebellum` | 300,000 | Motor refinement and coordination. |
| `vta` | 20,000 | Dopamine source. |
| `locusCoeruleus` | 15,000 | Norepinephrine source. |
| `raphe` | 15,000 | Serotonin / stability source. |

At `sizeGB: 0.1` the scale factor is `0.1 / 1.82`, giving 154,000 neurons
total.

Read a region at runtime:

```js
const assoc = brain.core.region('association');
assoc.start;      // first neuron index
assoc.end;        // last neuron index
assoc.size;       // neuron count
assoc.threshold;  // firing threshold
assoc.inhibRatio; // inhibitory fraction
```

---

## Wiring

There is a wiring table of long-range projections between regions. Each entry
has a density, a minimum weight, and a maximum weight.

```js
['association', 'hippocampus', 0.7, 0.4, 0.9]
//  from           to            density  wMin  wMax
```

At construction, each rule samples `density × source region size` connections
(capped by `maxConnections`) and gives each a random weight in range.

Within each region, neurons are also wired to each other, so regions are not
isolated islands.

`maxConnections` (default 50,000) bounds the samples per rule. Lower it to
build a brain faster, or raise it for a denser connectome.

---

## Affect

Three numbers, all roughly in -1..1, all smoothed over time.

### Valence

How good or bad things feel. Driven by dopamine, minus need pressure, plus
serotonin stability, minus conflict penalty.

```js
brain.valence; // -1 (miserable) to 1 (delighted)
```

### Arousal

How activated the brain is. Driven by sensory and association activity, plus
hypothalamic pressure.

```js
brain.arousal; // 0 (calm) to 1 (highly activated)
```

### Drive

How much the brain wants to act. Driven by hippocampal activity and
hypothalamic pressure.

```js
brain.drive;
```

### Norepinephrine

The alerting signal. It rises when the amygdala detects a threat, and it
raises thresholds across the sensory and association regions — making the
brain more sensitive.

```js
brain.emotionalState().norepinephrine;
```

### Behavior state

Derived from the three affect numbers plus regional activity.

| Field | Meaning |
| --- | --- |
| `curiosity` | Driven by hypothalamic pressure and novelty. |
| `uncertainty` | Driven by conflict detection in the ACC. |
| `actionReadiness` | Driven by basal ganglia and VTA. |
| `patience` | Driven by raphe stability and low arousal. |
| `speechReadiness` | Whether the brain wants to talk. |
| `researchDrive` | A blend of curiosity, uncertainty, and pressure. |

`decideBehavior()` combines these into `canSpeak`, `shouldResearch`,
`shouldAct`, and a `responseMode` of `'grounded'`, `'speak'`, or `'quiet'`.

---

## Needs and the body

Three needs, each 0..1: `hunger`, `energy`, `joy`.

They start at 0.5 and drift down. Low needs generate distress signals in the
hypothalamus, and hunger below 0.4 produces pain signals and an amygdala
response.

```js
brain.getNeeds();          // { hunger, energy, joy }
brain.setNeeds({ hunger: 0.2 });
brain.handleInteraction('feed', 1.0);  // reduces hunger, rewards
```

The body is a position in a unit square, plus heading, speed, and energy.

```js
brain.getBody(); // { x, y, heading, speed, energy }
```

`integrateWorldState()` reads the body and needs and turns them into neural
signals: spatial position relative to centre, distance from the border,
motion, and need pressure.

---

## Motor intent

The motor region is divided into four quadrants: right, left, down, up.

`getMotorIntent()` samples the mean activation of each quadrant and returns
the difference between opposing pairs.

```js
const intent = brain.getMotorIntent();
// { dx: -0.62, dy: 0.78, strength: 0.41 }
```

`dx` and `dy` are a normalized direction. `strength` is 0..1, scaled by how
much of the motor region is active.

The brain does not move itself — it expresses an intent, and your code
decides what to do with it. `brain.move(dx, dy, intensity)` applies the
intent to the brain's own body model and fires the corresponding motor and
cerebellar pulses.

---

## Reafference

Reafference is the brain noticing its own activity — the "correlate of
action". Here it means: which association neurons are currently firing.

```js
const reaf = brain.reafference(20);
reaf.indices;  // the top N association neuron indices
reaf.strength; // 0..1, how far they deviate from baseline
```

It is computed by comparing current association potentials against a slow
moving baseline, then taking the largest deviations.

`MemoryCortex.recallByReafference()` uses this to bias recall: memories
whose encoding pattern overlaps with currently-firing neurons come first.

```js
// Inside Brain.recall():
const reaf = this.core.reafference(20);
const nodes = this.memory.recallByReafference(reaf.indices, query, emotion, topN, context);
```

---

## Memory

A memory node holds `content`, `entities`, `emotion`, `salience`,
`dopamine`, `timestamp`, `accessCount`, `type`, and `turnId`.

Four types, decaying at different rates:

| Type | Decay | Use |
| --- | --- | --- |
| `episodic` | Fastest (1.8x) | Things that happened. |
| `semantic` | Slowest (0.6x) | Facts. |
| `procedural` | Medium | How to do something. |
| `utterance` | Very slow | Speech. What `hear()` stores. |

Recall is a blend of three factors:

1. **Entity overlap** — how many of the query's entities the memory has.
2. **Emotion match** — whether the emotional tone matches.
3. **Reafference** — whether the neural encoding overlaps with what is
   firing now.

Salience and recency then affect the ordering.

Decay only happens when you call `brain.forget()`.

---

## Concepts

A concept is a label on an experienced cluster.

```js
brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4 }, 'watch', 0.6);
```

The concept accumulates:

- **Sensory features** — a weighted map of feature names to values.
- **Emotion** — `{ valence, arousal, approach }`, averaged over learnings.
- **Activation** — how strongly it is currently lit.
- **Associations** — links to other concepts.

Activation decays over time and is boosted when the word is heard or
recalled. `activeConcepts()` returns the strongest ones.

`netEmotion()` sums the emotion of all active concepts, which is how a
character's overall mood shifts toward whatever it has been thinking about.

---

## Beliefs

Beliefs are claims with provenance, kept deliberately separate from memories.

```js
brain.believe({
  topic: 'fire',
  claim: 'fire is warm',
  source: 'observation',
  confidence: 0.8,
  verified: true,
});
```

Keeping the roles separate prevents a generated sentence or a repeated
thought from silently becoming knowledge.

`deliberate()` clusters claims whose text overlaps by token similarity
(threshold 0.55), then decides whether to conclude:

- **Concluded** if the leading cluster is verified, or has 2+ independent
  sources and confidence >= 0.45.
- **Not concluded** otherwise.

The store caps at 500 beliefs, evicting the weakest (unverified, low
confidence, oldest) first.

---

## Metacognition and homeostasis

### Metacognition

Predicts the next internal state before you respond, then scores itself
after.

```js
const record = brain.predict({ intent: 'question', emotion: 'happy' }, 0.6);
// ... generate a response ...
const delta = brain.observe(record, 'because fire is warm?');
```

The prediction is a function of emotion, novelty (from reafference), arousal,
and drive. The observation compares what was predicted against what actually
happened, and produces an accuracy score.

The error is fed back as dopamine through `brain.reward()` / `brain.punish()`.

The cue weights adapt. A missed valence prediction raises `emotion_cue`; an
accurate prediction decays all weights slightly. The log keeps the last 20
records.

### Homeostasis

Watches a rolling window of 20 turns and looks for the metric that is
furthest outside its target range.

| Metric | Target |
| --- | --- |
| `prediction_accuracy` | 0.55 to 1.0 |
| `interrupt_rate` | 0.0 to 0.3 |
| `memory_usefulness` | 0.3 to 1.0 |
| `goal_resolution_rate` | 0.4 to 1.0 |

When it finds a problem, it proposes **one** small mutation to a genome
parameter, runs a 10-turn trial, and then accepts the change (if it improved
by at least 0.02 and did not degrade anything else by more than 0.05) or
reverts it.

Every trial is written to the ledger, which you can read:

```js
brain.homeostasis.ledger;
brain.homeostasis.ledgerSummary(3);
```

---

## Growth

Neurogenesis adds neurons over time.

**Distribution.** New neurons are apportioned across the 16 regions by
`base size × growth weight`. The default weights favour the plastic
regions:

| Region | Weight |
| --- | --- |
| `hippocampus` | 3.0 |
| `association` | 2.6 |
| `prefrontal` | 2.2 |
| `temporal` | 1.6 |
| `sensory` | 1.4 |
| `visual`, `acc` | 1.2 |
| `basalGanglia`, `motor`, `cerebellum` | 1.0 |
| `thalamus` | 0.8 |
| `amygdala` | 0.7 |
| `hypothalamus` | 0.4 |
| `vta` | 0.3 |
| `locusCoeruleus`, `raphe` | 0.2 |

You can override any of these with `growthProfile`.

**Wiring.** Each newborn neuron gets:

- `growthFanout` (default 8) local recurrent connections in both directions,
  with weights in 0.1 to 0.5.
- `growthFanout` connections for each long-range projection the region
  participates in, using that rule's weight range.

So a grown region keeps its role in the circuit.

**Preservation.** The brain is remapped, not rebuilt. Potentials, thresholds,
decay rates, inhibitory flags, and learned synapse weights all survive, with
synapse targets rewritten through the remap table.

**Cadence.** `tick()` calls `maybeGrow()`, which adds a batch if
`growthInterval` ticks have passed since the last event. Setting
`growthInterval: 0` disables automatic growth entirely.
