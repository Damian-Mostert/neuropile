// neuropile_core.hpp - native C++ substrate for the Neuropile brain.
//
// This is the C++ implementation of the spiking engine and the neural/limbic
// core. It keeps the same behaviour and the same public shape as the
// JavaScript implementation in lib/, but moves the hot loops (propagation,
// sparse decay, region sampling, wiring) into C++.
//
// Everything above the substrate — memory, concepts, working memory, genome,
// homeostasis, metacognition — lives in JavaScript in lib/. That split keeps
// the native surface small and lets you replace the cognitive layer without
// recompiling.

#pragma once

#include <cstdint>
#include <cmath>
#include <chrono>
#include <random>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace neuropile {

constexpr double PI = 3.14159265358979323846;

constexpr double REFRACTORY_MS = 20.0;

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
constexpr int64_t CO_ACTIVE_TICKS = 2;

constexpr float HEBBIAN_RATE = 0.012f;
constexpr float WEIGHT_DECAY = 0.002f;
constexpr float MAX_WEIGHT = 1.5f;
constexpr float MIN_WEIGHT = -1.5f;
constexpr double DOPAMINE_DECAY = 0.96;
constexpr double NE_DECAY = 0.92;
constexpr int MAX_QUEUE = 20000;
constexpr int SAMPLES_PER_REGION = 500;

struct Region {
    std::string name;
    uint32_t start = 0;
    uint32_t end = 0;
    uint32_t size = 0;
    float threshold = 1.0f;
    float inhibRatio = 0.0f;
    // The unscaled base size for this region. Growth is apportioned by
    // baseSize * profileWeight so the brain keeps its shape as it grows.
    uint32_t baseSize = 0;
};

// A homeostatic drive. Which drives a body has is a fact about the body,
// so the caller declares them. Nothing is seeded.
struct Drive {
    std::string name;
    float value = 0.5f;
    float decay = 0.002f;
    float threshold = 0.4f;
    float critical = 0.15f;
    float pain = 4.0f;
    float signal = 1.0f;
    float restore = 0.28f;
    float effort = 0.0f;
    // What satisfies this drive. The world decides, so this is a list of
    // names rather than a fixed vocabulary.
    std::vector<std::string> satisfiedBy;
    bool hasSource = false;
    float sourceX = 0.0f;
    float sourceY = 0.0f;
};

// The set of drives a body has, with helpers for the operations the core
// needs. Mirrors lib/drives.js.
class Drives {
public:
    std::vector<Drive> items;

    Drive* find(const std::string& name);
    const Drive* find(const std::string& name) const;

    void define(const std::string& name, const Drive& def);
    void set(const std::string& name, float value);
    void satisfy(const std::string& name, float amount);
    void tick();
    float average() const;

    // The drive furthest below its threshold.
    const Drive* mostPressing() const;

    // Does this label satisfy the drive?
    bool satisfies(const std::string& name, const std::string& label) const;

    // Apply an event to the drives it satisfies. Returns the number of
    // drives affected.
    int apply(const std::string& label, float amount, bool hasPos, float x, float y);
};

struct Body {
    float x = 0.5f;
    float y = 0.48f;
    float heading = 0.0f;
    float speed = 0.0f;
    float energy = 0.5f;
};

struct MotorState {
    float moveX = 0.0f;
    float moveY = 0.0f;
    std::string lastAction;
};

struct EmotionalState {
    float valence = 0.0f;
    float arousal = 0.0f;
    float drive = 0.0f;
    float norepinephrine = 0.0f;
    // The value of each drive the body has, by name.
    std::vector<std::pair<std::string, float>> needs;
    Body body;
};

struct BehaviorState {
    float valence = 0.0f;
    float arousal = 0.0f;
    float drive = 0.0f;
    float curiosity = 0.0f;
    float uncertainty = 0.0f;
    float actionReadiness = 0.0f;
    float patience = 0.0f;
    float speechReadiness = 0.0f;
    float researchDrive = 0.0f;
};

struct Decision {
    BehaviorState state;
    bool canSpeak = false;
    bool shouldResearch = false;
    bool shouldAct = false;
    std::string responseMode = "quiet";
};

struct MotorIntent {
    float dx = 0.0f;
    float dy = 0.0f;
    float strength = 0.0f;
};

struct Reafference {
    std::vector<int32_t> indices;
    float strength = 0.0f;
};

struct RegionStat {
    float mean = 0.0f;
    float peak = 0.0f;
    float firing = 0.0f;
};

struct Detection {
    std::string label;
    float x = 0.0f;
    float y = 0.0f;
    float w = 0.2f;
    float h = 0.2f;
    // Affect supplied by the environment. The brain has no built-in
    // knowledge of what any label means; the world tells it.
    float valence = 0.0f;
    float arousal = 0.0f;
    float approach = 0.0f;
    bool hasAffect = false;
};

struct Interaction {
    bool present = false;
    std::string note;
    // The label the world calls this event. Used to work out which drives
    // it satisfies. Falls back to the note when empty.
    std::string label;
    float x = 0.5f;
    float y = 0.5f;
    bool hasX = false;
    bool hasY = false;
    float hungerLevel = 0.5f;
    bool hasHungerLevel = false;
    float intensity = 1.0f;
    bool hasIntensity = false;
    // Affect supplied by the environment. When present, the brain uses
    // these instead of guessing from the note text.
    float valence = 0.0f;
    float arousal = 0.0f;
    float approach = 0.0f;
    bool hasValence = false;
    bool hasArousal = false;
    bool hasApproach = false;
    bool hasAffect = false;
};

struct WorldState {
    bool hasBody = false;
    Body body;
    float vx = 0.0f;
    float vy = 0.0f;

    bool hasOpticFlow = false;
    float flowX = 0.0f;
    float flowY = 0.0f;
    float flowMagnitude = 0.0f;

    bool hasMotorHint = false;
    float motorHintX = 0.0f;
    float motorHintY = 0.0f;
    float motorHintIntensity = 1.0f;
    std::string motorHintMode;

    bool hasNeeds = false;
    // Drive values, by name. Which drives exist is decided by the body.
    std::vector<std::pair<std::string, float>> needs;

    std::vector<Detection> detections;
    Interaction interaction;
};

struct BrainOptions {
    double sizeGB = 0.1;
    bool useExplicitNeurons = false;
    uint32_t neurons = 0;

    // Growth. `startNeurons` is an alias for `neurons` that makes the intent
    // explicit; `maxNeurons` caps neurogenesis. Zero/absent means "no growth".
    bool useStartNeurons = false;
    uint32_t startNeurons = 0;
    bool hasMaxNeurons = false;
    uint32_t maxNeurons = 0;
    bool hasAutoGrow = false;
    bool autoGrow = false;
    uint32_t growthBatch = 0;        // 0 => ~1% of the initial brain per event
    bool hasGrowthInterval = false;
    uint32_t growthInterval = 0;     // ticks between automatic growth events
    uint32_t growthFanout = 0;       // 0 => 8 synapses per direction per new neuron
    std::vector<float> growthProfile;  // optional per-region multipliers

    uint32_t synapsesPerNeuron = 200;
    uint32_t maxConnections = 50000;
    bool wire = true;
    bool hasSeed = false;
    uint32_t seed = 0;

    // The homeostatic drives this body has. Declared by the caller,
    // because the drives belong to the body rather than to the brain.
    std::vector<Drive> drives;
};

class NeuralEngine {
public:
    NeuralEngine(uint32_t neuronCount, uint32_t synapsesPerNeuron);

    void connect(uint32_t src, uint32_t dst, float weight);
    void receive(uint32_t i, float signal);
    float inject(uint32_t i, float signal);
    void pulse(uint32_t i, float signal);
    void tick();
    void setThreshold(uint32_t start, uint32_t end, float value);
    void setInhibitory(uint32_t start, uint32_t end);
    float meanAbs(uint32_t start, uint32_t end, uint32_t step = 1) const;
    float peakAbs(uint32_t start, uint32_t end) const;
    std::vector<float> activation(uint32_t start, uint32_t end) const;
    void rebuildActiveSet();
    size_t activeCount() const { return activeList_.size(); }

    // Reallocate this engine (already constructed at the new size) from an
    // older engine, moving neuron i to remap[i] and rewriting synapse targets
    // through the same table. Used by BrainCore::grow to preserve learned state.
    void remapFrom(const NeuralEngine& src, const std::vector<uint32_t>& remap);

    static double nowMs();

    uint32_t n = 0;
    uint32_t synapseCapacity = 0;

    std::vector<float> potential;
    std::vector<float> threshold;
    std::vector<float> decayRate;
    std::vector<double> firedAt;
    // Tick on which each neuron last fired. Used for the co-activation
    // window, which is measured in ticks rather than wall-clock time so
    // that learning does not depend on the host's tick rate.
    std::vector<int64_t> firedTick;
    std::vector<uint8_t> inhibitory;

    std::vector<uint32_t> synapseTargets;
    std::vector<float> synapseWeights;
    std::vector<uint32_t> synapseCounts;

    double dopamine = 0.0;
    double norepinephrine = 0.0;

    // Simulation clock used for the co-activation window.
    int64_t tickCounter_ = 0;

private:
    void propagate(uint32_t start);
    void fire(uint32_t i, double now);

    std::vector<uint8_t> active_;
    std::vector<int32_t> activeList_;
    std::vector<int32_t> queueBuf_;
    std::vector<uint8_t> inQueue_;
    bool firing_ = false;
    int32_t fqLen_ = 0;
};

class BrainCore {
public:
    explicit BrainCore(const BrainOptions& options);

    void tick(uint32_t count = 1);

    void reward(float strength = 1.0f);
    void punish(float strength = 1.0f);

    // Drives are dynamic: which ones exist is decided by the caller.
    void setNeeds(const std::vector<std::pair<std::string, float>>& needs);
    // Declare more drives at runtime.
    std::vector<std::string> defineDrives(const std::vector<Drive>& drives);
    Drives getDrives() const;
    // The value of each drive the body has, by name.
    std::vector<std::pair<std::string, float>> getDrivesValues() const;
    Body getBody() const;
    MotorState getMotorState() const;

    Body move(float dx, float dy, float intensity = 1.0f);
    EmotionalState integrateWorldState(const WorldState& state);
    void handleInteraction(const std::string& kind, float intensity = 1.0f);
    float amygdalaActivate(float threatLevel = 0.5f);
    void startle(float strength = 1.0f);

    EmotionalState emotionalState();
    BehaviorState behaviorState();
    Decision decideBehavior(bool hasActiveGoal,
                            float activeGoalUrgency,
                            bool humanPresent,
                            uint64_t tickCount,
                            uint64_t lastSpokeTick,
                            bool pendingSelfSpeech);

    void actionSelection();
    float novelty();
    Reafference reafference(uint32_t topN = 20);
    float selfAwareness();
    MotorIntent getMotorIntent() const;
    std::vector<std::pair<std::string, float>> readInternalState() const;
    std::unordered_map<std::string, RegionStat> neuronMap() const;
    std::vector<float> thought() const;

    void perceive(const std::vector<uint32_t>& indices);
    void perceiveDense(const std::vector<float>& values);
    void perceiveVisual(const std::vector<uint32_t>& indices);
    void hear(const std::vector<uint32_t>& indices);
    void hearDense(const std::vector<float>& values);
    void encode(const std::vector<uint32_t>& indices, float strength = 1.0f);
    void encodeDense(const std::vector<float>& values, float strength = 1.0f);
    void consolidate(const std::vector<uint32_t>& indices, float strength = 1.0f);
    void consolidateDense(const std::vector<float>& values, float strength = 1.0f);

    uint32_t motorQuadrantSize() const;
    const std::vector<Region>& regions() const { return regions_; }
    const Region* region(const std::string& name) const;
    const Region& regionRef(const std::string& name) const;

    // ── Growth ────────────────────────────────────────────────────────────
    // grow() adds up to `count` neurons (capped by maxNeurons) and returns how
    // many were actually added. maybeGrow() is called by tick() and applies the
    // automatic growth cadence. growTo() grows toward a target total.
    uint32_t grow(uint32_t count);
    uint32_t growTo(uint32_t target);
    uint32_t maybeGrow();
    uint32_t neuronCount() const { return engine_.n; }
    uint32_t maxNeurons() const { return options_.maxNeurons; }
    bool canGrow() const { return engine_.n < options_.maxNeurons; }
    float growthProgress() const;
    uint32_t growthEvents() const { return growthEvents_; }
    uint64_t lastGrowthTick() const { return lastGrowthTick_; }
    void setGrowthEvents(uint32_t value) { growthEvents_ = value; }
    void setLastGrowthTick(uint64_t value) { lastGrowthTick_ = value; }

    void setRegions(const std::vector<Region>& regions);
    void resizeEngine(uint32_t newN, uint32_t synapseCapacity);
    void restoreOptions(const BrainOptions& options);

    NeuralEngine& engine() { return engine_; }
    const NeuralEngine& engine() const { return engine_; }

    uint64_t tickCount() const { return tickCount_; }
    float valence() const { return valence_; }
    float arousal() const { return arousal_; }
    float drive() const { return drive_; }
    const BrainOptions& options() const { return options_; }

    void setBody(const Body& body) { body_ = body; }
    void setMotorState(const MotorState& state) { motorState_ = state; }
    void setAffect(float valence, float arousal, float drive) {
        valence_ = valence;
        arousal_ = arousal;
        drive_ = drive;
    }
    void setLastFood(bool has, float x, float y) {
        hasLastFood_ = has;
        lastFoodX_ = x;
        lastFoodY_ = y;
    }
    bool hasLastFood() const { return hasLastFood_; }
    float lastFoodX() const { return lastFoodX_; }
    float lastFoodY() const { return lastFoodY_; }

    void setMotorHint(bool active, float x, float y, float intensity, const std::string& mode) {
        motorHintActive_ = active;
        motorHintX_ = x;
        motorHintY_ = y;
        motorHintIntensity_ = intensity;
        motorHintMode_ = mode;
    }
    bool motorHintActive() const { return motorHintActive_; }
    float motorHintX() const { return motorHintX_; }
    float motorHintY() const { return motorHintY_; }
    float motorHintIntensity() const { return motorHintIntensity_; }
    const std::string& motorHintMode() const { return motorHintMode_; }

    void setTickCount(uint64_t t) { tickCount_ = t; }

    const std::vector<float>& baseline() const { return baseline_; }
    const std::vector<float>& reafBaseline() const { return reafBaseline_; }
    void setBaseline(const std::vector<float>& values);
    void setReafBaseline(const std::vector<float>& values);

private:
    static const std::vector<Region>& baseRegions();
    static uint32_t scaledSize(uint32_t base, double scale);
    void applyRegionProperties();
    void wireRegions(const std::string& srcName,
                     const std::string& dstName,
                     float density,
                     float wMin,
                     float wMax);
    void wire();
    void tickNeeds();
    float meanOfRegion(const std::string& name, uint32_t step) const;
    float peakOfRegion(const std::string& name) const;
    void seedRegion(const std::string& name, uint32_t seedCount, float signal, bool pulse);

    void rebuildRegionIndex();
    std::vector<float> growthWeights() const;
    std::vector<uint32_t> distributeGrowth(uint32_t count);
    void wireNewNeurons(const std::vector<Region>& oldRegions,
                        const std::vector<uint32_t>& additions);

    NeuralEngine engine_;
    BrainOptions options_;
    std::vector<Region> regions_;
    std::unordered_map<std::string, size_t> regionIndex_;
    std::mt19937 rng_;

    std::vector<float> baseline_;
    float baselineAlpha_ = 0.005f;
    std::vector<float> reafBaseline_;
    float reafBaselineAlpha_ = 0.02f;

    float valence_ = 0.0f;
    float arousal_ = 0.0f;
    float drive_ = 0.0f;

    // The homeostatic drives this body has. Declared by the caller.
    Drives drives_;
    Body body_;
    MotorState motorState_;

    bool hasLastFood_ = false;
    float lastFoodX_ = 0.0f;
    float lastFoodY_ = 0.0f;

    bool motorHintActive_ = false;
    float motorHintX_ = 0.0f;
    float motorHintY_ = 0.0f;
    float motorHintIntensity_ = 1.0f;
    std::string motorHintMode_;

    uint64_t tickCount_ = 0;
    uint32_t growthEvents_ = 0;
    uint64_t lastGrowthTick_ = 0;
};

// djb2-based pattern hashing, identical to soundPattern() in core/boot.js.
std::vector<uint32_t> soundPattern(const std::string& text, uint32_t size, uint32_t length = 200);

}  // namespace neuropile
