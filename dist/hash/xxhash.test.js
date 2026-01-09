import { describe, test, expect } from 'vitest';
import { xxhash32, xxhash32String, xxhash32Combine } from './xxhash';
describe('xxhash32', () => {
    // Determinism - same input always produces same output
    test('produces consistent output for same input', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const hash1 = xxhash32(data);
        const hash2 = xxhash32(data);
        expect(hash1).toBe(hash2);
    });
    // Known test vectors from xxHash reference implementation
    // Source: https://github.com/Cyan4973/xxHash/blob/dev/cli/xsum_sanity_check.c
    test('empty input with seed 0', () => {
        const hash = xxhash32(new Uint8Array([]), 0);
        expect(hash).toBe(0x02CC5D05);
    });
    test('empty input with seed 1', () => {
        const hash = xxhash32(new Uint8Array([]), 1);
        expect(hash).toBe(0x0B2CB792);
    });
    // Single byte test
    test('single byte', () => {
        const hash = xxhash32(new Uint8Array([0x42]), 0);
        // Verify it's a valid uint32
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
    });
    // Short inputs (less than 16 bytes - uses different code path)
    test('short input (4 bytes)', () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const hash1 = xxhash32(data);
        const hash2 = xxhash32(data);
        expect(hash1).toBe(hash2);
        expect(hash1).not.toBe(0);
    });
    test('short input (15 bytes)', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        const hash1 = xxhash32(data);
        const hash2 = xxhash32(data);
        expect(hash1).toBe(hash2);
    });
    // Longer inputs (16+ bytes - uses accumulator code path)
    test('16 bytes exactly (triggers block processing)', () => {
        const data = new Uint8Array(16).fill(0xAA);
        const hash1 = xxhash32(data);
        const hash2 = xxhash32(data);
        expect(hash1).toBe(hash2);
    });
    test('32 bytes (two full blocks)', () => {
        const data = new Uint8Array(32);
        for (let i = 0; i < 32; i++)
            data[i] = i;
        const hash1 = xxhash32(data);
        const hash2 = xxhash32(data);
        expect(hash1).toBe(hash2);
    });
    test('100 bytes', () => {
        const data = new Uint8Array(100);
        for (let i = 0; i < 100; i++)
            data[i] = i % 256;
        const hash1 = xxhash32(data);
        const hash2 = xxhash32(data);
        expect(hash1).toBe(hash2);
    });
    // Seed affects output
    test('different seeds produce different hashes', () => {
        const data = new Uint8Array([1, 2, 3]);
        const hash0 = xxhash32(data, 0);
        const hash1 = xxhash32(data, 1);
        const hash42 = xxhash32(data, 42);
        expect(hash0).not.toBe(hash1);
        expect(hash0).not.toBe(hash42);
        expect(hash1).not.toBe(hash42);
    });
    // Same seed is deterministic
    test('same seed produces same hash', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        expect(xxhash32(data, 42)).toBe(xxhash32(data, 42));
        expect(xxhash32(data, 0xDEADBEEF)).toBe(xxhash32(data, 0xDEADBEEF));
    });
    // Different data produces different hashes
    test('different data produces different hashes', () => {
        const data1 = new Uint8Array([1, 2, 3]);
        const data2 = new Uint8Array([1, 2, 4]);
        const data3 = new Uint8Array([1, 2, 3, 4]);
        expect(xxhash32(data1)).not.toBe(xxhash32(data2));
        expect(xxhash32(data1)).not.toBe(xxhash32(data3));
    });
    // Returns 4-byte unsigned integer
    test('returns value in uint32 range', () => {
        const testCases = [
            new Uint8Array([]),
            new Uint8Array([1]),
            new Uint8Array([1, 2, 3, 4, 5]),
            new Uint8Array(100).fill(0xFF),
            new Uint8Array(1000).fill(0x42),
        ];
        for (const data of testCases) {
            const hash = xxhash32(data);
            expect(typeof hash).toBe('number');
            expect(hash).toBeGreaterThanOrEqual(0);
            expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
            expect(Number.isInteger(hash)).toBe(true);
        }
    });
    // Avalanche effect - small input changes affect output significantly
    test('avalanche effect - single bit change affects output', () => {
        const data1 = new Uint8Array([0b00000000]);
        const data2 = new Uint8Array([0b00000001]);
        const hash1 = xxhash32(data1);
        const hash2 = xxhash32(data2);
        // Count differing bits
        const xor = hash1 ^ hash2;
        let diffBits = 0;
        for (let i = 0; i < 32; i++) {
            if ((xor >> i) & 1)
                diffBits++;
        }
        // Good hash should have roughly half the bits differ (8-24 bits typically)
        expect(diffBits).toBeGreaterThan(4);
    });
});
describe('xxhash32String', () => {
    test('produces consistent results', () => {
        expect(xxhash32String('hello')).toBe(xxhash32String('hello'));
        expect(xxhash32String('world')).toBe(xxhash32String('world'));
    });
    test('different strings produce different hashes', () => {
        expect(xxhash32String('hello')).not.toBe(xxhash32String('world'));
        expect(xxhash32String('hello')).not.toBe(xxhash32String('Hello'));
        expect(xxhash32String('test')).not.toBe(xxhash32String('TEST'));
    });
    test('empty string', () => {
        const hash = xxhash32String('');
        expect(hash).toBe(xxhash32(new Uint8Array([]), 0));
        expect(hash).toBe(0x02CC5D05);
    });
    test('returns uint32', () => {
        const hash = xxhash32String('test string with some content');
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
    });
    test('handles unicode correctly', () => {
        const hash1 = xxhash32String('日本語');
        const hash2 = xxhash32String('日本語');
        const hash3 = xxhash32String('中文');
        expect(hash1).toBe(hash2);
        expect(hash1).not.toBe(hash3);
    });
    test('seed parameter works', () => {
        const hash0 = xxhash32String('test', 0);
        const hash1 = xxhash32String('test', 1);
        expect(hash0).not.toBe(hash1);
    });
});
describe('xxhash32Combine', () => {
    test('combines hashes deterministically', () => {
        const base = xxhash32String('base');
        const combined1 = xxhash32Combine(base, 42);
        const combined2 = xxhash32Combine(base, 42);
        expect(combined1).toBe(combined2);
    });
    test('different values produce different results', () => {
        const base = xxhash32String('base');
        const combined1 = xxhash32Combine(base, 1);
        const combined2 = xxhash32Combine(base, 2);
        expect(combined1).not.toBe(combined2);
    });
    test('different base hashes produce different results', () => {
        const base1 = xxhash32String('base1');
        const base2 = xxhash32String('base2');
        const combined1 = xxhash32Combine(base1, 42);
        const combined2 = xxhash32Combine(base2, 42);
        expect(combined1).not.toBe(combined2);
    });
    test('returns uint32', () => {
        const combined = xxhash32Combine(0xDEADBEEF, 0x12345678);
        expect(combined).toBeGreaterThanOrEqual(0);
        expect(combined).toBeLessThanOrEqual(0xFFFFFFFF);
    });
    test('can chain multiple combines', () => {
        let hash = xxhash32String('initial');
        hash = xxhash32Combine(hash, 1);
        hash = xxhash32Combine(hash, 2);
        hash = xxhash32Combine(hash, 3);
        // Should be deterministic
        let hash2 = xxhash32String('initial');
        hash2 = xxhash32Combine(hash2, 1);
        hash2 = xxhash32Combine(hash2, 2);
        hash2 = xxhash32Combine(hash2, 3);
        expect(hash).toBe(hash2);
    });
});
// Cross-platform determinism test
describe('determinism', () => {
    test('hash is consistent across multiple runs', () => {
        // These values should be the same every time
        const testCases = [
            [new Uint8Array([]), 0, 0x02CC5D05],
            [new Uint8Array([]), 1, 0x0B2CB792],
        ];
        for (const [input, seed, expected] of testCases) {
            if (input instanceof Uint8Array) {
                expect(xxhash32(input, seed)).toBe(expected);
            }
        }
    });
});
