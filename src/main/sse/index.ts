import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { createRedisConnection } from '../config/redis.js';
import { publishEvent, publishDownloadStatus, EVENTS_CHANNEL } from '../queues/index.js';
import { logger } from '../utils/logger.js';
import type { DownloadStatus } from '../types/index.js';

/**
 * Service to manage Server-Sent Events (SSE) active connections and distributed notifications
 * via Redis Pub/Sub.
 */
export class SseManager {
  private clients: Response[];
  private subscriber: Redis;

  constructor() {
    this.clients = [];

    // Initialize dedicated Redis subscriber connection
    this.subscriber = createRedisConnection({
      connectionName: 'sse:subscriber'
    });

    this._initSubscriber();
  }

  /**
   * Initializes Redis subscriber for the events channel.
   * @private
   */
  private _initSubscriber(): void {
    this.subscriber.subscribe(EVENTS_CHANNEL, (err?: Error | null, count?: unknown) => {
      if (err) {
        logger.error(`Failed to subscribe to Redis channel ${EVENTS_CHANNEL}:`, err);
      } else {
        logger.debug(`Subscribed to Redis channel '${EVENTS_CHANNEL}' (Active subscriptions: ${count})`);
      }
    });

    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel === EVENTS_CHANNEL) {
        this._handleRedisMessage(message);
      }
    });
  }

  /**
   * Handles incoming message from Redis pub/sub and delivers to all local SSE clients.
   * @private
   * @param message Serialized JSON event string
   */
  private _handleRedisMessage(message: string): void {
    try {
      const parsed = JSON.parse(message);
      const { channel, data } = parsed;
      this._sendToLocalClients(channel, data);
    } catch (error) {
      logger.error('Failed to parse SSE Redis message:', error);
    }
  }

  /**
   * Sends SSE-formatted data chunk to all connected local HTTP clients.
   * @private
   * @param channel Event channel
   * @param data Payload data
   */
  private _sendToLocalClients(channel: string, data: unknown): void {
    if (this.clients.length === 0) {
      return;
    }

    const payload = JSON.stringify({ channel, data });
    const formatted = `data: ${payload}\n\n`;

    const deadClients: Response[] = [];
    for (const res of this.clients) {
      try {
        res.write(formatted);
      } catch {
        deadClients.push(res);
      }
    }

    if (deadClients.length > 0) {
      this.clients = this.clients.filter(c => !deadClients.includes(c));
      logger.debug(`Removed ${deadClients.length} dead SSE client(s). Active clients: ${this.clients.length}`);
    }
  }

  /**
   * Registers a new client connection.
   * @param req Express request
   * @param res Express response
   */
  registerClient(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    this.clients.push(res);
    logger.info(`New SSE client connected. Active clients: ${this.clients.length}`);

    const cleanup = () => {
      clearInterval(heartbeat);
      if (this.clients.includes(res)) {
        this.clients = this.clients.filter(c => c !== res);
        logger.info(`SSE client disconnected. Active clients: ${this.clients.length}`);
      }
    };

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        cleanup();
      }
    }, 15000);

    req.on('close', cleanup);
  }

  /**
   * Broadcasts a payload to all connected clients across all instances via Redis Pub/Sub.
   * @param channel Target channel
   * @param data Event data
   */
  async broadcast(channel: string, data: unknown): Promise<number> {
    return publishEvent(channel, data);
  }

  /**
   * Helper to broadcast specific download progress status events across all instances.
   * @param id Media identifier
   * @param status Download status string
   * @param progress Progress percentage string or number
   */
  async broadcastDownloadStatus(id: string, status: DownloadStatus | string, progress: string | number = '0.00'): Promise<number> {
    return publishDownloadStatus(id, status, progress);
  }

  /**
   * Closes subscriber connection and client connections.
   */
  async destroy(): Promise<void> {
    try {
      await this.subscriber.unsubscribe(EVENTS_CHANNEL);
      await this.subscriber.quit();
    } catch {
      // Ignore disconnect errors on shutdown
    }
    this.clients.forEach(res => {
      try {
        res.end();
      } catch {
        // Ignore
      }
    });
    this.clients = [];
  }
}

const sseInstance = new SseManager();
export { sseInstance as sseManager };
export default sseInstance;
