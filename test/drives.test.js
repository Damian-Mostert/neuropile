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
// Drives belong to the body, not to the brain.
// ─────────────────────────────────────────────────────────────────────────────

for (const { name, create } of coreFactories()) {
  test(`${name}: a brain with no declared drives has no needs`, () => {
    const core = create({ neurons: 4000, seed: 1 });

    assert.deepEqual(core.getNeeds(), {});

    // Setting a drive the body does not have does nothing.
    core.setNeeds({ hunger: 0.2, energy: 0.1 });
    assert.deepEqual(core.getNeeds(), {});
  });

  test(`${name}: a body declares its own drives`, () => {
    const core = create({
      neurons: 4000,
      seed: 1,
      drives: {
        fuel: { decay: 0.01, threshold: 0.3, critical: 0.1, satisfiedBy: ['diesel'] },
        coolant: { decay: 0.005, threshold: 0.4 },
      },
    });

    assert.deepEqual(core.getNeeds(), { fuel: 0.5, coolant: 0.5 });

    // A declared drive can be set. The native core stores floats, so
    // compare approximately.
    core.setNeeds({ fuel: 0.1 });
    assert.ok(Math.abs(core.getNeeds().fuel - 0.1) < 1e-6);

    // An undeclared drive is ignored.
    core.setNeeds({ hunger: 0.1 });
    assert.equal(core.getNeeds().hunger, undefined);
    assert.ok(Math.abs(core.getNeeds().fuel - 0.1) < 1e-6);
  });

  test(`${name}: drives decay on the simulation clock`, () => {
    const core = create({
      neurons: 4000,
      seed: 1,
      drives: { fuel: { decay: 0.01 } },
    });

    core.setNeeds({ fuel: 0.5 });
    for (let i = 0; i < 10; i++) core.tick(1);

    assert.ok(
      core.getNeeds().fuel < 0.5,
      `expected the drive to decay, got ${core.getNeeds().fuel}`,
    );
  });

  test(`${name}: the world's own vocabulary satisfies a drive`, () => {
    const core = create({
      neurons: 4000,
      seed: 1,
      drives: { fuel: { satisfiedBy: ['diesel', 'charging-station'] } },
    });

    core.setNeeds({ fuel: 0.2 });
    core.integrateWorldState({
      interaction: { note: 'diesel', x: 0.5, y: 0.5, valence: 0.6 },
    });

    assert.ok(
      core.getNeeds().fuel > 0.2,
      `expected diesel to satisfy the fuel drive, got ${core.getNeeds().fuel}`,
    );
  });

  test(`${name}: movement costs whatever the body says it costs`, () => {
    const core = create({
      neurons: 4000,
      seed: 1,
      drives: { fuel: { effort: 0.05 } },
    });

    core.setNeeds({ fuel: 0.8 });
    core.move(1, 0, 1);

    assert.ok(
      core.getNeeds().fuel < 0.8,
      `expected movement to cost fuel, got ${core.getNeeds().fuel}`,
    );
  });

  test(`${name}: a drive below its threshold hurts`, () => {
    const core = create({
      neurons: 4000,
      seed: 1,
      drives: { fuel: { threshold: 0.4, critical: 0.2, pain: 4.0 } },
    });

    core.setNeeds({ fuel: 0.0 });
    const emotion = core.emotionalState();

    // A neglected drive raises arousal and drive.
    assert.ok(emotion.arousal > 0.1, `expected raised arousal, got ${emotion.arousal}`);
    assert.ok(emotion.drive > 0, `expected raised drive, got ${emotion.drive}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The brain wrapper exposes the same thing.
// ─────────────────────────────────────────────────────────────────────────────

test('drives can be declared at runtime', () => {
  const brain = new Brain({ neurons: 4000, seed: 1, native: false });

  assert.deepEqual(brain.getNeeds(), {});

  const names = brain.defineDrives({
    fuel: { threshold: 0.3, satisfiedBy: ['diesel'] },
  });

  assert.deepEqual(names, ['fuel']);
  assert.deepEqual(brain.getNeeds(), { fuel: 0.5 });
});

test('a brain declared with drives reports them', () => {
  const brain = new Brain({
    neurons: 4000,
    seed: 1,
    native: false,
    drives: {
      fuel: { decay: 0.01, threshold: 0.3, satisfiedBy: ['diesel'] },
      coolant: { decay: 0.005 },
    },
  });

  assert.deepEqual(Object.keys(brain.getNeeds()).sort(), ['coolant', 'fuel']);
});
