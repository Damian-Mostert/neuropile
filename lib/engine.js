'use strict';

// Pure-JavaScript spiking engine. This is a direct port of core/engine.js from
// Neuropile, used when the native addon is not available (or when the user asks for
// the fallback explicitly). The API is intentionally identical to the native
// NeuralEngine exposed by addon.cpp.

const REFRACTORY_MS = 20;
const HEBBIAN_RATE = 0.012;
const WEIGHT_DECAY = 0.002;
const MAX_WEIGHT = 1.5;
const MIN_WEIGHT = -1.5;
const DOPAMINE_DECAY = 0.96;
const NE_DECAY = 0.92;
const MAX_QUEUE = 20000;

// Co-activation window, measured in ticks rather than wall-clock time.
//
// This used to be 50 milliseconds of real time, which quietly broke
// learning at any realistic tick rate: at 10 Hz a tick takes 100 ms, so two
// neurons that fired in the same tick were never within 50 ms of each other
// and no synapse ever saw co-activation. Learning only appeared to work at
// very high tick rates, and it made the brain's behaviour depend on how fast
// the host loop happened to be running.
//
// Counting in ticks makes the learning window a property of the simulation
// rather than of the machine.
const CO_ACTIVE_TICKS = 2;

class NeuralEngine {
  constructor(neuronCount, synapsesPerNeuron = 200) {
    this.n = Math.max(1, neuronCount | 0);
    const synapses = this.n * Math.max(1, synapsesPerNeuron | 0);

    this.potential = new Float32Array(this.n);
    this.threshold = new Float32Array(this.n).fill(1.0);
    this.decayRate = new Float32Array(this.n).fill(0.95);
    this.firedAt = new Float64Array(this.n);
    // Tick on which each neuron last fired. Int32 rather than Int64 so the
    // snapshot stays JSON-serializable without a BigInt encoder.
    this.firedTick = new Int32Array(this.n).fill(-1);
    this.inhibitory = new Uint8Array(this.n);

    this.synapseTargets = new Uint32Array(synapses);
    this.synapseWeights = new Float32Array(synapses);
    this.synapseCounts = new Uint32Array(this.n);

    this.synapseCapacity = Math.max(1, synapsesPerNeuron | 0);
    this.dopamine = 0;
    this.norepinephrine = 0;

    this._active = new Uint8Array(this.n);
    this._activeList = [];
    this._queueBuf = new Int32Array(MAX_QUEUE);
    this._inQueue = new Uint8Array(this.n);
    this._firingQueue = null;
    this._fqLen = 0;
    // Simulation clock for the co-activation window. Named distinctly from
    // tick() so it cannot shadow the method.
    this.tickCount = 0;
  }

  get activeCount() {
    return this._activeList.length;
  }

  static now() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  setThreshold(start, end, value) {
    this.threshold.fill(value, start, end);
  }

  setInhibitory(start, end) {
    this.inhibitory.fill(1, start, end);
  }

  connect(src, dst, weight) {
    if (src < 0 || src >= this.n || dst < 0 || dst >= this.n) return;
    const base = src * this.synapseCapacity;
    const count = this.synapseCounts[src];
    if (count >= this.synapseCapacity) return;
    this.synapseTargets[base + count] = dst;
    this.synapseWeights[base + count] = weight;
    this.synapseCounts[src]++;
  }

  receive(i, signal) {
    if (i < 0 || i >= this.n) return;
    const prev = this.potential[i];
    this.potential[i] += signal;

    if (prev === 0 && signal !== 0 && !this._active[i]) {
      this._active[i] = 1;
      this._activeList.push(i);
    }

    if (this.potential[i] >= this.threshold[i]) {
      if (this._firingQueue !== null) {
        if (!this._inQueue[i]) {
          this._inQueue[i] = 1;
          if (this._fqLen < MAX_QUEUE) this._queueBuf[this._fqLen++] = i;
        }
      } else {
        this._propagate(i);
      }
    }
  }

  inject(i, signal) {
    if (i < 0 || i >= this.n) return 0;
    const prev = this.potential[i];
    this.potential[i] += signal;
    if (prev === 0 && signal !== 0 && !this._active[i]) {
      this._active[i] = 1;
      this._activeList.push(i);
    }
    // Injecting enough to cross threshold makes the neuron spike, exactly
    // as a real one would. Previously inject() only raised the membrane
    // potential and left it there, so a stimulus that arrived through
    // inject() - which is most of them - never produced a spike and
    // therefore never produced any learning.
    if (this.potential[i] >= this.threshold[i]) {
      const residual = this.threshold[i] * 0.8;
      this._propagate(i);
      this.potential[i] = residual;
    }
    return this.potential[i];
  }

  pulse(i, signal) {
    if (i < 0 || i >= this.n) return;
    this.potential[i] += signal;
    if (!this._active[i]) {
      this._active[i] = 1;
      this._activeList.push(i);
    }
    if (this.potential[i] >= this.threshold[i]) {
      const residual = this.threshold[i] * 0.8;
      this._propagate(i);
      this.potential[i] = residual;
      if (!this._active[i]) {
        this._active[i] = 1;
        this._activeList.push(i);
      }
    }
  }

  _propagate(start) {
    this._fqLen = 0;
    this._queueBuf[this._fqLen++] = start;
    this._inQueue[start] = 1;
    this._firingQueue = this._queueBuf;
    const now = NeuralEngine.now();

    for (let qi = 0; qi < this._fqLen; qi++) {
      this._fire(this._queueBuf[qi], now);
    }

    for (let qi = 0; qi < this._fqLen; qi++) {
      this._inQueue[this._queueBuf[qi]] = 0;
    }
    this._firingQueue = null;
    this._fqLen = 0;
  }

  _fire(i, now) {
    if (this.firedAt[i] !== 0 && now - this.firedAt[i] < REFRACTORY_MS) return;

    this.firedAt[i] = now;
    this.firedTick[i] = this.tickCount;
    this.potential[i] = 0;

    const base = i * this.synapseCapacity;
    const count = this.synapseCounts[i];
    const sign = this.inhibitory[i] ? -1 : 1;
    const da = this.dopamine;

    // Hebbian plasticity always runs. Co-activation is the learning signal
    // on its own, the way it is in a real cortex: a brain that watches two
    // things happen together learns they go together, with or without
    // anyone scoring the outcome.
    //
    // Dopamine modulates the rate rather than gating it. Reward makes
    // learning faster and punishment makes it slower, but neither is
    // required for the synapse to change at all.
    //
    // Previously this was `da > 0.05 || da < -0.05`, which meant a brain
    // that was never explicitly rewarded never learned anything. A brain
    // that had merely experienced the world could not learn from it.
    const learningRate = HEBBIAN_RATE * (da > 0.05 || da < -0.05
      ? Math.max(0.1, 1 + da)
      : 1);
    const decayRate = WEIGHT_DECAY * (1 - da * 0.5);

    for (let k = 0; k < count; k++) {
      const dst = this.synapseTargets[base + k];

      // Co-activation is measured in ticks, so it behaves the same whether
      // the host is ticking at 1 Hz or 1 kHz.
      const coActive = this.firedTick[dst] >= 0
        && this.tickCount - this.firedTick[dst] <= CO_ACTIVE_TICKS;
      if (coActive) {
        const w = this.synapseWeights[base + k] + learningRate;
        this.synapseWeights[base + k] = w > MAX_WEIGHT ? MAX_WEIGHT : w;
      } else {
        const w = this.synapseWeights[base + k] - decayRate;
        this.synapseWeights[base + k] = w < MIN_WEIGHT ? MIN_WEIGHT : w;
      }

      const newPot = this.potential[dst] + sign * this.synapseWeights[base + k];
      this.potential[dst] = newPot;

      if (!this._active[dst]) {
        this._active[dst] = 1;
        this._activeList.push(dst);
      }

      if (newPot >= this.threshold[dst] && this._fqLen < MAX_QUEUE) {
        if (!this._inQueue[dst]) {
          this._inQueue[dst] = 1;
          this._queueBuf[this._fqLen++] = dst;
        }
      }
    }
  }

  tick() {
    const pot = this.potential;
    const decay = this.decayRate;
    const active = this._active;
    const list = this._activeList;
    let writeIdx = 0;

    // Advance the simulation clock used for co-activation.
    this.tickCount++;

    const overload = list.length > 50000;
    const inhibScale = overload ? 0.35 : 1.0;

    for (let i = 0; i < list.length; i++) {
      const idx = list[i];
      const v = pot[idx] * decay[idx] * inhibScale * 0.92;
      if (Math.abs(v) > 1e-6) {
        pot[idx] = v;
        list[writeIdx++] = idx;
      } else {
        pot[idx] = 0;
        active[idx] = 0;
      }
    }
    list.length = writeIdx;

    this.dopamine *= DOPAMINE_DECAY;
    this.norepinephrine *= NE_DECAY;
  }

  activation(start, end) {
    return this.potential.subarray(start, end);
  }

  meanAbs(start, end, step = 1) {
    const pot = this.potential;
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += step) {
      const v = pot[i];
      sum += v < 0 ? -v : v;
      count++;
    }
    return count === 0 ? 0 : sum / count;
  }

  peakAbs(start, end) {
    const pot = this.potential;
    const step = Math.max(1, Math.floor((end - start) / 2000));
    let peak = 0;
    for (let i = start; i < end; i += step) {
      const v = pot[i] < 0 ? -pot[i] : pot[i];
      if (v > peak) peak = v;
    }
    return peak;
  }

  rebuildActiveSet() {
    this._active.fill(0);
    this._inQueue.fill(0);
    this._activeList = [];
    this._firingQueue = null;
    this._fqLen = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.potential[i] !== 0) {
        this._active[i] = 1;
        this._activeList.push(i);
      }
    }
  }

  remapFrom(src, remap) {
    const capacity = this.synapseCapacity;
    const oldCapacity = src.synapseCapacity;
    const copyCapacity = Math.min(capacity, oldCapacity);
    const oldN = src.n;

    for (let i = 0; i < oldN && i < remap.length; i++) {
      const j = remap[i];
      if (j >= this.n) continue;

      this.potential[j] = src.potential[i];
      this.threshold[j] = src.threshold[i];
      this.decayRate[j] = src.decayRate[i];
      this.firedAt[j] = src.firedAt[i];
      this.firedTick[j] = src.firedTick ? src.firedTick[i] : -1;
      this.inhibitory[j] = src.inhibitory[i];

      const oldBase = i * oldCapacity;
      const newBase = j * capacity;
      let count = src.synapseCounts[i];
      if (count > copyCapacity) count = copyCapacity;
      this.synapseCounts[j] = count;

      for (let k = 0; k < count; k++) {
        const target = src.synapseTargets[oldBase + k];
        this.synapseTargets[newBase + k] = target < remap.length ? remap[target] : target;
        this.synapseWeights[newBase + k] = src.synapseWeights[oldBase + k];
      }
    }

    this.dopamine = src.dopamine;
    this.norepinephrine = src.norepinephrine;
    this.rebuildActiveSet();
    return this;
  }

  snapshot() {
    return {
      n: this.n,
      synapseCapacity: this.synapseCapacity,
      dopamine: this.dopamine,
      norepinephrine: this.norepinephrine,
      potential: this.potential.slice(),
      threshold: this.threshold.slice(),
      decayRate: this.decayRate.slice(),
      firedAt: this.firedAt.slice(),
      firedTick: this.firedTick.slice(),
      inhibitory: this.inhibitory.slice(),
      synapseTargets: this.synapseTargets.slice(),
      synapseWeights: this.synapseWeights.slice(),
      synapseCounts: this.synapseCounts.slice(),
    };
  }

  restore(snapshot) {
    if (!snapshot) throw new Error('restore(snapshot) expects an object');
    if (snapshot.n != null && snapshot.n !== this.n) {
      throw new RangeError('snapshot was taken from an engine with a different neuron count');
    }
    const copy = (target, source, name) => {
      if (!source) return;
      if (source.length !== target.length) {
        throw new RangeError(`${name} has the wrong length`);
      }
      target.set(source);
    };
    copy(this.potential, snapshot.potential, 'potential');
    copy(this.threshold, snapshot.threshold, 'threshold');
    copy(this.decayRate, snapshot.decayRate, 'decayRate');
    copy(this.firedAt, snapshot.firedAt, 'firedAt');
    if (snapshot.firedTick) copy(this.firedTick, snapshot.firedTick, 'firedTick');
    copy(this.inhibitory, snapshot.inhibitory, 'inhibitory');
    copy(this.synapseTargets, snapshot.synapseTargets, 'synapseTargets');
    copy(this.synapseWeights, snapshot.synapseWeights, 'synapseWeights');
    copy(this.synapseCounts, snapshot.synapseCounts, 'synapseCounts');
    if (typeof snapshot.dopamine === 'number') this.dopamine = snapshot.dopamine;
    if (typeof snapshot.norepinephrine === 'number') this.norepinephrine = snapshot.norepinephrine;
    this.rebuildActiveSet();
    return this;
  }
}

module.exports = {
  NeuralEngine,
  REFRACTORY_MS,
  HEBBIAN_RATE,
  WEIGHT_DECAY,
  MAX_WEIGHT,
  MIN_WEIGHT,
  DOPAMINE_DECAY,
  NE_DECAY,
  MAX_QUEUE,
};
