import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const USER_DATA_PATH: string = path.join(os.homedir(), '.orion');
export const DOWNLOADS_DIR: string = path.join(USER_DATA_PATH, 'downloads');

export const ORION_TEMP: string = path.join(USER_DATA_PATH, 'temp');
export const MOVIES_TEMP: string = path.join(ORION_TEMP, 'movies');
export const SHOWS_TEMP: string = path.join(ORION_TEMP, 'shows');

// Ensure base directories exist
[USER_DATA_PATH, DOWNLOADS_DIR, ORION_TEMP, MOVIES_TEMP, SHOWS_TEMP].forEach((dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});
