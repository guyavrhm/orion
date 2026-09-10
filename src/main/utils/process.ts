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
    const isTransient = (err: any): boolean => {
      const isAbort = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
      const isNet =
        err?.code &&
        ['UTP_ECONNRESET', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECANCELED', 'ECONNABORTED'].includes(err.code);
      return Boolean(isAbort || isNet);
    };

    process.on('uncaughtException', (err: ErrorWithCode) => {
      if (isTransient(err)) {
        const identifier = (err?.code && typeof err.code === 'string') ? err.code : (err?.name || 'AbortError');
        logger.debug(`Ignored transient network/abort error (${identifier}): ${err.message}`);
        return;
      }
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: any) => {
      if (isTransient(reason)) {
        const identifier = (reason?.code && typeof reason.code === 'string') ? reason.code : (reason?.name || 'AbortError');
        logger.debug(`Ignored transient network/abort unhandled rejection (${identifier}): ${reason?.message || reason}`);
        return;
      }
      logger.error('Unhandled Rejection:', reason);
    });
  }
}

export default setupProcessSafety;
