import { logger } from './logger.js';

interface ErrorWithCode extends Error {
  code?: string;
}


/**
 * Registers process-level safety handlers to prevent transient peer drops
 * (ECONNRESET, EPIPE, etc.) from crashing background workers or the API server.
 */
export function setupProcessSafety(): void {
  if (typeof process !== 'undefined' && process.on) {
    process.on('uncaughtException', (err: ErrorWithCode) => {
      if (err?.code && ['UTP_ECONNRESET', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(err.code)) {
        logger.debug(`Ignored transient network peer drop (${err.code}): ${err.message}`);
        return;
      }
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });
  }
}

export default setupProcessSafety;
