import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { USER_DATA_PATH } from '../utils/paths.js';

if (!fs.existsSync(USER_DATA_PATH)) {
  fs.mkdirSync(USER_DATA_PATH, { recursive: true });
}

const dbPath = path.join(USER_DATA_PATH, 'orion.db');
const db = new DatabaseSync(dbPath);

// Enable Write-Ahead Logging for SQLite concurrency and enforce foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// Initialize tables and indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS movie_metadata (
    id TEXT PRIMARY KEY,
    title TEXT,
    year TEXT,
    released TEXT,
    genres TEXT,
    poster TEXT,
    background TEXT,
    logo TEXT,
    imdb_rating TEXT,
    runtime TEXT,
    description TEXT,
    awards TEXT,
    cast TEXT,
    director TEXT,
    writer TEXT,
    country TEXT,
    dvdRelease TEXT,
    moviedb_id INTEGER,
    popularity REAL,
    last_fetched INTEGER
  );

  CREATE TABLE IF NOT EXISTS show_metadata (
    id TEXT PRIMARY KEY,
    title TEXT,
    year TEXT,
    released TEXT,
    genres TEXT,
    poster TEXT,
    background TEXT,
    logo TEXT,
    imdb_rating TEXT,
    runtime TEXT,
    description TEXT,
    awards TEXT,
    cast TEXT,
    director TEXT,
    writer TEXT,
    country TEXT,
    status TEXT,
    tvdb_id INTEGER,
    moviedb_id INTEGER,
    popularity REAL,
    last_fetched INTEGER
  );

  CREATE TABLE IF NOT EXISTS episode_metadata (
    id TEXT PRIMARY KEY,
    show_id TEXT REFERENCES show_metadata(id) ON DELETE CASCADE,
    season INTEGER,
    episode INTEGER,
    name TEXT,
    description TEXT,
    thumbnail TEXT,
    released TEXT,
    rating TEXT,
    tvdb_id INTEGER,
    runtime INTEGER,
    UNIQUE(show_id, season, episode)
  );

  CREATE TABLE IF NOT EXISTS movie_progress (
    movie_id TEXT PRIMARY KEY REFERENCES movie_metadata(id) ON DELETE CASCADE,
    timestamp REAL,
    runtime INTEGER,
    last_updated INTEGER
  );

  CREATE TABLE IF NOT EXISTS episode_progress (
    episode_id TEXT PRIMARY KEY REFERENCES episode_metadata(id) ON DELETE CASCADE,
    timestamp REAL,
    runtime INTEGER,
    last_updated INTEGER
  );

  CREATE TABLE IF NOT EXISTS movie_downloads (
    movie_id TEXT PRIMARY KEY REFERENCES movie_metadata(id) ON DELETE CASCADE,
    fileName TEXT,
    torrentHash TEXT,
    fileHash TEXT,
    fileIdx INTEGER,
    quality TEXT,
    sizeBytes INTEGER,
    downloadTime INTEGER
  );

  CREATE TABLE IF NOT EXISTS episode_downloads (
    episode_id TEXT PRIMARY KEY REFERENCES episode_metadata(id) ON DELETE CASCADE,
    fileName TEXT,
    torrentHash TEXT,
    fileHash TEXT,
    fileIdx INTEGER,
    quality TEXT,
    sizeBytes INTEGER,
    downloadTime INTEGER
  );

  CREATE TABLE IF NOT EXISTS subtitle_preferences (
    media_id TEXT PRIMARY KEY,
    subtitle_lang TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_movie_progress_last_updated ON movie_progress(last_updated DESC);
  CREATE INDEX IF NOT EXISTS idx_episode_progress_last_updated ON episode_progress(last_updated DESC);
  CREATE INDEX IF NOT EXISTS idx_episode_metadata_lookup ON episode_metadata(show_id, season, episode);
  CREATE INDEX IF NOT EXISTS idx_movie_downloads_time ON movie_downloads(downloadTime DESC);
  CREATE INDEX IF NOT EXISTS idx_episode_downloads_time ON episode_downloads(downloadTime DESC);
`);

logger.info(`Database connection established and schema verified at: ${dbPath}`);

export { db };
export default db;
