import { parseWebDavCredentials, validateWebDavIdentity, type WebDavCredentials } from '@/domain/webdav/validation';

export const WEBDAV_CONFIGURATION_VERSION = 1;

export interface WebDavConfiguration {
  readonly schemaVersion: 1;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly credentials: WebDavCredentials;
}

function configurationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机 WebDAV 配置格式不正确');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).toSorted().join(',') !== 'credentials,deviceId,schemaVersion,vaultId'
    || config.schemaVersion !== WEBDAV_CONFIGURATION_VERSION || typeof config.vaultId !== 'string'
    || typeof config.deviceId !== 'string') throw new Error('本机 WebDAV 配置版本或身份无效');
  return config;
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
  return { schemaVersion: WEBDAV_CONFIGURATION_VERSION, vaultId: validateWebDavIdentity(config.vaultId as string, '同步库'),
    deviceId: validateWebDavIdentity(config.deviceId as string, '设备'), credentials: parseWebDavCredentials(credentialRecord(config.credentials)) };
}

export function validateWebDavVaultDescriptor(value: unknown, vaultId: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WebDAV 同步库解密描述无效');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).toSorted().join(',') !== 'schemaVersion,vaultId'
    || record.schemaVersion !== WEBDAV_CONFIGURATION_VERSION || record.vaultId !== vaultId) {
    throw new Error('WebDAV 同步库描述版本或身份不一致');
  }
}
