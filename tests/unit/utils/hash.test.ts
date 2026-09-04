import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calculateOSHash } from '../../../src/main/utils/hash.js';

describe('utils/hash - calculateOSHash', () => {
  let testTempDir: string;

  beforeEach(() => {
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-hash-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  it('should throw an error if the file size is less than 65536 bytes (64KB)', async () => {
    const smallFile = path.join(testTempDir, 'small.bin');
    fs.writeFileSync(smallFile, Buffer.alloc(100)); // 100 bytes

    await expect(calculateOSHash(smallFile)).rejects.toThrow(
      'File is too small for OSHash calculation'
    );
  });

  it('should throw an error for a file with exactly 65535 bytes (64KB - 1 byte)', async () => {
    const boundarySmallFile = path.join(testTempDir, 'boundary-small.bin');
    fs.writeFileSync(boundarySmallFile, Buffer.alloc(65535));

    await expect(calculateOSHash(boundarySmallFile)).rejects.toThrow(
      'File is too small for OSHash calculation'
    );
  });

  it('should throw an error for an empty file (0 bytes)', async () => {
    const emptyFile = path.join(testTempDir, 'empty.bin');
    fs.writeFileSync(emptyFile, Buffer.alloc(0));

    await expect(calculateOSHash(emptyFile)).rejects.toThrow(
      'File is too small for OSHash calculation'
    );
  });

  it('should throw an error if the file does not exist', async () => {
    const nonExistent = path.join(testTempDir, 'non-existent.bin');
    await expect(calculateOSHash(nonExistent)).rejects.toThrow();
  });

  it('should calculate correct hash for exactly 65536 bytes of zeros', async () => {
    const zeroFile = path.join(testTempDir, 'zeros-64k.bin');
    fs.writeFileSync(zeroFile, Buffer.alloc(65536, 0));

    const result = await calculateOSHash(zeroFile);
    expect(result.size).toBe(65536);
    // BigInt(65536) = 0x10000, 16 hex chars = 0000000000010000
    expect(result.hash).toBe('0000000000010000');
  });

  it('should calculate correct hash for 65536 bytes file with repeated 64-bit integer values', async () => {
    const file = path.join(testTempDir, 'ones-64k.bin');
    const buf = Buffer.alloc(65536);
    // Write 1n into each 8-byte chunk (8192 chunks in 64KB)
    for (let i = 0; i < 65536; i += 8) {
      buf.writeBigInt64LE(1n, i);
    }
    fs.writeFileSync(file, buf);

    const result = await calculateOSHash(file);
    expect(result.size).toBe(65536);
    // Buffer is 128KB in hash algorithm (first 64KB + last 64KB read same 64KB)
    // 16384 chunks of 1n = 16384n
    // size = 65536n
    // total = 65536n + 16384n = 81920n = 0x14000
    expect(result.hash).toBe('0000000000014000');
  });

  it('should correctly ignore content in the middle of a file larger than 128KB', async () => {
    const size = 256 * 1024; // 256 KB
    const buf = Buffer.alloc(size);

    // First 64KB filled with 1s (8192 chunks * 1n = 8192n)
    for (let i = 0; i < 65536; i += 8) {
      buf.writeBigInt64LE(1n, i);
    }

    // Middle 128KB filled with arbitrary junk (0xFF) - should be ignored
    for (let i = 65536; i < size - 65536; i++) {
      buf[i] = 0xff;
    }

    // Last 64KB filled with 2s (8192 chunks * 2n = 16384n)
    for (let i = size - 65536; i < size; i += 8) {
      buf.writeBigInt64LE(2n, i);
    }

    const testFile = path.join(testTempDir, 'large-file.bin');
    fs.writeFileSync(testFile, buf);

    const result = await calculateOSHash(testFile);
    expect(result.size).toBe(size);
    // Hash = size (262144n) + first 64KB (8192n) + last 64KB (16384n) = 286720n = 0x46000
    expect(result.hash).toBe('0000000000046000');
  });

  it('should correctly handle 64-bit integer overflow wrapping to unsigned 64-bit hex', async () => {
    const size = 65536;
    const buf = Buffer.alloc(size);
    // Write large positive values to provoke 64-bit overflow
    // 0x7fffffffffffffffn into each 8-byte chunk
    for (let i = 0; i < size; i += 8) {
      buf.writeBigInt64LE(0x7fffffffffffffffn, i);
    }

    const overflowFile = path.join(testTempDir, 'overflow.bin');
    fs.writeFileSync(overflowFile, buf);

    const result = await calculateOSHash(overflowFile);
    expect(result.size).toBe(size);
    expect(result.hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(result.hash)).toBe(true);

    // Compute expected manual calculation:
    // 16384 chunks * 0x7fffffffffffffffn
    let expectedHash = BigInt(size);
    for (let i = 0; i < 16384; i++) {
      expectedHash += 0x7fffffffffffffffn;
    }
    const unsignedExpected = (expectedHash & 0xffffffffffffffffn).toString(16).padStart(16, '0');
    expect(result.hash).toBe(unsignedExpected);
  });

  it('should return a 16-character padded lowercase hex string', async () => {
    const file = path.join(testTempDir, 'hex-format.bin');
    fs.writeFileSync(file, Buffer.alloc(100000, 0x05));

    const result = await calculateOSHash(file);
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.size).toBe(100000);
  });
});
