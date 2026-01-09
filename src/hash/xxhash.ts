/**
 * xxHash32 - Fast non-cryptographic hash function
 * Pure JavaScript implementation for determinism across platforms
 *
 * Based on the xxHash specification: https://github.com/Cyan4973/xxHash
 */

// xxHash32 prime constants
const PRIME32_1 = 0x9E3779B1 >>> 0;
const PRIME32_2 = 0x85EBCA77 >>> 0;
const PRIME32_3 = 0xC2B2AE3D >>> 0;
const PRIME32_4 = 0x27D4EB2F >>> 0;
const PRIME32_5 = 0x165667B1 >>> 0;

/**
 * 32-bit unsigned addition with overflow handling
 */
function add32(a: number, b: number): number {
  return ((a >>> 0) + (b >>> 0)) >>> 0;
}

/**
 * 32-bit unsigned multiplication (lower 32 bits of result)
 */
function mul32(a: number, b: number): number {
  const al = a & 0xFFFF;
  const ah = a >>> 16;
  const bl = b & 0xFFFF;
  const bh = b >>> 16;

  const ll = al * bl;
  const lh = al * bh;
  const hl = ah * bl;

  return ((ll + ((lh + hl) << 16)) >>> 0);
}

/**
 * 32-bit left rotation
 */
function rotl32(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/**
 * Read 32-bit little-endian value from byte array
 */
function readU32LE(data: Uint8Array, offset: number): number {
  return (data[offset] |
          (data[offset + 1] << 8) |
          (data[offset + 2] << 16) |
          (data[offset + 3] << 24)) >>> 0;
}

/**
 * xxHash32 round function
 */
function round(acc: number, input: number): number {
  acc = add32(acc, mul32(input, PRIME32_2));
  acc = rotl32(acc, 13);
  acc = mul32(acc, PRIME32_1);
  return acc;
}

/**
 * Compute xxHash32 of a byte array
 * @param data Input byte array
 * @param seed Optional seed value (default: 0)
 * @returns 4-byte unsigned integer hash
 */
export function xxhash32(data: Uint8Array, seed: number = 0): number {
  seed = seed >>> 0;
  const len = data.length;
  let h32: number;
  let i = 0;

  if (len >= 16) {
    // Initialize 4 accumulators
    let v1 = add32(add32(seed, PRIME32_1), PRIME32_2);
    let v2 = add32(seed, PRIME32_2);
    let v3 = seed;
    let v4 = (seed - PRIME32_1) >>> 0;

    // Process 16-byte blocks
    const limit = len - 16;
    do {
      v1 = round(v1, readU32LE(data, i)); i += 4;
      v2 = round(v2, readU32LE(data, i)); i += 4;
      v3 = round(v3, readU32LE(data, i)); i += 4;
      v4 = round(v4, readU32LE(data, i)); i += 4;
    } while (i <= limit);

    // Merge accumulators
    h32 = rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18);
    h32 = h32 >>> 0;
  } else {
    h32 = add32(seed, PRIME32_5);
  }

  h32 = add32(h32, len);

  // Process remaining 4-byte chunks
  while (i + 4 <= len) {
    h32 = add32(h32, mul32(readU32LE(data, i), PRIME32_3));
    h32 = mul32(rotl32(h32, 17), PRIME32_4);
    i += 4;
  }

  // Process remaining bytes
  while (i < len) {
    h32 = add32(h32, mul32(data[i], PRIME32_5));
    h32 = mul32(rotl32(h32, 11), PRIME32_1);
    i++;
  }

  // Final avalanche
  h32 ^= h32 >>> 15;
  h32 = mul32(h32, PRIME32_2);
  h32 ^= h32 >>> 13;
  h32 = mul32(h32, PRIME32_3);
  h32 ^= h32 >>> 16;

  return h32 >>> 0;
}

/**
 * Compute xxHash32 of a string (UTF-8 encoded)
 * @param str Input string
 * @param seed Optional seed value (default: 0)
 * @returns 4-byte unsigned integer hash
 */
export function xxhash32String(str: string, seed: number = 0): number {
  const encoder = new TextEncoder();
  return xxhash32(encoder.encode(str), seed);
}

/**
 * Incrementally compute xxHash32 by combining with new data
 * Useful for hashing multiple fields into one hash
 * @param existingHash The current hash value
 * @param newValue New 32-bit value to incorporate
 * @returns Combined hash
 */
export function xxhash32Combine(existingHash: number, newValue: number): number {
  let h = add32(existingHash, mul32(newValue >>> 0, PRIME32_3));
  h = mul32(rotl32(h, 17), PRIME32_4);
  h ^= h >>> 15;
  h = mul32(h, PRIME32_2);
  h ^= h >>> 13;
  h = mul32(h, PRIME32_3);
  h ^= h >>> 16;
  return h >>> 0;
}
