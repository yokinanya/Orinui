import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { SyncObjectProgress } from '@/domain/sync/object-types';
import type { S3Credentials } from '@/domain/s3-configuration';
import type { SyncObjectStore } from '@/sync/objects';
import { createS3Context, S3_RUNTIME, type S3StoreRuntime, type S3VaultDescriptor } from '@/platform/s3-store-common';
import { createS3ObjectStore } from '@/platform/s3-object-store';
import { createS3VaultStore } from '@/platform/s3-vault-store';

export type { S3ClientOptions, S3StoreRuntime, S3VaultDescriptor } from '@/platform/s3-store-common';

export interface S3Remote {
  readonly objects: SyncObjectStore;
  readVault(): Promise<S3VaultDescriptor | null>;
  createVault(input: { readonly vaultId: string; readonly ciphertext: Uint8Array }): Promise<void>;
  verifyConditions(input: { readonly vaultId: string; readonly deviceId: string }): Promise<void>;
  listVaultBytes(vaultId: string, onObjectProgress?: SyncObjectProgress): Promise<number>;
  deleteVault(vaultId: string, expectedDescriptorRevision: string): Promise<void>;
  dispose(): void;
}

export function createS3Remote(credentials: S3Credentials, runtime: S3StoreRuntime = S3_RUNTIME): S3Remote {
  const context = createS3Context(credentials, runtime);
  const objects = createS3ObjectStore(context);
  const vault = createS3VaultStore(context);
  return { objects, ...vault, dispose: () => { context.client.destroy(); context.handler.destroy(); } };
}

export async function checkS3Bucket(credentials: S3Credentials, runtime: S3StoreRuntime = S3_RUNTIME): Promise<void> {
  const client = runtime.createClient({ endpoint: credentials.endpoint, region: credentials.region, forcePathStyle: true,
    maxAttempts: 1, credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey } });
  try { await client.send(new HeadBucketCommand({ Bucket: credentials.bucket })); }
  catch (cause) {
    const message = cause instanceof TypeError ? `${cause.message}；请检查网络、S3 来源权限和 bucket CORS 配置`
      : cause instanceof Error ? cause.message : String(cause);
    throw new Error(`S3 bucket 检查失败：${message}`, { cause });
  } finally { client.destroy(); }
}
