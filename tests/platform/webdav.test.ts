import { expect, it } from 'vitest';

import { parseWebDavMultiStatus } from '@/platform/webdav-xml';
import { createWebDavRemote } from '@/platform/webdav-store';
import { createWebDavClient } from '@/platform/webdav-client';
import { documentFor, element, ok, response, setup, xmlFor } from './webdav-test-helpers';

const PARALLEL_SNAPSHOT_TIMEOUT_MS = 50;

it('rejects insecure or ambiguous collection URLs and unsafe path identities', async () => {
    expect(() => createWebDavRemote({ credentials: { url: 'http://dav.test/root/', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    expect(() => createWebDavRemote({ credentials: { url: 'https://u:p@dav.test/root/', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    expect(() => createWebDavRemote({ credentials: { url: 'https://@dav.test/root/', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    expect(() => createWebDavRemote({ credentials: { url: 'https://dav.test/root/?x=1', username: 'u', password: 'p' }, fetch, parseXml: () => documentFor([]) })).toThrow(/HTTPS/);
    const { remote } = setup(() => ok());
    await expect(remote.objects.readAsset({ vaultId: '..', objectId: 'x' })).rejects.toThrow(/路径段/);
});

it('sends Basic UTF-8 authorization and rejects redirected responses', async () => {
    let captured: RequestInit | undefined;
    const { remote } = setup((_url, init) => { captured = init; return ok('', 302, { Location: 'https://elsewhere.test/' }); });
    await expect(remote.readVault()).rejects.toThrow(/重定向/);
    expect(captured?.redirect).toBe('error');
    expect(captured?.credentials).toBe('omit');
    expect(new Headers(captured?.headers).get('Authorization')).toBe(`Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('用户:pāss')))}`);
  });

it('prepares parent collections in order, creating only the configured hierarchy', async () => {
    const urls: string[] = [];
    const { remote } = setup((url, init) => {
      urls.push(`${init.method} ${url.pathname}`);
      if (init.method === 'PROPFIND') {
        return url.pathname === '/orinui/'
          ? ok(xmlFor(response(url.pathname, { collection: true })), 207)
          : ok('', 404);
      }
      return ok('', 201);
    });
    await remote.prepareCollections({ vaultId: 'vault-1', deviceId: 'device-1' });
    expect(urls).toEqual([
      'PROPFIND /orinui/', 'PROPFIND /orinui/vaults/', 'MKCOL /orinui/vaults/',
      'PROPFIND /orinui/vaults/vault-1/', 'MKCOL /orinui/vaults/vault-1/',
      'PROPFIND /orinui/vaults/vault-1/devices/', 'PROPFIND /orinui/vaults/vault-1/assets/',
      'MKCOL /orinui/vaults/vault-1/devices/', 'MKCOL /orinui/vaults/vault-1/assets/',
      'PROPFIND /orinui/vaults/vault-1/devices/device-1/', 'MKCOL /orinui/vaults/vault-1/devices/device-1/',
    ]);
  });

it('reports the exact collection path when creation is forbidden', async () => {
    const { remote } = setup((url, init) => {
      if (init.method === 'PROPFIND') {
        return url.pathname === '/orinui/'
          ? ok(xmlFor(response(url.pathname, { collection: true })), 207)
          : ok('', 404);
      }
      return ok('', 403);
    });
    await expect(remote.prepareCollections({ vaultId: 'v1', deviceId: 'd1' }))
      .rejects.toThrow('WebDAV 创建 collection 失败（HTTP 403）：/orinui/vaults/');
});

it('verifies a collection after MKCOL reports a concurrent create', async () => {
    const methods: string[] = [];
    const { remote } = setup((url, init) => {
      methods.push(`${init.method} ${url.pathname}`);
      if (init.method === 'PROPFIND') {
        if (url.pathname === '/orinui/' || url.pathname === '/orinui/vaults/' && methods.includes('MKCOL /orinui/vaults/')) {
          return ok(xmlFor(response(url.pathname, { collection: true, resourceTypeStatus: 200, etagStatus: 404 })), 207);
        }
        return ok('', 404);
      }
      return url.pathname === '/orinui/vaults/' ? ok('', 405) : ok('', 201);
    });
    await remote.prepareCollections({ vaultId: 'v1', deviceId: 'd1' });
    expect(methods).toEqual([
      'PROPFIND /orinui/', 'PROPFIND /orinui/vaults/', 'MKCOL /orinui/vaults/', 'PROPFIND /orinui/vaults/',
      'PROPFIND /orinui/vaults/v1/', 'MKCOL /orinui/vaults/v1/',
      'PROPFIND /orinui/vaults/v1/devices/', 'PROPFIND /orinui/vaults/v1/assets/',
      'MKCOL /orinui/vaults/v1/devices/', 'MKCOL /orinui/vaults/v1/assets/',
      'PROPFIND /orinui/vaults/v1/devices/d1/', 'MKCOL /orinui/vaults/v1/devices/d1/',
    ]);
  });

it('confirms existing collections from resourcetype without requiring getetag', async () => {
    const methods: string[] = [];
    const { remote } = setup((url, init) => {
      methods.push(`${init.method} ${url.pathname}`);
      return ok(xmlFor(response(url.pathname, { collection: true, resourceTypeStatus: 200, etagStatus: 404 })), 207);
    });
    await remote.prepareCollections({ vaultId: 'v1', deviceId: 'd1' });
    expect(methods).toEqual([
      'PROPFIND /orinui/', 'PROPFIND /orinui/vaults/', 'PROPFIND /orinui/vaults/v1/',
      'PROPFIND /orinui/vaults/v1/devices/', 'PROPFIND /orinui/vaults/v1/assets/',
      'PROPFIND /orinui/vaults/v1/devices/d1/',
    ]);
});

it('reads and conditionally creates the encrypted vault descriptor', async () => {
    let stored = '';
    const { remote } = setup((_url, init) => {
      if (init.method === 'PUT') {
        expect(new Headers(init.headers).get('If-None-Match')).toBe('*');
        stored = String(init.body);
        return ok('', 201, { ETag: '"vault-r1"' });
      }
      return stored ? ok(stored) : ok('', 404);
    });
    expect(await remote.readVault()).toBeNull();
    await remote.createVault({ vaultId: 'vault-1', ciphertext: Uint8Array.of(3, 4, 5) });
    const read = await remote.readVault();
    expect(read).toEqual({ vaultId: 'vault-1', ciphertext: Uint8Array.of(3, 4, 5) });
  });

it('uses an Orinui collection when the Nutstore URL points to the account root', async () => {
    const requests: string[] = [];
    let storedManifest: string | null = null;
    const { remote } = setup((url, init) => {
      const method = init.method ?? 'GET';
      requests.push(`${method} ${url.pathname}`);
      if (method === 'PROPFIND') {
        return ok('', 404);
      }
      if (method === 'MKCOL') return ok('', 201);
      if (method === 'PUT') {
        storedManifest = String(init.body);
        return ok('', 201);
      }
      if (method === 'GET') return storedManifest ? ok(storedManifest) : ok('', 404);
      throw new Error(`unexpected ${method} ${url.pathname}`);
    }, { url: 'https://dav.jianguoyun.com/dav', consistencyMode: 'readback-only' });

    await remote.prepareCollections({ vaultId: 'vault-1', deviceId: 'device-1' });
    await remote.createVault({ vaultId: 'vault-1', ciphertext: Uint8Array.of(3, 4, 5) });

    expect(requests).toContain('MKCOL /dav/Orinui/');
    expect(requests).toContain('PUT /dav/Orinui/vault.json');
    expect(requests).not.toContain('PUT /dav/vault.json');
    expect(requests.filter((request) => request === 'GET /dav/Orinui/vault.json')).toHaveLength(2);
  });

it('uses an Orinui collection for any bare DAV endpoint URL', () => {
    const client = createWebDavClient({
      credentials: { url: 'https://dav.example.test/dav', username: 'user', password: 'password' },
      fetch,
      parseXml: () => documentFor([]),
    });
    expect(client.root.pathname).toBe('/dav/Orinui/');
    expect(client.autoCreateRootCollection).toBe(true);
  });

it('recognizes only Nutstore AncestorsNotFound 409 as a missing descriptor', async () => {
    const missing = '<d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>AncestorsNotFound</s:exception></d:error>';
    const { remote: nutstore } = setup(() => ok(missing, 409), {
      url: 'https://dav.jianguoyun.com/dav', consistencyMode: 'readback-only',
    });
    await expect(nutstore.readVault()).resolves.toBeNull();

    const conflict = '<d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>Conflict</s:exception></d:error>';
    const { remote: nutstoreConflict } = setup(() => ok(conflict, 409), {
      url: 'https://dav.jianguoyun.com/dav', consistencyMode: 'readback-only',
    });
    await expect(nutstoreConflict.readVault()).rejects.toThrow('WebDAV 读取同步库描述失败（HTTP 409）');

    const { remote: otherProvider } = setup(() => ok(missing, 409), {
      url: 'https://dav.example.test/dav', consistencyMode: 'readback-only',
    });
    await expect(otherProvider.readVault()).rejects.toThrow('WebDAV 读取同步库描述失败（HTTP 409）');
  });

it('keeps a user-specified Nutstore subdirectory unchanged', async () => {
    const requests: string[] = [];
    const { remote } = setup((url, init) => {
      const method = init.method ?? 'GET';
      requests.push(`${method} ${url.pathname}`);
      if (method === 'PROPFIND') {
        return url.pathname === '/dav/custom/'
          ? ok(xmlFor(response(url.pathname, { collection: true })), 207)
          : ok('', 404);
      }
      return ok('', 201);
    }, { url: 'https://dav.jianguoyun.com/dav/custom/', consistencyMode: 'readback-only' });

    await remote.prepareCollections({ vaultId: 'vault-1', deviceId: 'device-1' });

    expect(requests[0]).toBe('PROPFIND /dav/custom/');
    expect(requests).not.toContain('PROPFIND /dav/Orinui/');
  });

it('lists direct device collections and gets strong snapshot ETags via PROPFIND', async () => {
    const { remote } = setup((url, init) => {
      if (init.method !== 'PROPFIND') throw new Error(`unexpected ${init.method}`);
      if (new Headers(init.headers).get('Depth') === '1') {
        return ok(xmlFor(response('/orinui/vaults/v1/devices/', { collection: true, etagStatus: 404 }),
          response('/orinui/vaults/v1/devices/device%20one/', { collection: true, etagStatus: 404 }),
          response('/orinui/vaults/v1/devices/nested/child/', { collection: true })), 207);
      }
      return ok(xmlFor(response(url.pathname, { etag: '"s1"' })), 207);
    });
    await expect(remote.objects.listSnapshots({ vaultId: 'v1' })).rejects.toThrow(/直接子项/);

    const valid = setup((url, init) => new Headers(init.headers).get('Depth') === '1'
      ? ok(xmlFor(response('/orinui/vaults/v1/devices/', { collection: true, etagStatus: 404 }), response('/orinui/vaults/v1/devices/device%20one/', { collection: true, etagStatus: 404 })), 207)
      : ok('', 200, { ETag: '"s1"', 'Content-Length': '8' }));
    await expect(valid.remote.objects.listSnapshots({ vaultId: 'v1' })).resolves.toEqual([
      { deviceId: 'device one', revision: '"s1"', ciphertextBytes: 8 },
    ]);

    const missingSnapshotTag = setup((url, init) => {
      if (init.method === 'PROPFIND' && new Headers(init.headers).get('Depth') === '1') {
        return ok(xmlFor(response('/orinui/vaults/v1/devices/d1/', { collection: true, etagStatus: 404 })), 207);
      }
      if (init.method === 'HEAD') return ok('', 200, { 'Content-Length': '8' });
      if (init.method === 'PROPFIND') return ok(xmlFor(response(url.pathname, { collection: false, etagStatus: 404 })), 207);
      return ok('', 200);
    });
    await expect(missingSnapshotTag.remote.objects.listSnapshots({ vaultId: 'v1' })).rejects.toThrow(/ETag/);
  });

it('reads snapshot revisions for separate devices concurrently', async () => {
    const paths: string[] = [];
    let releaseRequests = (): void => undefined;
    let resolveAllStarted = (): void => undefined;
    const requestGate = new Promise<void>((resolve) => { releaseRequests = resolve; });
    const allStarted = new Promise<void>((resolve) => { resolveAllStarted = resolve; });
    const { remote } = setup(async (url, init) => {
      if (init.method === 'PROPFIND' && new Headers(init.headers).get('Depth') === '1') {
        return ok(xmlFor(response('/orinui/vaults/v1/devices/', { collection: true }),
          response('/orinui/vaults/v1/devices/d1/', { collection: true }),
          response('/orinui/vaults/v1/devices/d2/', { collection: true }),
          response('/orinui/vaults/v1/devices/d3/', { collection: true })), 207);
      }
      paths.push(url.pathname);
      if (paths.length === 3) resolveAllStarted();
      await requestGate;
      return ok('', 200, { ETag: '"snapshot-r1"', 'Content-Length': '16' });
    });
    const loading = remote.objects.listSnapshots({ vaultId: 'v1' });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, PARALLEL_SNAPSHOT_TIMEOUT_MS);
    });
    await Promise.race([allStarted, timedOut]);
    const startedConcurrently = paths.length === 3;
    releaseRequests();
    if (timeout !== undefined) clearTimeout(timeout);

    const heads = await loading;
    expect(startedConcurrently).toBe(true);
    expect(heads).toEqual([
      { deviceId: 'd1', revision: '"snapshot-r1"', ciphertextBytes: 16 },
      { deviceId: 'd2', revision: '"snapshot-r1"', ciphertextBytes: 16 },
      { deviceId: 'd3', revision: '"snapshot-r1"', ciphertextBytes: 16 },
    ]);
  });

it('reads snapshots with exact If-Match and rejects stale or weak revisions', async () => {
    let captured: RequestInit | undefined;
    const { remote } = setup((_url, init) => { captured = init; return ok('snapshot-bytes', 200, { ETag: '"r7"' }); });
    const result = await remote.objects.readSnapshot({ vaultId: 'v1', objectId: 'd1', revision: '"r7"' });
    expect(new Headers(captured?.headers).get('If-Match')).toBe('"r7"');
    expect(result.ciphertext).toEqual(new TextEncoder().encode('snapshot-bytes'));
    const stale = setup(() => ok('', 412));
    await expect(stale.remote.objects.readSnapshot({ vaultId: 'v1', objectId: 'd1', revision: '"r6"' })).rejects.toThrow(/版本已变化/);
    await expect(remote.objects.readSnapshot({ vaultId: 'v1', objectId: 'd1', revision: 'W/"weak"' })).rejects.toThrow(/强 ETag/);
  });

it('returns null for a missing asset and requires strong ETags for existing bytes', async () => {
    const missing = setup(() => ok('', 404));
    await expect(missing.remote.objects.readAsset({ vaultId: 'v1', objectId: 'a1' })).resolves.toBeNull();
    const weak = setup(() => ok('bytes', 200, { ETag: 'W/"weak"' }));
    await expect(weak.remote.objects.readAsset({ vaultId: 'v1', objectId: 'a1' })).rejects.toThrow(/强 ETag/);
  });

it('creates assets only when absent and re-reads condition races', async () => {
    let putInit: RequestInit | undefined;
    const created = setup((_url, init) => { putInit = init; return ok('', 201, { ETag: '"a1"' }); });
    await expect(created.remote.objects.createAsset({ vaultId: 'v1', objectId: 'a1', ciphertext: Uint8Array.of(8) }))
      .resolves.toEqual({ created: true, revision: '"a1"' });
    expect(new Headers(putInit?.headers).get('If-None-Match')).toBe('*');

    let count = 0;
    const raced = setup((_url, init) => {
      if (init.method === 'PUT') return ok('', 412);
      count += 1;
      return ok('existing', 200, { ETag: '"existing"' });
    });
    await expect(raced.remote.objects.createAsset({ vaultId: 'v1', objectId: 'a1', ciphertext: Uint8Array.of(8) }))
      .resolves.toEqual({ created: false, revision: '"existing"' });
    expect(count).toBe(1);
  });

it('publishes snapshots with create-only or exact replacement conditions', async () => {
    const conditions: string[] = [];
    const { remote } = setup((_url, init) => {
      const headers = new Headers(init.headers);
      conditions.push(headers.get('If-None-Match') ?? `match:${headers.get('If-Match')}`);
      return ok('', 204, { ETag: '"published"' });
    });
    await remote.objects.publishSnapshot({ vaultId: 'v1', objectId: 'd1', expectedRevision: null, ciphertext: Uint8Array.of(1) });
    await remote.objects.publishSnapshot({ vaultId: 'v1', objectId: 'd1', expectedRevision: '"old"', ciphertext: Uint8Array.of(2) });
    expect(conditions).toEqual(['*', 'match:"old"']);
    const conflict = setup(() => ok('', 412));
    await expect(conflict.remote.objects.publishSnapshot({ vaultId: 'v1', objectId: 'd1', expectedRevision: '"old"', ciphertext: Uint8Array.of(2) }))
      .rejects.toThrow(/条件发布冲突/);
  });

it('rejects malformed DAV multistatus and non-success propstat entries', () => {
    const entries = parseWebDavMultiStatus(documentFor([response('/dav/', { collection: true, resourceTypeStatus: 200, etagStatus: 404 })]));
    expect(entries[0]).toMatchObject({ collection: true, resourceTypeStatus: 200, etagStatus: 404, etag: null });
    const wrongNamespace = element('multistatus', { namespaceURI: 'urn:wrong' });
    expect(() => parseWebDavMultiStatus({ documentElement: wrongNamespace, getElementsByTagName: () => [] } as unknown as Document)).toThrow(/multistatus/);
    const external = setup(() => ok(xmlFor(response('https://attacker.test/orinui/vaults/v1/devices/d1/', { collection: true })), 207));
    return expect(external.remote.objects.listSnapshots({ vaultId: 'v1' })).rejects.toThrow(/越界 href/);
});
