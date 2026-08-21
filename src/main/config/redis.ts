import { Redis, type RedisOptions } from 'ioredis';
import { logger } from '../utils/logger.js';

/**
 * Default Redis connection configuration.
 */
export const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  username: process.env.REDIS_USERNAME || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number): number | void {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  reconnectOnError(err: Error): boolean {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  }
};

let hasLoggedGlobalOffline = false;

export interface CustomRedisOptions extends RedisOptions {
  connectionName?: string;
}

/**
 * Creates a new, isolated ioredis connection instance.
 * BullMQ requires separate Redis connections for Queues, Workers, and Events.
 *
 * @param customOptions Additional or override Redis options
 * @returns A configured ioredis client instance
 */
export function createRedisConnection(customOptions: CustomRedisOptions = {}): Redis {
  const { connectionName = 'default', ...overrideOptions } = customOptions;

  const client = new Redis({
    ...redisConfig,
    ...overrideOptions
  });

  let hasLoggedError = false;

  client.on('connect', () => {
    hasLoggedError = false;
    hasLoggedGlobalOffline = false;
    logger.debug(`Redis connection established [${connectionName}]`);
  });

  client.on('ready', () => {
    logger.debug(`Redis connection ready [${connectionName}]`);
  });

  client.on('error', (err: Error & { code?: string }) => {
    if (!hasLoggedError) {
      hasLoggedError = true;
      if (!hasLoggedGlobalOffline) {
        hasLoggedGlobalOffline = true;
        logger.warn(`Redis is offline or unreachable at ${redisConfig.host}:${redisConfig.port} (${err.code || err.message}). Retrying in background...`);
      }
      logger.debug(`Redis connection error [${connectionName}]: ${err.message}`);
    }
  });

  client.on('close', () => {
    logger.debug(`Redis connection closed [${connectionName}]`);
  });

  client.on('reconnecting', (delay: number) => {
    logger.debug(`Redis reconnecting in ${delay}ms [${connectionName}]`);
  });

  return client;
}

/**
 * Shared Redis publisher client for Pub/Sub events.
 */
export const redisPublisher: Redis = createRedisConnection({
  connectionName: 'publisher'
});

export default {
  redisConfig,
  createRedisConnection,
  redisPublisher
};
