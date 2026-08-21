/**
 * Canonical Application Error Codes
 */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  MEDIA_NOT_DOWNLOADED: 'MEDIA_NOT_DOWNLOADED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NO_STREAMS_FOUND: 'NO_STREAMS_FOUND',
  SERVICE_ERROR: 'SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

export interface ErrorResponseBody {
  error: ErrorCodeType;
}
