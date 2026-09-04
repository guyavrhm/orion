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
db.exec('PRAGMA recursive_triggers = ON;');
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

  CREATE TABLE IF NOT EXISTS progress (
    id TEXT PRIMARY KEY,
    show_id TEXT,
    timestamp REAL NOT NULL,
    runtime INTEGER NOT NULL,
    last_updated INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS streams (
    id TEXT PRIMARY KEY,
    show_id TEXT,
    size_bytes INTEGER NOT NULL,
    quality TEXT,
    ready_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subtitle_preferences (
    id TEXT PRIMARY KEY,
    subtitle_lang TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_progress_last_updated ON progress(last_updated DESC);
  CREATE INDEX IF NOT EXISTS idx_progress_show_id ON progress(show_id);
  CREATE INDEX IF NOT EXISTS idx_streams_ready_at ON streams(ready_at DESC);
  CREATE INDEX IF NOT EXISTS idx_streams_show_id ON streams(show_id);
  CREATE INDEX IF NOT EXISTS idx_episode_metadata_lookup ON episode_metadata(show_id, season, episode);

  -- Cascade delete triggers for unified tables
  CREATE TRIGGER IF NOT EXISTS trg_delete_movie_cascade AFTER DELETE ON movie_metadata
  BEGIN
    DELETE FROM streams WHERE id = OLD.id;
    DELETE FROM progress WHERE id = OLD.id;
    DELETE FROM subtitle_preferences WHERE id = OLD.id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_delete_show_cascade AFTER DELETE ON show_metadata
  BEGIN
    DELETE FROM streams WHERE show_id = OLD.id;
    DELETE FROM progress WHERE show_id = OLD.id;
    DELETE FROM subtitle_preferences WHERE id = OLD.id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_delete_episode_cascade AFTER DELETE ON episode_metadata
  BEGIN
    DELETE FROM streams WHERE id = OLD.id;
    DELETE FROM progress WHERE id = OLD.id;
    DELETE FROM subtitle_preferences WHERE id = OLD.id;
  END;
`);

logger.info(`Database connection established and schema verified at: ${dbPath}`);

export { db };
export default db;
