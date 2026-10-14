import type { WebDavConnectionDependencies } from '@/sync/webdav-types';
import { verifyWebDavVault } from '@/sync/webdav-vault';

export async function deleteRemoteWebDavVault(deps: WebDavConnectionDependencies): Promise<void> {
  const expected = await deps.settings.read();
  if (!expected) throw new Error('WebDAV 连接配置不存在');
  await deps.checkPermission(expected.credentials.url);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    const configuration = await deps.settings.read();
    const local = await deps.local.read();
    if (!configuration || JSON.stringify(configuration) !== JSON.stringify(expected)
      || !local || local.vaultId !== expected.vaultId || local.deviceId !== expected.deviceId) {
      throw new Error('本机同步连接已变化，拒绝删除远端同步库');
    }
    const remote = deps.remote(configuration.credentials, configuration.consistencyMode);
    const vault = await remote.readVault();
    if (vault) {
      if (vault.vaultId !== configuration.vaultId) throw new Error('远端同步库身份已变化，拒绝删除');
      await verifyWebDavVault({ crypto: deps.crypto, key: await deps.local.readKey(local.vaultId), ...vault });
    }
    await remote.deleteVault(configuration.vaultId);
    await deps.settings.remove();
    await deps.local.disconnect();
  });
}
