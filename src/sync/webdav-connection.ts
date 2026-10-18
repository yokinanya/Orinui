import type { WebDavConnectionDependencies, WebDavSyncService } from '@/sync/webdav-types';
import { webDavStatus } from '@/sync/webdav-status';
import { verifyWebDavVault } from '@/sync/webdav-vault';
import { deleteRemoteWebDavVault } from '@/sync/webdav-delete';
import { createWebDavPreparation } from '@/sync/webdav-preparation';
import type { SyncProgressReporter } from '@/sync/ports';

async function syncConnected(deps: WebDavConnectionDependencies, reportProgress?: SyncProgressReporter) {
  const configuration = await deps.settings.read();
  if (!configuration) throw new Error('WebDAV 连接配置不存在');
  await deps.checkPermission(configuration.credentials.url);
  const local = await deps.local.read();
  if (!local || local.vaultId !== configuration.vaultId || local.deviceId !== configuration.deviceId) {
    throw new Error('本机同步连接身份不一致，请断开后重新连接');
  }
  const remote = deps.remote(configuration.credentials, configuration.consistencyMode);
  const vault = await remote.readVault();
  if (!vault || vault.vaultId !== configuration.vaultId) throw new Error('远端同步库已删除或身份变化，请重新检查连接');
  await verifyWebDavVault({ crypto: deps.crypto, key: await deps.local.readKey(local.vaultId), ...vault });
  return deps.synchronize(remote.objects, configuration, reportProgress);
}

async function previewConnected(deps: WebDavConnectionDependencies, reportProgress?: SyncProgressReporter) {
  const configuration = await deps.settings.read();
  if (!configuration) throw new Error('WebDAV 连接配置不存在');
  await deps.checkPermission(configuration.credentials.url);
  const local = await deps.local.read();
  if (!local || local.vaultId !== configuration.vaultId || local.deviceId !== configuration.deviceId) {
    throw new Error('本机同步连接身份不一致，请断开后重新连接');
  }
  const remote = deps.remote(configuration.credentials, configuration.consistencyMode);
  const vault = await remote.readVault();
  if (!vault || vault.vaultId !== configuration.vaultId) throw new Error('远端同步库已删除或身份变化，请重新检查连接');
  await verifyWebDavVault({ crypto: deps.crypto, key: await deps.local.readKey(local.vaultId), ...vault });
  return deps.previewSizes(remote.objects, configuration, reportProgress);
}

export function createWebDavSyncService(deps: WebDavConnectionDependencies): WebDavSyncService {
  const preparation = createWebDavPreparation(deps);
  return {
    ...preparation,
    async read() { return webDavStatus(await deps.settings.read(), await deps.local.read()); },
    async deleteRemote() { preparation.cancelPlan(); await deleteRemoteWebDavVault(deps); },
    previewSizes: (reportProgress) => previewConnected(deps, reportProgress),
    syncNow: (reportProgress) => syncConnected(deps, reportProgress),
    async disconnect() {
      preparation.cancelPlan();
      await deps.lock.runExclusive(deps.local.scope, async () => {
        await deps.settings.remove();
        await deps.local.disconnect();
      });
    },
  };
}
