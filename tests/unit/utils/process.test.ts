import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupProcessSafety } from '../../../src/main/utils/process.js';
import { logger } from '../../../src/main/utils/logger.js';

describe('utils/process', () => {
  let uncaughtHandler: (err: any) => void;
  let unhandledRejectionHandler: (reason: any) => void;
  let exitMock: any;
  let loggerDebugMock: any;
  let loggerErrorMock: any;

  beforeEach(() => {
    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    loggerDebugMock = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    loggerErrorMock = vi.spyOn(logger, 'error').mockImplementation(() => {});

    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: any) => {
      if (event === 'uncaughtException') {
        uncaughtHandler = handler;
      }
      if (event === 'unhandledRejection') {
        unhandledRejectionHandler = handler;
      }
      return process;
    }) as any);

    setupProcessSafety();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register uncaughtException handler on process', () => {
    expect(uncaughtHandler).toBeDefined();
  });

  it('should ignore AbortError without exiting process', () => {
    const abortErr = new Error('This operation was aborted');
    abortErr.name = 'AbortError';

    uncaughtHandler(abortErr);

    expect(loggerDebugMock).toHaveBeenCalledWith(
      expect.stringContaining('Ignored transient network/abort error (AbortError)')
    );
    expect(exitMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('should ignore DOMException AbortError', () => {
    const domAbortErr = new DOMException('This operation was aborted', 'AbortError');

    uncaughtHandler(domAbortErr);

    expect(loggerDebugMock).toHaveBeenCalledWith(
      expect.stringContaining('Ignored transient network/abort error (AbortError)')
    );
    expect(exitMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('should ignore transient network error codes (ECONNRESET, EPIPE, etc.)', () => {
    const transientCodes = ['UTP_ECONNRESET', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECANCELED', 'ECONNABORTED', 'ABORT_ERR'];

    for (const code of transientCodes) {
      const err = new Error(`Connection issue: ${code}`) as any;
      err.code = code;

      uncaughtHandler(err);

      expect(loggerDebugMock).toHaveBeenCalledWith(
        expect.stringContaining(`Ignored transient network/abort error (${code})`)
      );
      expect(exitMock).not.toHaveBeenCalled();
    }
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('should log error and exit process for genuine uncaught exceptions', () => {
    const fatalErr = new Error('Critical unexpected crash');

    uncaughtHandler(fatalErr);

    expect(loggerErrorMock).toHaveBeenCalledWith('Uncaught Exception:', fatalErr);
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  describe('unhandledRejection', () => {
    it('should register unhandledRejection handler on process', () => {
      expect(unhandledRejectionHandler).toBeDefined();
    });

    it('should ignore transient AbortError rejections', () => {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';

      unhandledRejectionHandler(abortErr);

      expect(loggerDebugMock).toHaveBeenCalledWith(
        expect.stringContaining('Ignored transient network/abort unhandled rejection (AbortError)')
      );
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    it('should log error on genuine unhandled rejections without calling process.exit', () => {
      const fatalErr = new Error('Unhandled Promise Failure');

      unhandledRejectionHandler(fatalErr);

      expect(loggerErrorMock).toHaveBeenCalledWith('Unhandled Rejection:', fatalErr);
      expect(exitMock).not.toHaveBeenCalled();
    });
  });
});
