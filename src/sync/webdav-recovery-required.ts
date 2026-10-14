import type { WebDavCredentials } from '@/domain/webdav';
import type { WebDavConsistencyMode } from '@/domain/webdav/configuration';
import type { WebDavConnectionDependencies } from '@/sync/webdav-types';
import { equalBytes } from '@/platform/webdav-resource';

export interface WebDavResetTarget {
  readonly credentials: WebDavCredentials;
  readonly consistencyMode: WebDavConsistencyMode;
  readonly vaultId: string;
  readonly ciphertext: Uint8Array;
}

export class WebDavRecoveryRequiredError extends Error {
  constructor(readonly target: WebDavResetTarget) {
    super('该文件夹已有同步库，请输入恢复密钥后重新检查连接');
    this.name = 'WebDavRecoveryRequiredError';
  }
}

export async function resetWebDavVault(deps: WebDavConnectionDependencies, target: WebDavResetTarget): Promise<void> {
  await deps.checkPermission(target.credentials.url);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    if (await deps.local.read() || await deps.settings.read()) throw new Error('本机已连接同步库，请使用已连接面板删除');
    const remote = deps.remote(target.credentials, target.consistencyMode);
    const current = await remote.readVault();
    if (current && (current.vaultId !== target.vaultId || !equalBytes(current.ciphertext, target.ciphertext))) {
      throw new Error('远端同步库在确认期间已变化，请重新检查连接');
    }
    await remote.deleteVault(target.vaultId);
  });
}
