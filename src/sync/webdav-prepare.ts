import { parseWebDavCredentials } from '@/domain/webdav';
import { countWebDavData, sealWebDavVault, verifyWebDavVault } from '@/sync/webdav-vault';
import type { WebDavConnectionDependencies, WebDavConnectionPlan, WebDavPrepareInput,
  WebDavConfiguration } from '@/sync/webdav-types';
import type { WebDavRemote } from '@/platform/webdav-store';
import type { SyncProgressReporter } from '@/sync/ports';
import { WEBDAV_CONFIGURATION_VERSION } from '@/domain/webdav/configuration';
import { WebDavRecoveryRequiredError } from '@/sync/webdav-recovery-required';

export interface PreparedConnection {
  readonly plan: WebDavConnectionPlan;
  readonly configuration: WebDavConfiguration;
  readonly key: CryptoKey;
  readonly remote: WebDavRemote;
  readonly ciphertext: Uint8Array;
}

interface VaultMaterial {
  readonly vaultId: string;
  readonly key: CryptoKey;
  readonly ciphertext: Uint8Array;
  readonly recoveryKey?: string;
}

async function prepareVaultMaterial(deps: WebDavConnectionDependencies, input: WebDavPrepareInput,
  vault: Awaited<ReturnType<WebDavRemote['readVault']>>): Promise<VaultMaterial> {
  const material = await prepareKey(deps, { existing: vault !== null, recoveryKey: input.recoveryKey });
  const vaultId = vault?.vaultId ?? deps.createId();
  const ciphertext = vault?.ciphertext ?? await sealWebDavVault({ crypto: deps.crypto, key: material.key, vaultId });
  await verifyWebDavVault({ crypto: deps.crypto, key: material.key, vaultId, ciphertext });
  return { vaultId, key: material.key, ciphertext, recoveryKey: material.recoveryKey };
}

async function readConnectionCounts(input: { readonly deps: WebDavConnectionDependencies; readonly remote: WebDavRemote;
  readonly vaultId: string; readonly key: CryptoKey; readonly vaultExists: boolean;
  readonly local: Promise<Awaited<ReturnType<WebDavConnectionDependencies['local']['count']>>> }) {
  const remoteCount = input.vaultExists
    ? countWebDavData({ objects: input.remote.objects, crypto: input.deps.crypto, key: input.key,
      vaultId: input.vaultId, decodeSnapshot: input.deps.decodeSnapshot })
    : Promise.resolve({ folders: 0, shortcuts: 0, assets: 0, assetBytes: 0 });
  const remoteBytes = input.vaultExists ? input.remote.measureVaultBytes(input.vaultId) : Promise.resolve(0);
  return Promise.all([remoteCount, input.local, remoteBytes]);
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
  const [localConnection, storedConfiguration, otherProvider] = await Promise.all([
    deps.local.read(), deps.settings.read(), deps.hasOtherProviderConfiguration?.() ?? Promise.resolve(false), permission,
  ]);
  if (localConnection || storedConfiguration || otherProvider) throw new Error('请先断开当前同步库');
  const remote = deps.remote(credentials, input.consistencyMode);
  const localCountsPromise = deps.local.count();
  const vault = await remote.readVault();
  if (vault && !input.recoveryKey) {
    await localCountsPromise;
    throw new WebDavRecoveryRequiredError({ credentials, consistencyMode: input.consistencyMode, ...vault });
  }
  const material = await prepareVaultMaterial(deps, input, vault);
  const [remoteCounts, localCounts, remoteObjectBytes] = await readConnectionCounts({ deps, remote,
    vaultId: material.vaultId, key: material.key, vaultExists: vault !== null, local: localCountsPromise });
  const configuration: WebDavConfiguration = { schemaVersion: WEBDAV_CONFIGURATION_VERSION, consistencyMode: input.consistencyMode,
    credentials, vaultId: material.vaultId, deviceId: deps.createId() };
  return { remote, key: material.key, ciphertext: material.ciphertext, configuration,
    plan: { mode: vault ? 'join' as const : 'create' as const, consistencyMode: input.consistencyMode,
      url: credentials.url, username: credentials.username, recoveryKey: material.recoveryKey,
      local: localCounts, remote: remoteCounts, remoteObjectBytes } };
}

async function checkPreparedVault(deps: WebDavConnectionDependencies, prepared: PreparedConnection): Promise<void> {
  const { configuration, remote, key } = prepared;
  const observed = await remote.readVault();
  if (!observed || observed.vaultId !== configuration.vaultId) throw new Error('远端同步库在确认期间已变化，请重新检查');
  await verifyWebDavVault({ crypto: deps.crypto, key, ...observed });
}

export async function connectPrepared(deps: WebDavConnectionDependencies, prepared: PreparedConnection,
  reportProgress?: SyncProgressReporter): Promise<void> {
  const { configuration, key, remote } = prepared;
  await deps.checkPermission(configuration.credentials.url);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    const [localConnection, storedConfiguration] = await Promise.all([deps.local.read(), deps.settings.read()]);
    if (localConnection || storedConfiguration || await deps.hasOtherProviderConfiguration?.()) {
      throw new Error('本机同步提供方在确认期间已变化，请重新检查');
    }
    if (prepared.plan.mode === 'join') await checkPreparedVault(deps, prepared);
    await remote.prepareCollections(configuration);
    await remote.verifyConditions(configuration);
    if (prepared.plan.mode === 'create') await remote.createVault({ vaultId: configuration.vaultId, ciphertext: prepared.ciphertext });
    await deps.local.initialize({ vaultId: configuration.vaultId, deviceId: configuration.deviceId, key });
    await deps.settings.write(configuration);
  });
  await deps.synchronize(remote.objects, configuration, reportProgress);
}
