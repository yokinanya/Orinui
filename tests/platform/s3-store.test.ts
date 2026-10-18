import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { parseS3Credentials } from '@/domain/s3-configuration';
import { createS3Remote, type S3ClientOptions, type S3StoreRuntime } from '@/platform/s3-store';

interface TestCommand { readonly constructor: { readonly name: string }; readonly input: Record<string, unknown> }
interface ObjectValue { readonly bytes: Uint8Array; readonly etag: string }

class MemoryS3 {
  readonly objects = new Map<string, ObjectValue>();
  private revision = 0;
  async send(command: TestCommand): Promise<unknown> {
    const handlers: Readonly<Record<string, (input: Record<string, unknown>) => unknown>> = {
      HeadBucketCommand: () => ({}), HeadObjectCommand: (input) => this.head(String(input.Key)),
      GetObjectCommand: (input) => this.get(input), PutObjectCommand: (input) => this.put(input),
      ListObjectsV2Command: (input) => this.list(String(input.Prefix ?? '')),
      DeleteObjectsCommand: (input) => this.delete(input),
    };
    const handler = handlers[command.constructor.name];
    if (!handler) throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    return handler(command.input);
  }
  private missing(): never { throw Object.assign(new Error('Not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }); }
  private head(key: string) {
    const object = this.objects.get(key);
    if (!object) return this.missing();
    return { ETag: object.etag, ContentLength: object.bytes.length };
  }
  private get(input: Record<string, unknown>) {
    const object = this.objects.get(String(input.Key));
    if (!object) return this.missing();
    this.checkMatch(input.IfMatch, object.etag);
    return { ETag: object.etag, Body: { transformToByteArray: async () => object.bytes.slice() } };
  }
  private checkMatch(ifMatch: unknown, etag: string) {
    if (typeof ifMatch === 'string' && ifMatch !== etag) {
      throw Object.assign(new Error('Precondition failed'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
    }
  }
  private put(input: Record<string, unknown>) {
    const key = String(input.Key);
    const current = this.objects.get(key);
    if (input.IfNoneMatch === '*' && current) this.checkMatch('*', current.etag);
    if (input.IfMatch !== undefined) this.checkMatch(input.IfMatch, current?.etag ?? 'missing');
    const body = input.Body instanceof Uint8Array ? input.Body.slice() : new TextEncoder().encode(String(input.Body));
    const etag = `"r${++this.revision}"`;
    this.objects.set(key, { bytes: body, etag });
    return { ETag: etag };
  }
  private list(prefix: string) {
    const Contents = [...this.objects].filter(([key]) => key.startsWith(prefix)).map(([Key, value]) => ({ Key, Size: value.bytes.length, ETag: value.etag }));
    return { Contents, IsTruncated: false };
  }
  private delete(input: Record<string, unknown>) {
    const deletion = input.Delete as { Objects: readonly { Key: string }[] };
    for (const { Key } of deletion.Objects) this.objects.delete(Key);
    return {};
  }
}

function testRuntime(memory: MemoryS3): S3StoreRuntime {
  const handler = new EventEmitter();
  return { createHandler: () => Object.assign(handler, { destroy: () => undefined }) as never,
    createClient: (_options: S3ClientOptions) => Object.assign(Object.create(null), {
      send: (command: TestCommand) => memory.send(command), destroy: () => undefined,
    }) as never };
}

const credentials = parseS3Credentials({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'orinui-test-bucket',
  prefix: 'orinui', region: 'auto', accessKeyId: 'access', secretAccessKey: 'secret' });

describe('S3/R2 object store', () => {
  it('validates HTTPS endpoint, bucket, and a path-isolated prefix', () => {
    expect(() => parseS3Credentials({ ...credentials, endpoint: 'http://storage.example.test' })).toThrow(/HTTPS/);
    expect(() => parseS3Credentials({ ...credentials, endpoint: 'https://storage.example.test/path' })).toThrow(/无路径/);
    expect(() => parseS3Credentials({ ...credentials, prefix: '../other' })).toThrow(/相对路径/);
  });

  it('probes atomic conditions, reads sizes, and deletes only the selected vault prefix', async () => {
    const memory = new MemoryS3();
    const remote = createS3Remote(credentials, testRuntime(memory));
    try {
      await remote.verifyConditions({ vaultId: 'vault-a', deviceId: 'device-a' });
      await remote.createVault({ vaultId: 'vault-a', ciphertext: Uint8Array.of(1, 2, 3) });
      const descriptor = await remote.readVault();
      expect(descriptor?.vaultId).toBe('vault-a');
      await remote.objects.createAsset({ vaultId: 'vault-a', objectId: 'wallpaper-a', ciphertext: Uint8Array.of(4, 5) });
      const metadata = await remote.objects.statAsset({ vaultId: 'vault-a', objectId: 'wallpaper-a' });
      expect(metadata?.ciphertextBytes).toBe(2);
      await remote.objects.publishSnapshot({ vaultId: 'vault-a', objectId: 'device-a', expectedRevision: null,
        ciphertext: Uint8Array.of(6, 7, 8) });
      expect(await remote.objects.listSnapshots({ vaultId: 'vault-a' })).toMatchObject([
        { deviceId: 'device-a', ciphertextBytes: 3 },
      ]);
      memory.objects.set('neighbor/vaults/vault-b/assets/keep.enc', { bytes: Uint8Array.of(9), etag: '"neighbor"' });
      expect(await remote.listVaultBytes('vault-a')).toBeGreaterThan(3);
      await remote.deleteVault('vault-a', descriptor!.revision);
      expect(await remote.readVault()).toBeNull();
      expect(memory.objects.has('neighbor/vaults/vault-b/assets/keep.enc')).toBe(true);
    } finally { remote.dispose(); }
  });
});
