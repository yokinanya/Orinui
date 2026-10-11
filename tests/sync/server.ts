import type { SyncObjectStore, SyncObjectRead, SyncSnapshotHead } from '@/sync/objects';
import type { SyncAssetReceipt, SyncPublishReceipt } from '@/sync/objects';

interface StoredObject {
  readonly revision: string;
  readonly ciphertext: Uint8Array;
}

export type ServerEvent =
  | { readonly kind: 'list'; readonly vaultId: string }
  | { readonly kind: 'read-snapshot'; readonly objectId: string }
  | { readonly kind: 'read-asset'; readonly objectId: string }
  | { readonly kind: 'create-asset'; readonly objectId: string }
  | { readonly kind: 'publish'; readonly objectId: string };

export interface SyncObjectServerHooks {
  readonly afterListSnapshots?: () => Promise<void>;
  readonly beforeReadSnapshot?: (objectId: string) => Promise<void>;
  readonly beforeCreateAsset?: (objectId: string) => Promise<void>;
  readonly beforePublish?: (objectId: string) => Promise<void>;
  readonly afterPublish?: (objectId: string) => Promise<void>;
}

/** Test transport with observable bytes and real conditional object operations. */
export class SyncObjectServer implements SyncObjectStore {
  readonly events: ServerEvent[] = [];
  readonly hooks: SyncObjectServerHooks;
  private readonly snapshots = new Map<string, StoredObject>();
  private readonly assets = new Map<string, StoredObject>();
  private revision = 0;

  constructor(hooks: SyncObjectServerHooks = {}) {
    this.hooks = hooks;
  }

  async listSnapshots(input: { readonly vaultId: string }): Promise<readonly SyncSnapshotHead[]> {
    this.events.push({ kind: 'list', vaultId: input.vaultId });
    await this.hooks.afterListSnapshots?.();
    return [...this.snapshots].map(([deviceId, object]) => ({ deviceId, revision: object.revision }));
  }

  async readSnapshot(input: { readonly vaultId: string; readonly objectId: string; readonly revision: string }): Promise<SyncObjectRead> {
    this.events.push({ kind: 'read-snapshot', objectId: input.objectId });
    await this.hooks.beforeReadSnapshot?.(input.objectId);
    const object = this.snapshots.get(input.objectId);
    if (!object || object.revision !== input.revision) throw new Error('Snapshot revision changed');
    return cloneRead(object);
  }

  async readAsset(input: { readonly vaultId: string; readonly objectId: string }): Promise<SyncObjectRead | null> {
    this.events.push({ kind: 'read-asset', objectId: input.objectId });
    const object = this.assets.get(input.objectId);
    return object ? cloneRead(object) : null;
  }

  async createAsset(input: { readonly vaultId: string; readonly objectId: string; readonly ciphertext: Uint8Array }): Promise<SyncAssetReceipt> {
    this.events.push({ kind: 'create-asset', objectId: input.objectId });
    await this.hooks.beforeCreateAsset?.(input.objectId);
    const existing = this.assets.get(input.objectId);
    if (existing) return { created: false, revision: existing.revision };
    const object = this.store(input.ciphertext);
    this.assets.set(input.objectId, object);
    return { created: true, revision: object.revision };
  }

  async publishSnapshot(input: { readonly vaultId: string; readonly objectId: string; readonly expectedRevision: string | null; readonly ciphertext: Uint8Array }): Promise<SyncPublishReceipt> {
    this.events.push({ kind: 'publish', objectId: input.objectId });
    await this.hooks.beforePublish?.(input.objectId);
    const current = this.snapshots.get(input.objectId);
    if ((current?.revision ?? null) !== input.expectedRevision) throw new Error('Snapshot compare-and-swap failed');
    const object = this.store(input.ciphertext);
    this.snapshots.set(input.objectId, object);
    await this.hooks.afterPublish?.(input.objectId);
    return { revision: object.revision };
  }

  putSnapshot(deviceId: string, bytes: Uint8Array): string {
    const object = this.store(bytes);
    this.snapshots.set(deviceId, object);
    return object.revision;
  }

  putAsset(assetId: string, bytes: Uint8Array): string {
    const object = this.store(bytes);
    this.assets.set(assetId, object);
    return object.revision;
  }

  deleteAsset(assetId: string): void {
    this.assets.delete(assetId);
  }

  snapshotBytes(deviceId: string): Uint8Array | undefined {
    const object = this.snapshots.get(deviceId);
    return object ? new Uint8Array(object.ciphertext) : undefined;
  }

  assetBytes(assetId: string): Uint8Array | undefined {
    const object = this.assets.get(assetId);
    return object ? new Uint8Array(object.ciphertext) : undefined;
  }

  private store(bytes: Uint8Array): StoredObject {
    this.revision += 1;
    return { revision: `revision-${this.revision}`, ciphertext: new Uint8Array(bytes) };
  }
}

function cloneRead(object: StoredObject): SyncObjectRead {
  return { revision: object.revision, ciphertext: new Uint8Array(object.ciphertext) };
}
