/**
 * Partition Assignment Algorithm
 *
 * Determines which clients are responsible for sending which partitions.
 * Uses fixed-point arithmetic for cross-platform determinism.
 *
 * Key properties:
 * - Deterministic: Same inputs always produce same outputs
 * - Zero-coordination: All clients can compute independently
 * - Reliability-weighted: More reliable clients are more likely to be selected
 * - Frame-seeded: Different assignments each frame to distribute load
 */
import { xxhash32Combine } from '../hash/xxhash';
/**
 * Fixed-point scale factor (2^16 = 65536)
 * This gives us ~4 decimal places of precision.
 */
const FP_SCALE = 65536;
const FP_HALF = 32768;
/**
 * Compute partition assignment for a frame.
 * All clients compute the same result independently.
 *
 * @param entityCount Number of entities (determines partition count)
 * @param clientIds List of active client IDs
 * @param frame Current frame number (used as seed)
 * @param reliability Map of clientId -> reliability score (0-100)
 * @param sendersPerPartition How many clients should send each partition (default: 2)
 * @returns Partition assignment
 */
export function computePartitionAssignment(entityCount, clientIds, frame, reliability, sendersPerPartition = 2) {
    // Sort client IDs for determinism
    const sortedClients = [...clientIds].sort();
    // Determine number of partitions based on entity count
    const numPartitions = computePartitionCount(entityCount, sortedClients.length);
    // Create result map
    const partitionSenders = new Map();
    // Assign senders to each partition
    for (let partitionId = 0; partitionId < numPartitions; partitionId++) {
        // Compute seed for this partition+frame combination
        const seed = computePartitionSeed(frame, partitionId);
        // Select clients for this partition using weighted random
        const senders = weightedRandomPick(sortedClients, Math.min(sendersPerPartition, sortedClients.length), seed, reliability);
        partitionSenders.set(partitionId, senders);
    }
    return {
        partitionSenders,
        numPartitions,
        frame
    };
}
/**
 * Compute deterministic partition count based on entity count and client count.
 */
export function computePartitionCount(entityCount, clientCount) {
    if (clientCount <= 0)
        return 1;
    if (entityCount <= 0)
        return 1;
    // Target: 20-50 entities per partition
    // Min: 1 partition
    // Max: clientCount * 2 partitions (so each client handles ~2 partitions)
    const targetEntitiesPerPartition = 30;
    const idealPartitions = Math.ceil(entityCount / targetEntitiesPerPartition);
    // Clamp to reasonable range
    const minPartitions = 1;
    const maxPartitions = Math.max(1, clientCount * 2);
    return Math.max(minPartitions, Math.min(maxPartitions, idealPartitions));
}
/**
 * Compute deterministic seed for a partition+frame combination.
 * Uses xxhash32 combining for good distribution.
 */
export function computePartitionSeed(frame, partitionId) {
    let seed = 0x12345678;
    seed = xxhash32Combine(seed, frame >>> 0);
    seed = xxhash32Combine(seed, partitionId >>> 0);
    return seed >>> 0;
}
/**
 * Weighted random selection without replacement.
 * Uses fixed-point arithmetic for determinism.
 *
 * @param clients Sorted list of client IDs
 * @param count Number of clients to select
 * @param seed Random seed
 * @param reliability Map of clientId -> reliability score (0-100)
 * @returns Selected client IDs
 */
export function weightedRandomPick(clients, count, seed, reliability) {
    if (clients.length === 0)
        return [];
    if (count >= clients.length)
        return [...clients];
    const result = [];
    const available = [...clients];
    let rng = seed;
    for (let i = 0; i < count && available.length > 0; i++) {
        // Compute weights in fixed-point
        const weights = computeFixedPointWeights(available, reliability);
        // Select based on weights
        const selectedIdx = selectWeighted(weights, rng);
        result.push(available[selectedIdx]);
        // Remove selected client
        available.splice(selectedIdx, 1);
        // Advance RNG
        rng = nextRandom(rng);
    }
    return result;
}
/**
 * Compute weights in fixed-point format.
 * Reliability 0-100 maps to weight 1-101 (never zero to ensure all clients have some chance).
 */
function computeFixedPointWeights(clients, reliability) {
    const weights = [];
    for (const clientId of clients) {
        // Get reliability, default to 50 if not specified
        const rel = reliability[clientId] ?? 50;
        // Clamp to 0-100 range
        const clampedRel = Math.max(0, Math.min(100, rel));
        // Convert to weight: reliability + 1 (so 0 reliability still has weight 1)
        // Scale to fixed-point
        const weight = ((clampedRel + 1) * FP_SCALE) | 0;
        weights.push(weight);
    }
    return weights;
}
/**
 * Select an index based on weights using fixed-point arithmetic.
 */
function selectWeighted(weights, seed) {
    if (weights.length === 0)
        return -1;
    if (weights.length === 1)
        return 0;
    // Compute total weight
    let totalWeight = 0;
    for (const w of weights) {
        totalWeight = (totalWeight + w) | 0;
    }
    if (totalWeight <= 0) {
        // Fallback to uniform if all weights are 0
        return seed % weights.length;
    }
    // Generate random threshold in [0, totalWeight)
    // Use fixed-point multiplication to avoid floating point
    const randNormalized = (seed >>> 0) % FP_SCALE;
    const threshold = mulFP(randNormalized, totalWeight);
    // Find which bucket the threshold falls into
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
        cumulative = (cumulative + weights[i]) | 0;
        if (threshold < cumulative) {
            return i;
        }
    }
    // Fallback (should rarely happen due to rounding)
    return weights.length - 1;
}
/**
 * Fixed-point multiplication.
 * a and b are in FP_SCALE format.
 * Returns result in original scale (divides by FP_SCALE).
 */
function mulFP(a, b) {
    // Use BigInt for large intermediate values to avoid overflow
    // This is the only way to get deterministic multiplication in JS
    const result = (BigInt(a >>> 0) * BigInt(b >>> 0)) / BigInt(FP_SCALE);
    return Number(result) | 0;
}
/**
 * Simple deterministic RNG (xorshift32).
 * Returns next random value.
 */
function nextRandom(state) {
    let x = state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
}
/**
 * Determine which partition an entity belongs to.
 * Same as in state-delta.ts, exported here for convenience.
 */
export function getEntityPartition(eid, numPartitions) {
    return eid % numPartitions;
}
/**
 * Check if a client is assigned to send a specific partition.
 */
export function isClientAssigned(assignment, clientId, partitionId) {
    const senders = assignment.partitionSenders.get(partitionId);
    return senders?.includes(clientId) ?? false;
}
/**
 * Get all partitions a client is assigned to send.
 */
export function getClientPartitions(assignment, clientId) {
    const partitions = [];
    for (const [partitionId, senders] of assignment.partitionSenders) {
        if (senders.includes(clientId)) {
            partitions.push(partitionId);
        }
    }
    return partitions.sort((a, b) => a - b);
}
/**
 * Compute degradation tier based on partition collection success.
 */
export function computeDegradationTier(totalPartitions, receivedPartitions, trustedSenders, totalSenders) {
    // All partitions received from trusted senders
    if (receivedPartitions === totalPartitions && trustedSenders === totalSenders) {
        return 'NORMAL';
    }
    // Most partitions received (>75%)
    if (receivedPartitions > totalPartitions * 0.75) {
        return 'DEGRADED';
    }
    // Some partitions received (>25%)
    if (receivedPartitions > totalPartitions * 0.25) {
        return 'MINIMAL';
    }
    // Too few partitions - skip this tick's delta
    return 'SKIP';
}
