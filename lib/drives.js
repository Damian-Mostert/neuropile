'use strict';

// Drives - the homeostatic system.
//
// A brain does not come with a fixed list of needs. A body made of flesh
// gets hungry and tired; a rover running on batteries gets low on charge and
// overheats; a plant gets thirsty. Which drives exist, what they decay at,
// how bad they get when neglected, and what satisfies them are all facts
// about the body, not facts about brains.
//
// So the drive schema is declared by whoever builds the body. The brain
// carries the machinery: it decays each drive over time, converts a
// neglected drive into distress and pain signals, and drives the motor
// system toward whatever would satisfy the most pressing one.
//
// Each drive can declare:
//
//   value       current satisfaction, 0..1
//   decay       how much it falls per tick
//   threshold   below this it starts to hurt
//   critical    below this it is an emergency
//   pain        how loudly the neglect is felt
//   signal      how much it drives the hypothalamus
//   satisfiedBy what counts as satisfying it
//
// Nothing here is seeded. A brain with no drives declared has no drives,
// and `setNeeds({ hunger: 0.2 })` on such a brain does nothing, because
// there is no hunger drive to set.

const DEFAULT_DECAY = 0.002;
const DEFAULT_THRESHOLD = 0.4;
const DEFAULT_CRITICAL = 0.15;
const DEFAULT_PAIN = 4.0;
const DEFAULT_SIGNAL = 1.0;

// A drive is satisfied by something that happens. Satisfaction rules are
// keyed by whatever the environment calls the thing, so a world can use
// any vocabulary it likes.
class Drives {
  constructor(schema = null) {
    // name -> definition
    this._defs = new Map();
    // name -> current value
    this._values = new Map();
    // name -> { x, y } of the last thing that satisfied it
    this._sources = new Map();
    this._tickCount = 0;
    if (schema) this.define(schema);
  }

  // Declare the drives this body has. Accepts:
  //   ['hunger', 'energy']
  //   { hunger: { decay: 0.002, threshold: 0.4 }, energy: {} }
  define(schema) {
    if (!schema) return this;
    if (Array.isArray(schema)) {
      for (const name of schema) this._defineOne(name, {});
      return this;
    }
    if (typeof schema === 'object') {
      for (const [name, def] of Object.entries(schema)) {
        this._defineOne(name, def && typeof def === 'object' ? def : {});
      }
    }
    return this;
  }

  _defineOne(name, def) {
    const key = String(name);
    if (!key) return;
    this._defs.set(key, {
      name: key,
      decay: num(def.decay, DEFAULT_DECAY),
      threshold: num(def.threshold, DEFAULT_THRESHOLD),
      critical: num(def.critical, DEFAULT_CRITICAL),
      pain: num(def.pain, DEFAULT_PAIN),
      signal: num(def.signal, DEFAULT_SIGNAL),
      // What satisfies this drive. Either a list of names or a function
      // that decides whether a given event satisfies it.
      satisfiedBy: def.satisfiedBy || null,
      // How much satisfaction an event delivers.
      restore: num(def.restore, 0.28),
      // What movement costs this drive. A drive that declares an effort
      // cost is drained by moving.
      effort: num(def.effort, 0),
    });
    if (!this._values.has(key)) {
      this._values.set(key, num(def.start, 0.5));
    }
  }

  get names() {
    return [...this._defs.keys()];
  }

  get size() {
    return this._defs.size;
  }

  has(name) {
    return this._defs.has(String(name));
  }

  definition(name) {
    return this._defs.get(String(name)) || null;
  }

  get(name) {
    const v = this._values.get(String(name));
    return v === undefined ? null : v;
  }

  values() {
    const out = {};
    for (const [k, v] of this._values) out[k] = v;
    return out;
  }

  // Set one or more drives. Unknown names are ignored rather than
  // silently creating a drive the body does not have.
  set(values = {}) {
    for (const [name, value] of Object.entries(values)) {
      const key = String(name);
      if (!this._defs.has(key)) continue;
      this._values.set(key, clamp01(num(value, this._values.get(key))));
    }
    return this.values();
  }

  // Restore a drive toward satisfaction.
  // Restore a drive toward satisfaction.
  //
  // Named `satisfy` rather than `restore` because `restore` is already
  // taken by the snapshot restore. The collision meant the two silently
  // overwrote each other.
  satisfy(name, amount) {
    const key = String(name);
    if (!this._defs.has(key)) return null;
    const current = this._values.get(key) || 0;
    const next = clamp01(current + amount);
    this._values.set(key, next);
    return next;
  }

  // Record where a satisfying thing was, so the brain can seek it.
  noteSource(name, x, y) {
    const key = String(name);
    if (!this._defs.has(key)) return;
    if (x == null || y == null) {
      this._sources.delete(key);
      return;
    }
    this._sources.set(key, { x, y });
  }

  source(name) {
    return this._sources.get(String(name)) || null;
  }

  // The most pressing drive: the one furthest below its threshold.
  // Returns null when nothing is declared or nothing is neglected.
  mostPressing() {
    let worst = null;
    let worstGap = 0;
    for (const [name, def] of this._defs) {
      const value = this._values.get(name) ?? 1;
      const gap = def.threshold - value;
      if (gap > worstGap) {
        worstGap = gap;
        worst = { name, value, def, gap };
      }
    }
    return worst;
  }

  // Average satisfaction across all drives, used for overall arousal.
  average() {
    if (this._defs.size === 0) return 1;
    let sum = 0;
    for (const name of this._defs.keys()) sum += this._values.get(name) ?? 1;
    return sum / this._defs.size;
  }

  // Drives currently below their threshold, worst first.
  neglected() {
    const out = [];
    for (const [name, def] of this._defs) {
      const value = this._values.get(name) ?? 1;
      if (value < def.threshold) {
        out.push({
          name,
          value,
          def,
          gap: def.threshold - value,
          critical: value < def.critical,
        });
      }
    }
    out.sort((a, b) => b.gap - a.gap);
    return out;
  }

  // Does this event satisfy the given drive? The rule comes from the
  // schema, so the world decides what counts.
  satisfies(driveName, event) {
    const def = this._defs.get(String(driveName));
    if (!def || !def.satisfiedBy) return false;
    const label = String(event?.label ?? event ?? '').toLowerCase();
    if (!label) return false;

    if (typeof def.satisfiedBy === 'function') {
      try {
        return !!def.satisfiedBy(label, event);
      } catch {
        return false;
      }
    }
    const list = Array.isArray(def.satisfiedBy) ? def.satisfiedBy : [def.satisfiedBy];
    return list.some(candidate => String(candidate).toLowerCase() === label);
  }

  // Apply an event to the drives it satisfies.
  apply(label, event = {}) {
    const applied = [];
    for (const name of this._defs.keys()) {
      const def = this._defs.get(name);
      if (!this.satisfies(name, { ...event, label })) continue;
      const amount = num(event.restore, def.restore);
      const restored = this.satisfy(name, amount * num(event.intensity, 1));
      if (event.x != null && event.y != null) this.noteSource(name, event.x, event.y);
      applied.push({ name, restored });
    }
    return applied;
  }

  tick() {
    this._tickCount++;
    for (const [name, def] of this._defs) {
      const current = this._values.get(name) ?? 0.5;
      this._values.set(name, clamp01(current - def.decay));
    }
  }

  snapshot() {
    return {
      version: 1,
      tickCount: this._tickCount,
      defs: [...this._defs.values()].map(d => ({
        ...d,
        // A function cannot be serialised. Rules are stored by name and
        // reattached on restore by the caller if it cares.
        satisfiedBy: typeof d.satisfiedBy === 'function' ? null : d.satisfiedBy,
      })),
      values: [...this._values.entries()],
      sources: [...this._sources.entries()],
    };
  }

  restore(snapshot) {
    if (!snapshot) return this;
    this._defs = new Map();
    for (const d of snapshot.defs || []) {
      this._defs.set(d.name, { ...d });
    }
    this._values = new Map(snapshot.values || []);
    this._sources = new Map(snapshot.sources || []);
    this._tickCount = snapshot.tickCount || 0;
    return this;
  }
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

module.exports = { Drives };
