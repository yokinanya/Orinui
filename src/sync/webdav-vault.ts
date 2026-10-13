import type { SyncCrypto } from '@/platform/sync-crypto-types';
import type { WebDavRemote } from '@/platform/webdav-store';
import { parseSnapshotHeads, parseObjectRead } from '@/domain/sync/object-validation';
import type { SyncCodec } from '@/sync/ports';
import { materializeSyncSnapshot, mergeSyncSnapshots } from '@/domain/sync';
import type { WebDavCounts } from '@/sync/webdav-types';
import { validateWebDavVaultDescriptor, WEBDAV_CONFIGURATION_VERSION } from '@/domain/webdav/configuration';

export async function sealWebDavVault(input: { readonly crypto: SyncCrypto; readonly key: CryptoKey;
  readonly vaultId: string }): Promise<Uint8Array> {
  return input.crypto.encrypt({ key: input.key,
    context: { vaultId: input.vaultId, kind: 'snapshot', objectId: input.vaultId },
    plaintext: new TextEncoder().encode(JSON.stringify({ schemaVersion: WEBDAV_CONFIGURATION_VERSION, vaultId: input.vaultId })),
  });
}

export async function verifyWebDavVault(input: { readonly crypto: SyncCrypto; readonly key: CryptoKey;
  readonly vaultId: string; readonly ciphertext: Uint8Array }): Promise<void> {
  const plaintext = await input.crypto.decrypt({ key: input.key,
    context: { vaultId: input.vaultId, kind: 'snapshot', objectId: input.vaultId }, ciphertext: input.ciphertext });
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  validateWebDavVaultDescriptor(value, input.vaultId);
}

export async function countWebDavData(input: { readonly remote: WebDavRemote; readonly crypto: SyncCrypto;
  readonly key: CryptoKey; readonly vaultId: string; readonly decodeSnapshot: SyncCodec['decode'] }): Promise<WebDavCounts> {
  const heads = parseSnapshotHeads(await input.remote.objects.listSnapshots({ vaultId: input.vaultId }));
  const snapshots = await Promise.all(heads.map(async (head) => {
    const object = parseObjectRead(await input.remote.objects.readSnapshot({ vaultId: input.vaultId,
      objectId: head.deviceId, revision: head.revision }));
    if (object.revision !== head.revision) throw new Error('WebDAV 快照在预览期间发生变化');
    const context = { vaultId: input.vaultId, kind: 'snapshot' as const, objectId: head.deviceId };
    const bytes = await input.crypto.decrypt({ key: input.key, context, ciphertext: object.ciphertext });
    return input.decodeSnapshot(bytes, context);
  }));
  const first = snapshots[0];
  if (!first) return { groups: 0, shortcuts: 0, assets: 0 };
  const merged = mergeSyncSnapshots({ local: first, remotes: snapshots.slice(1) });
  const data = materializeSyncSnapshot(merged);
  return { groups: data.groups.length, shortcuts: data.shortcuts.length, assets: data.assets.length };
}
