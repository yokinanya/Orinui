import { browser } from 'wxt/browser';
import { parseS3Configuration } from '@/domain/s3-configuration';
import type { S3Configuration } from '@/domain/s3-configuration';

const S3_CONFIGURATION_KEY = 'orinui.s3.v1';

function requireExtension(): void {
  if (location.protocol !== 'chrome-extension:') throw new Error('S3 同步需要在已加载的 Chrome 扩展中使用');
}

export interface S3ConfigurationStore {
  read(): Promise<S3Configuration | null>;
  write(value: S3Configuration): Promise<void>;
  remove(): Promise<void>;
}

export function createS3ConfigurationStore(): S3ConfigurationStore {
  return {
    async read() {
      requireExtension();
      await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      const stored = await browser.storage.local.get(S3_CONFIGURATION_KEY);
      return stored[S3_CONFIGURATION_KEY] === undefined ? null : parseS3Configuration(stored[S3_CONFIGURATION_KEY]);
    },
    async write(value) {
      requireExtension();
      await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await browser.storage.local.set({ [S3_CONFIGURATION_KEY]: parseS3Configuration(value) });
    },
    async remove() { requireExtension(); await browser.storage.local.remove(S3_CONFIGURATION_KEY); },
  };
}

function permission(endpoint: string) { return { origins: [`${new URL(endpoint).origin}/*`] }; }

export async function requestS3Permission(endpoint: string): Promise<void> {
  requireExtension();
  if (!await browser.permissions.request(permission(endpoint))) throw new Error('未授予 S3 来源权限，连接已取消');
}

export async function checkS3Permission(endpoint: string): Promise<void> {
  requireExtension();
  if (!await browser.permissions.contains(permission(endpoint))) throw new Error('S3 来源权限已撤销，请重新授权后同步');
}

export function subscribeS3Configuration(changed: () => void): () => void {
  if (location.protocol !== 'chrome-extension:') return () => {};
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && S3_CONFIGURATION_KEY in changes) changed();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
