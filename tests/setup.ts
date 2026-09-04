import { afterAll, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Create isolated temporary directory for test runs
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-test-'));

process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.ORION_DATA_DIR = testDataDir;
process.env.TORRENT_MOVIE_PROVIDERS = 'https://api.mockmovies.org/torrents';
process.env.TORRENT_SHOW_PROVIDERS = 'https://api.mockshows.org/torrents';

afterAll(async () => {
  // Global test teardown
  vi.restoreAllMocks();
  try {
    const { db } = await import('../src/main/db/index.js');
    db.close();
  } catch (_) {}
  try {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  } catch (_) {}
});
