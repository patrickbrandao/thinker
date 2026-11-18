import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  RequestRecordingStorageService,
  S3RecordingStorage,
  jsonbText,
  resolveLegacyRecordingStorage,
  resolveRecordingStorage,
} from './request-recording-storage.service';
import type { StoredAttemptRecording } from '../../routing/proxy/attempt-recording.types';
import { encodeRequestRecording } from '../utils/request-recording-codec';

const TEST_SECRET = 'recording-storage-spec-secret-32-chars!!';
const originalSecret = process.env['THINKER_ENCRYPTION_KEY'];
beforeAll(() => {
  process.env['THINKER_ENCRYPTION_KEY'] = TEST_SECRET;
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env['THINKER_ENCRYPTION_KEY'];
  else process.env['THINKER_ENCRYPTION_KEY'] = originalSecret;
});

const RECORDING: StoredAttemptRecording = {
  version: 1,
  wire_format: 'openai_chat_completions',
  request_body: { messages: [{ role: 'user', content: 'hello' }] },
  response_body: { type: 'json', body: { choices: [] } },
};
const OWNER = { tenantId: 'tenant-1', requestId: 'request-1', attemptId: 'attempt-1' };

/** A fake DataSource backed by a Map, standing in for provider_attempt_recordings. */
function fakeDb() {
  const rows = new Map<string, { payload: unknown; owner: unknown[] }>();
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO provider_attempt_recordings')) {
      const key = params[0] as string;
      if (sql.includes('DO NOTHING') && rows.has(key)) return [];
      rows.set(key, { payload: JSON.parse(params[4] as string), owner: params.slice(1, 4) });
      return [];
    }
    if (sql.startsWith('SELECT payload')) {
      const row = rows.get(params[0] as string);
      return row ? [{ payload: row.payload }] : [];
    }
    if (sql.startsWith('DELETE')) {
      rows.delete(params[0] as string);
      return [];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { rows, query, dataSource: { query } as never };
}

function config(values: Record<string, unknown>) {
  return {
    get: <T>(key: string) => values[key] as T | undefined,
  };
}

describe('request recording storage selection', () => {
  it('defaults to PostgreSQL, also when S3 settings are present', () => {
    expect(resolveRecordingStorage(config({ 'app.nodeEnv': 'production' }))).toEqual({
      backend: 'postgres',
    });
    expect(
      resolveRecordingStorage(
        config({
          'app.requestRecordingStorage': 'auto',
          'app.requestRecordingS3Bucket': 'recordings',
          'app.requestRecordingS3Region': 'auto',
          'app.requestRecordingS3AccessKeyId': 'access',
          'app.requestRecordingS3SecretAccessKey': 'secret',
        }),
      ),
    ).toEqual({ backend: 'postgres' });
    expect(resolveRecordingStorage(config({ 'app.requestRecordingStorage': 'POSTGRES' }))).toEqual({
      backend: 'postgres',
    });
  });

  it('supports explicit disabled, filesystem, and S3 modes', () => {
    expect(resolveRecordingStorage(config({ 'app.requestRecordingStorage': 'disabled' }))).toEqual({
      backend: null,
      reason: 'Recording storage was explicitly disabled',
    });
    expect(
      resolveRecordingStorage(
        config({
          'app.requestRecordingStorage': 'filesystem',
          'app.nodeEnv': 'development',
        }),
        '/thinker',
      ),
    ).toEqual({
      backend: 'filesystem',
      path: '/thinker/.data/request-recordings',
    });
    expect(
      resolveRecordingStorage(
        config({ 'app.requestRecordingStorage': 'filesystem', 'app.nodeEnv': 'production' }),
      ),
    ).toEqual({ backend: 'filesystem', path: '/data/request-recordings' });
    expect(
      resolveRecordingStorage(
        config({
          'app.requestRecordingStorage': 's3',
          'app.requestRecordingS3Bucket': 'recordings',
          'app.requestRecordingS3Endpoint': 'https://storage.example.com',
          'app.requestRecordingS3Region': 'eu-west-1',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        backend: 's3',
        bucket: 'recordings',
        endpoint: 'https://storage.example.com',
        region: 'eu-west-1',
      }),
    );
  });

  it('reports partial S3 credentials instead of silently falling back', () => {
    expect(
      resolveRecordingStorage(
        config({
          'app.requestRecordingStorage': 's3',
          'app.requestRecordingS3Bucket': 'recordings',
          'app.requestRecordingS3Region': 'auto',
          'app.requestRecordingS3AccessKeyId': 'access',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        backend: null,
        reason: expect.stringContaining('either both access-key values or neither'),
      }),
    );
  });

  it('rejects unknown storage modes', () => {
    expect(
      resolveRecordingStorage(config({ 'app.requestRecordingStorage': 'somewhere-else' })),
    ).toEqual({
      backend: null,
      reason: 'Unknown THINKER_RECORDING_STORAGE value "somewhere-else"',
    });
  });
});

describe('legacy recording store', () => {
  it('is the S3 bucket when S3 settings are complete', () => {
    expect(
      resolveLegacyRecordingStorage(
        config({
          'app.requestRecordingS3Bucket': 'recordings',
          'app.requestRecordingS3Region': 'auto',
        }),
      ),
    ).toEqual(expect.objectContaining({ backend: 's3', bucket: 'recordings' }));
  });

  it('is nothing when S3 settings are incomplete', () => {
    expect(
      resolveLegacyRecordingStorage(config({ 'app.requestRecordingS3Bucket': 'recordings' })),
    ).toBeNull();
  });

  it('is the recording directory only when it already exists', () => {
    const settings = config({ 'app.nodeEnv': 'production' });
    expect(resolveLegacyRecordingStorage(settings, '/thinker', () => true)).toEqual({
      backend: 'filesystem',
      path: '/data/request-recordings',
    });
    expect(resolveLegacyRecordingStorage(settings, '/thinker', () => false)).toBeNull();
  });
});

describe('jsonbText', () => {
  it('drops NUL and replaces unpaired surrogates, keeping valid text', () => {
    const text = jsonbText({ a: 'x\u0000y', b: 'bad\ud800', c: 'ok 😀', n: 1 });
    expect(JSON.parse(text)).toEqual({ a: 'xy', b: 'bad\ufffd', c: 'ok 😀', n: 1 });
  });
});

describe('S3RecordingStorage', () => {
  const send = jest.fn();
  const storage = new S3RecordingStorage(
    {
      bucket: 'recordings',
      endpoint: 'https://storage.example.com',
      region: 'auto',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      forcePathStyle: false,
    },
    { send } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('writes opaque encrypted objects to the configured private bucket', async () => {
    send.mockResolvedValue({});

    await storage.put('request-recordings/v1/request-1.json.gz', Buffer.from('body'));

    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toEqual(
      expect.objectContaining({
        Bucket: 'recordings',
        Key: 'request-recordings/v1/request-1.json.gz',
        ContentType: 'application/octet-stream',
      }),
    );
    // The body is ciphertext, so declaring gzip would make S3-compatible stores
    // and CDNs try to decompress it on GET.
    expect(send.mock.calls[0][0].input.ContentEncoding).toBeUndefined();
  });

  it('reads object bytes through the S3 streaming body helper', async () => {
    send.mockResolvedValue({
      Body: { transformToByteArray: jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])) },
    });

    await expect(storage.get('recording.json.gz')).resolves.toEqual(Buffer.from([1, 2, 3]));

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  });

  it('rejects S3 objects without a response body', async () => {
    send.mockResolvedValue({});

    await expect(storage.get('missing.json.gz')).rejects.toThrow(
      'Request recording object has no body',
    );
  });

  it('deletes objects idempotently through the S3 API', async () => {
    send.mockResolvedValue({});

    await storage.delete('recording.json.gz');

    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('can initialize the default AWS client without explicit credentials', async () => {
    const defaultClientStorage = new S3RecordingStorage({
      bucket: 'recordings',
      region: 'eu-west-1',
      forcePathStyle: false,
    });

    await expect(defaultClientStorage.prepare()).resolves.toBeUndefined();
  });
});

describe('RequestRecordingStorageService filesystem driver', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'thinker-recordings-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function filesystemService() {
    return new RequestRecordingStorageService(
      config({
        'app.requestRecordingStorage': 'filesystem',
        'app.requestRecordingFilesystemPath': directory,
      }) as never,
    );
  }

  it('writes, reads, and deletes encrypted recordings through the mounted directory', async () => {
    const service = filesystemService();
    await service.onModuleInit();
    const key = service.objectKey('tenant-1', 'request-1', 'attempt-1');

    expect(key).toBe(
      'request-recordings/v1/tenants/tenant-1/requests/request-1/attempts/attempt-1.json.gz',
    );
    await service.saveRecording(key, RECORDING, OWNER);
    const onDisk = await readFile(join(directory, key));
    expect(onDisk.toString('utf8')).not.toContain('hello');
    await expect(service.loadRecording(key)).resolves.toEqual(RECORDING);
    await service.delete(key);
    await expect(service.loadRecording(key)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('keeps storage segments inside their tenant namespace', async () => {
    const service = filesystemService();
    await service.onModuleInit();

    expect(service.objectKey('../tenant', 'request/1', 'attempt/1')).toBe(
      'request-recordings/v1/tenants/%2E%2E%2Ftenant/requests/request%2F1/attempts/attempt%2F1.json.gz',
    );
    expect(() => service.objectKey('', 'request-1', 'attempt-1')).toThrow(
      'Request recording storage key segments cannot be empty',
    );
  });

  it('continues reading legacy unscoped object keys', async () => {
    const service = filesystemService();
    await service.onModuleInit();
    const legacyKey = 'request-recordings/v1/request-1.json.gz';
    await mkdir(join(directory, 'request-recordings/v1'), { recursive: true });
    await writeFile(join(directory, legacyKey), await encodeRequestRecording(RECORDING));

    await expect(service.loadRecording(legacyKey)).resolves.toEqual(RECORDING);
  });

  it('rejects keys that escape the configured recording directory', async () => {
    const service = filesystemService();
    await service.onModuleInit();

    await expect(service.saveRecording('../outside', RECORDING, OWNER)).rejects.toThrow(
      'Invalid request recording storage key',
    );
  });

  it('initializes S3 storage', async () => {
    const service = new RequestRecordingStorageService(
      config({
        'app.requestRecordingStorage': 's3',
        'app.requestRecordingS3Bucket': 'recordings',
        'app.requestRecordingS3Region': 'eu-west-1',
      }) as never,
    );

    await service.onModuleInit();

    expect(service.backend).toBe('s3');
  });

  it('reports explicitly disabled storage as unavailable', async () => {
    const service = new RequestRecordingStorageService(
      config({ 'app.requestRecordingStorage': 'disabled' }) as never,
    );

    await service.onModuleInit();

    expect(service.backend).toBeNull();
    await expect(service.saveRecording('recording.json.gz', RECORDING, OWNER)).rejects.toThrow(
      'Recording storage was explicitly disabled',
    );
  });

  it('becomes unavailable when filesystem preparation fails', async () => {
    const blockedPath = join(directory, 'blocked');
    await writeFile(blockedPath, 'not a directory');
    const service = new RequestRecordingStorageService(
      config({
        'app.requestRecordingStorage': 'filesystem',
        'app.requestRecordingFilesystemPath': blockedPath,
      }) as never,
    );

    await service.onModuleInit();

    expect(service.backend).toBeNull();
    await expect(service.saveRecording('recording.json.gz', RECORDING, OWNER)).rejects.toThrow(
      'EEXIST',
    );
  });
});

describe('RequestRecordingStorageService PostgreSQL driver', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'thinker-recordings-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('is unavailable without a database connection', async () => {
    const service = new RequestRecordingStorageService(config({}) as never);
    await service.onModuleInit();
    expect(service.backend).toBeNull();
  });

  it('stores readable JSON rows with their owner and deletes them', async () => {
    const db = fakeDb();
    const service = new RequestRecordingStorageService(
      config({ 'app.requestRecordingFilesystemPath': join(directory, 'missing') }) as never,
      db.dataSource,
    );
    await service.onModuleInit();
    expect(service.backend).toBe('postgres');
    expect(service.legacyBackend).toBeNull();

    const key = service.objectKey('tenant-1', 'request-1', 'attempt-1');
    await service.saveRecording(key, RECORDING, OWNER);
    expect(db.rows.get(key)).toEqual({
      payload: RECORDING,
      owner: ['tenant-1', 'request-1', 'attempt-1'],
    });
    await expect(service.loadRecording(key)).resolves.toEqual(RECORDING);

    await service.delete(key);
    expect(db.rows.has(key)).toBe(false);
    await expect(service.loadRecording(key)).rejects.toThrow('Request recording not found');
  });

  it('reads, moves and deletes recordings still in the legacy directory', async () => {
    const db = fakeDb();
    const service = new RequestRecordingStorageService(
      config({ 'app.requestRecordingFilesystemPath': directory }) as never,
      db.dataSource,
    );
    await service.onModuleInit();
    expect(service.legacyBackend).toBe('filesystem');

    const key = service.objectKey('tenant-1', 'request-1', 'attempt-1');
    const file = join(directory, key);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, await encodeRequestRecording(RECORDING));

    // Not moved yet: read through the legacy store.
    await expect(service.loadRecording(key)).resolves.toEqual(RECORDING);

    await expect(service.moveFromLegacy(key, OWNER)).resolves.toBe(true);
    expect(db.rows.get(key)?.payload).toEqual(RECORDING);
    await expect(readFile(file)).rejects.toHaveProperty('code', 'ENOENT');
    await expect(service.loadRecording(key)).resolves.toEqual(RECORDING);
  });

  it('never overwrites a newer PostgreSQL row when moving', async () => {
    const db = fakeDb();
    const service = new RequestRecordingStorageService(
      config({ 'app.requestRecordingFilesystemPath': directory }) as never,
      db.dataSource,
    );
    await service.onModuleInit();
    const key = service.objectKey('tenant-1', 'request-1', 'attempt-1');
    const newer = { ...RECORDING, wire_format: 'anthropic_messages' };
    await service.saveRecording(key, newer, OWNER);
    const file = join(directory, key);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, await encodeRequestRecording(RECORDING));

    await service.moveFromLegacy(key, OWNER);

    expect(db.rows.get(key)?.payload).toEqual(newer);
  });
});
