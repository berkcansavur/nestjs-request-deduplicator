import { DeduplicatorState } from './deduplicator-state.enum';

export interface DeduplicatorRecord {
  /** Unique per-record UUID. Use as primary key in your adapter. */
  id: string;
  /** SHA-256 hash of the extracted request fields. Used for deduplication lookup. */
  deduplicationKey: string;
  state: DeduplicatorState;
  /**
   * The raw incoming request body stored at the time the record was created.
   * Present on all records (IN_PROGRESS, COMPLETED, FAILED).
   * Use this to inspect what was sent and compare originals vs duplicates for monitoring.
   */
  requestBody?: unknown;
  /**
   * The response body saved after the operation settles.
   * Set for COMPLETED (handler return value) and FAILED (error details or rejection message).
   * Undefined while IN_PROGRESS.
   */
  responseBody?: unknown;
  /**
   * The HTTP status code saved after the operation settles.
   * Set for COMPLETED (handler status) and FAILED (error or rejection status).
   * Undefined while IN_PROGRESS.
   */
  responseStatus?: number;
  createdAt: Date;
}
