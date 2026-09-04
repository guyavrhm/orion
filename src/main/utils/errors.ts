import { ErrorCode, type ErrorCodeType } from '../types/errors.js';

/**
 * Base HTTP Error with structured status code and domain error code.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: ErrorCodeType;

  constructor(status: number, code: ErrorCodeType, message?: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends HttpError {
  constructor(code: ErrorCodeType, message?: string) {
    super(400, code, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(code: ErrorCodeType, message?: string) {
    super(404, code, message);
  }
}

export class BadGatewayError extends HttpError {
  constructor(code: ErrorCodeType, message?: string) {
    super(502, code, message);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(code: ErrorCodeType, message?: string) {
    super(503, code, message);
  }
}

export class GatewayTimeoutError extends HttpError {
  constructor(code: ErrorCodeType, message?: string) {
    super(504, code, message);
  }
}

export class InternalServerError extends HttpError {
  constructor(code: ErrorCodeType = ErrorCode.INTERNAL_ERROR, message?: string) {
    super(500, code, message);
  }
}
