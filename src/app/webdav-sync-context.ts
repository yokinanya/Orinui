import { createContext, use } from 'react';
import type { WebDavConnectionPlan, WebDavPrepareInput, WebDavSyncStatus } from '@/sync/webdav-types';
import type { SyncSizePreview } from '@/sync/ports';

export interface WebDavSyncContextValue {
  readonly status: WebDavSyncStatus | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly plan: WebDavConnectionPlan | null;
  prepare(input: WebDavPrepareInput): Promise<boolean>;
  connect(): Promise<boolean>;
  cancelPlan(): void;
  syncNow(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  deleteRemote(): Promise<boolean>;
  readonly recoveryRequired: boolean;
  previewSizes(): Promise<SyncSizePreview | null>;
  resetRemote(): Promise<boolean>;
}

export const WebDavSyncContext = createContext<WebDavSyncContextValue | null>(null);

export function useWebDavSync(): WebDavSyncContextValue {
  const value = use(WebDavSyncContext);
  if (!value) throw new Error('useWebDavSync 必须在 WebDavSyncProvider 中使用');
  return value;
}
