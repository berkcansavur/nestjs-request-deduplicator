# nestjs-request-deduplicator

Prevent duplicate requests in NestJS. Add one decorator to a route and the library will block any request that has already been completed. No database is included — you bring your own storage (Postgres, Redis, MongoDB, or anything else).

---

## How it works

1. A request arrives. The guard hashes the fields you chose (body, headers, query, params) and looks up the hash in your storage.
2. **No record** → creates an `IN_PROGRESS` record and lets the request through.
3. **`COMPLETED`** → blocks with `409 Conflict`. The handler never runs.
4. **`IN_PROGRESS` within TTL** → blocks with `409 Conflict` (concurrent duplicate).
5. **`IN_PROGRESS` older than TTL** → the previous request probably crashed; lets this one through.
6. **`FAILED`** → resets to `IN_PROGRESS` and lets the request retry.

Routes **without** `@RequestDeduplicator()` are never touched. The guard checks for the decorator first and exits immediately if it is not present.

---

## Installation

```bash
npm install nestjs-request-deduplicator
```

---

## Quick Start

```typescript
// 1. Write an adapter for your database
import { DeduplicatorStorageAdapter, DeduplicatorRecord, DeduplicatorState } from 'nestjs-request-deduplicator';

class InMemoryAdapter extends DeduplicatorStorageAdapter {
  private store = new Map<string, DeduplicatorRecord>();

  async initialize() {}
  async findByKey(key: string) { return this.store.get(key) ?? null; }
  async create(record: Omit<DeduplicatorRecord, 'createdAt'>) {
    if (this.store.has(record.deduplicationKey)) return this.store.get(record.deduplicationKey)!;
    const full = { ...record, createdAt: new Date() };
    this.store.set(record.deduplicationKey, full);
    return full;
  }
  async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number) {
    const r = this.store.get(key);
    if (!r) return;
    this.store.set(key, {
      ...r,
      state,
      ...(responseBody !== undefined ? { responseBody } : {}),
      ...(responseStatus !== undefined ? { responseStatus } : {}),
    });
  }
  async close() { this.store.clear(); }
}

// 2. Register the module in AppModule
import { Module } from '@nestjs/common';
import { RequestDeduplicatorModule } from 'nestjs-request-deduplicator';

@Module({
  imports: [
    RequestDeduplicatorModule.forRoot({
      adapter: new InMemoryAdapter(),
      tableName: 'deduplicator_records',
    }),
  ],
})
export class AppModule {}

// 3. Protect a route
import { Controller, Post, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  RequestDeduplicatorGuard,
  RequestDeduplicatorInterceptor,
  RequestDeduplicator,
} from 'nestjs-request-deduplicator';

@Controller('orders')
@UseGuards(RequestDeduplicatorGuard)
@UseInterceptors(RequestDeduplicatorInterceptor)
export class OrdersController {
  @Post()
  @RequestDeduplicator({
    body:    ['accountId', 'productId', 'amount'],
    headers: ['x-request-id'],
  })
  async createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }
}
```

---

## Module Options

Pass these to `RequestDeduplicatorModule.forRoot()`.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `adapter` | `DeduplicatorStorageAdapter` | Yes | — | Your storage adapter |
| `tableName` | `string` | Yes | — | Table or collection name. Must match `/^[A-Za-z_][a-zA-Z0-9_]{0,62}$/` |
| `idFieldName` | `string` | No | `'id'` | Primary key column name in your adapter |
| `deduplicationKeyFieldName` | `string` | No | `'deduplication_key'` | Deduplication key column name in your adapter |
| `inProgressTtl` | `number` | No | `30` | Seconds before a stuck `IN_PROGRESS` record is considered crashed and allowed to retry |
| `global` | `boolean` | No | `true` | Register as a NestJS global module |
| `logger` | `LoggerFn` | No | — | Function to receive internal log events. If not provided, errors are silently swallowed |

### Logger

```typescript
import type { LoggerFn } from 'nestjs-request-deduplicator';

// type: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void
```

**Always provide a logger in production.** Without it you will not see storage errors.

```typescript
// NestJS built-in logger
const logger = new Logger('RequestDeduplicator');
RequestDeduplicatorModule.forRoot({
  adapter: new MyAdapter(),
  tableName: 'deduplicator_records',
  logger: (level, message, meta) => logger[level](message, meta),
});

// Winston
logger: (level, message, meta) => winstonLogger[level](message, meta);

// Pino
logger: (level, message, meta) => pinoLogger[level](meta ?? {}, message);
```

---

## Decorator Options

```typescript
@RequestDeduplicator({
  body:    ['accountId', 'amount'],   // fields from request.body
  headers: ['x-request-id'],          // header names (case-insensitive)
  query:   ['currency'],              // fields from request.query
  params:  ['orderId'],               // fields from request.params
})
```

At least one of `body`, `headers`, `query`, or `params` is required. Maximum 50 fields total.

Dot-notation is supported for nested fields: `body: ['order.total']` reads `request.body.order.total`.

| Option | Type | Description |
|---|---|---|
| `body` | `string[]` | Body field names. Supports dot-notation. |
| `headers` | `string[]` | Header names (case-insensitive). |
| `query` | `string[]` | Query parameter names. Supports dot-notation. |
| `params` | `string[]` | Route parameter names. |
| `keyName` | `string` | Override the deduplication key column name for this route only. |

---

## Request Lifecycle

```
First request
  Guard:       no record → create IN_PROGRESS → allow
  Handler:     runs
  Interceptor: save COMPLETED + response

Duplicate (already COMPLETED)
  Guard:       COMPLETED found → 409 Conflict
  Handler:     does not run

Concurrent duplicate (IN_PROGRESS within TTL)
  Guard:       IN_PROGRESS found, age < 30s → 409 Conflict
  Handler:     does not run

Crashed request recovery (IN_PROGRESS older than TTL)
  Guard:       IN_PROGRESS found, age > 30s → allow
  Handler:     runs
  Interceptor: save COMPLETED or FAILED

Retry after failure (FAILED)
  Guard:       FAILED found → reset to IN_PROGRESS → allow
  Handler:     runs again
  Interceptor: save COMPLETED or FAILED
```

---

## Writing a Storage Adapter

Extend `DeduplicatorStorageAdapter` and implement all five methods.

```typescript
import { DeduplicatorStorageAdapter, DeduplicatorRecord, DeduplicatorState } from 'nestjs-request-deduplicator';

export class MyAdapter extends DeduplicatorStorageAdapter {
  async initialize(): Promise<void> { /* create table/index on startup */ }
  async findByKey(key: string): Promise<DeduplicatorRecord | null> { /* lookup */ }
  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> { /* insert */ }
  async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number): Promise<void> { /* update */ }
  async close(): Promise<void> { /* disconnect */ }
}
```

`initialize()` runs on app startup. `close()` runs on app shutdown. Both are called automatically.

**Important:** Add an index on the deduplication key column to speed up lookups. Do not make it a unique index — the same deduplication key can appear in multiple records over time (for example, a `FAILED` record followed by a new `IN_PROGRESS` record after a retry). Race conditions between concurrent identical requests are handled by the application logic (`IN_PROGRESS` state + 409 Conflict), not by the index.

### `findByKey` priority order

When multiple records share the same key, return the first match in this order:
1. `COMPLETED`
2. `IN_PROGRESS`
3. Most recent `FAILED`

---

## Adapter Examples

### PostgreSQL

```bash
npm install pg @types/pg
```

```typescript
import { DeduplicatorStorageAdapter, DeduplicatorRecord, DeduplicatorState } from 'nestjs-request-deduplicator';
import { Pool } from 'pg';

export class PostgresAdapter extends DeduplicatorStorageAdapter {
  private readonly pool: Pool;

  constructor(connectionUri: string, private readonly tableName: string) {
    super();
    this.pool = new Pool({ connectionString: connectionUri });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id                VARCHAR      PRIMARY KEY,
        deduplication_key VARCHAR      NOT NULL,
        state             VARCHAR      NOT NULL,
        request_body      JSONB,
        response_body     JSONB,
        response_status   INT,
        created_at        TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "${this.tableName}_dedup_key_idx"
      ON "${this.tableName}" (deduplication_key)
    `);
  }

  async findByKey(key: string): Promise<DeduplicatorRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM "${this.tableName}"
       WHERE deduplication_key = $1
       ORDER BY
         CASE state
           WHEN 'COMPLETED'   THEN 1
           WHEN 'IN_PROGRESS' THEN 2
           ELSE                    3
         END ASC,
         created_at DESC
       LIMIT 1`,
      [key],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      deduplicationKey: row.deduplication_key,
      state: row.state,
      requestBody: row.request_body,
      responseBody: row.response_body,
      responseStatus: row.response_status,
      createdAt: new Date(row.created_at),
    };
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const result = await this.pool.query(
      `INSERT INTO "${this.tableName}"
         (id, deduplication_key, state, request_body, response_body, response_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING created_at`,
      [
        record.id,
        record.deduplicationKey,
        record.state,
        record.requestBody != null ? JSON.stringify(record.requestBody) : null,
        record.responseBody != null ? JSON.stringify(record.responseBody) : null,
        record.responseStatus ?? null,
      ],
    );
    return { ...record, createdAt: new Date(result.rows[0].created_at) };
  }

  async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number): Promise<void> {
    if (state === DeduplicatorState.IN_PROGRESS) {
      await this.pool.query(
        `UPDATE "${this.tableName}" SET state = $1
         WHERE id = (
           SELECT id FROM "${this.tableName}"
           WHERE deduplication_key = $2 AND state = 'FAILED'
           ORDER BY created_at DESC LIMIT 1
         )`,
        [state, key],
      );
    } else {
      await this.pool.query(
        `UPDATE "${this.tableName}"
         SET state = $1, response_body = $2, response_status = $3
         WHERE deduplication_key = $4 AND state = 'IN_PROGRESS'`,
        [state, responseBody !== undefined ? JSON.stringify(responseBody) : null, responseStatus ?? null, key],
      );
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

### Redis

```bash
npm install ioredis
```

```typescript
import { DeduplicatorStorageAdapter, DeduplicatorRecord, DeduplicatorState } from 'nestjs-request-deduplicator';
import Redis from 'ioredis';

export class RedisAdapter extends DeduplicatorStorageAdapter {
  private readonly client: Redis;

  constructor(connectionUri: string, private readonly keyPrefix: string) {
    super();
    this.client = new Redis(connectionUri);
  }

  private key(deduplicationKey: string): string {
    return `${this.keyPrefix}:${deduplicationKey}`;
  }

  async initialize(): Promise<void> {
    await this.client.ping();
  }

  async findByKey(key: string): Promise<DeduplicatorRecord | null> {
    const raw = await this.client.get(this.key(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeduplicatorRecord & { createdAt: string };
    return { ...parsed, createdAt: new Date(parsed.createdAt) };
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const full: DeduplicatorRecord = { ...record, createdAt: new Date() };
    await this.client.set(this.key(record.deduplicationKey), JSON.stringify(full), 'NX');
    return full;
  }

  async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number): Promise<void> {
    const existing = await this.findByKey(key);
    if (!existing) return;
    const updated = { ...existing, state } as Record<string, unknown>;
    if (responseBody !== undefined) updated['responseBody'] = responseBody;
    if (responseStatus !== undefined) updated['responseStatus'] = responseStatus;
    await this.client.set(this.key(key), JSON.stringify(updated));
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
```

### MongoDB

```bash
npm install mongodb
```

```typescript
import { DeduplicatorStorageAdapter, DeduplicatorRecord, DeduplicatorState } from 'nestjs-request-deduplicator';
import { Collection, MongoClient } from 'mongodb';

export class MongoAdapter extends DeduplicatorStorageAdapter {
  private client!: MongoClient;
  private collection!: Collection;

  constructor(
    private readonly uri: string,
    private readonly dbName: string,
    private readonly collectionName: string,
  ) {
    super();
  }

  async initialize(): Promise<void> {
    this.client = await MongoClient.connect(this.uri);
    this.collection = this.client.db(this.dbName).collection(this.collectionName);
    await this.collection.createIndex({ deduplicationKey: 1 });
  }

  async findByKey(key: string): Promise<DeduplicatorRecord | null> {
    const active = await this.collection.findOne({
      deduplicationKey: key,
      state: { $in: ['COMPLETED', 'IN_PROGRESS'] },
    });
    const doc = active ?? await this.collection.findOne(
      { deduplicationKey: key, state: 'FAILED' },
      { sort: { createdAt: -1 } },
    );
    if (!doc) return null;
    return {
      id: doc['id'],
      deduplicationKey: doc['deduplicationKey'],
      state: doc['state'],
      requestBody: doc['requestBody'] ?? undefined,
      responseBody: doc['responseBody'] ?? undefined,
      responseStatus: doc['responseStatus'] ?? undefined,
      createdAt: doc['createdAt'],
    };
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const full: DeduplicatorRecord = { ...record, createdAt: new Date() };
    try {
      await this.collection.insertOne({ ...full });
    } catch (err: unknown) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    return full;
  }

  async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number): Promise<void> {
    const $set: Record<string, unknown> = { state };
    if (responseBody !== undefined) $set['responseBody'] = responseBody;
    if (responseStatus !== undefined) $set['responseStatus'] = responseStatus;

    if (state === DeduplicatorState.IN_PROGRESS) {
      await this.collection.findOneAndUpdate(
        { deduplicationKey: key, state: 'FAILED' },
        { $set },
        { sort: { createdAt: -1 } },
      );
    } else {
      await this.collection.updateOne(
        { deduplicationKey: key, state: 'IN_PROGRESS' },
        { $set },
      );
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
```

---

## Record Expiry

This package does not delete old records. Use your database's built-in expiry:

| Database | How to expire records |
|---|---|
| MongoDB | `collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })` |
| Redis | Call `EXPIRE` on the key when you `SET` it |
| PostgreSQL | Use `pg_cron` or a NestJS `@Cron` task to `DELETE WHERE created_at < NOW() - INTERVAL '1 day'` |
| MySQL | Use MySQL Event Scheduler or a NestJS `@Cron` task |

---

## Error Handling

### `DuplicateRequestException`

When the guard blocks a duplicate, it throws `DuplicateRequestException`. Add a filter in your app to return a clean JSON response.

```typescript
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { DuplicateRequestException } from 'nestjs-request-deduplicator';

@Catch(DuplicateRequestException)
export class DuplicateRequestFilter implements ExceptionFilter {
  catch(exception: DuplicateRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.statusCode).json({
      statusCode: exception.statusCode,
      code: exception.code,
      message: exception.message,
    });
  }
}
```

Register it in `main.ts`:

```typescript
app.useGlobalFilters(new DuplicateRequestFilter());
```

Response body:

```json
{
  "statusCode": 409,
  "code": "DUPLICATE_REQUEST",
  "message": "This operation has already been completed"
}
```

| Property | Value |
|---|---|
| `statusCode` | `409` |
| `code` | `'DUPLICATE_REQUEST'` |
| `message` | `'This operation has already been completed'` or `'Request is already being processed'` |

### Why not `HttpException`?

`DuplicateRequestException` extends `Error`, not NestJS's `HttpException`. This is intentional. When the package is installed via a local `file:` path during development, two separate copies of `@nestjs/common` can exist. NestJS's `instanceof HttpException` check would fail across the boundary and return `500` instead of `409`. Using a plain `Error` subclass avoids this entirely.

### Other situations

| Situation | Result |
|---|---|
| Duplicate of a completed request | `409` via `DuplicateRequestFilter` |
| Concurrent duplicate within TTL | `409` via `DuplicateRequestFilter` |
| Handler throws | Record marked `FAILED`; next request with the same key is allowed to retry |
| Adapter throws during `findByKey` | `500` — the guard does not catch adapter errors |
| Adapter throws during `updateState` | Logged via your `logger`; the client response is not affected |
| Invalid `tableName` at startup | Throws at boot: `Invalid tableName "…"` |
| `adapter` is wrong type | Throws at boot: `options.adapter must be an instance of DeduplicatorStorageAdapter` |

### Retrying after a failure

If your handler throws, the record is marked `FAILED`. The next request with the same key will re-run the handler. If your handler caused a side effect before throwing (for example, a payment was charged), make sure the handler checks whether the side effect already happened before repeating it.

---

## Contributing

You can contribute by fixing any missing or buggy parts you find in the project, and if you find it useful, a star would be greatly appreciated.

For questions or feedback, reach out at **alpbasaran99@gmail.com**.

---

## License

MIT — see [LICENSE](./LICENSE).
