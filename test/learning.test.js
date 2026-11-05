'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('..');
const { Brain } = pkg;

// Every core implementation that can be exercised in this environment.
function coreFactories() {
  const factories = [{ name: 'js', create: (options) => new pkg.BrainCore(options) }];
  if (pkg.nativeAvailable) {
    factories.push({
      name: 'native',
      create: (options) => new pkg.nativeModule.BrainCore(options),
    });
  }
  return factories;
}

// ─────────────────────────────────────────────────────────────────────────────
// A blank brain has no opinions.
// ─────────────────────────────────────────────────────────────────────────────

test('a new brain has no concepts and no affect', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  assert.equal(brain.state().conceptSize, 0);
  assert.equal(brain.state().groundingSize, 0);

  // Not even about things that sound like they ought to be known.
  assert.equal(brain.emotionOf('danger'), null);
  assert.equal(brain.emotionOf('safe'), null);
  assert.equal(brain.emotionOf('food'), null);
  assert.equal(brain.emotionOf('happy'), null);
});

test('the brain has no hardcoded rewards for particular labels', () => {
  // These labels used to trigger a built-in reward in both cores. They must
  // now be inert: nothing is good unless the world says so.
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  const before = brain.emotionalState().valence;
  brain.integrateWorldState({
    detections: [{ label: 'violet-glow', w: 0.9 }],
  });
  brain.tick(2);

  const after = brain.emotionalState().valence;
  assert.ok(
    Math.abs(after - before) < 0.2,
    `violet-glow should not be worth anything on its own (${before} -> ${after})`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The world supplies the facts, and affect generalises through features.
// ─────────────────────────────────────────────────────────────────────────────

test('affect declared by the environment reaches the brain', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  brain.integrateWorldState({
    detections: [{ label: 'wolf', w: 0.9, valence: -0.9, arousal: 0.8, approach: -1.0 }],
  });
  brain.tick(3);

  const state = brain.emotionalState();
  assert.ok(state.valence < 0, `expected negative valence, got ${state.valence}`);
  assert.ok(state.arousal > 0.1, `expected raised arousal, got ${state.arousal}`);
});

test('an interaction can carry affect without using any known vocabulary', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  const before = brain.emotionalState().valence;
  brain.integrateWorldState({
    interaction: { note: 'a bespoke user-defined event', valence: -0.8, arousal: 0.6 },
  });
  brain.tick(2);

  const after = brain.emotionalState().valence;
  assert.ok(after < before, `expected valence to fall (${before} -> ${after})`);
});

test('the brain generalises affect to a label it has never seen', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  brain.ground('ember', {
    features: ['hot', 'burning', 'orange'],
    valence: -0.9, arousal: 0.8, approach: -1.0, strength: 0.9,
  });

  // "flame" is new, but shares the features, so it inherits the fear.
  brain.ground('flame', { features: ['hot', 'burning', 'orange'], strength: 0.9 });
  const flame = brain.emotionOf('flame');
  assert.ok(flame.valence < -0.2, `expected flame to inherit negative valence, got ${flame.valence}`);

  // Something unrelated must not inherit anything.
  brain.ground('pebble', { features: ['grey', 'hard'], strength: 0.9 });
  const pebble = brain.emotionOf('pebble');
  assert.ok(Math.abs(pebble.valence) < 0.15, `expected pebble to stay neutral, got ${pebble.valence}`);
});

test('the brain learns relatedness from co-occurrence', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  for (let i = 0; i < 10; i++) {
    brain.ground('kitten', { features: ['furry', 'young'] });
    brain.ground('cat', { features: ['furry', 'adult'] });
    brain.coOccur(['kitten', 'cat'], { strength: 0.8 });
  }

  assert.ok(brain.relatedness('cat', 'kitten') > 0.5);
  assert.ok(brain.relatedness('cat', 'stone') < 0.1);
});

test('feature weights decide how much affect a shared feature carries', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });

  // The wolf is frightening. "grey" is a weak feature of it.
  brain.ground('wolf', {
    features: { grey: 0.2, wild: 1.0 },
    valence: -0.9, arousal: 0.8, approach: -1.0,
    strength: 0.9,
  });

  // A pebble shares only the weak feature.
  brain.ground('pebble', { features: { grey: 0.2, hard: 0.9 }, strength: 0.9 });
  const pebble = brain.emotionOf('pebble');
  assert.ok(
    Math.abs(pebble.valence) < 0.25,
    `expected a weak shared feature to carry little affect, got ${pebble.valence}`,
  );

  // Something sharing the strong feature inherits the fear.
  brain.ground('jackal', { features: { grey: 0.2, wild: 1.0 }, strength: 0.9 });
  const jackal = brain.emotionOf('jackal');
  assert.ok(
    jackal.valence < -0.3,
    `expected a strong shared feature to carry the fear, got ${jackal.valence}`,
  );
});

test('grounded knowledge survives a save and load', () => {
  const brain = new Brain({ neurons: 5000, seed: 1, native: false });
  brain.ground('ember', {
    features: ['hot', 'burning'],
    valence: -0.9, arousal: 0.8, approach: -1.0, strength: 0.9,
  });
  brain.ground('flame', { features: ['hot', 'burning'], strength: 0.9 });

  const expected = brain.emotionOf('flame');

  const restored = new Brain({ neurons: 5000, seed: 1, native: false });
  restored.restore(brain.snapshot());

  const actual = restored.emotionOf('flame');
  assert.ok(actual !== null);
  assert.ok(
    Math.abs(actual.valence - expected.valence) < 0.01,
    `expected ${expected.valence}, got ${actual.valence}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The substrate learns from experience, not only from being scored.
// ─────────────────────────────────────────────────────────────────────────────

for (const { name, create } of coreFactories()) {
  test(`${name}: the substrate learns from co-activation without any reward`, () => {
    const untrained = create({ neurons: 20000, seed: 42 });
    const experienced = create({ neurons: 20000, seed: 42 });

    // A sensory pattern of the size a real encoder would produce. A handful
    // of indices is not enough to drive the network, because a handful of
    // neurons cannot co-activate with anything.
    const pattern = new Uint32Array(200);
    for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 7 + 3) % 400000;

    // No reward, no punishment. Just the same input, repeatedly.
    for (let i = 0; i < 30; i++) {
      experienced.perceive(pattern);
      experienced.tick(2);
    }
    untrained.tick(60);

    let changed = 0;
    const a = untrained.engine.synapseWeights;
    const b = experienced.engine.synapseWeights;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) changed++;
    }

    assert.ok(
      changed > 500,
      `expected synapses to change from experience alone, got ${changed} changes`,
    );
  });

  test(`${name}: activity spreads across regions when the input is rich enough`, () => {
    const core = create({ neurons: 20000, seed: 42 });

    const pattern = new Uint32Array(200);
    for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 7 + 3) % 400000;

    for (let i = 0; i < 10; i++) {
      core.perceive(pattern);
      core.tick(2);
    }

    const regions = core.regions;
    const firedIn = new Set();
    for (let i = 0; i < core.engine.firedTick.length; i++) {
      if (core.engine.firedTick[i] < 0) continue;
      for (const r of regions) {
        if (i >= r.start && i < r.end) { firedIn.add(r.name); break; }
      }
    }

    assert.ok(
      firedIn.size >= 8,
      `expected activity in many regions, got ${firedIn.size}: ${[...firedIn].join(', ')}`,
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The representation has structure, so similarity is possible at all.
// ─────────────────────────────────────────────────────────────────────────────

test('a phrase contains the code of its words', () => {
  const { soundPattern, containment } = require('../lib/patterns');

  // Containment, not Jaccard: a phrase has a longer code than its words,
  // so it contains them rather than being equal to them.
  assert.ok(containment(soundPattern('the cat sat'), soundPattern('cat')) > 0.5);
  assert.ok(containment(soundPattern('dog bites'), soundPattern('dog')) > 0.5);
});

test('unrelated words share almost nothing', () => {
  const { soundPattern, patternOverlap } = pkg;

  assert.ok(patternOverlap(soundPattern('zebra'), soundPattern('quartz')) < 0.3);
  assert.ok(patternOverlap(soundPattern('cat'), soundPattern('dog')) < 0.3);
});
