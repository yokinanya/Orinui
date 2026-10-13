import { liveQuery } from 'dexie';
import type { Database } from '@/storage/db';
import type { SyncStateRow } from '@/storage/sync/types';

export interface WebDavObservation {
  readonly state: SyncStateRow | undefined;
  readonly nextDeleteAt: number | undefined;
}

export function observeWebDavLocal(db: Database,
  callbacks: { readonly next: (value: WebDavObservation) => void; readonly error: (cause: unknown) => void }): () => void {
  const subscription = liveQuery(async () => {
    const state = await db.sync_state.get('app');
    const rows = await db.sync_records.toArray();
    const deadlines = rows.flatMap((row) => row.kind !== 'tombstone' && row.pendingDeleteUntil !== undefined
      ? [row.pendingDeleteUntil] : []);
    return { state, nextDeleteAt: deadlines.length ? Math.min(...deadlines) : undefined };
  }).subscribe(callbacks);
  return () => subscription.unsubscribe();
}
