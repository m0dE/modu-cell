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
/**
 * Result of partition assignment computation.
 */
export interface PartitionAssignment {
    /** Map of partitionId -> array of clientIds assigned to send it */
    partitionSenders: Map<number, string[]>;
    /** Number of partitions */
    numPartitions: number;
    /** Frame this assignment is for */
    frame: number;
}
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
export declare function computePartitionAssignment(entityCount: number, clientIds: string[], frame: number, reliability: Record<string, number>, sendersPerPartition?: number): PartitionAssignment;
/**
 * Compute deterministic partition count based on entity count and client count.
 */
export declare function computePartitionCount(entityCount: number, clientCount: number): number;
/**
 * Compute deterministic seed for a partition+frame combination.
 * Uses xxhash32 combining for good distribution.
 */
export declare function computePartitionSeed(frame: number, partitionId: number): number;
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
export declare function weightedRandomPick(clients: string[], count: number, seed: number, reliability: Record<string, number>): string[];
/**
 * Determine which partition an entity belongs to.
 * Same as in state-delta.ts, exported here for convenience.
 */
export declare function getEntityPartition(eid: number, numPartitions: number): number;
/**
 * Check if a client is assigned to send a specific partition.
 */
export declare function isClientAssigned(assignment: PartitionAssignment, clientId: string, partitionId: number): boolean;
/**
 * Get all partitions a client is assigned to send.
 */
export declare function getClientPartitions(assignment: PartitionAssignment, clientId: string): number[];
/**
 * Degradation tier for when clients fail to deliver.
 */
export type DegradationTier = 'NORMAL' | 'DEGRADED' | 'MINIMAL' | 'SKIP';
/**
 * Compute degradation tier based on partition collection success.
 */
export declare function computeDegradationTier(totalPartitions: number, receivedPartitions: number, trustedSenders: number, totalSenders: number): DegradationTier;
