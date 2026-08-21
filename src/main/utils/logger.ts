const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
} as const;

type LogLevelKey = keyof typeof LOG_LEVELS;

const CURRENT_LEVEL = process.env.LOG_LEVEL
  ? (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase() as LogLevelKey] ?? LOG_LEVELS.INFO)
  : (process.env.NODE_ENV === 'development' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO);

export class Logger {
  private context: string | null;

  constructor(context: string | null = null) {
    this.context = context;
  }

  /**
   * Creates a scoped child logger with an automatic context prefix.
   * @param context Module or worker name
   * @returns Scoped Logger instance
   */
  child(context: string): Logger {
    const newContext = this.context ? `${this.context}:${context}` : context;
    return new Logger(newContext);
  }

  /**
   * Helper to format output log strings.
   */
  private _format(level: LogLevelKey, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const tag = this.context ? ` [${this.context}]` : '';
    const metaString = meta !== undefined
      ? ` | meta: ${meta instanceof Error ? meta.stack || meta.message : typeof meta === 'object' && meta !== null ? JSON.stringify(meta) : String(meta)}`
      : '';
    return `[${timestamp}] [${level}]${tag} ${message}${metaString}`;
  }

  debug(message: string, meta?: unknown): void {
    if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
      console.debug(this._format('DEBUG', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
      console.info(this._format('INFO', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
      console.warn(this._format('WARN', message, meta));
    }
  }

  error(message: string, errorOrMeta?: unknown): void {
    if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
      console.error(this._format('ERROR', message, errorOrMeta));
    }
  }
}

export const logger = new Logger();
export default logger;
