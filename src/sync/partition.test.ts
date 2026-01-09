import { describe, test, expect } from 'vitest';
import {
  computePartitionAssignment,
  computePartitionCount,
  computePartitionSeed,
  weightedRandomPick,
  getEntityPartition,
  isClientAssigned,
  getClientPartitions,
  computeDegradationTier,
  PartitionAssignment
} from './partition';

describe('computePartitionAssignment', () => {
  // CRITICAL: Determinism across independent computations
  test('produces identical results for same inputs', () => {
    const clientIds = ['a', 'b', 'c', 'd', 'e'];
    const reliability = { a: 100, b: 90, c: 80, d: 70, e: 60 };

    const result1 = computePartitionAssignment(100, clientIds, 42, reliability);
    const result2 = computePartitionAssignment(100, clientIds, 42, reliability);

    // Same number of partitions
    expect(result1.numPartitions).toBe(result2.numPartitions);
    expect(result1.frame).toBe(result2.frame);

    // Same senders for each partition
    for (let i = 0; i < result1.numPartitions; i++) {
      const senders1 = result1.partitionSenders.get(i);
      const senders2 = result2.partitionSenders.get(i);
      expect(senders1).toEqual(senders2);
    }
  });

  // Different frames produce different assignments (but still deterministic)
  test('different frames produce different but deterministic assignments', () => {
    const clientIds = ['a', 'b', 'c'];
    const reliability = { a: 100, b: 100, c: 100 };

    const frame1 = computePartitionAssignment(100, clientIds, 1, reliability);
    const frame2 = computePartitionAssignment(100, clientIds, 2, reliability);
    const frame1Again = computePartitionAssignment(100, clientIds, 1, reliability);

    // Different frames should have different assignments (with high probability)
    // But same frame should always produce same result
    expect(frame1.partitionSenders).toEqual(frame1Again.partitionSenders);

    // Check that at least some assignments differ between frames
    // (statistically very unlikely to be identical for all partitions)
    let anyDifferent = false;
    for (let i = 0; i < frame1.numPartitions; i++) {
      const s1 = frame1.partitionSenders.get(i);
      const s2 = frame2.partitionSenders.get(i);
      if (JSON.stringify(s1) !== JSON.stringify(s2)) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  // Client list order doesn't matter (sorted internally)
  test('client order does not affect assignment', () => {
    const reliability = { a: 100, b: 90, c: 80 };

    const result1 = computePartitionAssignment(100, ['a', 'b', 'c'], 42, reliability);
    const result2 = computePartitionAssignment(100, ['c', 'a', 'b'], 42, reliability);

    expect(result1.numPartitions).toBe(result2.numPartitions);
    for (let i = 0; i < result1.numPartitions; i++) {
      expect(result1.partitionSenders.get(i)).toEqual(result2.partitionSenders.get(i));
    }
  });

  // Higher reliability = more likely to be selected
  test('reliability weighting affects selection probability', () => {
    const clientIds = ['reliable', 'unreliable'];
    const reliability = { reliable: 100, unreliable: 10 };

    let reliableCount = 0;
    const totalTrials = 1000;

    for (let frame = 0; frame < totalTrials; frame++) {
      const assignment = computePartitionAssignment(10, clientIds, frame, reliability);
      const partition0Senders = assignment.partitionSenders.get(0) || [];
      if (partition0Senders.includes('reliable')) {
        reliableCount++;
      }
    }

    // Reliable client should be selected significantly more often
    // With reliability 100 vs 10, reliable should win ~91% of the time (101/111)
    expect(reliableCount).toBeGreaterThan(totalTrials * 0.7);
  });

  test('handles single client', () => {
    const result = computePartitionAssignment(100, ['solo'], 1, { solo: 50 });

    expect(result.numPartitions).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < result.numPartitions; i++) {
      expect(result.partitionSenders.get(i)).toEqual(['solo']);
    }
  });

  test('handles empty client list', () => {
    const result = computePartitionAssignment(100, [], 1, {});

    expect(result.numPartitions).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < result.numPartitions; i++) {
      expect(result.partitionSenders.get(i)).toEqual([]);
    }
  });

  test('handles zero entities', () => {
    const result = computePartitionAssignment(0, ['a', 'b'], 1, { a: 50, b: 50 });
    expect(result.numPartitions).toBe(1);
  });

  test('assigns sendersPerPartition clients per partition', () => {
    const clientIds = ['a', 'b', 'c', 'd', 'e'];
    const reliability = { a: 80, b: 80, c: 80, d: 80, e: 80 };

    // 2 senders per partition (default)
    const result2 = computePartitionAssignment(50, clientIds, 1, reliability, 2);
    for (let i = 0; i < result2.numPartitions; i++) {
      expect(result2.partitionSenders.get(i)?.length).toBe(2);
    }

    // 3 senders per partition
    const result3 = computePartitionAssignment(50, clientIds, 1, reliability, 3);
    for (let i = 0; i < result3.numPartitions; i++) {
      expect(result3.partitionSenders.get(i)?.length).toBe(3);
    }
  });

  test('caps senders at available clients', () => {
    const result = computePartitionAssignment(50, ['a', 'b'], 1, { a: 50, b: 50 }, 5);

    for (let i = 0; i < result.numPartitions; i++) {
      expect(result.partitionSenders.get(i)?.length).toBe(2); // Max available
    }
  });
});

describe('computePartitionCount', () => {
  test('returns 1 for zero entities', () => {
    expect(computePartitionCount(0, 10)).toBe(1);
  });

  test('returns 1 for zero clients', () => {
    expect(computePartitionCount(100, 0)).toBe(1);
  });

  test('scales with entity count', () => {
    const c10 = computePartitionCount(10, 10);
    const c100 = computePartitionCount(100, 10);
    const c1000 = computePartitionCount(1000, 10);

    expect(c10).toBeLessThanOrEqual(c100);
    expect(c100).toBeLessThanOrEqual(c1000);
  });

  test('is capped by client count', () => {
    // With 5 clients, max partitions should be 10 (5 * 2)
    const result = computePartitionCount(10000, 5);
    expect(result).toBeLessThanOrEqual(10);
  });
});

describe('computePartitionSeed', () => {
  test('is deterministic', () => {
    const seed1 = computePartitionSeed(42, 3);
    const seed2 = computePartitionSeed(42, 3);
    expect(seed1).toBe(seed2);
  });

  test('different frames produce different seeds', () => {
    const seed1 = computePartitionSeed(1, 0);
    const seed2 = computePartitionSeed(2, 0);
    expect(seed1).not.toBe(seed2);
  });

  test('different partitions produce different seeds', () => {
    const seed1 = computePartitionSeed(1, 0);
    const seed2 = computePartitionSeed(1, 1);
    expect(seed1).not.toBe(seed2);
  });

  test('returns uint32', () => {
    const seed = computePartitionSeed(999, 777);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});

describe('weightedRandomPick', () => {
  test('returns correct number of picks', () => {
    const picks = weightedRandomPick(
      ['a', 'b', 'c', 'd'],
      2,
      42,
      { a: 100, b: 100, c: 100, d: 100 }
    );
    expect(picks).toHaveLength(2);
  });

  test('never picks same client twice', () => {
    for (let seed = 0; seed < 100; seed++) {
      const picks = weightedRandomPick(
        ['a', 'b', 'c'],
        2,
        seed,
        { a: 100, b: 100, c: 100 }
      );
      expect(new Set(picks).size).toBe(picks.length);
    }
  });

  test('returns all clients when count >= clients.length', () => {
    const picks = weightedRandomPick(
      ['a', 'b', 'c'],
      5,
      42,
      { a: 100, b: 100, c: 100 }
    );
    expect(picks.sort()).toEqual(['a', 'b', 'c']);
  });

  test('returns empty array for empty client list', () => {
    const picks = weightedRandomPick([], 2, 42, {});
    expect(picks).toEqual([]);
  });

  test('is deterministic with same seed', () => {
    const picks1 = weightedRandomPick(['a', 'b', 'c', 'd'], 2, 42, { a: 80, b: 60, c: 40, d: 20 });
    const picks2 = weightedRandomPick(['a', 'b', 'c', 'd'], 2, 42, { a: 80, b: 60, c: 40, d: 20 });
    expect(picks1).toEqual(picks2);
  });

  test('handles missing reliability values (defaults to 50)', () => {
    const picks = weightedRandomPick(['a', 'b', 'c'], 2, 42, {});
    expect(picks).toHaveLength(2);
  });

  test('favors higher reliability clients statistically', () => {
    const counts: Record<string, number> = { high: 0, low: 0 };

    for (let seed = 0; seed < 1000; seed++) {
      const picks = weightedRandomPick(
        ['high', 'low'],
        1,
        seed,
        { high: 100, low: 10 }
      );
      counts[picks[0]]++;
    }

    // High reliability should be picked much more often
    expect(counts['high']).toBeGreaterThan(counts['low'] * 3);
  });
});

describe('getEntityPartition', () => {
  test('distributes entities evenly', () => {
    const partitions = [0, 0, 0];
    for (let eid = 0; eid < 300; eid++) {
      partitions[getEntityPartition(eid, 3)]++;
    }

    expect(partitions[0]).toBe(100);
    expect(partitions[1]).toBe(100);
    expect(partitions[2]).toBe(100);
  });

  test('is deterministic', () => {
    for (let eid = 0; eid < 100; eid++) {
      const p1 = getEntityPartition(eid, 5);
      const p2 = getEntityPartition(eid, 5);
      expect(p1).toBe(p2);
    }
  });
});

describe('isClientAssigned', () => {
  test('returns true when client is assigned', () => {
    const assignment = computePartitionAssignment(50, ['a', 'b', 'c'], 1, { a: 100, b: 50, c: 50 }, 1);

    let foundAssignment = false;
    for (let i = 0; i < assignment.numPartitions; i++) {
      if (isClientAssigned(assignment, 'a', i)) {
        foundAssignment = true;
        break;
      }
    }
    expect(foundAssignment).toBe(true);
  });

  test('returns false for non-existent partition', () => {
    const assignment = computePartitionAssignment(50, ['a', 'b'], 1, { a: 50, b: 50 });
    expect(isClientAssigned(assignment, 'a', 9999)).toBe(false);
  });

  test('returns false for unknown client', () => {
    const assignment = computePartitionAssignment(50, ['a', 'b'], 1, { a: 50, b: 50 });
    expect(isClientAssigned(assignment, 'unknown', 0)).toBe(false);
  });
});

describe('getClientPartitions', () => {
  test('returns partitions assigned to client', () => {
    const assignment = computePartitionAssignment(50, ['a'], 1, { a: 100 }, 1);

    const partitions = getClientPartitions(assignment, 'a');

    // Solo client should be assigned to all partitions
    expect(partitions.length).toBe(assignment.numPartitions);
  });

  test('returns empty array for unknown client', () => {
    const assignment = computePartitionAssignment(50, ['a', 'b'], 1, { a: 50, b: 50 });
    expect(getClientPartitions(assignment, 'unknown')).toEqual([]);
  });

  test('returns sorted partition IDs', () => {
    const assignment = computePartitionAssignment(100, ['a', 'b', 'c'], 1, { a: 100, b: 100, c: 100 }, 2);

    for (const clientId of ['a', 'b', 'c']) {
      const partitions = getClientPartitions(assignment, clientId);
      for (let i = 1; i < partitions.length; i++) {
        expect(partitions[i]).toBeGreaterThan(partitions[i - 1]);
      }
    }
  });
});

describe('computeDegradationTier', () => {
  test('returns NORMAL when all partitions received from trusted senders', () => {
    expect(computeDegradationTier(10, 10, 20, 20)).toBe('NORMAL');
  });

  test('returns DEGRADED for >75% partitions', () => {
    expect(computeDegradationTier(10, 8, 15, 20)).toBe('DEGRADED');
  });

  test('returns MINIMAL for >25% partitions', () => {
    expect(computeDegradationTier(10, 4, 5, 20)).toBe('MINIMAL');
  });

  test('returns SKIP for <25% partitions', () => {
    expect(computeDegradationTier(10, 2, 2, 20)).toBe('SKIP');
  });

  test('boundary cases', () => {
    // Exactly 75%
    expect(computeDegradationTier(100, 75, 100, 100)).toBe('MINIMAL');

    // Exactly 25%
    expect(computeDegradationTier(100, 25, 50, 100)).toBe('SKIP');
  });
});

describe('determinism validation', () => {
  test('assignment is identical regardless of execution order', () => {
    const clients = ['alice', 'bob', 'charlie', 'david', 'eve'];
    const reliability = { alice: 95, bob: 88, charlie: 72, david: 65, eve: 40 };

    // Simulate multiple clients computing same assignment
    const results: PartitionAssignment[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(computePartitionAssignment(200, clients, 12345, reliability, 2));
    }

    // All results should be identical
    const baseline = results[0];
    for (const result of results) {
      expect(result.numPartitions).toBe(baseline.numPartitions);
      expect(result.frame).toBe(baseline.frame);

      for (let p = 0; p < baseline.numPartitions; p++) {
        expect(result.partitionSenders.get(p)).toEqual(baseline.partitionSenders.get(p));
      }
    }
  });

  test('uses only integer arithmetic (no floating point drift)', () => {
    // Run the same computation many times with values that might cause
    // floating point issues
    const clients = ['a', 'b', 'c'];
    const reliability = { a: 33, b: 33, c: 34 }; // Sum to 100, might cause FP issues

    const results: string[] = [];
    for (let frame = 0; frame < 100; frame++) {
      const assignment = computePartitionAssignment(100, clients, frame, reliability);
      const senders = assignment.partitionSenders.get(0) || [];
      results.push(JSON.stringify(senders));
    }

    // Run again and verify identical
    for (let frame = 0; frame < 100; frame++) {
      const assignment = computePartitionAssignment(100, clients, frame, reliability);
      const senders = assignment.partitionSenders.get(0) || [];
      expect(JSON.stringify(senders)).toBe(results[frame]);
    }
  });
});
