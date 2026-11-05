'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MemoryCortex,
  ConceptNet,
  WorkingMemory,
  Genome,
  Metacognition,
  Homeostasis,
  BeliefStore,
  soundPattern,
} = require('..');

test('MemoryCortex encodes, deduplicates, recalls, and formats', () => {
  const memory = new MemoryCortex();
  const a = memory.encode('the sky is blue', ['sky'], 'neutral', 0.6, 0, 'semantic');
  const b = memory.encode('the sky is blue', ['sky'], 'neutral', 0.6, 0, 'semantic');
  assert.equal(a, b);
  assert.equal(memory.size, 1);

  memory.encode('a loud thunder clap scared me', ['thunder'], 'fear', 0.8, 0.5, 'episodic', 3);
  const recalled = memory.recall(['thunder'], 'fear', 5, 'conversation');
  assert.ok(recalled.some(n => n.type === 'episodic'));

  const text = memory.format(recalled);
  assert.match(text, /episodic turn:3/);

  const fact = memory.recallFact('sky');
  assert.ok(fact.length >= 1);

  memory.decay();
  assert.ok(memory.size >= 1);
});

test('MemoryCortex decay multipliers differ by type', () => {
  const { decayMult } = require('../lib/memory');
  assert.ok(decayMult('episodic') > decayMult('semantic'));
  assert.ok(decayMult('semantic') > decayMult('procedural'));
  assert.equal(decayMult('utterance'), decayMult('procedural'));
});

test('ConceptNet starts blank and learns from experience', () => {
  const net = new ConceptNet();

  // A brain that has experienced nothing has no opinions, not even about
  // "danger" or "safe". Those are facts about the world, supplied by it.
  assert.equal(net.size, 0);
  assert.equal(net.emotionOf('danger'), null);
  assert.equal(net.emotionOf('safe'), null);

  // An unknown word cannot be activated: the brain has no concept for it.
  assert.equal(net.activate('food', 1.0), null);

  // Once the brain has met the word, it can be recalled and activated.
  net.learn('food', { edible: 0.8 }, { valence: 0.5, arousal: 0.3 }, 'eat', 0.8);
  assert.equal(net.size, 1);
  net.activate('food', 1.0);
  const active = net.activeConceptsSnapshot(3);
  assert.ok(active.some(c => c.label === 'food'));

  const before = net.emotionOf('ember')?.valence ?? 0;
  for (let i = 0; i < 5; i++) {
    net.learn('ember', { bright: 0.9 }, { valence: 0.8, arousal: 0.4, approach: 0.6 }, 'watch', 1.0);
  }
  assert.ok(net.emotionOf('ember').valence > before);

  net.associate('ember', 'fire', 0.4);
  const emotion = net.netEmotion();
  assert.equal(typeof emotion.valence, 'number');
  assert.ok(net.formatForLLM() !== null);
});

test('WorkingMemory holds, rehearses, focuses, and evicts', () => {
  const wm = new WorkingMemory();
  wm.hold('first thought', ['one'], 'thought');
  wm.hold('user said something', ['user'], 'input');
  assert.equal(wm.size, 2);

  wm.rehearse(['one']);
  assert.ok(wm.read().some(s => s.content === 'first thought'));

  const focus = wm.setFocus('fire', ['warm', 'light']);
  assert.equal(focus.topic, 'fire');
  assert.ok(wm.getFocus());

  for (let i = 0; i < 10; i++) wm.hold(`item ${i}`, [`tag${i}`], 'thought', 0.5);
  assert.ok(wm.size <= 7);

  wm.flush();
  assert.equal(wm.size, 0);
  assert.equal(wm.getFocus(), null);
});

test('Genome clamps values and snapshots', () => {
  const genome = new Genome();
  assert.ok(genome.keys().length > 0);
  assert.equal(genome.set('emotion_cue', 99), true);
  assert.equal(genome.get('emotion_cue'), 1.0);
  genome.set('emotion_cue', -5);
  assert.equal(genome.get('emotion_cue'), 0.1);

  const snap = genome.snapshot();
  genome.set('emotion_cue', 0.5);
  genome.restore(snap);
  assert.equal(genome.get('emotion_cue'), 0.1);

  assert.equal(genome.set('nope', 1), false);
  assert.equal(genome.get('nope'), null);
});

test('Metacognition predicts, scores, and adapts', () => {
  const genome = new Genome();
  const meta = new Metacognition(genome);

  const record = meta.predict(
    { valence: 0.1, arousal: 0.6, drive: 0.5, norepinephrine: 0.2 },
    { intent: 'question', emotion: 'happy' },
    0.6,
  );
  assert.equal(record.prediction.response_type, 'answer');
  assert.ok(record.prediction.confidence >= 0 && record.prediction.confidence <= 1);

  const delta = meta.observe(
    record,
    { valence: 0.2, arousal: 0.7, norepinephrine: 0.3 },
    'because it is warm?',
  );
  assert.equal(typeof delta, 'number');
  assert.ok(record.accuracy >= 0 && record.accuracy <= 1);
  assert.ok(meta.recentAccuracy() !== null);
  assert.ok(meta.summary());
});

test('Homeostasis records turns and proposes a mutation', () => {
  const genome = new Genome();
  const meta = new Metacognition(genome);
  const memory = new MemoryCortex(genome);
  const homeo = new Homeostasis(genome, meta, memory);

  for (let i = 0; i < 20; i++) {
    homeo.recordTurn({ interrupted: true, recalledSalience: 0.1, goalPushed: true, goalResolved: false });
  }

  const log = homeo.evaluate();
  assert.ok(log === null || /trial started/.test(log));
  if (log) {
    assert.ok(homeo.ledger.length >= 1);
    for (let i = 0; i < 10; i++) homeo.recordTurn({ recalledSalience: 0.2 });
    const scored = homeo.evaluate();
    assert.ok(scored === null || /trial (accepted|reverted)/.test(scored));
  }
});

test('BeliefStore records provenance and deliberates', () => {
  const store = new BeliefStore();
  const a = store.record({ topic: 'water', claim: 'water is wet', source: 'observation', confidence: 0.7 });
  const b = store.record({ topic: 'water', claim: 'water is wet', source: 'memory', confidence: 0.6 });
  assert.ok(a && b);
  assert.equal(store.items.length, 2);
  assert.equal(store.best('water').topic, 'water');

  const result = store.deliberate('water');
  assert.ok(result.evidenceCount >= 2);
  assert.ok(result.alternatives.length >= 1);

  const snap = store.snapshot();
  store.restore({ items: [], nextId: 0 });
  assert.equal(store.items.length, 0);
  store.restore(snap);
  assert.equal(store.items.length, 2);
});

test('soundPattern is deterministic and produces a sparse distributed code', () => {
  const a = soundPattern('fire', 400000);
  const b = soundPattern('fire', 400000);
  assert.deepEqual([...a], [...b]);
  assert.ok(a.length > 0);
  assert.ok(a.length <= 200);
  assert.ok(a.every(i => i >= 0 && i < 400000));

  // Sparse: every index is distinct.
  assert.equal(new Set(a).size, a.length);
});

test('soundPattern gives related words overlapping codes and unrelated words none', () => {
  const { patternOverlap, containment } = require('../lib/patterns');

  // Composition: a phrase contains the code of its words.
  assert.ok(containment(soundPattern('the cat sat'), soundPattern('cat')) > 0.5);
  assert.ok(containment(soundPattern('dog bites'), soundPattern('dog')) > 0.5);

  // Unrelated words share almost nothing.
  assert.ok(patternOverlap(soundPattern('zebra'), soundPattern('quartz')) < 0.3);

  // Identity is preserved.
  assert.equal(patternOverlap(soundPattern('fire'), soundPattern('fire')), 1);
});

test('grounding generalises affect to labels the brain has never seen', () => {
  const { Grounding } = require('../lib/grounding');
  const g = new Grounding();

  // A blank brain knows nothing.
  assert.equal(g.size, 0);
  assert.equal(g.affectOf('ember'), null);

  // The world says the ember is painful and hot.
  g.observe('ember', {
    features: ['hot', 'burning', 'orange'],
    valence: -0.9,
    arousal: 0.8,
    approach: -1.0,
    strength: 0.9,
  });

  // "flame" is new, but it shares the features, so it inherits the fear.
  g.observe('flame', { features: ['hot', 'burning', 'orange'], strength: 0.9 });
  const flame = g.affectOf('flame');
  assert.ok(flame.valence < -0.2, `expected flame to inherit negative valence, got ${flame.valence}`);

  // Something unrelated does not inherit it.
  g.observe('banana', { features: ['yellow', 'fruit'], strength: 0.9 });
  const banana = g.affectOf('banana');
  assert.ok(Math.abs(banana.valence) < 0.15, `expected banana to stay neutral, got ${banana.valence}`);
});

test('grounding learns relatedness from co-occurrence', () => {
  const { Grounding } = require('../lib/grounding');
  const g = new Grounding();

  for (let i = 0; i < 12; i++) {
    g.observe('kitten', { features: ['furry', 'young'] });
    g.observe('cat', { features: ['furry', 'adult'] });
    g.coOccur(['kitten', 'cat'], { strength: 0.8 });
  }

  assert.ok(g.relatedness('cat', 'kitten') > 0.5);
  assert.ok(g.relatedness('cat', 'rock') < 0.1);
  assert.equal(g.nearest('cat')[0].label, 'kitten');
});
