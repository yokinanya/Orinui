import { browser } from 'wxt/browser';

export interface ExtensionInfo {
  name: string;
  version: string;
}

/**
 * 扩展自身信息。
 *
 * 平台模块：集中放置扩展 API 调用，便于后续新增浏览器目标时只改这里。
 * 只有扩展环境才提供 runtime.getManifest；普通网页预览没有扩展 API，
 * Chrome 与 Firefox 的扩展页面走同一实现，这里明确报错而不是伪造版本号。
 */
export function getExtensionInfo(): ExtensionInfo {
  const runtime = browser.runtime;
  if (!runtime?.getManifest) throw new Error('无法读取扩展信息：当前页面不在 Chrome 或 Firefox 扩展环境中运行');
  const manifest = runtime.getManifest();
  return {
    name: manifest.name,
    version: manifest.version_name ?? manifest.version,
  };
}
