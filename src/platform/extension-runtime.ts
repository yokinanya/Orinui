/**
 * 扩展运行环境判定与存储访问级别。
 *
 * 平台模块：Chrome 与 Firefox 共用同一份本地运行时。
 * - Chrome 扩展页 origin 为 `chrome-extension:`，Firefox 为 `moz-extension:`；
 *   普通网页（HTTP/HTTPS/file）仍视为非扩展环境。
 * - Chrome MV3 通过 `storage.local.setAccessLevel` 把同步凭据限制在受信上下文；
 *   Firefox 未实现该 API，能力缺失时明确跳过（不使用通用 try/catch 掩盖其他失败）。
 */

const EXTENSION_PROTOCOLS: readonly string[] = ['chrome-extension:', 'moz-extension:'];

/** 当前页面是否运行在真实的 Chrome 或 Firefox 扩展页面中。 */
export function isExtensionPage(): boolean {
  return EXTENSION_PROTOCOLS.includes(globalThis.location?.protocol ?? '');
}

/** 只声明本模块实际使用的能力，避免把 Firefox 缺失的 API 当成一定存在。 */
export interface TrustedContextStorageArea {
  readonly setAccessLevel?: (options: { readonly accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void> | void;
}

/**
 * 把存储访问限制在受信扩展上下文。
 *
 * Firefox 的 `storage.local` 没有 `setAccessLevel`；这种情况下不调用该 API，
 * 因为 Firefox 的扩展页本身已是受信上下文。其他失败（权限、配额、运行时错误）
 * 由调用方向上抛出，不在这里吞掉。
 */
export async function restrictStorageToTrustedContexts(area: TrustedContextStorageArea): Promise<void> {
  if (typeof area.setAccessLevel !== 'function') return;
  await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
