import type { SyncStateRow } from '@/storage/sync/types';
import type { WebDavConfiguration, WebDavSyncStatus } from '@/sync/webdav-types';

type ConnectionIdentity = Pick<WebDavSyncStatus, 'url' | 'username' | 'vaultId' | 'deviceId'>;

function configuredIdentity(config: WebDavConfiguration): ConnectionIdentity {
  return { url: config.credentials.url, username: config.credentials.username, vaultId: config.vaultId, deviceId: config.deviceId };
}

function localStatus(identity: ConnectionIdentity, local: SyncStateRow): WebDavSyncStatus {
  const lastSuccessfulSyncAt = local.lastSuccessfulSync?.at;
  if (local.lastSync?.status === 'running') return { ...identity, state: 'syncing', lastSuccessfulSyncAt };
  if (local.lastSync?.status === 'failed') return { ...identity, state: 'error', lastSuccessfulSyncAt,
    error: local.lastSync.error?.message ?? '同步失败，发布结果请重新检查' };
  const state = local.lastSuccessfulSync?.generation === local.generation ? 'synced' : 'pending';
  return { ...identity, state, lastSuccessfulSyncAt };
}

export function webDavStatus(config: WebDavConfiguration | null, local: SyncStateRow | undefined): WebDavSyncStatus | null {
  if (!config && !local) return null;
  const identity = config ? configuredIdentity(config) : { url: '', username: '', vaultId: local!.vaultId, deviceId: local!.deviceId };
  if (!config || !local || config.vaultId !== local.vaultId || config.deviceId !== local.deviceId) {
    return { ...identity, state: 'error', error: '本机同步连接配置不完整或身份不一致，请断开后重新连接' };
  }
  return localStatus(identity, local);
}
