import { afterEach, describe, expect, it, vi } from 'vitest';

import { isExtensionPage, restrictStorageToTrustedContexts } from '@/platform/extension-runtime';
import { isExtensionPage as reexportedIsExtensionPage, requestWebDavPermission } from '@/platform/webdav-settings';

const extensionApi = vi.hoisted(() => ({ requestPermissions: vi.fn() }));

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: { request: extensionApi.requestPermissions },
    storage: { local: {}, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  },
}));

function setPage(protocol: string): void {
  vi.stubGlobal('location', { protocol });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('isExtensionPage', () => {
  it('recognizes Chrome extension pages', () => {
    setPage('chrome-extension:');
    expect(isExtensionPage()).toBe(true);
  });

  it('recognizes Firefox extension pages', () => {
    setPage('moz-extension:');
    expect(isExtensionPage()).toBe(true);
  });

  it.each(['https:', 'http:', 'file:'])('rejects the regular page protocol %s', (protocol) => {
    setPage(protocol);
    expect(isExtensionPage()).toBe(false);
  });
});

describe('restrictStorageToTrustedContexts', () => {
  it('applies the trusted-context access level when the capability exists', async () => {
    const setAccessLevel = vi.fn().mockResolvedValue(undefined);

    await restrictStorageToTrustedContexts({ setAccessLevel });

    expect(setAccessLevel).toHaveBeenCalledTimes(1);
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('skips the unsupported call when Firefox lacks setAccessLevel', async () => {
    await expect(restrictStorageToTrustedContexts({})).resolves.toBeUndefined();
  });

  it('propagates storage API failures instead of hiding them', async () => {
    const failure = new Error('storage unavailable');
    const setAccessLevel = vi.fn().mockRejectedValue(failure);

    await expect(restrictStorageToTrustedContexts({ setAccessLevel })).rejects.toBe(failure);
  });
});

describe('webdav settings on shared runtime', () => {
  it('keeps the isExtensionPage re-export available to existing callers', () => {
    setPage('moz-extension:');
    expect(reexportedIsExtensionPage()).toBe(true);
  });

  it('requests the origin permission synchronously from the caller before awaiting', () => {
    setPage('moz-extension:');
    extensionApi.requestPermissions.mockReturnValue(new Promise(() => {}));

    let resolved = false;
    void requestWebDavPermission('https://dav.example.com/orinui').then(() => { resolved = true; });

    expect(extensionApi.requestPermissions).toHaveBeenCalledWith({ origins: ['https://dav.example.com/*'] });
    expect(resolved).toBe(false);
  });
});
