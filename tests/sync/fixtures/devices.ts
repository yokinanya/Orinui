import { webcrypto } from 'node:crypto';
import type { ImageAsset } from '@/domain/asset';
import { mergeSyncSnapshots } from '@/domain/sync';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { decodeSyncSnapshot, encodeSyncSnapshot, openSyncImage } from '@/platform/sync-codec';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createShortcut } from '@/storage/shortcuts';
import { createSyncLocalStore } from '@/storage/sync/local-store';
import { initializeSyncVault } from '@/storage/sync/vault';
import { planSyncJoin } from '@/storage/sync/join-plan';
import type { SyncCoordinatorDependencies, SyncLock } from '@/sync/ports';
import { SyncObjectServer } from '../server';

export const crypto = createSyncCrypto(webcrypto as unknown as Crypto);
export const vaultId = 'sync-test-vault';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+L8AAAAASUVORK5CYII=';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface TestDevice {
  readonly db: Database;
  readonly deviceId: string;
  readonly dependencies: SyncCoordinatorDependencies;
}

export async function createTestDevice(input: {
  readonly deviceId: string;
  readonly recoveryKey?: string;
  readonly seedImage?: boolean;
  readonly seedWebsite?: boolean;
  readonly lock: SyncLock;
  readonly server: SyncObjectServer;
  readonly runIds?: string[];
  readonly now?: () => number;
}): Promise<TestDevice> {
  const db = createDatabase(`sync-coordinator-${input.deviceId}-${cryptoRandomId()}`, { now: input.now });
  try {
    const initial = await ensureInitialized(db);
    if (input.seedWebsite || input.seedImage) await seedWebsite(db, initial.defaultGroup.id, input.seedImage ?? false);
    const key = await createDeviceKey(input.recoveryKey);
    await initializeSyncVault(db, { vaultId, deviceId: input.deviceId, key });
    return { db, deviceId: input.deviceId, dependencies: coordinatorDependencies(db, input) };
  } catch (error) {
    await db.delete();
    throw error;
  }
}

export async function addFixtureImageShortcut(db: Database, title: string): Promise<void> {
  const { defaultGroup } = await ensureInitialized(db);
  await createShortcut(db, { groupId: defaultGroup.id, title, url: `https://${title.toLowerCase().replaceAll(' ', '-')}.example.test/`,
    image: { kind: 'icon', mime: 'image/png', width: 1, height: 1, blob: makePngBlob() } });
}

async function createDeviceKey(recoveryKey?: string): Promise<CryptoKey> {
  if (recoveryKey) return crypto.importKey(recoveryKey);
  return (await crypto.createKey()).key;
}

async function seedWebsite(db: Database, groupId: string, withImage: boolean): Promise<void> {
  const image = withImage ? makePngBlob() : undefined;
  await createShortcut(db, { groupId, title: 'Seed website', url: 'https://seed.example.test/',
    ...(image ? { image: { kind: 'icon' as const, mime: 'image/png' as const, width: 1, height: 1, blob: image } } : {}) });
}

function makePngBlob(): Blob {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}

function coordinatorDependencies(db: Database, input: {
  readonly deviceId: string;
  readonly lock: SyncLock;
  readonly server: SyncObjectServer;
  readonly runIds?: string[];
  readonly now?: () => number;
}): SyncCoordinatorDependencies {
  let localRun = 0;
  let runIdIndex = 0;
  const runIds = [...(input.runIds ?? [])];
  const local = createSyncLocalStore(db, { crypto, validateImage: validateFixtureImage });
  return {
    local, objects: input.server, lock: input.lock, crypto,
    codec: { encode: encodeSyncSnapshot, decode: decodeSyncSnapshot,
      openImage: openSyncImage },
    algorithms: { merge: mergeSyncSnapshots, join: planSyncJoin },
    now: input.now ?? (() => Date.UTC(2026, 9, 12) + localRun),
    createRunId: () => runIds[runIdIndex++] ?? `${input.deviceId}-run-${++localRun}`,
  };
}

async function validateFixtureImage(asset: ImageAsset): Promise<void> {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (asset.mime !== 'image/png' || asset.width !== 1 || asset.height !== 1
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error('Invalid test PNG');
}

export class SharedFifoLock implements SyncLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(scope) ?? Promise.resolve();
    let release = (): void => undefined;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => turn);
    this.tails.set(scope, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(scope) === tail) this.tails.delete(scope);
    }
  }
}

export async function deleteDevices(devices: readonly TestDevice[]): Promise<void> {
  await Promise.all(devices.map(({ db }) => db.delete()));
}

export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
