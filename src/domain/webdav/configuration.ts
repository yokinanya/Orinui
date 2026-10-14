import { parseWebDavCredentials, validateWebDavIdentity, type WebDavCredentials } from '@/domain/webdav/validation';

export const WEBDAV_CONFIGURATION_VERSION = 2;
export const WEBDAV_VAULT_DESCRIPTOR_VERSION = 1;

export type WebDavConsistencyMode = 'strong-etag' | 'readback-only';

export interface WebDavConfiguration {
  readonly schemaVersion: 2;
  readonly consistencyMode: WebDavConsistencyMode;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly credentials: WebDavCredentials;
}

function configurationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机 WebDAV 配置格式不正确');
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).toSorted().join(',');
  const legacy = keys === 'credentials,deviceId,schemaVersion,vaultId' && config.schemaVersion === 1;
  const current = keys === 'consistencyMode,credentials,deviceId,schemaVersion,vaultId'
    && config.schemaVersion === WEBDAV_CONFIGURATION_VERSION;
  if ((!legacy && !current) || (current && config.consistencyMode !== 'strong-etag' && config.consistencyMode !== 'readback-only')
    || typeof config.vaultId !== 'string'
    || typeof config.deviceId !== 'string') throw new Error('本机 WebDAV 配置版本或身份无效');
  return legacy ? { ...config, consistencyMode: 'strong-etag' } : config;
}

function credentialRecord(value: unknown): WebDavCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机 WebDAV 凭据格式不正确');
  const credentials = value as Record<string, unknown>;
  if (Object.keys(credentials).toSorted().join(',') !== 'password,url,username'
    || typeof credentials.url !== 'string' || typeof credentials.username !== 'string'
    || typeof credentials.password !== 'string') throw new Error('本机 WebDAV 凭据格式不正确');
  return { url: credentials.url, username: credentials.username, password: credentials.password };
}

export function parseWebDavConfiguration(value: unknown): WebDavConfiguration {
  const config = configurationRecord(value);
  return { schemaVersion: WEBDAV_CONFIGURATION_VERSION, consistencyMode: config.consistencyMode as WebDavConsistencyMode,
    vaultId: validateWebDavIdentity(config.vaultId as string, '同步库'),
    deviceId: validateWebDavIdentity(config.deviceId as string, '设备'), credentials: parseWebDavCredentials(credentialRecord(config.credentials)) };
}

export function validateWebDavVaultDescriptor(value: unknown, vaultId: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WebDAV 同步库解密描述无效');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).toSorted().join(',') !== 'schemaVersion,vaultId'
    || record.schemaVersion !== WEBDAV_VAULT_DESCRIPTOR_VERSION || record.vaultId !== vaultId) {
    throw new Error('WebDAV 同步库描述版本或身份不一致');
  }
}
