import { describe, it, expect } from 'vitest';
import {
  HttpError,
  BadRequestError,
  NotFoundError,
  BadGatewayError,
  ServiceUnavailableError,
  GatewayTimeoutError,
  InternalServerError
} from '../../../src/main/utils/errors.js';
import { ErrorCode } from '../../../src/main/types/errors.js';

describe('utils/errors', () => {
  describe('ErrorCode constants', () => {
    it('should define all canonical error code constants', () => {
      expect(ErrorCode.BAD_REQUEST).toBe('BAD_REQUEST');
      expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
      expect(ErrorCode.MEDIA_NOT_FOUND).toBe('MEDIA_NOT_FOUND');
      expect(ErrorCode.MEDIA_NOT_DOWNLOADED).toBe('MEDIA_NOT_DOWNLOADED');
      expect(ErrorCode.PROVIDER_NOT_CONFIGURED).toBe('PROVIDER_NOT_CONFIGURED');
      expect(ErrorCode.PROVIDER_UNAVAILABLE).toBe('PROVIDER_UNAVAILABLE');
      expect(ErrorCode.NO_STREAMS_FOUND).toBe('NO_STREAMS_FOUND');
      expect(ErrorCode.SERVICE_ERROR).toBe('SERVICE_ERROR');
      expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });
  });

  describe('HttpError base class', () => {
    it('should correctly set status, code, and message', () => {
      const err = new HttpError(418, ErrorCode.BAD_REQUEST, "I'm a teapot");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(418);
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.message).toBe("I'm a teapot");
      expect(err.name).toBe('HttpError');
    });

    it('should maintain prototype chain properly', () => {
      const err = new HttpError(400, ErrorCode.BAD_REQUEST);
      expect(Object.getPrototypeOf(err)).toBe(HttpError.prototype);
      expect(err.stack).toBeDefined();
    });

    it('should support undefined message', () => {
      const err = new HttpError(404, ErrorCode.NOT_FOUND);
      expect(err.message).toBe('');
      expect(err.status).toBe(404);
      expect(err.code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('BadRequestError', () => {
    it('should have status 400 and preserve custom code and message', () => {
      const err = new BadRequestError(ErrorCode.BAD_REQUEST, 'Invalid request parameter');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toBeInstanceOf(BadRequestError);
      expect(err.status).toBe(400);
      expect(err.code).toBe(ErrorCode.BAD_REQUEST);
      expect(err.message).toBe('Invalid request parameter');
      expect(err.name).toBe('BadRequestError');
    });
  });

  describe('NotFoundError', () => {
    it('should have status 404 and preserve custom code and message', () => {
      const err = new NotFoundError(ErrorCode.MEDIA_NOT_FOUND, 'Media not found');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.status).toBe(404);
      expect(err.code).toBe(ErrorCode.MEDIA_NOT_FOUND);
      expect(err.message).toBe('Media not found');
      expect(err.name).toBe('NotFoundError');
    });
  });

  describe('BadGatewayError', () => {
    it('should have status 502 and preserve custom code and message', () => {
      const err = new BadGatewayError(ErrorCode.PROVIDER_UNAVAILABLE, 'Upstream torrent provider unavailable');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toBeInstanceOf(BadGatewayError);
      expect(err.status).toBe(502);
      expect(err.code).toBe(ErrorCode.PROVIDER_UNAVAILABLE);
      expect(err.message).toBe('Upstream torrent provider unavailable');
      expect(err.name).toBe('BadGatewayError');
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should have status 503 and preserve custom code and message', () => {
      const err = new ServiceUnavailableError(ErrorCode.SERVICE_ERROR, 'Service temporarily overloaded');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toBeInstanceOf(ServiceUnavailableError);
      expect(err.status).toBe(503);
      expect(err.code).toBe(ErrorCode.SERVICE_ERROR);
      expect(err.message).toBe('Service temporarily overloaded');
      expect(err.name).toBe('ServiceUnavailableError');
    });
  });

  describe('GatewayTimeoutError', () => {
    it('should have status 504 and preserve custom code and message', () => {
      const err = new GatewayTimeoutError(ErrorCode.SERVICE_ERROR, 'Upstream provider timed out');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toBeInstanceOf(GatewayTimeoutError);
      expect(err.status).toBe(504);
      expect(err.code).toBe(ErrorCode.SERVICE_ERROR);
      expect(err.message).toBe('Upstream provider timed out');
      expect(err.name).toBe('GatewayTimeoutError');
    });
  });

  describe('InternalServerError', () => {
    it('should default to status 500 and ErrorCode.INTERNAL_ERROR', () => {
      const err = new InternalServerError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.status).toBe(500);
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.name).toBe('InternalServerError');
    });

    it('should allow custom code and custom message', () => {
      const err = new InternalServerError(ErrorCode.SERVICE_ERROR, 'Unexpected database error');
      expect(err.status).toBe(500);
      expect(err.code).toBe(ErrorCode.SERVICE_ERROR);
      expect(err.message).toBe('Unexpected database error');
    });
  });
});
