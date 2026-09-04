import fs from 'node:fs';

export interface OSHashResult {
  hash: string;
  size: number;
}

/**
 * Calculates the OpenSubtitles Hash (OSHash) for a local file.
 * @param filePath Path to local media file
 * @returns Hash hex string and total file size in bytes
 */
export async function calculateOSHash(filePath: string): Promise<OSHashResult> {
  const stats = await fs.promises.stat(filePath);
  const size = stats.size;
  
  if (size < 65536) {
    throw new Error(`File is too small for OSHash calculation: ${filePath}`);
  }

  const fd = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(128 * 1024); // 128KB buffer

  try {
    // Read first 64KB
    await fd.read(buffer, 0, 65536, 0);
    // Read last 64KB
    await fd.read(buffer, 65536, 65536, size - 65536);
  } finally {
    await fd.close();
  }

  let hash = BigInt(size);
  for (let i = 0; i < 128 * 1024; i += 8) {
    const chunk = buffer.readBigInt64LE(i);
    hash += chunk;
  }

  const unsignedHash = hash & 0xffffffffffffffffn;
  const hashStr = unsignedHash.toString(16).padStart(16, '0');
  
  return { hash: hashStr, size };
}
