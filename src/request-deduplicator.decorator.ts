import { SetMetadata } from '@nestjs/common';
import { REQUEST_DEDUPLICATOR_METADATA_KEY } from './request-deduplicator.constants';
import { RequestDeduplicatorOptions } from './types/request-deduplicator-options.interface';

/**
 * Marks a route handler as idempotent.
 *
 * Place `@UseGuards(RequestDeduplicatorGuard)` and
 * `@UseInterceptors(RequestDeduplicatorInterceptor)` on the controller (or handler),
 * then add this decorator to specify which fields form the deduplication key.
 *
 * @example
 * @RequestDeduplicator({ body: ['userId', 'productId'], headers: ['x-client-id'] })
 * async createOrder(@Body() body: CreateOrderDto) { ... }
 */
export const RequestDeduplicator = (options: RequestDeduplicatorOptions) =>
  SetMetadata(REQUEST_DEDUPLICATOR_METADATA_KEY, options);
