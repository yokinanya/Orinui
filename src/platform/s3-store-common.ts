import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command,
  PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { XhrHttpHandler } from '@aws-sdk/xhr-http-handler';
import { fail } from '@/domain/errors';
import { validateObjectIdentity } from '@/domain/sync/object-validation';
import type { SyncAssetHead, SyncByteProgress } from '@/domain/sync/object-types';
import type { S3Credentials } from '@/domain/s3-configuration';

export const S3_DELETE_MAX_KEYS = 1000;
export const S3_DESCRIPTOR_VERSION = 1;
export type S3ClientOptions = NonNullable<ConstructorParameters<typeof S3Client>[0]>;

export interface S3StoreRuntime {
  readonly createHandler: () => XhrHttpHandler;
  readonly createClient: (options: S3ClientOptions) => S3Client;
}

export interface S3VaultDescriptor { readonly vaultId: string; readonly ciphertext: Uint8Array; readonly revision: string }
export interface S3ObjectContext {
  readonly credentials: S3Credentials;
  readonly client: S3Client;
  readonly handler: XhrHttpHandler;
  listObjects(prefix: string): AsyncGenerator<{ readonly Key?: string; readonly Size?: number; readonly ETag?: string }>;
  base(...parts: readonly string[]): string;
}

export const S3_RUNTIME: S3StoreRuntime = { createHandler: () => new XhrHttpHandler(),
  createClient: (options) => new S3Client(options) };

export function objectId(value: string, label: string): string {
  const parsed = validateObjectIdentity(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(parsed)) return fail(`${label}不能用于 S3 对象路径`);
  return parsed;
}

function prefixPath(prefix: string, parts: readonly string[]): string {
  return [prefix, ...parts].filter(Boolean).join('/');
}

export function createS3Context(credentials: S3Credentials, runtime: S3StoreRuntime): S3ObjectContext {
  const handler = runtime.createHandler();
  const client = runtime.createClient({ endpoint: credentials.endpoint, region: credentials.region, forcePathStyle: true,
    maxAttempts: 1, requestHandler: handler,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey } });
  async function* listObjects(prefix: string) {
    let continuationToken: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: credentials.bucket, Prefix: prefix,
        ContinuationToken: continuationToken }));
      for (const object of page.Contents ?? []) yield object;
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !continuationToken) throw new Error('S3 分页响应缺少 continuation token');
    } while (continuationToken);
  }
  return { credentials, client, handler, listObjects, base: (...parts) => prefixPath(credentials.prefix, parts) };
}

export function objectEtag(value: string | undefined, label: string): string {
  if (!value || value.startsWith('W/')) throw new Error(`S3 ${label}未返回可用 ETag；请检查 bucket CORS 的 ETag 暴露设置`);
  return value;
}

function statusCode(cause: unknown): number | undefined {
  if (cause && typeof cause === 'object' && '$metadata' in cause) {
    return (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  }
  return undefined;
}

export function isMissingObject(cause: unknown): boolean {
  if (statusCode(cause) === 404) return true;
  return Boolean(cause && typeof cause === 'object' && 'name' in cause
    && ['NotFound', 'NoSuchKey'].includes(String((cause as { name: unknown }).name)));
}

export function isWritePreconditionFailure(cause: unknown): boolean {
  let current = cause;
  while (current instanceof Error) {
    if (statusCode(current) === 412 || ['PreconditionFailed', 'ConditionalRequestConflict'].includes(current.name)) return true;
    current = current.cause;
  }
  return false;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof TypeError) return `${cause.message}；请检查网络、S3 来源权限和 bucket CORS 配置`;
  return cause instanceof Error ? cause.message : String(cause);
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('S3 同步库描述密文格式无效');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function parseS3Descriptor(value: unknown): { readonly vaultId: string; readonly ciphertext: Uint8Array } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('S3 同步库描述格式无效');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).toSorted().join(',') !== 'ciphertext,schemaVersion,vaultId' || raw.schemaVersion !== S3_DESCRIPTOR_VERSION) {
    throw new Error('S3 同步库描述版本不受支持');
  }
  return { vaultId: objectId(String(raw.vaultId), '同步库'), ciphertext: decodeBase64(raw.ciphertext) };
}

export function stringifyS3Descriptor(value: { readonly vaultId: string; readonly ciphertext: Uint8Array }): string {
  return JSON.stringify({ schemaVersion: S3_DESCRIPTOR_VERSION, vaultId: objectId(value.vaultId, '同步库'),
    ciphertext: encodeBase64(value.ciphertext) });
}

function observeProgress(handler: XhrHttpHandler, event: 'xhr.progress' | 'xhr.upload.progress', report?: SyncByteProgress) {
  if (!report) return () => {};
  const listener = (progress: ProgressEvent) => report(progress.loaded, progress.lengthComputable ? progress.total : undefined);
  handler.on(event, listener);
  return () => handler.off(event, listener);
}

export async function readS3Object(input: { readonly context: S3ObjectContext; readonly key: string; readonly label: string;
  readonly revision?: string; readonly progress?: SyncByteProgress }): Promise<{ readonly revision: string; readonly ciphertext: Uint8Array } | null> {
  const { context, key, label, progress } = input;
  const stop = observeProgress(context.handler, 'xhr.progress', progress);
  try {
    const result = await context.client.send(new GetObjectCommand({ Bucket: context.credentials.bucket,
      Key: key, ...(input.revision ? { IfMatch: input.revision } : {}) }));
    if (!result.Body) throw new Error(`S3 ${label}响应缺少 body`);
    const ciphertext = await result.Body.transformToByteArray();
    if (ciphertext.byteLength === 0) throw new Error(`S3 ${label}内容为空`);
    return { revision: objectEtag(result.ETag, label), ciphertext: new Uint8Array(ciphertext) };
  } catch (cause) {
    if (isMissingObject(cause)) return null;
    throw new Error(`S3 读取${label}失败：${errorMessage(cause)}`, { cause });
  } finally { stop(); }
}

export async function statS3Object(context: S3ObjectContext, key: string, label: string): Promise<SyncAssetHead | null> {
  try {
    const head = await context.client.send(new HeadObjectCommand({ Bucket: context.credentials.bucket, Key: key }));
    if (!Number.isSafeInteger(head.ContentLength) || Number(head.ContentLength) < 0) {
      throw new Error(`S3 ${label}缺少准确的 Content-Length`);
    }
    return { revision: objectEtag(head.ETag, label), ciphertextBytes: Number(head.ContentLength) };
  } catch (cause) {
    if (isMissingObject(cause)) return null;
    throw new Error(`S3 查询${label}失败：${errorMessage(cause)}`, { cause });
  }
}

export async function writeS3Object(input: { readonly context: S3ObjectContext; readonly key: string;
  readonly body: Uint8Array; readonly condition?: { readonly IfMatch?: string; readonly IfNoneMatch?: string };
  readonly label: string; readonly progress?: SyncByteProgress }): Promise<string> {
  const { context, key, body, condition, label, progress } = input;
  const stop = observeProgress(context.handler, 'xhr.upload.progress', progress);
  try {
    const result = await context.client.send(new PutObjectCommand({ Bucket: context.credentials.bucket, Key: key,
      Body: body, ContentType: 'application/octet-stream', ...condition }));
    return objectEtag(result.ETag, label);
  } catch (cause) {
    if (isWritePreconditionFailure(cause)) throw new Error(`S3 ${label}条件写入冲突`, { cause });
    throw new Error(`S3 写入${label}失败：${errorMessage(cause)}`, { cause });
  } finally { stop(); }
}

export async function deleteS3Keys(context: S3ObjectContext, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const result = await context.client.send(new DeleteObjectsCommand({ Bucket: context.credentials.bucket,
    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
  if (result.Errors?.length) {
    const failed = result.Errors.map(({ Key, Code }) => `${Key ?? '未知对象'} (${Code ?? '未知错误'})`).join(', ');
    throw new Error(`S3 对象删除部分失败：${failed}`);
  }
}
