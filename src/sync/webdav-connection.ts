import { parseWebDavCredentials } from '@/domain/webdav';
import { webDavStatus } from '@/sync/webdav-status';
import { countWebDavData, sealWebDavVault, verifyWebDavVault } from '@/sync/webdav-vault';
import type { WebDavConnectionDependencies, WebDavConnectionPlan, WebDavPrepareInput, WebDavSyncService,
  WebDavConfiguration } from '@/sync/webdav-types';
import type { WebDavRemote } from '@/platform/webdav-store';
import { WEBDAV_CONFIGURATION_VERSION } from '@/domain/webdav/configuration';

interface PreparedConnection {
  readonly plan: WebDavConnectionPlan;
  readonly configuration: WebDavConfiguration;
  readonly key: CryptoKey;
  readonly remote: WebDavRemote;
  readonly ciphertext: Uint8Array;
}

async function prepareKey(deps: WebDavConnectionDependencies,
  input: { readonly existing: boolean; readonly recoveryKey: string | undefined }) {
  if (input.existing) {
    if (!input.recoveryKey) throw new Error('该文件夹已有同步库，请输入恢复密钥后重新检查连接');
    return { key: await deps.crypto.importKey(input.recoveryKey), recoveryKey: undefined };
  }
  if (input.recoveryKey) throw new Error('未找到同步库，请确认地址；创建新库请清空恢复密钥');
  return deps.crypto.createKey();
}

async function prepareConnection(deps: WebDavConnectionDependencies, input: WebDavPrepareInput): Promise<PreparedConnection> {
  const credentials = parseWebDavCredentials(input.credentials);
  // This call must remain before the first await, within the user's click gesture.
  const permission = deps.requestPermission(credentials.url);
  await permission;
  if (await deps.local.read() || await deps.settings.read()) throw new Error('请先断开当前同步库');
  const remote = deps.remote(credentials);
  const vault = await remote.readVault();
  const material = await prepareKey(deps, { existing: vault !== null, recoveryKey: input.recoveryKey });
  const vaultId = vault?.vaultId ?? deps.createId();
  const ciphertext = vault?.ciphertext ?? await sealWebDavVault({ crypto: deps.crypto, key: material.key, vaultId });
  await verifyWebDavVault({ crypto: deps.crypto, key: material.key, vaultId, ciphertext });
  const remoteCounts = vault ? await countWebDavData({ remote, crypto: deps.crypto, key: material.key, vaultId, decodeSnapshot: deps.decodeSnapshot })
    : { groups: 0, shortcuts: 0, assets: 0 };
  return { remote, key: material.key, ciphertext,
    configuration: { schemaVersion: WEBDAV_CONFIGURATION_VERSION, credentials, vaultId, deviceId: deps.createId() },
    plan: { mode: vault ? 'join' : 'create', url: credentials.url, username: credentials.username,
      recoveryKey: material.recoveryKey, local: await deps.local.count(), remote: remoteCounts } };
}

async function checkPreparedVault(deps: WebDavConnectionDependencies, prepared: PreparedConnection): Promise<void> {
  const { configuration, remote, key } = prepared;
  const observed = await remote.readVault();
  if (prepared.plan.mode === 'create') {
    if (observed) throw new Error('该文件夹刚被另一设备创建，请使用其恢复密钥重新连接');
    return;
  }
  if (!observed || observed.vaultId !== configuration.vaultId) throw new Error('远端同步库在确认期间已变化，请重新检查');
  await verifyWebDavVault({ crypto: deps.crypto, key, ...observed });
}

async function connectPrepared(deps: WebDavConnectionDependencies, prepared: PreparedConnection): Promise<void> {
  const { configuration, key, remote } = prepared;
  await deps.checkPermission(configuration.credentials.url);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    if (await deps.local.read() || await deps.settings.read()) throw new Error('本机连接在确认期间已变化，请重新检查');
    await checkPreparedVault(deps, prepared);
    await remote.prepareCollections(configuration);
    await remote.verifyConditions(configuration);
    if (prepared.plan.mode === 'create') await remote.createVault({ vaultId: configuration.vaultId, ciphertext: prepared.ciphertext });
    const published = await remote.readVault();
    if (!published || published.vaultId !== configuration.vaultId) throw new Error('远端同步库创建结果无法确认');
    await verifyWebDavVault({ crypto: deps.crypto, key, ...published });
    await deps.local.initialize({ vaultId: configuration.vaultId, deviceId: configuration.deviceId, key });
    await deps.settings.write(configuration);
  });
  await deps.synchronize(remote.objects, configuration);
}

export function createWebDavSyncService(deps: WebDavConnectionDependencies): WebDavSyncService {
  let prepared: PreparedConnection | null = null;
  let preparationId = 0;
  return {
    async read() { return webDavStatus(await deps.settings.read(), await deps.local.read()); },
    async prepare(input) {
      const identity = ++preparationId;
      prepared = null;
      const result = await prepareConnection(deps, input);
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
    cancelPlan() { preparationId += 1; prepared = null; },
    async syncNow() {
      const configuration = await deps.settings.read();
      if (!configuration) throw new Error('WebDAV 连接配置不存在');
      await deps.checkPermission(configuration.credentials.url);
      const local = await deps.local.read();
      if (!local || local.vaultId !== configuration.vaultId || local.deviceId !== configuration.deviceId) {
        throw new Error('本机同步连接身份不一致，请断开后重新连接');
      }
      const remote = deps.remote(configuration.credentials);
      const vault = await remote.readVault();
      if (!vault || vault.vaultId !== configuration.vaultId) throw new Error('远端同步库已删除或身份变化，请重新检查连接');
      await verifyWebDavVault({ crypto: deps.crypto, key: await deps.local.readKey(local.vaultId), ...vault });
      return deps.synchronize(remote.objects, configuration);
    },
    async disconnect() {
      preparationId += 1;
      prepared = null;
      await deps.lock.runExclusive(deps.local.scope, async () => {
        await deps.settings.remove();
        await deps.local.disconnect();
      });
    },
  };
}
