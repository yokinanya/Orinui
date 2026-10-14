import { expect, it } from 'vitest';
import { ok, response, setup, xmlFor } from './webdav-test-helpers';

const ROOT = '/orinui/';
const DESCRIPTOR = `${ROOT}vault.json`;
const COLLECTION = `${ROOT}vaults/v1/`;
const DESCRIPTOR_BYTES = JSON.stringify({ schemaVersion: 1, vaultId: 'v1', ciphertext: btoa('encrypted') });

function harness(options: { readonly mode?: 'strong-etag' | 'readback-only'; readonly deleteStatus?: number;
  readonly retained?: boolean; readonly vaultId?: string } = {}) {
  const deleted: string[] = [];
  let descriptorExists = true;
  let collectionExists = true;
  const { remote } = setup((url, init) => {
    if (init.method === 'GET' && url.pathname === DESCRIPTOR) {
      const bytes = options.vaultId ? DESCRIPTOR_BYTES.replace('v1', options.vaultId) : DESCRIPTOR_BYTES;
      return descriptorExists ? ok(bytes, 200, { ETag: '"descriptor-r1"' }) : ok('', 404);
    }
    if (init.method === 'PROPFIND' && url.pathname === COLLECTION) {
      return collectionExists ? ok(xmlFor(response(COLLECTION, { collection: true })), 207) : ok('', 404);
    }
    if (init.method === 'DELETE') {
      deleted.push(url.pathname);
      if (options.deleteStatus) return ok('', options.deleteStatus);
      if (url.pathname === COLLECTION) collectionExists = options.retained ?? false;
      else if (url.pathname === DESCRIPTOR) {
        expect(new Headers(init.headers).get('If-Match')).toBe(options.mode === 'readback-only' ? null : '"descriptor-r1"');
        descriptorExists = false;
      } else throw new Error(`unexpected deletion ${url.pathname}`);
      return ok('', 204);
    }
    throw new Error(`unexpected ${init.method} ${url.pathname}`);
  }, { consistencyMode: options.mode ?? 'strong-etag' });
  return { remote, deleted };
}

it.each(['strong-etag', 'readback-only'] as const)('deletes only the current vault and descriptor in %s mode', async (mode) => {
  const h = harness({ mode });
  await h.remote.deleteVault('v1');
  expect(h.deleted).toEqual([COLLECTION, DESCRIPTOR]);
});

it('rejects a different vault without deleting anything', async () => {
  const h = harness({ vaultId: 'other' });
  await expect(h.remote.deleteVault('v1')).rejects.toThrow('身份已变化');
  expect(h.deleted).toEqual([]);
});

it.each([403, 412, 500, 207])('reports HTTP %s deletion failures and keeps the descriptor', async (deleteStatus) => {
  const h = harness({ deleteStatus });
  await expect(h.remote.deleteVault('v1')).rejects.toThrow(`HTTP ${deleteStatus}`);
  expect(h.deleted).toEqual([COLLECTION]);
});

it('does not accept a successful response when the directory remains', async () => {
  const h = harness({ retained: true });
  await expect(h.remote.deleteVault('v1')).rejects.toThrow('目录仍存在');
  expect(h.deleted).toEqual([COLLECTION]);
});

it('can retry cleanup when both resources are already absent', async () => {
  const calls: string[] = [];
  const { remote } = setup((url, init) => { calls.push(`${init.method} ${url.pathname}`); return ok('', 404); });
  await remote.deleteVault('v1');
  expect(calls).toContain(`DELETE ${COLLECTION}`);
  expect(calls).not.toContain(`DELETE ${DESCRIPTOR}`);
});

it('accepts Nutstore AncestorsNotFound only for the missing descriptor', async () => {
  const { remote } = setup((url, init) => {
    if (init.method === 'GET') return ok('<d:exception xmlns:d="DAV:">AncestorsNotFound</d:exception>', 409);
    expect(url.pathname).toBe('/dav/Orinui/vaults/v1/');
    return ok('', 404);
  }, { url: 'https://dav.jianguoyun.com/dav/', consistencyMode: 'readback-only' });
  await expect(remote.deleteVault('v1')).resolves.toBeUndefined();
});
