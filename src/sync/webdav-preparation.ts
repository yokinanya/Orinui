import type { WebDavConnectionDependencies, WebDavSyncService } from '@/sync/webdav-types';
import { prepareConnection, connectPrepared, type PreparedConnection } from '@/sync/webdav-prepare';
import { WebDavRecoveryRequiredError, resetWebDavVault, type WebDavResetTarget } from '@/sync/webdav-recovery-required';

export function createWebDavPreparation(deps: WebDavConnectionDependencies):
  Pick<WebDavSyncService, 'prepare' | 'connect' | 'cancelPlan' | 'resetRemote'> {
  let prepared: PreparedConnection | null = null;
  let resetTarget: WebDavResetTarget | null = null;
  let preparationId = 0;
  return {
    async prepare(input) {
      const identity = ++preparationId;
      prepared = null;
      resetTarget = null;
      const result = await prepareConnection(deps, input).catch((cause: unknown) => {
        if (identity !== preparationId) throw new Error('连接准备已取消或本机连接变化，请重新检查');
        if (cause instanceof WebDavRecoveryRequiredError) resetTarget = cause.target;
        throw cause;
      });
      if (identity !== preparationId) throw new Error('连接准备已取消或本机连接变化，请重新检查');
      prepared = result;
      return result.plan;
    },
    async connect() {
      if (!prepared) throw new Error('请先检查 WebDAV 连接');
      const current = prepared;
      try { await connectPrepared(deps, current); }
      finally { prepared = null; }
    },
    cancelPlan() { preparationId += 1; prepared = null; resetTarget = null; },
    async resetRemote() {
      if (!resetTarget) throw new Error('请留空恢复密钥重新检查连接');
      const target = resetTarget;
      await resetWebDavVault(deps, target);
      resetTarget = null;
    },
  };
}
