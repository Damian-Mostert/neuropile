'use strict';

// Sparse distributed codes for sensory patterns.
//
// The original encoding hashed a string with djb2 and spread the result over
// 200 neuron indices. That gives every word a distinct, private set of
// neurons, which means the substrate could never learn that two things are
// related: "cat" and "kitten" shared zero neurons, so no amount of
// experience could make them co-activate and Hebbian learning had nothing to
// bind.
//
// A real cortex solves this with sparse distributed representation: each
// item is described by the features it shares with other items, and those
// features are projected into a high-dimensional code. Similar things overlap
// because they literally share components.
//
// This module provides that. A token is broken into features (character
// trigrams, whole-word tokens, and any explicit sensory features the caller
// supplies). Each feature is projected into the code space with an
// independent hash, and the projections are combined into a sparse set of
// neuron indices.
//
// The result:
//   - "cat" and "kitten" share character trigrams and their shared tokens
//     contribute overlapping indices
//   - "dog bites" contains "dog"'s trigram projection
//   - unrelated words share little
//
// The indices are still sparse and still distributed. Nothing here is a
// lookup table of meanings: features are shallow, lexical, and derived only
// from the string itself. They give *structure*, not *meaning*. Meaning
// still has to be learned, which is the point.

const SENSORY_SIZE = 400000;
const PATTERN_LENGTH = 200;

// Number of independent projections each feature is hashed into. More
// projections means a smoother overlap distribution: two items sharing a
// feature will share roughly 1/PROJECTIONS of that feature's indices.
const PROJECTIONS = 3;

// How many indices each feature contributes.
const INDICES_PER_FEATURE = 6;

// Feature weights. Whole-word identity carries the most signal, and the
// longer character n-grams carry most of the morphological signal. Single
// characters are pure noise for similarity ("cat" and "dog" share "c"), so
// they get almost no weight.
//
// Without this weighting every pair of English words overlaps roughly
// equally, because the shared character-level junk outnumbers the shared
// word-level signal.
const FEATURE_WEIGHTS = {
  'w:': 4.0,   // whole token
  'q:': 2.5,   // 4-gram
  't:': 1.0,   // 3-gram
  'b:': 0.3,   // 2-gram
  's:': 3.0,   // caller-supplied sensory feature
};

// Total weight of the shared features between two items, relative to the
// smaller of the two totals. This is a containment score rather than a
// Jaccard score, so a short word contained in a longer one scores high.
function containment(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  return shared / Math.min(A.size, B.size);
}

const _patternCache = new Map();
const _cacheLimit = 4096;

function hashString(text, seed) {
  let h = 5381 ^ seed;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

// Split a token into shallow lexical features.
//
// The design goal is that a shared feature means something. Naive character
// n-grams fail that goal badly: "cat" and "dog" share "c" and "t" style
// fragments that carry no meaning, and short words end up more similar to
// each other than to their own morphological relatives.
//
// The fix is to weight by how *distinctive* a feature is:
//   - the whole token is highly distinctive
//   - a 4-gram is distinctive
//   - a 3-gram is moderately distinctive
//   - a 2-gram is weak but still better than a single character
//   - single characters are dropped entirely
//
// Morphological relatives ("happy"/"happiness") are caught by shared
// 3-grams and a shared suffix, which is enough to separate them from
// unrelated words that merely happen to share a letter.
//
// Returns [feature, weight] pairs so the projection can weight the signal.
function lexicalFeatures(token) {
  const feats = [];
  const t = String(token).toLowerCase();
  if (!t) return feats;

  for (let i = 0; i + 2 <= t.length; i++) {
    feats.push([`b:${t.slice(i, i + 2)}`, FEATURE_WEIGHTS['b:']]);
  }
  for (let i = 0; i + 3 <= t.length; i++) {
    feats.push([`t:${t.slice(i, i + 3)}`, FEATURE_WEIGHTS['t:']]);
  }
  if (t.length > 4) {
    for (let i = 0; i + 4 <= t.length; i++) {
      feats.push([`q:${t.slice(i, i + 4)}`, FEATURE_WEIGHTS['q:']]);
    }
  }
  // A shared suffix is a strong morphological cue ("run"/"running",
  // "happy"/"happiness"), so give the tail extra weight.
  if (t.length >= 4) {
    feats.push([`e:${t.slice(-4)}`, FEATURE_WEIGHTS['t:'] * 2.0]);
  }
  feats.push([`w:${t}`, FEATURE_WEIGHTS['w:']]);
  return feats;
}

// Build the feature list for arbitrary input. Accepts a string, an array of
// strings, or an object with a `text` plus explicit `features`.
function featureList(input, explicitFeatures) {
  const feats = [];
  const push = f => { if (f) feats.push(f); };

  const addText = txt => {
    const words = String(txt).toLowerCase().match(/[a-z0-9']+/g) || [];
    for (const w of words) {
      for (const f of lexicalFeatures(w)) push(f);
    }
  };

  if (Array.isArray(input)) {
    for (const item of input) addText(item);
  } else if (input != null) {
    addText(input);
  }

  if (explicitFeatures) {
    if (Array.isArray(explicitFeatures)) {
      for (const f of explicitFeatures) push([String(f), 1.0]);
    } else if (typeof explicitFeatures === 'object') {
      for (const [k, v] of Object.entries(explicitFeatures)) {
        if (v) push([`s:${k}`, FEATURE_WEIGHTS['s:']]);
      }
    } else {
      push([String(explicitFeatures), 1.0]);
    }
  }

  return feats;
}

// Project features into a sparse set of neuron indices.
function projectFeatures(features, size, length) {
  const buckets = new Map();

  for (const [feat, weight] of features) {
    for (let p = 0; p < PROJECTIONS; p++) {
      const h = hashString(feat, p * 0x9e3779b9);
      for (let k = 0; k < INDICES_PER_FEATURE; k++) {
        const idx = (Math.imul(h ^ k, 2654435761) >>> 0) % size;
        buckets.set(idx, (buckets.get(idx) || 0) + weight);
      }
    }
  }

  if (buckets.size === 0) return new Uint32Array(0);

  // Keep the strongest indices so the code stays sparse, but break ties
  // deterministically so the same input always yields the same code.
  const ranked = [...buckets.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] - b[0];
  });

  const out = new Uint32Array(Math.min(length, ranked.length));
  for (let i = 0; i < out.length; i++) out[i] = ranked[i][0];
  return out;
}

// The public encoder. Mirrors the old soundPattern signature so existing
// callers keep working, with an optional feature list for callers that have
// real sensory features to contribute.
function soundPattern(text, size = SENSORY_SIZE, features = null) {
  const key = `${size}\u0000${features ? JSON.stringify(features) : ''}\u0000${text}`;
  const cached = _patternCache.get(key);
  if (cached) return cached;

  const feats = featureList(text, features);
  const pattern = projectFeatures(feats, size, PATTERN_LENGTH);

  if (_patternCache.size >= _cacheLimit) {
    // Simple bounded eviction: drop the oldest insertion.
    const oldest = _patternCache.keys().next().value;
    _patternCache.delete(oldest);
  }
  _patternCache.set(key, pattern);
  return pattern;
}

// Overlap between two encoded patterns, as a Jaccard similarity. Used by the
// tests and available to callers that want to reason about representational
// similarity directly.
function patternOverlap(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  return shared / (A.size + B.size - shared);
}

// Deterministic hash used for detection labels in the native core.
function labelHash(label) {
  let hash = 5381;
  const text = String(label).toLowerCase();
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash >>> 0;
}

module.exports = {
  soundPattern,
  labelHash,
  patternOverlap,
  containment,
  featureList,
  SENSORY_SIZE,
  PATTERN_LENGTH,
};
