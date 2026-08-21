import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.TORRENT_MOVIE_PROVIDERS = 'https://api.mockmovies.org/torrents';
process.env.TORRENT_SHOW_PROVIDERS = 'https://api.mockshows.org/torrents';

beforeAll(() => {
  // Global test setup
});

afterAll(() => {
  // Global test teardown
  vi.restoreAllMocks();
});
