import { parseWebDavCredentials } from '@/domain/webdav';
import { countWebDavData, sealWebDavVault, verifyWebDavVault } from '@/sync/webdav-vault';
import type { WebDavConnectionDependencies, WebDavConnectionPlan, WebDavPrepareInput,
  WebDavConfiguration } from '@/sync/webdav-types';
import type { WebDavRemote } from '@/platform/webdav-store';
import { WEBDAV_CONFIGURATION_VERSION } from '@/domain/webdav/configuration';
import { WebDavRecoveryRequiredError } from '@/sync/webdav-recovery-required';

export interface PreparedConnection {
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

export async function prepareConnection(deps: WebDavConnectionDependencies, input: WebDavPrepareInput): Promise<PreparedConnection> {
  const credentials = parseWebDavCredentials(input.credentials);
  // This call must remain before the first await, within the user's click gesture.
  const permission = deps.requestPermission(credentials.url);
  const [localConnection, storedConfiguration] = await Promise.all([
    deps.local.read(), deps.settings.read(), permission,
  ]).then(([local, settings]) => [local, settings] as const);
  if (localConnection || storedConfiguration) throw new Error('请先断开当前同步库');
  const remote = deps.remote(credentials, input.consistencyMode);
  const localCountsPromise = deps.local.count();
  const vault = await remote.readVault();
  if (vault && !input.recoveryKey) {
    await localCountsPromise;
    throw new WebDavRecoveryRequiredError({ credentials, consistencyMode: input.consistencyMode, ...vault });
  }
  const material = await prepareKey(deps, { existing: vault !== null, recoveryKey: input.recoveryKey });
  const vaultId = vault?.vaultId ?? deps.createId();
  const ciphertext = vault?.ciphertext ?? await sealWebDavVault({ crypto: deps.crypto, key: material.key, vaultId });
  await verifyWebDavVault({ crypto: deps.crypto, key: material.key, vaultId, ciphertext });
  const [remoteCounts, localCounts] = await Promise.all([
    vault ? countWebDavData({ remote, crypto: deps.crypto, key: material.key, vaultId, decodeSnapshot: deps.decodeSnapshot })
      : Promise.resolve({ groups: 0, shortcuts: 0, assets: 0 }),
    localCountsPromise,
  ]);
  return { remote, key: material.key, ciphertext,
    configuration: { schemaVersion: WEBDAV_CONFIGURATION_VERSION, consistencyMode: input.consistencyMode,
      credentials, vaultId, deviceId: deps.createId() },
    plan: { mode: vault ? 'join' : 'create', consistencyMode: input.consistencyMode,
      url: credentials.url, username: credentials.username,
      recoveryKey: material.recoveryKey, local: localCounts, remote: remoteCounts } };
}

async function checkPreparedVault(deps: WebDavConnectionDependencies, prepared: PreparedConnection): Promise<void> {
  const { configuration, remote, key } = prepared;
  const observed = await remote.readVault();
  if (!observed || observed.vaultId !== configuration.vaultId) throw new Error('远端同步库在确认期间已变化，请重新检查');
  await verifyWebDavVault({ crypto: deps.crypto, key, ...observed });
}

export async function connectPrepared(deps: WebDavConnectionDependencies, prepared: PreparedConnection): Promise<void> {
  const { configuration, key, remote } = prepared;
  await deps.checkPermission(configuration.credentials.url);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    const [localConnection, storedConfiguration] = await Promise.all([deps.local.read(), deps.settings.read()]);
    if (localConnection || storedConfiguration) throw new Error('本机连接在确认期间已变化，请重新检查');
    if (prepared.plan.mode === 'join') await checkPreparedVault(deps, prepared);
    await remote.prepareCollections(configuration);
    await remote.verifyConditions(configuration);
    if (prepared.plan.mode === 'create') await remote.createVault({ vaultId: configuration.vaultId, ciphertext: prepared.ciphertext });
    await deps.local.initialize({ vaultId: configuration.vaultId, deviceId: configuration.deviceId, key });
    await deps.settings.write(configuration);
  });
  await deps.synchronize(remote.objects, configuration);
}
