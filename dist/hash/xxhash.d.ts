/**
 * xxHash32 - Fast non-cryptographic hash function
 * Pure JavaScript implementation for determinism across platforms
 *
 * Based on the xxHash specification: https://github.com/Cyan4973/xxHash
 */
/**
 * Compute xxHash32 of a byte array
 * @param data Input byte array
 * @param seed Optional seed value (default: 0)
 * @returns 4-byte unsigned integer hash
 */
export declare function xxhash32(data: Uint8Array, seed?: number): number;
/**
 * Compute xxHash32 of a string (UTF-8 encoded)
 * @param str Input string
 * @param seed Optional seed value (default: 0)
 * @returns 4-byte unsigned integer hash
 */
export declare function xxhash32String(str: string, seed?: number): number;
/**
 * Incrementally compute xxHash32 by combining with new data
 * Useful for hashing multiple fields into one hash
 * @param existingHash The current hash value
 * @param newValue New 32-bit value to incorporate
 * @returns Combined hash
 */
export declare function xxhash32Combine(existingHash: number, newValue: number): number;
