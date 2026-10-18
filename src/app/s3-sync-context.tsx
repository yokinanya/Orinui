import { createContext, use, type ReactNode } from 'react';
import type { S3Credentials } from '@/domain/s3-configuration';
import type { S3ConnectionPlan, S3ResetTarget, S3SyncStatus } from '@/sync/s3-types';
import type { SyncSizePreview } from '@/sync/ports';

export interface S3SyncContextValue {
  readonly status: S3SyncStatus | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly plan: S3ConnectionPlan | null;
  readonly recoveryTarget: S3ResetTarget | null;
  readonly sizePreview: SyncSizePreview | null;
  prepare(credentials: S3Credentials, recoveryKey?: string): Promise<boolean>;
  connect(): Promise<boolean>;
  cancelPlan(): void;
  syncNow(): Promise<boolean>;
  previewSizes(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  deleteRemote(): Promise<boolean>;
  resetRemote(): Promise<boolean>;
}

export const S3SyncContext = createContext<S3SyncContextValue | null>(null);

export function S3SyncContextProvider({ value, children }: { readonly value: S3SyncContextValue; readonly children: ReactNode }) {
  return <S3SyncContext value={value}>{children}</S3SyncContext>;
}

export function useS3Sync(): S3SyncContextValue {
  const value = use(S3SyncContext);
  if (!value) throw new Error('useS3Sync 必须在 S3SyncProvider 内使用');
  return value;
}
