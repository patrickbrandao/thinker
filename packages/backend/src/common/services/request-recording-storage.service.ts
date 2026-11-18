import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DataSource } from 'typeorm';
import type { StoredAttemptRecording } from '../../routing/proxy/attempt-recording.types';
import {
  assertStoredRecording,
  decodeRequestRecording,
  encodeRequestRecording,
} from '../utils/request-recording-codec';

/**
 * Where Provider Attempt recordings live (ADR 0013). `postgres` is the default:
 * readable JSON in `provider_attempt_recordings`. `filesystem` and `s3` keep the
 * gzip + AES blobs and are used only when THINKER_RECORDING_STORAGE names them.
 */
export type RecordingStorageBackend = 'postgres' | 'filesystem' | 's3';

/** A blob store (filesystem or S3): holds encoded recordings by key. */
export interface RecordingStorage {
  readonly backend: 'filesystem' | 's3';
  prepare(): Promise<void>;
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface S3StorageConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

export type ResolvedBlobStorage =
  { backend: 'filesystem'; path: string } | ({ backend: 's3' } & S3StorageConfig);

export type ResolvedRecordingStorage =
  | { backend: 'postgres' }
  | { backend: 'filesystem'; path: string }
  | ({ backend: 's3' } & S3StorageConfig)
  | { backend: null; reason: string };

function storageKeySegment(value: string): string {
  if (!value) throw new Error('Request recording storage key segments cannot be empty');
  return encodeURIComponent(value).replaceAll('.', '%2E');
}

interface RecordingStorageConfigSource {
  get<T = unknown>(key: string): T | undefined;
}

interface BlobSettings {
  filesystemPath: string;
  hasS3Settings: boolean;
  s3(): ResolvedRecordingStorage;
}

function blobSettings(config: RecordingStorageConfigSource, cwd: string): BlobSettings {
  const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';
  const filesystemPath =
    config.get<string>('app.requestRecordingFilesystemPath') ||
    (nodeEnv === 'production'
      ? '/data/request-recordings'
      : join(cwd, '.data', 'request-recordings'));
  const bucket = config.get<string>('app.requestRecordingS3Bucket')?.trim() ?? '';
  const endpoint = config.get<string>('app.requestRecordingS3Endpoint')?.trim() || undefined;
  const region = config.get<string>('app.requestRecordingS3Region')?.trim() ?? '';
  const accessKeyId = config.get<string>('app.requestRecordingS3AccessKeyId')?.trim() || undefined;
  const secretAccessKey =
    config.get<string>('app.requestRecordingS3SecretAccessKey')?.trim() || undefined;
  const forcePathStyle = config.get<boolean>('app.requestRecordingS3ForcePathStyle') ?? false;
  const hasExplicitCredentials = Boolean(accessKeyId && secretAccessKey);
  const hasPartialCredentials = Boolean(accessKeyId || secretAccessKey);
  const completeS3 = Boolean(
    bucket && region && (!hasPartialCredentials || hasExplicitCredentials),
  );

  return {
    filesystemPath,
    hasS3Settings: Boolean(bucket || region || hasPartialCredentials || endpoint),
    s3: () =>
      completeS3
        ? {
            backend: 's3',
            bucket,
            endpoint,
            region,
            accessKeyId,
            secretAccessKey,
            forcePathStyle,
          }
        : {
            backend: null,
            reason:
              'S3 recording storage requires a bucket, region, and either both access-key values or neither',
          },
  };
}

export function resolveRecordingStorage(
  config: RecordingStorageConfigSource,
  cwd = process.cwd(),
): ResolvedRecordingStorage {
  const requested = (config.get<string>('app.requestRecordingStorage') ?? 'auto').toLowerCase();
  const blobs = blobSettings(config, cwd);

  // `auto` is PostgreSQL even when S3 settings are present (ADR 0013): the
  // blob stores are opt-in by name.
  if (requested === 'auto' || requested === 'postgres') return { backend: 'postgres' };
  if (requested === 's3') return blobs.s3();
  if (requested === 'filesystem') return { backend: 'filesystem', path: blobs.filesystemPath };
  if (requested === 'disabled') {
    return { backend: null, reason: 'Recording storage was explicitly disabled' };
  }
  return {
    backend: null,
    reason: `Unknown THINKER_RECORDING_STORAGE value "${requested}"`,
  };
}

/**
 * The blob store that held recordings before PostgreSQL became the default:
 * the one the old `auto` mode would have picked (S3 when any S3 setting is
 * present, otherwise the filesystem directory). The directory counts only when
 * it already exists, so a fresh install never creates it. Null when there is
 * nothing to read from.
 */
export function resolveLegacyRecordingStorage(
  config: RecordingStorageConfigSource,
  cwd = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): ResolvedBlobStorage | null {
  const blobs = blobSettings(config, cwd);
  if (blobs.hasS3Settings) {
    const s3 = blobs.s3();
    return s3.backend === 's3' ? s3 : null;
  }
  return exists(blobs.filesystemPath)
    ? { backend: 'filesystem', path: blobs.filesystemPath }
    : null;
}

export function createBlobStorage(resolved: ResolvedBlobStorage): RecordingStorage {
  return resolved.backend === 'filesystem'
    ? new FilesystemRecordingStorage(resolved.path)
    : new S3RecordingStorage(resolved);
}

/** Who a recording belongs to; stored as columns next to the PostgreSQL payload. */
export interface RecordingOwner {
  tenantId: string;
  requestId: string;
  attemptId: string;
}

const UNPAIRED_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * JSON text PostgreSQL accepts as jsonb: it rejects the NUL character and
 * unpaired UTF-16 surrogates inside strings, which a provider stream can carry.
 * NUL is dropped and a lone surrogate becomes U+FFFD; everything else is kept.
 */
export function jsonbText(payload: unknown): string {
  return JSON.stringify(payload, (_key, value: unknown) => {
    if (typeof value !== 'string') return value;
    let clean = value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
    if (/[\ud800-\udfff]/.test(clean)) clean = clean.replace(UNPAIRED_SURROGATE, '\ufffd');
    return clean;
  });
}

const UPSERT_RECORDING_SQL = `
  INSERT INTO provider_attempt_recordings (storage_key, tenant_id, request_id, attempt_id, payload)
  VALUES ($1, $2, $3, $4, $5::jsonb)
  ON CONFLICT (storage_key) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP
`;

/** A copy from the legacy store never overwrites a newer PostgreSQL row. */
const INSERT_MOVED_RECORDING_SQL = `
  INSERT INTO provider_attempt_recordings (storage_key, tenant_id, request_id, attempt_id, payload)
  VALUES ($1, $2, $3, $4, $5::jsonb)
  ON CONFLICT (storage_key) DO NOTHING
`;

const SELECT_RECORDING_SQL = `SELECT payload FROM provider_attempt_recordings WHERE storage_key = $1`;

const DELETE_RECORDING_SQL = `DELETE FROM provider_attempt_recordings WHERE storage_key = $1`;

export class FilesystemRecordingStorage implements RecordingStorage {
  readonly backend = 'filesystem' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.pathFor(key);
    const temporary = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, body);
    await rename(temporary, target);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    const target = resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid request recording storage key');
    }
    return target;
  }
}

export class S3RecordingStorage implements RecordingStorage {
  readonly backend = 's3' as const;
  private readonly client: S3Client;

  constructor(
    private readonly config: S3StorageConfig,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials:
          config.accessKeyId && config.secretAccessKey
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              }
            : undefined,
      });
  }

  async prepare(): Promise<void> {}

  async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        // The body is client-side ciphertext (see request-recording-codec), not
        // readable JSON, and declaring ContentEncoding: gzip made some
        // S3-compatible stores and CDNs try to gunzip it transparently on GET.
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) throw new Error('Request recording object has no body');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

@Injectable()
export class RequestRecordingStorageService implements OnModuleInit {
  private readonly logger = new Logger(RequestRecordingStorageService.name);
  private primary: 'postgres' | RecordingStorage | null;
  private legacy: RecordingStorage | null = null;
  private unavailableReason: string | null;

  constructor(
    config: ConfigService,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    const resolved = resolveRecordingStorage(config);
    if (resolved.backend === 'postgres') {
      if (dataSource) {
        this.primary = 'postgres';
        this.unavailableReason = null;
        const legacy = resolveLegacyRecordingStorage(config);
        this.legacy = legacy ? createBlobStorage(legacy) : null;
      } else {
        this.primary = null;
        this.unavailableReason = 'PostgreSQL recording storage needs a database connection';
      }
    } else if (resolved.backend === 'filesystem' || resolved.backend === 's3') {
      this.primary = createBlobStorage(resolved);
      this.unavailableReason = null;
    } else {
      this.primary = null;
      this.unavailableReason = resolved.reason;
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.primary) {
      this.logger.warn(`Request recording storage unavailable: ${this.unavailableReason}`);
      return;
    }
    if (this.primary !== 'postgres') {
      try {
        await this.primary.prepare();
      } catch (error) {
        this.unavailableReason = error instanceof Error ? error.message : String(error);
        this.primary = null;
        this.logger.error(`Request recording storage unavailable: ${this.unavailableReason}`);
        return;
      }
    }
    this.logger.log(
      `Request recording storage: ${this.backend}` +
        (this.legacy ? ` (reading older recordings from ${this.legacy.backend})` : ''),
    );
  }

  get backend(): RecordingStorageBackend | null {
    if (!this.primary) return null;
    return this.primary === 'postgres' ? 'postgres' : this.primary.backend;
  }

  /** The blob store older recordings are still read from and moved out of. */
  get legacyBackend(): 'filesystem' | 's3' | null {
    return this.legacy?.backend ?? null;
  }

  objectKey(tenantId: string, requestId: string, attemptId: string): string {
    return (
      `request-recordings/v1/tenants/${storageKeySegment(tenantId)}` +
      `/requests/${storageKeySegment(requestId)}` +
      `/attempts/${storageKeySegment(attemptId)}.json.gz`
    );
  }

  async saveRecording(
    key: string,
    payload: StoredAttemptRecording,
    owner: RecordingOwner,
  ): Promise<void> {
    const primary = this.requireStorage();
    if (primary === 'postgres') {
      await this.db().query(UPSERT_RECORDING_SQL, [
        key,
        owner.tenantId,
        owner.requestId,
        owner.attemptId,
        jsonbText(payload),
      ]);
      return;
    }
    await primary.put(key, await encodeRequestRecording(payload));
  }

  async loadRecording(key: string): Promise<StoredAttemptRecording> {
    const primary = this.requireStorage();
    if (primary !== 'postgres') return decodeRequestRecording(await primary.get(key));
    const rows = (await this.db().query(SELECT_RECORDING_SQL, [key])) as Array<{
      payload: unknown;
    }>;
    if (rows.length > 0) {
      const raw = rows[0].payload;
      return assertStoredRecording(typeof raw === 'string' ? JSON.parse(raw) : raw);
    }
    // Not moved yet: still in the store it was written to.
    if (this.legacy) return decodeRequestRecording(await this.legacy.get(key));
    throw new Error('Request recording not found');
  }

  async delete(key: string): Promise<void> {
    const primary = this.requireStorage();
    if (primary !== 'postgres') {
      await primary.delete(key);
      return;
    }
    await this.db().query(DELETE_RECORDING_SQL, [key]);
    if (this.legacy) await this.legacy.delete(key);
  }

  /**
   * Copies one recording from the legacy blob store into PostgreSQL, then
   * removes the blob. Returns false when there is no legacy store.
   */
  async moveFromLegacy(key: string, owner: RecordingOwner): Promise<boolean> {
    if (this.primary !== 'postgres' || !this.legacy) return false;
    const payload = await decodeRequestRecording(await this.legacy.get(key));
    await this.db().query(INSERT_MOVED_RECORDING_SQL, [
      key,
      owner.tenantId,
      owner.requestId,
      owner.attemptId,
      jsonbText(payload),
    ]);
    await this.legacy.delete(key);
    return true;
  }

  private db(): DataSource {
    if (!this.dataSource)
      throw new Error('PostgreSQL recording storage needs a database connection');
    return this.dataSource;
  }

  private requireStorage(): 'postgres' | RecordingStorage {
    if (!this.primary) {
      throw new Error(this.unavailableReason ?? 'Request recording storage is unavailable');
    }
    return this.primary;
  }
}
