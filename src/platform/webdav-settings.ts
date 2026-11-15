import { browser } from 'wxt/browser';
import { parseWebDavConfiguration } from '@/domain/webdav/configuration';
import { isExtensionPage, restrictStorageToTrustedContexts } from '@/platform/extension-runtime';
import type { WebDavConfigurationStore } from '@/sync/webdav-types';

const CONFIGURATION_KEY = 'orinui.webdav.v1';

// 保持既有导出名，现有调用方继续从本模块读取。
export { isExtensionPage };

function requireExtension(): void {
  if (!isExtensionPage()) throw new Error('WebDAV 同步需要在已加载的 Chrome 或 Firefox 扩展中使用');
}

export function createWebDavConfigurationStore(): WebDavConfigurationStore {
  return {
    async read() {
      requireExtension();
      await restrictStorageToTrustedContexts(browser.storage.local);
      const stored = await browser.storage.local.get(CONFIGURATION_KEY);
      return stored[CONFIGURATION_KEY] === undefined ? null : parseWebDavConfiguration(stored[CONFIGURATION_KEY]);
    },
    async write(value) {
      requireExtension();
      const config = parseWebDavConfiguration(value);
      await restrictStorageToTrustedContexts(browser.storage.local);
      await browser.storage.local.set({ [CONFIGURATION_KEY]: config });
    },
    async remove() { requireExtension(); await browser.storage.local.remove(CONFIGURATION_KEY); },
  };
}

function permissions(url: string) { return { origins: [`${new URL(url).origin}/*`] }; }

export async function requestWebDavPermission(url: string): Promise<void> {
  requireExtension();
  if (!await browser.permissions.request(permissions(url))) throw new Error('未授予 WebDAV 来源权限，连接已取消');
}

export async function checkWebDavPermission(url: string): Promise<void> {
  requireExtension();
  if (!await browser.permissions.contains(permissions(url))) throw new Error('WebDAV 来源权限已撤销，请重新授权后同步');
}

export function subscribeWebDavConfiguration(changed: () => void): () => void {
  if (!isExtensionPage()) return () => {};
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && CONFIGURATION_KEY in changes) changed();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
