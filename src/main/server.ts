import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { sseManager } from './sse/index.js';
import {
  downloadQueue,
  transcodeQueue,
  subtitleQueue,
  finalizeQueue,
  flowProducer
} from './queues/index.js';
import { redisPublisher } from './config/redis.js';
import { startWorkers, stopWorkers } from './workers/index.js';
import apiRouter from './routes/api.js';
import streamRouter from './routes/stream.js';
import { logger } from './utils/logger.js';
import { setupProcessSafety } from './utils/process.js';
import { ErrorCode, type ErrorCodeType, type ErrorResponseBody } from './types/index.js';

setupProcessSafety();

const app: Express = express();
const PORT: number | string = process.env.PORT || 3000;

// Optional in-process worker initialization for single-process local dev or testing
const isAllInOne: boolean = process.argv.includes('--all-in-one');

if (isAllInOne) {
  logger.info('Starting workers in-process (--all-in-one)...');
  startWorkers().catch((err: Error) => {
    logger.error('Failed to start in-process workers:', err);
  });
}

// Global CORS Middleware
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Middleware for JSON body parsing
app.use(express.json());

// Serve frontend build output directory and public assets
app.use(express.static('dist'));
app.use('/assets', express.static('public/assets'));
app.use(express.static('public'));

// Mount stream and subtitle serving routes (/stream, /subtitles)
app.use(streamRouter);

// Server-Sent Events (SSE) channel route (/events)
app.get('/events', (req: Request, res: Response) => {
  sseManager.registerClient(req, res);
});

// Mount REST API routes (/api)
app.use(apiRouter);

// Fallback to index.html for client-side routing
app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/stream') ||
    req.path.startsWith('/events') ||
    req.path.startsWith('/subtitles')
  ) {
    return next();
  }
  const indexPath = process.env.NODE_ENV !== 'development' && fs.existsSync(path.resolve('dist/index.html'))
    ? path.resolve('dist/index.html')
    : path.resolve('index.html');
  res.sendFile(indexPath);
});

// Centralized Express global error handling middleware (Leak-free: returns canonical error tokens only)
app.use((err: Error & { status?: number; code?: ErrorCodeType }, req: Request, res: Response<ErrorResponseBody>, _next: NextFunction) => {
  logger.error(`Express Route Error: ${req.method} ${req.path}`, err);
  const status = typeof err.status === 'number' && err.status >= 400
    ? err.status
    : (res.statusCode >= 400 ? res.statusCode : 500);

  // Leak-free: strictly send canonical error code (e.g. 'INTERNAL_ERROR', 'BAD_REQUEST', 'NO_STREAMS_FOUND')
  // Internal server error messages, SQL queries, or stack traces are logged on the server and not sent to the client.
  const errorCode: ErrorCodeType = err.code || (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST);
  res.status(status).json({
    error: errorCode
  });
});

// Listen to the port
const httpServer: Server = app.listen(PORT, () => {
  logger.info(`Orion Server is running on: http://localhost:${PORT}`);
  if (isAllInOne) {
    logger.info('Orion running in all-in-one mode (API server + background workers).');
  } else {
    logger.info('Orion running in stateless API mode (workers run in separate processes).');
  }
});

// Graceful shutdown handling
let isShuttingDown = false;

const handleGracefulShutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initializing graceful shutdown...`);

  httpServer.close(async () => {
    logger.info('Express HTTP server closed.');
    try {
      if (isAllInOne) {
        await stopWorkers();
      }
      await sseManager.destroy();
      await Promise.allSettled([
        downloadQueue.close(),
        transcodeQueue.close(),
        subtitleQueue.close(),
        finalizeQueue.close(),
        flowProducer.close(),
        redisPublisher.quit()
      ]);
      logger.info('Graceful shutdown completed.');
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
    }
    process.exit(0);
  });

  // Force close after 10s if sockets remain hanging
  setTimeout(() => {
    logger.error('Forced shutdown triggered due to hanging client sockets.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

export default app;
