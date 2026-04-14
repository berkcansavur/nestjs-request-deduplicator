import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DuplicateRequestException } from './duplicate-request.exception';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { DeduplicatorStorageAdapter } from './adapters/deduplicator-storage.adapter';
import {
  DEFAULT_IN_PROGRESS_TTL_SECONDS,
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_KEY_PROPERTY,
  REQUEST_DEDUPLICATOR_METADATA_KEY,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  REQUEST_DEDUPLICATOR_RECORD_PROPERTY,
} from './request-deduplicator.constants';
import { extractFromRequest } from './field-extractor.util';
import { generateHash } from './hash.util';
import {
  RequestDeduplicatorOptions,
  RequestDeduplicatorModuleOptions,
} from './types/request-deduplicator-options.interface';
import { DeduplicatorState } from './types/deduplicator-state.enum';
import { isRequestDeduplicatorOptions } from './request-deduplicator.metadata';

@Injectable()
export class RequestDeduplicatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REQUEST_DEDUPLICATOR_ADAPTER_TOKEN) private readonly adapter: DeduplicatorStorageAdapter,
    @Inject(REQUEST_DEDUPLICATOR_OPTIONS_TOKEN) private readonly moduleOptions: RequestDeduplicatorModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const decoratorOptions = this.reflector.get<unknown>(
      REQUEST_DEDUPLICATOR_METADATA_KEY,
      context.getHandler(),
    );

    if (!isRequestDeduplicatorOptions(decoratorOptions)) {
      return true;
    }

    const options: RequestDeduplicatorOptions = decoratorOptions;
    const request = context.switchToHttp().getRequest<Request>();
    const req = request as unknown as Record<string, unknown>;

    const extracted = extractFromRequest(
      {
        headers: request.headers as Record<string, string | string[] | undefined>,
        body: request.body,
        query: request.query as Record<string, unknown>,
        params: request.params as Record<string, unknown>,
      },
      options.body,
      options.headers,
      options.query,
      options.params,
    );
    const deduplicationKey = generateHash(extracted);

    const existing = await this.adapter.findByKey(deduplicationKey);

    if (!existing) {
      await this.adapter.create({
        id: randomUUID(),
        deduplicationKey,
        state: DeduplicatorState.IN_PROGRESS,
        requestBody: request.body,
      });
      req[REQUEST_DEDUPLICATOR_KEY_PROPERTY] = deduplicationKey;
      return true;
    }

    if (existing.state === DeduplicatorState.COMPLETED) {
      const exception = new DuplicateRequestException();

      void this.adapter.create({
        id: randomUUID(),
        deduplicationKey,
        state: DeduplicatorState.FAILED,
        requestBody: request.body,
        responseBody: { statusCode: exception.statusCode, code: exception.code, message: exception.message },
        responseStatus: exception.statusCode,
      }).catch((err: unknown) => {
        this.tryLog('error', 'RequestDeduplicatorGuard: failed to record duplicate attempt', {
          deduplicationKey,
          error: err instanceof Error ? err.message : String(err),
          errorType: err instanceof Error ? err.constructor.name : typeof err,
          stack: err instanceof Error ? err.stack : undefined,
        });
      });

      throw exception;
    }

    if (existing.state === DeduplicatorState.IN_PROGRESS) {
      const ttlMs = (this.moduleOptions.inProgressTtl ?? DEFAULT_IN_PROGRESS_TTL_SECONDS) * 1000;
      const ageMs = Date.now() - existing.createdAt.getTime();

      if (ageMs <= ttlMs) {
        throw new DuplicateRequestException('Request is already being processed');
      }

      req[REQUEST_DEDUPLICATOR_KEY_PROPERTY] = deduplicationKey;
      req[REQUEST_DEDUPLICATOR_RECORD_PROPERTY] = existing;
      return true;
    }

    if (existing.state === DeduplicatorState.FAILED) {
      await this.adapter.updateState(deduplicationKey, DeduplicatorState.IN_PROGRESS);
      req[REQUEST_DEDUPLICATOR_KEY_PROPERTY] = deduplicationKey;
      req[REQUEST_DEDUPLICATOR_RECORD_PROPERTY] = existing;
      return true;
    }

    this.tryLog(
      'warn',
      `RequestDeduplicatorGuard: unknown state "${existing.state}" for key "${deduplicationKey}"`,
    );
    return true;
  }

  private tryLog(
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    try {
      this.moduleOptions.logger?.(level, message, meta);
    } catch {
      // logger threw — ignore to avoid masking operational errors
    }
  }
}
