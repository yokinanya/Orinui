import { randomUUID, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { decodeSyncSnapshot } from '@/platform/sync-codec';
import type { WebDavRemote } from '@/platform/webdav-store';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createWebDavLocalConnection } from '@/storage/webdav-local';
import type { WebDavConfiguration, WebDavConfigurationStore } from '@/sync/webdav-types';
import { createWebDavSyncService } from '@/sync/webdav-connection';
import { sealWebDavVault } from '@/sync/webdav-vault';

const crypto = createSyncCrypto(webcrypto as unknown as Crypto);
const credentials = { url: 'https://dav.example.test/orinui/', username: 'user', password: 'pass' };
const databases: Database[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((db) => db.delete())));

function memorySettings(): WebDavConfigurationStore & { value: WebDavConfiguration | null } {
  return { value: null, async read() { return this.value; }, async write(value) { this.value = value; },
    async remove() { this.value = null; } };
}

function remoteHarness() {
  let vault: { vaultId: string; ciphertext: Uint8Array } | null = null;
  const events: string[] = [];
  const remote: WebDavRemote = {
    objects: { async listSnapshots() { return []; }, async readSnapshot() { throw new Error('unused'); },
      async readAsset() { return null; }, async createAsset() { throw new Error('unused'); },
      async publishSnapshot() { throw new Error('unused'); } },
    async readVault() { return vault && { ...vault, ciphertext: vault.ciphertext.slice() }; },
    async createVault(input) {
      events.push('createVault');
      if (vault) throw new Error('WebDAV 同步库描述已存在，拒绝覆盖');
      vault = { vaultId: input.vaultId, ciphertext: input.ciphertext.slice() };
    },
    async prepareCollections() { events.push('prepareCollections'); },
    async verifyConditions() { events.push('verifyConditions'); },
  };
  return { remote, events, get vault() { return vault; }, set vault(value) { vault = value; } };
}

async function harness(options: { readonly synchronize?: () => Promise<never>;
  readonly settings?: WebDavConfigurationStore; readonly requestPermission?: () => Promise<void> } = {}) {
  const db = createDatabase(`webdav-connection-${randomUUID()}`);
  databases.push(db);
  await ensureInitialized(db);
  const settings = (options.settings ?? memorySettings()) as ReturnType<typeof memorySettings>;
  const provider = remoteHarness();
  const ids = ['vault-local', 'device-local'];
  let idIndex = 0;
  const service = createWebDavSyncService({
    local: createWebDavLocalConnection(db), settings, crypto, decodeSnapshot: decodeSyncSnapshot,
    lock: { async runExclusive(_scope, op) { return op(); } },
    requestPermission: options.requestPermission ?? (async () => undefined), checkPermission: async () => undefined,
    remote: () => provider.remote,
    synchronize: options.synchronize ?? (async () => ({ runId: 'run', vaultId: 'vault-local', deviceId: 'device-local',
      state: 'synced', publishedGeneration: 0, localGeneration: 0, revision: '"rev"', uploadedAssets: 0,
      downloadedAssets: 0, repairedAssetIds: [] })),
    createId: () => ids[idIndex++] ?? `id-${idIndex}`,
  });
  return { db, settings, provider, service };
}

async function encryptedVault(vaultId: string, recoveryKey?: string) {
  const keyMaterial = recoveryKey ? { key: await crypto.importKey(recoveryKey), recoveryKey: undefined }
    : await crypto.createKey();
  return { recoveryKey: keyMaterial.recoveryKey, vault: { vaultId,
    ciphertext: await sealWebDavVault({ crypto, key: keyMaterial.key, vaultId }) } };
}

it('creates a vault only after confirmation and remains pending until synchronization succeeds', async () => {
    const h = await harness();
    const plan = await h.service.prepare({ credentials, consistencyMode: 'strong-etag' });
    expect(plan.mode).toBe('create');
    expect(plan.recoveryKey).toBeTruthy();
    expect(await h.db.sync_state.count()).toBe(0);
    expect(await h.db.sync_keys.count()).toBe(0);
    expect(h.settings.value).toBeNull();
    await h.service.connect();
    expect(h.provider.events).toEqual(['prepareCollections', 'verifyConditions', 'createVault']);
    expect((await h.service.read())?.state).toBe('pending');
});

it('rejects a wrong recovery key without local writes, then accepts the correct key', async () => {
    const existing = await encryptedVault('vault-remote');
    const h = await harness();
    h.provider.vault = existing.vault;
    await expect(h.service.prepare({ credentials, consistencyMode: 'strong-etag', recoveryKey: 'invalid recovery key' })).rejects.toThrow();
    expect(await h.db.sync_state.count()).toBe(0);
    expect(h.settings.value).toBeNull();
    const plan = await h.service.prepare({ credentials, consistencyMode: 'strong-etag', recoveryKey: existing.recoveryKey });
    expect(plan.mode).toBe('join');
    expect(await h.db.sync_keys.count()).toBe(0);
    expect(h.settings.value).toBeNull();
    await h.service.connect();
    expect((await h.service.read())?.vaultId).toBe('vault-remote');
});

it('detects vault creation races and remote identity changes during confirmation', async () => {
    const h = await harness();
    await h.service.prepare({ credentials, consistencyMode: 'strong-etag' });
    h.provider.vault = (await encryptedVault('racing-vault')).vault;
    await expect(h.service.connect()).rejects.toThrow('拒绝覆盖');
    expect(await h.db.sync_state.count()).toBe(0);
    expect(h.settings.value).toBeNull();

    const joined = await encryptedVault('vault-remote');
    h.provider.vault = joined.vault;
    await h.service.prepare({ credentials, consistencyMode: 'strong-etag', recoveryKey: joined.recoveryKey });
    h.provider.vault = (await encryptedVault('changed-vault')).vault;
    await expect(h.service.connect()).rejects.toThrow('确认期间已变化');
    expect(await h.db.sync_state.count()).toBe(0);
});

it('propagates publication failure and does not report the connection as synced', async () => {
    const h = await harness({ synchronize: async () => { throw new Error('snapshot publication failed'); } });
    await h.service.prepare({ credentials, consistencyMode: 'strong-etag' });
    await expect(h.service.connect()).rejects.toThrow('snapshot publication failed');
    expect((await h.service.read())?.state).toBe('pending');
});

it('reports orphaned configuration and disconnect preserves domain rows', async () => {
    const settings = memorySettings();
    settings.value = { schemaVersion: 2, consistencyMode: 'strong-etag', vaultId: 'orphan-vault', deviceId: 'orphan-device', credentials };
    const h = await harness({ settings });
    expect((await h.service.read())?.state).toBe('error');
    await expect(h.service.syncNow()).rejects.toThrow('身份不一致');
    settings.value = null;
    await h.service.prepare({ credentials, consistencyMode: 'strong-etag' });
    await h.service.connect();
    const groupsBefore = await h.db.groups.toArray();
    await h.service.disconnect();
    expect(await h.db.groups.toArray()).toEqual(groupsBefore);
    expect(await h.db.sync_state.count()).toBe(0);
    expect(await h.db.sync_keys.count()).toBe(0);
    expect(settings.value).toBeNull();
});

it('does not restore a prepared plan after cancellation during preparation', async () => {
  let finishPermission = (): void => undefined;
  let permissionRequested = false;
  const permission = new Promise<void>((resolve) => { finishPermission = resolve; });
  const h = await harness({ requestPermission: () => { permissionRequested = true; return permission; } });
  const preparing = h.service.prepare({ credentials, consistencyMode: 'strong-etag' });
  expect(permissionRequested).toBe(true);
  h.service.cancelPlan();
  finishPermission();
  await expect(preparing).rejects.toThrow('连接准备已取消');
  await expect(h.service.connect()).rejects.toThrow('请先检查 WebDAV 连接');
  expect(await h.db.sync_state.count()).toBe(0);
  expect(h.settings.value).toBeNull();
});
