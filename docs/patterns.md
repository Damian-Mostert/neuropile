# Patterns

Copy-paste recipes for common tasks. Each one is complete and runnable.

- [Give a language model the brain's state](#give-a-language-model-the-brains-state)
- [A chat character with memory](#a-chat-character-with-memory)
- [A game agent that acts on its own](#a-game-agent-that-acts-on-its-own)
- [An HTTP service over a brain](#an-http-service-over-a-brain)
- [A character that learns words](#a-character-that-learns-words)
- [A character with opinions](#a-character-with-opinions)
- [Teaching a brain about your world](#teaching-a-brain-about-your-world)
- [Giving the body drives](#giving-the-body-drives)
- [Growing a brain over time](#growing-a-brain-over-time)
- [Persistent agents](#persistent-agents)
- [Embedding in an existing app](#embedding-in-an-existing-app)
- [Testing](#testing)

---

## Teaching a brain about your world

A new brain has no opinions. It does not think `wolf` is frightening or
`lamb` is tasty, because those are facts about the world, not about brains.
You supply them.

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.05 });

// Tell the brain what these things are worth, and what they feel like.
// Features are given as a map so you can say how much each one counts.
brain.ground('wolf', {
  features: { grey: 0.2, wild: 1.0, quadruped: 0.7, howls: 0.9 },
  valence: -0.9, arousal: 0.8, approach: -1.0,
});

brain.ground('lamb', {
  features: { white: 0.2, tame: 1.0, quadruped: 0.7, bleats: 0.9 },
  valence: 0.7, arousal: 0.2, approach: 0.8,
});
```

The brain now has opinions. More usefully, it has opinions that
**generalise**. The next animal you mention that shares features with the
wolf is treated as dangerous too, even if you never said so:

```js
// The brain has never heard of "jackal", but it shares features with the
// wolf, so it inherits the fear.
brain.ground('jackal', { features: { grey: 0.2, wild: 1.0, quadruped: 0.7 } });

brain.emotionOf('jackal');  // { valence: -0.18, ... }
```

That is the point of `features`. If you only ever taught the brain about
words, it would only ever know about words. Teach it about features and it
can apply what it learned to things it has never been told about.

The weights matter. A pebble is also grey, but grey is a weak feature, so
the wolf's fear barely reaches it:

```js
brain.ground('pebble', { features: { grey: 0.2, hard: 0.9 } });

brain.emotionOf('pebble');  // near neutral
```

Relatedness is learned from things being seen together, not declared:

```js
// Wolves and sheep keep turning up in the same place.
for (let i = 0; i < 10; i++) {
  brain.ground('wolf', { features: { grey: 0.2, wild: 1.0 } });
  brain.ground('sheep', { features: { white: 0.2, tame: 1.0 } });
  brain.coOccur(['wolf', 'sheep']);
}

brain.relatedness('wolf', 'sheep');  // 1.0
brain.relatedness('wolf', 'stone');  // 0.0
```

### Telling the brain what just happened

The same principle applies to events. You do not need to use the built-in
vocabulary:

```js
brain.integrateWorldState({
  detections: [
    { label: 'wolf', w: 0.9, valence: -0.9, arousal: 0.8, approach: -1.0 },
    { label: 'lamb', w: 0.6, valence: 0.7, arousal: 0.2, approach: 0.8 },
  ],
  interaction: {
    note: 'the wolf lunged',
    valence: -0.8,
    arousal: 0.9,
  },
});

brain.tick(3);
brain.emotionalState();  // the brain is now afraid
```

### Giving the body drives

Drives belong to the body, so you declare them when you build the brain. A
brain with no drives has no needs at all.

```js
const brain = new Brain({
  sizeGB: 0.05,
  drives: {
    fuel: {
      decay: 0.01,
      threshold: 0.3,
      critical: 0.1,
      satisfiedBy: ['diesel', 'charging-station'],
      effort: 0.004,   // movement costs fuel
    },
    coolant: {
      decay: 0.005,
      threshold: 0.4,
      satisfiedBy: 'coolant',
    },
  },
});

console.log(brain.getNeeds());  // { fuel: 0.5, coolant: 0.5 }
```

The world satisfies them using its own vocabulary:

```js
brain.integrateWorldState({
  interaction: { label: 'diesel', x: 0.8, y: 0.2, valence: 0.7 },
});

console.log(brain.getNeeds().fuel);  // restored
```

When fuel falls below its threshold the brain feels it, and when it falls
below the critical threshold it is an emergency. The most pressing drive
pulls the motor system toward wherever the satisfying thing was last seen.

---

## Give a language model the brain's state

The core integration. `brain.context()` returns a compact text block built to
sit in a prompt.

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.05 });

async function respond(userText, llm) {
  brain.hear(userText);
  brain.hold(userText, userText.toLowerCase().split(/\s+/), 'input');
  brain.focus(userText, userText.toLowerCase().split(/\s+/), 'input');
  brain.tick(2);

  const context = brain.context();
  const reply = await llm({
    system: `You are a character with an inner life. Here is your state:\n\n${context}`,
    user: userText,
  });

  // Let the brain react to what was said back to it.
  const record = brain.predict({ intent: 'response', emotion: 'neutral' }, 0.5);
  brain.observe(record, reply);
  brain.recordTurn({ recalledSalience: 0.4 });

  return reply;
}
```

`context()` emits these lines:

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

Two optional lines appear when there is data: `GENOME LEDGER` (recent
homeostasis trials) and `METACOGNITION` (recent prediction accuracy).

---

## A chat character with memory

The key is that recall is biased by what the brain is currently thinking about,
so it remembers the relevant thing without you doing any retrieval work.

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.05 });
brain.start(10); // ticks at 10 Hz in the background

function chat(userText) {
  brain.hear(userText, { salience: 0.6 });
  brain.hold(userText, userText.toLowerCase().split(/\s+/), 'input');
  brain.focus(userText, userText.toLowerCase().split(/\s+/), 'input');

  const memories = brain.recall(['topic'], { topN: 5 });
  const concepts = brain.activeConcepts(5);
  const emotion = brain.emotionalState();

  return { memories, concepts, emotion };
}
```

Note `brain.hear()` already stores the utterance as an episodic memory, so
you do not need a separate `remember()` call for conversation.

---

## A game agent that acts on its own

The brain produces a motor intent. You decide what to do with it.

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.01 });

let body = { x: 0.5, y: 0.5, heading: 0, speed: 0 };
let food = { x: 0.3, y: 0.4 };

function step() {
  // Tell the brain what it perceives.
  brain.integrateWorldState({
    body,
    needs: brain.getNeeds(),
    detections: [{ label: 'food', w: 1 - Math.hypot(body.x - food.x, body.y - food.y) }],
  });

  // Read the brain's intent.
  const intent = brain.getMotorIntent();

  // Apply it (with a little steering so it does not get stuck).
  const dx = intent.dx * intent.strength + (food.x - body.x) * 0.12;
  const dy = intent.dy * intent.strength + (food.y - body.y) * 0.12;
  const mag = Math.hypot(dx, dy) || 1;

  brain.move(dx / mag, dy / mag, 0.7);
  body = brain.getBody();

  if (Math.hypot(body.x - food.x, body.y - food.y) < 0.05) {
    brain.handleInteraction('feed', 1.0);
    food = { x: Math.random(), y: Math.random() };
  }

  brain.tick(1);
}
```

`handleInteraction('feed')` raises hunger satisfaction and rewards the brain,
which is what makes the association between food and good outcomes form.

Recognised interaction kinds: `feed`, `rest`, `play`, `poke`, `danger`.

---

## An HTTP service over a brain

```js
const http = require('node:http');
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.01 });
brain.start(10);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};

  const send = (data) => {
    const payload = JSON.stringify(data);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  };

  if (req.url === '/state') return send(brain.state());
  if (req.url === '/context') return send({ context: brain.context() });

  if (req.url === '/perceive') {
    brain.hear(body.text || '');
    brain.tick(2);
    return send({ emotion: brain.emotionalState(), concepts: brain.activeConcepts(6) });
  }

  if (req.url === '/recall') {
    const memories = brain.recall(body.entities || [], { topN: 8 });
    return send({ memories });
  }

  send({ error: 'not found' });
});

server.listen(8787);
```

A fuller version is in `examples/http-server.js`, with routes for `/state`,
`/context`, `/perceive`, `/remember`, `/recall`, `/learn`, `/believe`,
`/step`, `/interact`, and `/save`.

---

## A character that learns words

```js
// Teach a word a sensory profile and how it feels.
brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4, arousal: 0.3 }, 'watch', 0.6);

// Link it to another word.
brain.associate('ember', 'fire', 0.4);

// Later, ask how it feels.
brain.emotionOf('ember');   // { valence, arousal, approach }
brain.activeConcepts(5);   // the most active concepts
brain.netEmotion();         // combined emotion of active concepts
```

The `learn()` arguments are: word, sensory features, emotion vector, action
label, and strength. `learn()` also grounds the word in the neural substrate,
so it is not only a table lookup.

---

## A character with opinions

Beliefs are separate from memories on purpose, so a generated sentence never
quietly becomes knowledge.

```js
// Record a claim.
brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.6 });

// Record the same claim from an observation, and mark it verified.
brain.believe({ topic: 'fire', claim: 'fire is warm', source: 'observation', verified: true });

// Ask what the brain thinks.
const verdict = brain.deliberate('fire');
// {
//   topic: 'fire',
//   evidenceCount: 2,
//   alternatives: [{ claim: 'fire is warm', sources: ['observation','internal'], confidence: 0.425, verified: true }],
//   concluded: true,
//   conclusion: { claim: 'fire is warm', verified: true, sources: ['observation','internal'] }
// }
```

A conclusion requires verified evidence, or agreement from two or more
independent sources. One unverified claim is not enough.

`brain.beliefsAbout('fire')` returns the raw belief list.

---

## Growing a brain over time
```js
const brain = new Brain({
  startNeurons: 20000,
  maxNeurons: 200000,
  growthBatch: 1000,
  growthInterval: 100, // ticks between automatic growth events
  growthProfile: {
    hippocampus: 4, // grow memory capacity faster
    association: 3,
    motor: 0.2, // barely grow the motor system
  },
});

brain.tick(100); // one growth event fires
brain.neuronCount; // 20020
```

Manual control:

```js
brain.grow(500);        // add up to 500 neurons
brain.growTo(50000);    // grow toward a total
brain.maybeGrow();      // one automatic step, if the cadence allows
brain.canGrow;          // false at the ceiling
brain.growthProgress;   // 0..1
```

Everything already learned survives growth — the brain is remapped, not
rebuilt.

---

## Persistent agents

```js
// Save.
const path = brain.save('./agent.neuropile');

// Load into a fresh brain.
const restored = new Brain({ startNeurons: 20000, maxNeurons: 200000 });
restored.load('./agent.neuropile');
restored.neuronCount; // the grown size, not the starting size
```

The snapshot includes the neural engine, needs, body, memory, concepts,
working memory, genome, metacognition, beliefs, and the homeostasis ledger.

Plain JSON instead of gzip:

```js
brain.save('./agent.json', { compress: false });
```

Async versions: `await brain.saveAsync(path)` and `await restored.loadAsync(path)`.

---

## Embedding in an existing app

Use the core directly if you want the substrate without the cognitive layers.

```js
const { BrainCore } = require('neuropile');

const core = new BrainCore({ neurons: 50000, seed: 42 });

core.integrateWorldState({ body: { x: 0.5, y: 0.4 }, needs: { hunger: 0.3 } });
core.tick(10);

core.emotionalState();
core.getMotorIntent(); // { dx, dy, strength }
core.readInternalState(); // Ω1..Ω5, Ω_da, Ω_ne
```

Use `createCore(options)` to get the same core the `Brain` wrapper would have
built, including the native/JS selection logic.

---

## Testing

Use a small brain and a fixed seed. The JS fallback is deterministic with a
seed.

```js
const { Brain } = require('neuropile');

const brain = new Brain({ neurons: 2000, seed: 42, native: false });

brain.remember('the fire is warm', { entities: ['fire'] });
brain.tick(5);

assert.equal(brain.memory.size, 1);
assert.ok(brain.recall(['fire']).length > 0);
```

Use `{ native: false }` when you want to test the JavaScript path
specifically. The test suite in this repo runs every behaviour against both
implementations and asserts they agree.

For fast tests, `neurons: 2000` is enough. For a realistic feel, `sizeGB:
0.01`.
