import type { DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction } from 'dexie';

export type StoredRow = Record<string, unknown> & { readonly id: string };

export interface MutationRows {
  readonly transaction: DBCoreTransaction;
  readonly before: readonly StoredRow[];
  readonly after: readonly StoredRow[];
}

function idOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') return undefined;
  return value.id;
}

export function requestKeys(table: DBCoreTable, request: DBCoreMutateRequest): readonly IDBValidKey[] | null {
  if (request.type === 'deleteRange') return null;
  const keys = 'keys' in request ? [...(request.keys ?? [])] : [];
  const values = 'values' in request ? request.values : [];
  for (const value of values) {
    const key = table.schema.primaryKey.extractKey?.(value) ?? idOf(value);
    if (key !== undefined) keys.push(key);
  }
  if (request.type === 'put' && request.updates) keys.push(...request.updates.keys);
  return [...new Set(keys)];
}

async function rangedRows(table: DBCoreTable, request: DBCoreMutateRequest): Promise<StoredRow[]> {
  if (request.type === 'add') return [];
  const indexName = request.type === 'deleteRange' ? null : request.criteria?.index;
  const range = request.type === 'deleteRange' ? request.range : request.criteria?.range;
  if (!range) return [];
  const index = indexName == null ? table.schema.primaryKey : table.schema.getIndexByKeyPath(indexName);
  if (!index) throw new Error(`无法捕获 ${table.name} 的删除范围`);
  return (await table.query({ trans: request.trans, query: { index, range }, values: true })).result as StoredRow[];
}

export async function readBeforeRows(table: DBCoreTable, request: DBCoreMutateRequest): Promise<MutationRows> {
  const keys = requestKeys(table, request);
  const before = keys === null ? await rangedRows(table, request)
    : await table.getMany({ trans: request.trans, keys: [...keys] }) as Array<StoredRow | undefined>;
  return { transaction: request.trans, before: before.filter((row): row is StoredRow => row !== undefined), after: [] };
}

interface ReadAfterInput {
  readonly table: DBCoreTable;
  readonly request: DBCoreMutateRequest;
  readonly response: DBCoreMutateResponse;
  readonly rows: MutationRows;
}

export async function readAfterRows(input: ReadAfterInput): Promise<MutationRows> {
  const { table, request, response, rows } = input;
  const keys = requestKeys(table, request);
  const successful = successfulKeys({ request, response, keys, before: rows.before });
  const allowed = new Set(successful.map(String));
  const targetKeys = successful;
  const after = await table.getMany({ trans: request.trans, keys: [...targetKeys] }) as Array<StoredRow | undefined>;
  return { ...rows, before: rows.before.filter(({ id }) => allowed.has(id)),
    after: after.filter((row): row is StoredRow => row !== undefined) };
}

function successfulKeys(input: { readonly request: DBCoreMutateRequest; readonly response: DBCoreMutateResponse;
  readonly keys: readonly IDBValidKey[] | null; readonly before: readonly StoredRow[] }): readonly IDBValidKey[] {
  const { request, response, keys, before } = input;
  if (keys === null) return before.map(({ id }) => id);
  const resultKeys = request.type === 'add' || request.type === 'put'
    ? response.results?.length ? response.results : keys : keys;
  const failed = new Set(Object.keys(response.failures).map(Number));
  return resultKeys.filter((_key, index) => !failed.has(index));
}
