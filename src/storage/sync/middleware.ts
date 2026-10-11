import type { DBCore } from 'dexie';
import { isTrackedTable, mutateWithCapture } from '@/storage/sync/capture';

const SYNC_TABLES = ['sync_state', 'sync_records'] as const;
const BUSINESS_TABLES = ['groups', 'shortcuts', 'settings', 'assets'] as const;

export function createSyncCaptureMiddleware(now: () => number) {
  return {
    stack: 'dbcore' as const,
    name: 'OrinuiSyncCapture',
    create(downlevel: DBCore): Partial<DBCore> {
      return {
        ...downlevel,
        transaction(stores, mode, options) {
          const hasSyncStores = SYNC_TABLES.every((syncTable) => downlevel.schema.tables.some(({ name }) => name === syncTable));
          const shouldCapture = hasSyncStores && mode === 'readwrite' &&
            stores.some((store) => BUSINESS_TABLES.includes(store as typeof BUSINESS_TABLES[number]));
          const nextStores = shouldCapture ? [...new Set([...stores, ...SYNC_TABLES])] : stores;
          return downlevel.transaction(nextStores, mode, options);
        },
        table(name) {
          const table = downlevel.table(name);
          const hasSyncStores = SYNC_TABLES.every((syncTable) => downlevel.schema.tables.some(({ name: tableName }) => tableName === syncTable));
          if (!hasSyncStores || !isTrackedTable(name)) return table;
          return {
            ...table,
            mutate(request) {
              return mutateWithCapture({ core: downlevel, name, table, request, now });
            },
          };
        },
      };
    },
  };
}
