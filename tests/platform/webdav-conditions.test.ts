import { expect, it } from 'vitest';

import { conditionProbeHandler, ok, response, setup, xmlFor } from './webdav-test-helpers';

it('proves server preconditions and removes the probe with its observed strong ETag', async () => {
  const stored = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const { remote } = setup(conditionProbeHandler(stored, calls));
  await remote.prepareCollections({ vaultId: 'v1', deviceId: 'd1' });
  await remote.verifyConditions({ vaultId: 'v1', deviceId: 'd1' });
  expect(stored.size).toBe(0);
  expect(calls).toContain('PUT *');
  expect(calls).toContain('DELETE "probe-r1"');
});

it('recovers a strong PUT revision from DAV properties or GET and verifies bytes with If-Match', async () => {
  let probeUrl = '';
  const cases = [
    { responseEtag: undefined, propertyEtag: '"probe-r1"', propertyStatus: 200 },
    { responseEtag: undefined, propertyEtag: undefined, propertyStatus: 404 },
    { responseEtag: 'W/"weak"', propertyEtag: 'W/"weak"', propertyStatus: 200 },
    { responseEtag: 'W/"weak"', propertyEtag: undefined, propertyStatus: 404 },
  ] as const;
  for (const scenario of cases) {
    let stored: Uint8Array | null = null;
    const getConditions: (string | null)[] = [];
    const { remote } = setup((url, init) => {
      const method = init.method ?? 'GET';
      const headers = new Headers(init.headers);
      if (method === 'PUT') {
        probeUrl = url.pathname;
        if (headers.get('If-None-Match') === '*' && stored) return ok('', 412);
        if (headers.has('If-Match') && headers.get('If-Match') !== '"probe-r1"') return ok('', 412);
        stored = new Uint8Array(init.body as ArrayBuffer);
        return ok('', 201, scenario.responseEtag ? { ETag: scenario.responseEtag } : undefined);
      }
      if (method === 'PROPFIND') {
        if (url.pathname !== probeUrl || !stored) return ok('', 404);
        return ok(xmlFor(response(url.pathname, { etag: scenario.propertyEtag,
          etagStatus: scenario.propertyStatus, collection: false })), 207);
      }
      if (method === 'GET') {
        if (!stored) return ok('', 404);
        getConditions.push(headers.get('If-Match'));
        if (headers.has('If-Match') && headers.get('If-Match') !== '"probe-r1"') return ok('', 412);
        const copy = new ArrayBuffer(stored.byteLength);
        new Uint8Array(copy).set(stored);
        return new Response(copy, { status: 200, headers: { ETag: '"probe-r1"' } });
      }
      if (method === 'DELETE' && headers.get('If-Match') === '"probe-r1"') {
        stored = null;
        return ok('', 204);
      }
      return ok('', 412);
    });
    await remote.verifyConditions({ vaultId: 'v1', deviceId: 'd1' });
    expect(stored).toBeNull();
    if (scenario.propertyStatus === 404 || scenario.propertyEtag?.startsWith('W/')) {
      expect(getConditions).toContain(null);
    }
    expect(getConditions).toContain('"probe-r1"');
  }
});

it('fails when neither DAV:getetag nor the GET response provides a strong revision', async () => {
  let stored: Uint8Array | null = null;
  const { remote } = setup((url, init) => {
    const method = init.method ?? 'GET';
    if (method === 'PUT') {
      if (new Headers(init.headers).has('If-Match')) return ok('', 412);
      stored = new Uint8Array(init.body as ArrayBuffer);
      return ok('', 201);
    }
    if (method === 'PROPFIND') return ok(xmlFor(response(url.pathname, { collection: false, etagStatus: 404 })), 207);
    if (method === 'GET') return stored ? ok('probe', 200) : ok('', 404);
    throw new Error(`unexpected ${method} ${url.pathname}`);
  });
  await expect(remote.verifyConditions({ vaultId: 'v1', deviceId: 'd1' }))
    .rejects.toThrow(/DAV:getetag 或 GET 获取有效强 ETag/);
  expect(stored).not.toBeNull();
});

it('fails explicitly when If-None-Match is ignored and leaves its diagnostic probe', async () => {
  const { remote } = setup((url, init) => {
    if (init.method === 'PUT') return ok('', 201, { ETag: '"probe-r1"' });
    throw new Error(`unexpected ${init.method} ${url.pathname}`);
  });
  await expect(remote.verifyConditions({ vaultId: 'v1', deviceId: 'd1' }))
    .rejects.toThrow(/预期 HTTP 412，实际 201/);
});
