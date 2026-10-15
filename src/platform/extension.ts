import { browser } from 'wxt/browser';

export interface ExtensionInfo {
  name: string;
  version: string;
}

/**
 * 扩展自身信息。
 *
 * 平台模块：集中放置扩展 API 调用，便于后续新增浏览器目标时只改这里。
 */
export function getExtensionInfo(): ExtensionInfo {
  const manifest = browser.runtime.getManifest();
  return {
    name: manifest.name,
    version: manifest.version_name ?? manifest.version,
  };
}
