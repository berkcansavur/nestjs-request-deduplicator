// Module
export { RequestDeduplicatorModule } from './request-deduplicator.module';

// Exceptions
export { DuplicateRequestException } from './duplicate-request.exception';

// Guard & Interceptor
export { RequestDeduplicatorGuard } from './request-deduplicator.guard';
export { RequestDeduplicatorInterceptor } from './request-deduplicator.interceptor';

// Decorator
export { RequestDeduplicator } from './request-deduplicator.decorator';

// Abstract adapter — extend this to build your own storage backend
export { DeduplicatorStorageAdapter } from './adapters/deduplicator-storage.adapter';

// Types
export { DeduplicatorState } from './types/deduplicator-state.enum';
export type { DeduplicatorRecord } from './types/deduplicator-record.interface';
export type {
  RequestDeduplicatorModuleOptions,
  RequestDeduplicatorOptions,
  LoggerFn,
} from './types/request-deduplicator-options.interface';

// Constants (for advanced / custom-adapter use)
export {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  REQUEST_DEDUPLICATOR_METADATA_KEY,
  DEFAULT_IN_PROGRESS_TTL_SECONDS,
} from './request-deduplicator.constants';

// Utilities (for testing / custom adapter authors)
export { extractFields, extractFromRequest } from './field-extractor.util';
export type { ExtractedFields, RequestLike } from './field-extractor.util';
export { generateHash } from './hash.util';

// Validation helper (for custom integrations)
export { validateRequestDeduplicatorOptions } from './request-deduplicator.module';
