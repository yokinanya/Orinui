import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createShortcut, updateShortcut } from '@/storage/shortcuts';
import { createBackupSnapshot } from '@/storage/backup';
import { exportSyncSnapshot } from '@/storage/sync/export';
import { initializeSyncVault, readSyncKey, disconnectSyncVault } from '@/storage/sync/vault';
import { sealSyncExport } from '@/storage/sync/encrypted';
import { planSyncJoin } from '@/storage/sync/join-plan';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { decodeSyncSnapshot, encodeSyncSnapshot } from '@/platform/sync-codec';

const cipher = createSyncCrypto(webcrypto as unknown as Crypto);
let db: Database;

beforeEach(() => { db = createDatabase(`sync-vault-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });

async function setup() {
  const initial = await ensureInitialized(db);
  const shortcut = await createShortcut(db, { groupId: initial.defaultGroup.id, title: '原网站', url: 'https://example.com' });
  const material = await cipher.createKey();
  await initializeSyncVault(db, { vaultId: 'shared-vault', deviceId: 'device-a', key: material.key });
  return { initial, shortcut, material };
}

describe('local sync vault foundation', () => {
  it('seeds stable IDs without including keys or sync metadata in ordinary ZIP backups', async () => {
    const { initial, shortcut } = await setup();
    const exported = await exportSyncSnapshot(db, cipher);
    expect(exported.snapshot.groups.map(({ id }) => id)).toContain(initial.defaultGroup.id);
    expect(exported.snapshot.shortcuts[0]?.id).toBe(shortcut.id);
    const backup = await createBackupSnapshot(db);
    expect(Object.keys(backup)).toEqual(['formatVersion', 'exportedAt', 'groups', 'shortcuts', 'settings', 'assets']);
    expect(JSON.stringify(backup)).not.toContain('sync_records');
  });

  it('persists a non-extractable native CryptoKey across IndexedDB reopen', async () => {
    await setup();
    db.close();
    await db.open();
    const key = await readSyncKey(db, 'shared-vault');
    expect(key.extractable).toBe(false);
    const context = { vaultId: 'shared-vault', kind: 'snapshot' as const, objectId: 'device-a' };
    const plaintext = new TextEncoder().encode('持久化密钥');
    const ciphertext = await cipher.encrypt({ key, context, plaintext });
    expect(await cipher.decrypt({ key, context, ciphertext })).toEqual(plaintext);
  });

  it('exports authenticated binary snapshot objects after real local edits', async () => {
    const { shortcut } = await setup();
    await updateShortcut(db, shortcut.id, { title: '新标题' });
    const sealed = await sealSyncExport(db, { crypto: cipher, encodeSnapshot: encodeSyncSnapshot });
    const key = await readSyncKey(db, sealed.vaultId);
    const context = { vaultId: sealed.vaultId, kind: 'snapshot' as const, objectId: sealed.snapshot.id };
    const bytes = await cipher.decrypt({ key, context, ciphertext: sealed.snapshot.ciphertext });
    const opened = decodeSyncSnapshot(bytes, context);
    expect(opened.shortcuts[0]?.title.value).toBe('新标题');
    expect(opened.generation).toBe(sealed.localGeneration);
  });
});

describe('local sync vault lifecycle', () => {
  it('plans another empty device without keeping its generated default group', async () => {
    const { material } = await setup();
    const remote = (await exportSyncSnapshot(db, cipher)).snapshot;
    const other = createDatabase(`sync-join-${crypto.randomUUID()}`);
    try {
      await initializeSyncVault(other, { vaultId: 'shared-vault', deviceId: 'device-b',
        key: await cipher.importKey(material.recoveryKey) });
      const local = (await exportSyncSnapshot(other, cipher)).snapshot;
      const joined = planSyncJoin({ local, remotes: [remote] });
      expect(joined.generation).toBeGreaterThan(local.generation);
      expect(joined.groups.map(({ id }) => id)).toEqual(remote.groups.map(({ id }) => id));
      expect(joined.defaultGroupId.value).toBe(remote.defaultGroupId.value);
      expect(joined.shortcuts[0]?.title.value).toBe('原网站');
    } finally { await other.delete(); }
  });

  it('disconnects metadata without deleting local websites', async () => {
    await setup();
    await disconnectSyncVault(db);
    expect(await db.sync_state.count()).toBe(0);
    expect(await db.sync_keys.count()).toBe(0);
    expect(await db.shortcuts.count()).toBe(1);
    await expect(exportSyncSnapshot(db, cipher)).rejects.toThrow('尚未配置');
  });
});
