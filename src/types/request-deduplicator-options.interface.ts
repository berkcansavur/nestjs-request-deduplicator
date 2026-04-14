import { DeduplicatorStorageAdapter } from '../adapters/deduplicator-storage.adapter';

export type LoggerFn = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
) => void;

export interface RequestDeduplicatorModuleOptions {
  adapter: DeduplicatorStorageAdapter;
  tableName: string;
  idFieldName?: string;
  deduplicationKeyFieldName?: string;
  /**
   * Whether to register this module as a NestJS global module.
   * Default: `true`. Set to `false` when you need multiple adapter instances
   * in different feature modules (e.g. one Postgres module + one Redis module).
   */
  global?: boolean;
  /**
   * Maximum age in seconds for an IN_PROGRESS record to be considered actively running.
   * Requests older than this are treated as stale/crashed and allowed to retry.
   * Default: 30 seconds.
   */
  inProgressTtl?: number;
  logger?: LoggerFn;
}

export interface RequestDeduplicatorOptions {
  /**
   * Field names to pick from `request.body`.
   * Supports dot-notation for nested access (e.g. `'user.id'`).
   *
   * @example
   * body: ['userId', 'productId', 'amount']
   */
  body?: string[];
  /**
   * Header names to pick from `request.headers` (case-insensitive).
   *
   * @example
   * headers: ['x-client-id', 'x-session-token']
   */
  headers?: string[];
  /**
   * Query parameter names to pick from `request.query`.
   * Supports dot-notation for nested access (e.g. `'filter.status'`).
   *
   * @example
   * query: ['tenantId', 'version']
   */
  query?: string[];
  /**
   * Route parameter names to pick from `request.params`.
   *
   * @example
   * params: ['orderId', 'userId']
   */
  params?: string[];
  /** Overrides module-level deduplicationKeyFieldName for this route */
  keyName?: string;
}
