import { validateObjectIdentity } from '@/domain/sync/object-validation';

export const S3_CONFIGURATION_VERSION = 1 as const;

export interface S3Credentials {
  readonly endpoint: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface S3Configuration {
  readonly schemaVersion: typeof S3_CONFIGURATION_VERSION;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly credentials: S3Credentials;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(record).toSorted().join(',') !== [...keys].toSorted().join(',')) throw new Error(`${label}字段不正确`);
}

function endpointUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('S3 endpoint 格式不正确');
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) throw new Error('S3 endpoint 必须是无路径、查询参数和凭据的 HTTPS 来源');
  return url.origin;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label}不能为空或包含控制字符`);
  }
  return value.trim();
}

function prefix(value: unknown): string {
  if (typeof value !== 'string') throw new Error('S3 prefix 格式不正确');
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  if (/[\\\u0000-\u001f\u007f]/.test(normalized) || normalized.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('S3 prefix 不能包含反斜杠、控制字符或相对路径');
  }
  return normalized;
}

export function parseS3Credentials(value: unknown): S3Credentials {
  const raw = objectRecord(value, 'S3 凭据');
  exactKeys(raw, ['endpoint', 'bucket', 'prefix', 'region', 'accessKeyId', 'secretAccessKey'], 'S3 凭据');
  const bucket = text(raw.bucket, 'bucket');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) throw new Error('S3 bucket 名称不符合格式');
  return { endpoint: endpointUrl(raw.endpoint), bucket, prefix: prefix(raw.prefix),
    region: text(raw.region, 'region'), accessKeyId: text(raw.accessKeyId, 'Access Key ID'),
    secretAccessKey: text(raw.secretAccessKey, 'Secret Access Key') };
}

export function parseS3Configuration(value: unknown): S3Configuration {
  const raw = objectRecord(value, '本机 S3 配置');
  exactKeys(raw, ['schemaVersion', 'vaultId', 'deviceId', 'credentials'], '本机 S3 配置');
  if (raw.schemaVersion !== S3_CONFIGURATION_VERSION) throw new Error('本机 S3 配置版本不受支持');
  return { schemaVersion: S3_CONFIGURATION_VERSION,
    vaultId: validateObjectIdentity(raw.vaultId, '同步库'), deviceId: validateObjectIdentity(raw.deviceId, '设备'),
    credentials: parseS3Credentials(raw.credentials) };
}

export function s3ObjectPrefix(prefixValue: string, vaultId: string): string {
  const base = prefixValue ? `${prefixValue}/` : '';
  return `${base}vaults/${validateObjectIdentity(vaultId, '同步库')}/`;
}
