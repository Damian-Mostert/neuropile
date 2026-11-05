'use strict';

// Teaches a blank brain about a world, then shows what it learned.
//
// A new brain has no opinions. It does not think a wolf is frightening or
// that wool is soft, because those are facts about the world rather than
// facts about brains. This example supplies them, and then shows the two
// things that make the result worth having:
//
//   1. Affect generalises through features. Teach the brain that "hot and
//      burning" hurts, and it will fear a word it has never been told
//      about, as long as that word shares the features.
//
//   2. Relatedness is learned from co-occurrence. Two things seen together
//      repeatedly become associated, with nothing declaring that they are.
//
//   node examples/teaching.js

const { Brain } = require('..');

const brain = new Brain({ sizeGB: 0.02, seed: 42 });

console.log('neuropile - teaching a brain about a world\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. A blank brain.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- a brain that has experienced nothing ---');
console.log('  concepts:            ', brain.state().conceptSize);
console.log('  emotionOf("wolf"):   ', JSON.stringify(brain.emotionOf('wolf')));
console.log('  emotionOf("danger"): ', JSON.stringify(brain.emotionOf('danger')));
console.log('  emotionOf("safe"):   ', JSON.stringify(brain.emotionOf('safe')));
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 2. The world says what things are worth, and what they feel like.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- the world supplies the facts ---');

brain.ground('wolf', {
  features: { grey: 0.3, wild: 0.9, quadruped: 0.7, howls: 1.0 },
  valence: -0.9, arousal: 0.8, approach: -1.0, strength: 0.9,
});

brain.ground('lamb', {
  features: { white: 0.3, tame: 0.9, quadruped: 0.7, bleats: 1.0 },
  valence: 0.7, arousal: 0.2, approach: 0.8, strength: 0.9,
});

brain.ground('ember', {
  features: { hot: 1.0, burning: 0.9, orange: 0.2 },
  valence: -0.9, arousal: 0.8, approach: -1.0, strength: 0.9,
});

for (const label of ['wolf', 'lamb', 'ember']) {
  const e = brain.emotionOf(label);
  console.log(`  ${label.padEnd(6)} valence=${e.valence.toFixed(3)} arousal=${e.arousal.toFixed(3)} approach=${e.approach.toFixed(3)}`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 3. Affect generalises to labels the brain has never seen.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- the brain generalises to things it was never told about ---');

// The brain has never heard of these. They share features with what it
// knows, so it inherits the opinions.
brain.ground('jackal', { features: { grey: 0.3, wild: 0.9, quadruped: 0.7 }, strength: 0.9 });
brain.ground('flame', { features: { hot: 1.0, burning: 0.9, orange: 0.2 }, strength: 0.9 });
// The pebble shares only "grey", which the world marked as a weak feature,
// so the wolf's fear barely reaches it.
brain.ground('pebble', { features: { grey: 0.3, hard: 0.8, round: 0.5 }, strength: 0.9 });

for (const label of ['jackal', 'flame', 'pebble']) {
  const e = brain.emotionOf(label);
  const verdict = e.valence < -0.2 ? 'feared' : e.valence > 0.2 ? 'liked' : 'neutral';
  console.log(`  ${label.padEnd(8)} valence=${e.valence.toFixed(3)}  -> ${verdict}`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 4. Relatedness is learned from co-occurrence.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- things seen together become related ---');

for (let i = 0; i < 12; i++) {
  brain.ground('wolf', { features: { grey: 0.3, wild: 0.9 } });
  brain.ground('sheep', { features: { white: 0.3, tame: 0.9 } });
  brain.coOccur(['wolf', 'sheep'], { strength: 0.8 });
}

console.log('  relatedness(wolf, sheep):', brain.relatedness('wolf', 'sheep').toFixed(3));
console.log('  relatedness(wolf, pebble):', brain.relatedness('wolf', 'pebble').toFixed(3));
console.log('  nearest("wolf"):          ', JSON.stringify(brain.nearest('wolf', 3)));
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 5. The environment can also say what it is perceiving.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- the environment speaks during perception ---');

for (let step = 0; step < 6; step++) {
  const wolfNear = step % 3 === 0;
  brain.integrateWorldState({
    detections: [
      wolfNear
        ? { label: 'wolf', w: 0.9, valence: -0.9, arousal: 0.8, approach: -1.0 }
        : { label: 'sheep', w: 0.6, valence: 0.7, arousal: 0.2, approach: 0.8 },
    ],
  });
  brain.tick(2);
  const s = brain.emotionalState();
  console.log(`  step ${step}  valence=${s.valence.toFixed(3)}  arousal=${s.arousal.toFixed(3)}`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 6. The substrate learns from experience alone.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- the substrate changes as the brain experiences things ---');

const before = Float32Array.from(brain.engine.synapseWeights);
for (let i = 0; i < 10; i++) {
  brain.hear('the fire is warm and bright', { salience: 0.9 });
  brain.tick(2);
}
// Hoist the array out of the loop. Reading brain.engine.synapseWeights
// crosses the native boundary on every access, so indexing it per
// element is ruinously slow.
const after = Float32Array.from(brain.engine.synapseWeights);
let changed = 0;
for (let i = 0; i < before.length; i++) {
  if (before[i] !== after[i]) changed++;
}
console.log(`  synapses changed by 10 hearings, with no reward: ${changed}`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 7. Everything survives a save and load.
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- the knowledge persists ---');

const snapshot = brain.snapshot();
const restored = new Brain({ sizeGB: 0.02, seed: 42 });
restored.restore(snapshot);

const original = brain.emotionOf('flame');
const loaded = restored.emotionOf('flame');
console.log('  before save:', JSON.stringify(original));
console.log('  after load: ', JSON.stringify(loaded));
console.log('  relatedness(wolf, sheep) after load:', restored.relatedness('wolf', 'sheep').toFixed(3));
