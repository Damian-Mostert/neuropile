'use strict';

// Grounding layer - the bridge between the world a user builds and the
// concepts the brain forms about it.
//
// The problem this solves: a lexical code can tell you that "the cat sat"
// contains "cat", but it can never tell you that "kitten" and "cat" are
// related, because that is world knowledge, not string similarity. A brain
// that has met both a kitten and a cat in the same situation knows they are
// related. A brain that has met neither knows nothing.
//
// So this layer learns relations from co-occurrence in context, and it does
// so at the level of *features* rather than words. That is the important
// part: learning "furry things are pleasant" must apply to a kitten the
// brain has never seen the word for.
//
// Three things live here:
//
//   Grounding   - a detected thing in the world is bound to a concept, so
//                 the label stops being a string and becomes a referent.
//
//   Relations   - concepts that co-occur in the same context acquire
//                 associative links, so similarity is learned rather than
//                 declared.
//
//   Affect      - the world supplies valence/arousal/approach for a thing,
//                 and that affect attaches to the concept (and to its
//                 features) so it generalises to similar things.
//
// Nothing here is seeded. A brain that has never been told anything has no
// concepts, no relations, and no affect. Everything arrives through the
// environment.

const RELATION_DECAY = 0.995;
const MIN_RELATION = 0.02;
const MAX_RELATIONS = 24;
const FEATURE_AFFECT_MAX = 64;

// How fast a feature's affect moves toward the observed value. High,
// because a feature that has been seen once with a clear signal should
// already be usable as a guide.
const FEATURE_AFFECT_LR = 0.6;

// How strongly inherited feature affect counts against a concept's own
// learned affect. The concept's own experience still dominates, but a
// concept with no direct experience takes its colour from its features.
const FEATURE_AFFECT_WEIGHT = 1.6;

function normToken(t) {
  return String(t || '').toLowerCase().trim();
}

// Deterministic hash so a label always maps to the same concept id.
function hashLabel(label) {
  let h = 5381;
  const s = normToken(label);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h >>> 0;
}

class Grounding {
  constructor() {
    // label -> concept id
    this._byLabel = new Map();
    // concept id -> concept
    this._concepts = new Map();
    // concept id -> Map(otherId -> strength)
    this._relations = new Map();
    // feature name -> accumulated affect
    this._featureAffect = new Map();
    // feature name -> co-occurrence counts, used to infer relatedness
    this._featureContext = new Map();
    this._nextId = 0;
  }

  get size() {
    return this._concepts.size;
  }

  labels() {
    return [...this._byLabel.keys()];
  }

  _ensure(label) {
    const key = normToken(label);
    if (!key) return null;
    const existing = this._byLabel.get(key);
    if (existing !== undefined) return this._concepts.get(existing) || null;

    const id = this._nextId++;
    const concept = {
      id,
      label: key,
      // feature name -> weight. The weight says how much the feature
      // contributes to the concept's affect.
      features: new Map(),
      emotion: { valence: 0, arousal: 0, approach: 0 },
      encounters: 0,
      // How many times this concept was given affect directly, as opposed
      // to only being observed. This is what separates "the world told me
      // about this" from "I have seen this but never been told".
      directAffect: 0,
      lastSeen: 0,
    };
    this._concepts.set(id, concept);
    this._byLabel.set(key, id);
    this._relations.set(id, new Map());
    return concept;
  }

  get(label) {
    const id = this._byLabel.get(normToken(label));
    return id === undefined ? null : this._concepts.get(id) || null;
  }

  emotionOf(label) {
    const c = this.get(label);
    if (!c) return null;
    return { ...c.emotion };
  }

  // Bind a thing in the world to a concept, with optional features and
  // optional affect supplied by the environment. This is the entry point
  // that replaces hardcoded beliefs: nothing is known until it is declared
  // or learned here.
  //
  // Features may be given as an array of names, or as an object mapping a
  // name to a weight. The weight says how much that feature contributes to
  // the concept's affect, and it matters: "grey" is shared by a wolf and a
  // pebble, so it should carry less of the wolf's fear than "quadruped" or
  // "hot" does.
  observe(label, {
    features = null,
    valence = null,
    arousal = null,
    approach = null,
    strength = 0.5,
  } = {}) {
    const concept = this._ensure(label);
    if (!concept) return null;

    concept.encounters++;
    concept.lastSeen = Date.now();

    const featureList = [];
    if (Array.isArray(features)) {
      for (const f of features) if (f) featureList.push([normToken(f), 1]);
    } else if (features && typeof features === 'object') {
      for (const [k, v] of Object.entries(features)) {
        if (v) featureList.push([normToken(k), Number(v) || 0]);
      }
    }
    for (const [f, weight] of featureList) {
      const existing = concept.features.get(f);
      // Keep the strongest weight a feature was ever given.
      concept.features.set(f, existing === undefined ? weight : Math.max(existing, weight));
    }

    // Affect from the environment, applied to the concept itself.
    //
    // The rate is high because this is a declaration, not a sample. When
    // the world says a thing is painful, the brain should believe it
    // essentially immediately rather than averaging it in over a dozen
    // encounters. With a low rate a single observation moved the affect by
    // about seven percent of its target, which was too faint for the
    // opinion to mean anything.
    const lr = Math.max(0.1, Math.min(1, strength));
    if (valence != null) {
      concept.emotion.valence += lr * (valence - concept.emotion.valence);
      concept.directAffect++;
    }
    if (arousal != null) {
      concept.emotion.arousal += lr * (arousal - concept.emotion.arousal);
      concept.directAffect++;
    }
    if (approach != null) {
      concept.emotion.approach += lr * (approach - concept.emotion.approach);
      concept.directAffect++;
    }

    // The same affect is also recorded against the features. This is the
    // part that generalises: if "furry" is pleasant, then every later thing
    // with a "furry" feature inherits some of that, even if the brain has
    // never seen that word before.
    //
    // The feature average is kept as a running mean toward the *observed*
    // value rather than toward zero. Using zero as the target would mean
    // "hot, burning, orange" stays near neutral forever no matter how
    // painful the ember was, and then nothing inherits anything.
    //
    // A feature's own weight scales how fast it moves, so a feature the
    // world marked as weak stays a weak guide.
    for (const [f, weight] of featureList) {
      const cur = this._featureAffect.get(f) || { valence: 0, arousal: 0, approach: 0, n: 0 };
      const rate = FEATURE_AFFECT_LR * Math.max(0.05, Math.min(1, weight));
      if (valence != null) cur.valence += rate * (valence - cur.valence);
      if (arousal != null) cur.arousal += rate * (arousal - cur.arousal);
      if (approach != null) cur.approach += rate * (approach - cur.approach);
      cur.n++;
      this._featureAffect.set(f, cur);
    }

    return concept;
  }

  // Record that two things were perceived together. Repeated co-occurrence
  // creates an associative link between them, which is how the brain learns
  // that a kitten is like a cat: they keep showing up in the same context.
  coOccur(labels, { strength = 0.5 } = {}) {
    const ids = [];
    for (const label of labels) {
      const c = this._ensure(label);
      if (c) ids.push(c.id);
    }
    if (ids.length < 2) return;

    const amount = 0.12 * Math.max(0.1, Math.min(1, strength));
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const map = this._relations.get(ids[i]);
        if (!map) continue;
        const current = map.get(ids[j]) || 0;
        map.set(ids[j], current + amount);
      }
    }

    // Co-occurrence also links the features of the two things, which is how
    // "kitten" inherits the properties of "cat" without being told.
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const ca = this._concepts.get(a);
        const cb = this._concepts.get(b);
        if (!ca || !cb) continue;
        for (const [f, w] of cb.features) {
          const existing = ca.features.get(f);
          ca.features.set(f, existing === undefined ? w : Math.max(existing, w));
        }
      }
    }
  }

  // Associative strength between two labels, learned from co-occurrence.
  relatedness(a, b) {
    const ca = this.get(a);
    const cb = this.get(b);
    if (!ca || !cb) return 0;
    const direct = this._relations.get(ca.id)?.get(cb.id) || 0;

    // Feature overlap contributes as well: two things that share features
    // are related even if they were never seen together.
    let shared = 0;
    for (const f of ca.features.keys()) if (cb.features.has(f)) shared++;
    const featureScore = ca.features.size && cb.features.size
      ? shared / Math.min(ca.features.size, cb.features.size)
      : 0;

    return Math.min(1, direct + featureScore * 0.5);
  }

  // The affect a label should carry, combining what was learned about the
  // label directly with what its features imply. Feature affect is what
  // lets an unfamiliar label inherit an opinion.
  //
  // The concept's own experience wins when it has any. A concept that has
  // never been given direct affect takes its colour from the features it
  // shares with things that were.
  affectOf(label) {
    const c = this.get(label);
    if (!c) return null;

    // Feature-derived affect.
    //
    // The weight of each feature decides how much it contributes. A
    // concept that shares only a weak feature with something frightening
    // should not become frightening itself, and a concept that shares a
    // strong one should.
    let fv = 0, fa = 0, fp = 0, fw = 0;
    for (const [f, weight] of c.features) {
      const entry = this._featureAffect.get(f);
      if (!entry || entry.n === 0) continue;
      // A feature seen many times is a more reliable guide than one seen
      // once, and the weight the world gave it scales it further.
      const w = Math.min(1, entry.n / 3) * Math.max(0.05, Math.min(1, weight));
      fv += entry.valence * w;
      fa += entry.arousal * w;
      fp += entry.approach * w;
      fw += w;
    }

    if (fw > 0) {
      fv /= fw; fa /= fw; fp /= fw;
    }

    const direct = {
      valence: c.emotion.valence,
      arousal: c.emotion.arousal,
      approach: c.emotion.approach,
    };

    // How much direct affect this concept has been given, as opposed to
    // having only ever been seen. A concept that was only observed with
    // features has no opinion of its own and should take its colour
    // entirely from those features.
    const own = Math.min(1, c.directAffect / 2);
    const inherit = (1 - own) * FEATURE_AFFECT_WEIGHT;

    const mix = (d, f) => {
      const total = own + inherit;
      if (total <= 0) return 0;
      return (d * own + f * inherit) / total;
    };

    return {
      valence: +mix(direct.valence, fv).toFixed(3),
      arousal: +mix(direct.arousal, fa).toFixed(3),
      approach: +mix(direct.approach, fp).toFixed(3),
    };
  }

  // Labels most similar to the given one, using learned relations.
  nearest(label, limit = 5) {
    const c = this.get(label);
    if (!c) return [];
    const out = [];
    for (const other of this._concepts.values()) {
      if (other.id === c.id) continue;
      const strength = this.relatedness(label, other.label);
      if (strength > MIN_RELATION) out.push({ label: other.label, strength: +strength.toFixed(3) });
    }
    out.sort((a, b) => b.strength - a.strength);
    return out.slice(0, limit);
  }

  // Decay associative links so that stale relations fade, like a real
  // memory trace. Called on tick.
  tick() {
    for (const map of this._relations.values()) {
      for (const [key, value] of map) {
        const next = value * RELATION_DECAY;
        if (next < MIN_RELATION) map.delete(key);
        else map.set(key, next);
      }
    }
  }

  snapshot() {
    return {
      version: 1,
      nextId: this._nextId,
      labels: [...this._byLabel.entries()],
      concepts: [...this._concepts.values()].map(c => ({
        id: c.id,
        label: c.label,
        features: [...c.features.entries()],
        emotion: { ...c.emotion },
        encounters: c.encounters,
        directAffect: c.directAffect || 0,
        lastSeen: c.lastSeen,
      })),
      relations: [...this._relations.entries()].map(([id, map]) => [id, [...map.entries()]]),
      featureAffect: [...this._featureAffect.entries()],
    };
  }

  restore(snapshot) {
    if (!snapshot) return this;
    this._byLabel = new Map(snapshot.labels || []);
    this._concepts = new Map();
    this._relations = new Map();
    for (const c of snapshot.concepts || []) {
      this._concepts.set(c.id, {
        id: c.id,
        label: c.label,
        features: new Map(c.features || []),
        emotion: { ...c.emotion },
        encounters: c.encounters || 0,
        directAffect: c.directAffect || 0,
        lastSeen: c.lastSeen || 0,
      });
    }
    for (const [id, entries] of snapshot.relations || []) {
      this._relations.set(id, new Map(entries));
    }
    this._featureAffect = new Map(snapshot.featureAffect || []);
    this._nextId = snapshot.nextId ?? this._concepts.size;
    return this;
  }
}

module.exports = { Grounding, hashLabel };
