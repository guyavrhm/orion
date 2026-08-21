import express, { type Request, type Response, type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getMediaDirs } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

const router: Router = express.Router();

export interface HlsParams {
  id: string;
  filename: string;
}

export interface SubtitleParams {
  fileId: string;
  filename: string;
}

// HLS Stream static file server
router.get('/stream/hls/:id/:filename', (req: Request<HlsParams>, res: Response) => {
  const { id, filename } = req.params;
  const dirs = getMediaDirs(id);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (dirs) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(dirs.hlsDir, safeFilename);

    if (fs.existsSync(filePath)) {
      if (safeFilename.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (safeFilename.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/MP2T');
      }
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  logger.warn(`HLS stream file request 404: id=${id}, file=${filename}`);
  res.status(404).send('File not found');
});

// VTT Subtitles static file server
router.get('/subtitles/:fileId/:filename', (req: Request<SubtitleParams>, res: Response) => {
  const { fileId, filename } = req.params;
  const dirs = getMediaDirs(fileId);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (dirs) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(dirs.subtitlesDir, safeFilename);

    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/vtt');
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  logger.warn(`Subtitles file request 404: fileId=${fileId}, file=${filename}`);
  res.status(404).send('Subtitle not found');
});

export default router;
