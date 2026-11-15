/**
 * 浏览器书签平台边界。
 *
 * 本模块是唯一直接使用 `browser.bookmarks` 的运行时模块，只导出：
 * 能力/权限探测、整棵树读取、变更事件订阅、权限变更订阅与打开委托。
 * 不导出、也不调用 create/update/move/remove/removeTree/search；Orinui 对浏览器书签严格只读。
 *
 * 打开书签只把浏览器给出的原始地址交给 `tabs` API，由浏览器自身决定是否可导航。
 * 不使用 href、eval、innerHTML 或 window.open；拒绝缺失地址并让原生错误向上抛出。
 */
import { browser } from 'wxt/browser';
import { fail } from '@/domain/errors';
import type { RawBookmarkNode } from '@/domain/browser-bookmarks';

export type BookmarkCapability = 'available' | 'unsupported';
export type BookmarkPermission = 'granted' | 'denied';
export type BookmarkOpenTarget = 'current-tab' | 'new-tab';

interface BookmarkEvent {
  addListener: (listener: () => void) => void;
  removeListener: (listener: () => void) => void;
}

interface BookmarkApi {
  readonly getTree: () => Promise<readonly RawBookmarkNode[]>;
  readonly onCreated?: BookmarkEvent;
  readonly onRemoved?: BookmarkEvent;
  readonly onChanged?: BookmarkEvent;
  readonly onMoved?: BookmarkEvent;
  readonly onChildrenReordered?: BookmarkEvent;
  readonly onImportBegan?: BookmarkEvent;
  readonly onImportEnded?: BookmarkEvent;
}

interface PermissionsApi {
  readonly request: (permissions: { readonly permissions: string[] }) => Promise<boolean>;
  readonly contains: (permissions: { readonly permissions: string[] }) => Promise<boolean>;
  readonly onAdded?: {
    addListener: (listener: (permissions: { readonly permissions?: readonly string[] }) => void) => void;
    removeListener: (listener: (permissions: { readonly permissions?: readonly string[] }) => void) => void;
  };
  readonly onRemoved?: {
    addListener: (listener: (permissions: { readonly permissions?: readonly string[] }) => void) => void;
    removeListener: (listener: (permissions: { readonly permissions?: readonly string[] }) => void) => void;
  };
}

interface TabsApi {
  readonly create: (properties: { readonly url: string }) => Promise<unknown>;
  readonly query: (query: { readonly active: boolean; readonly currentWindow: boolean }) => Promise<readonly { readonly id?: number }[]>;
  readonly update: (tabId: number | undefined, properties: { readonly url: string }) => Promise<unknown>;
}

interface RuntimeBrowser {
  readonly bookmarks?: BookmarkApi;
  readonly permissions?: PermissionsApi;
  readonly tabs?: TabsApi;
}

export interface BookmarkChangeHandlers {
  readonly changed: () => void;
  readonly importingChanged: (importing: boolean) => void;
}

export interface BookmarkChangeSubscription {
  /** 浏览器是否提供成对的导入会话事件；只提供单侧时视为未提供，控制器退化为普通合并窗口。 */
  readonly importEvents: boolean;
  readonly dispose: () => void;
}

/**
 * 权限增减事件的可判定信息。
 *
 * 官方文档只说明 `permissions.onAdded` / `onRemoved` 的载荷是 Permissions 对象，
 * 并未规定 `bookmarks` 命名空间在授权前是否可见，也未规定事件与 `contains()` 的先后。
 * 因此这里只转述载荷本身：`bookmarks: null` 表示载荷无法判定，调用方必须自行
 * `contains()` 复核，并且撤销时先同步清空界面再异步确认。
 */
export interface BookmarkPermissionChange {
  readonly added: boolean;
  /** `true` = 载荷明确列出 bookmarks；`false` = 载荷明确不含；`null` = 无法判定。 */
  readonly bookmarks: boolean | null;
}

export interface BookmarkManagerGuidance {
  /** Chrome 扩展页跳转书签管理器尚未在真实扩展验证，因此固定为 false。 */
  readonly routeVerified: false;
  readonly chrome: string;
  readonly firefox: string;
}

/** 扩展 API 不可用时抛出，调用方据此显示“不支持”，而不是伪装成普通错误或空列表。 */
export class BookmarkUnsupportedError extends Error {
  override readonly name = 'BookmarkUnsupportedError';
  readonly code = 'unsupported' as const;

  constructor(message: string) {
    super(message);
  }
}

function runtime(): RuntimeBrowser | undefined {
  return browser as unknown as RuntimeBrowser | undefined;
}

function bookmarksApi(): BookmarkApi | undefined {
  return runtime()?.bookmarks;
}

function permissionsApi(): PermissionsApi | undefined {
  return runtime()?.permissions;
}

function tabsApi(): TabsApi | undefined {
  return runtime()?.tabs;
}

function requireBookmarks(): BookmarkApi {
  const api = bookmarksApi();
  if (!api || typeof api.getTree !== 'function') {
    throw new BookmarkUnsupportedError('此浏览器不提供书签接口，无法读取浏览器收藏夹');
  }
  return api;
}

function requirePermissions(): PermissionsApi {
  const api = permissionsApi();
  if (!api || typeof api.request !== 'function' || typeof api.contains !== 'function') {
    throw new BookmarkUnsupportedError('浏览器书签需要在已加载的 Chrome 或 Firefox 扩展中使用');
  }
  return api;
}

function requireTabs(): TabsApi {
  const api = tabsApi();
  if (!api || typeof api.create !== 'function' || typeof api.query !== 'function' || typeof api.update !== 'function') {
    throw new BookmarkUnsupportedError('当前环境不提供标签页接口，无法打开浏览器书签');
  }
  return api;
}

/** 能力探测本身不抛错；需要权限的浏览器可能暂时隐藏 bookmarks 命名空间。 */
export function hasBookmarkApi(): BookmarkCapability {
  const api = bookmarksApi();
  return api && typeof api.getTree === 'function' ? 'available' : 'unsupported';
}

/** 只查权限，不读取书签内容；普通网页预览会明确报告扩展 API 不可用。 */
export async function hasBookmarkPermission(): Promise<BookmarkPermission> {
  const api = requirePermissions();
  return await api.contains({ permissions: ['bookmarks'] }) ? 'granted' : 'denied';
}

/**
 * 在当前用户手势内请求可选 `bookmarks` 权限。
 *
 * 关键顺序：先同步创建 `permissions.request` 承诺，再等待结果。
 * 这个函数在调用 request 之前不执行任何 await，也不先查询 contains 或缓存，
 * 否则 Chrome 会认为请求不在用户手势中而拒绝弹窗。
 */
export function requestBookmarkPermission(): Promise<BookmarkPermission> {
  const api = requirePermissions();
  const request = api.request({ permissions: ['bookmarks'] });
  return request.then((granted) => granted ? 'granted' : 'denied');
}

/** 读取浏览器返回的原始树；规范化与结构校验在领域层完成。 */
export async function readBookmarkTree(): Promise<readonly RawBookmarkNode[]> {
  const api = requireBookmarks();
  const tree = await api.getTree();
  if (!Array.isArray(tree)) fail('浏览器书签树结构非法：顶层不是数组');
  return tree;
}

function listen(event: BookmarkEvent | undefined, listener: () => void): (() => void) | null {
  if (!event || typeof event.addListener !== 'function' || typeof event.removeListener !== 'function') return null;
  event.addListener(listener);
  return () => event.removeListener(listener);
}

/**
 * 订阅书签变更。
 *
 * 四个核心事件（created/removed/changed/moved）存在即挂载；`onChildrenReordered` 与
 * `onImportBegan` / `onImportEnded` 属于能力差异，只在浏览器实际提供时挂载，不按浏览器名硬分支。
 * 导入会话只在**成对**存在时启用：只挂 `onImportBegan` 会进入永远等不到结束的
 * “导入中”状态并抑制刷新，因此单侧缺失一律退化为普通合并窗口。
 * 任何变更都只通知控制器“需要重读”，不做增量补丁。
 */
export function subscribeBookmarkChanges(handlers: BookmarkChangeHandlers): BookmarkChangeSubscription {
  const api = bookmarksApi();
  if (!api) return { importEvents: false, dispose: () => {} };

  const cleanups = [api.onCreated, api.onRemoved, api.onChanged, api.onMoved]
    .map((event) => listen(event, handlers.changed))
    .filter((cleanup): cleanup is () => void => cleanup !== null);
  const reordered = listen(api.onChildrenReordered, handlers.changed);
  if (reordered) cleanups.push(reordered);

  const importSupported = (event: BookmarkEvent | undefined): boolean =>
    !!event && typeof event.addListener === 'function' && typeof event.removeListener === 'function';
  const importEvents = importSupported(api.onImportBegan) && importSupported(api.onImportEnded);
  if (importEvents) {
    const began = listen(api.onImportBegan, () => handlers.importingChanged(true));
    const ended = listen(api.onImportEnded, () => handlers.importingChanged(false));
    if (began) cleanups.push(began);
    if (ended) cleanups.push(ended);
  }

  return {
    importEvents,
    dispose() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

function permissionPayload(permissions: { readonly permissions?: readonly string[] } | undefined): BookmarkPermissionChange['bookmarks'] {
  // 载荷缺失或 `permissions` 字段缺失时无法判定；不能把“没有字段”当成“明确未包含”。
  if (permissions === undefined || permissions.permissions === undefined) return null;
  return permissions.permissions.includes('bookmarks');
}

/**
 * 订阅权限增减。
 *
 * 即使 `browser.bookmarks` 因未授权而不可见，这个订阅也必须能安装：
 * 撤销权限后立即清空投影；重新授权后自动恢复刷新。
 *
 * 事件只在“启动即订阅”时才有意义：授权前命名空间可能不可见，因此本函数不依赖
 * `bookmarks` 存在，只依赖 `permissions`。载荷无法判定时上报 `bookmarks: null`，
 * 由控制器用 `contains()` 复核，而不是猜成“与书签无关”而漏掉撤销。
 */
export function subscribeBookmarkPermissionChanges(
  listener: (change: BookmarkPermissionChange) => void,
): () => void {
  const api = permissionsApi();
  if (!api) return () => {};
  const cleanups: (() => void)[] = [];
  if (api.onAdded && typeof api.onAdded.addListener === 'function') {
    const added = (permissions: { readonly permissions?: readonly string[] } | undefined): void => {
      listener({ added: true, bookmarks: permissionPayload(permissions) });
    };
    api.onAdded.addListener(added);
    cleanups.push(() => api.onAdded?.removeListener(added));
  }
  if (api.onRemoved && typeof api.onRemoved.addListener === 'function') {
    const removed = (permissions: { readonly permissions?: readonly string[] } | undefined): void => {
      listener({ added: false, bookmarks: permissionPayload(permissions) });
    };
    api.onRemoved.addListener(removed);
    cleanups.push(() => api.onRemoved?.removeListener(removed));
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * 打开浏览器书签。
 *
 * 原始地址不做协议过滤、不改写、不补 scheme；`javascript:` 等地址也原样交给浏览器，
 * 由浏览器拒绝或执行自身导航，扩展页面不接触该地址内容。
 * `current-tab` 先定位当前标签页再更新；`new-tab` 直接创建。原生失败原样抛出。
 */
export async function openBookmark(rawUrl: string, target: BookmarkOpenTarget = 'new-tab'): Promise<void> {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') fail('书签地址缺失，无法打开');
  const tabs = requireTabs();
  if (target === 'current-tab') {
    const [current] = await tabs.query({ active: true, currentWindow: true });
    if (!current || typeof current.id !== 'number') fail('无法找到当前标签页，书签未打开');
    await tabs.update(current.id, { url: rawUrl });
    return;
  }
  await tabs.create({ url: rawUrl });
}

/** 浏览器书签管理器入口文案；路由未验证前只提供手动指引。 */
export function getBookmarkManagerGuidance(): BookmarkManagerGuidance {
  return {
    routeVerified: false,
    chrome: '按 Ctrl+Shift+O 打开书签管理器，或打开浏览器菜单 → 书签 → 书签管理器（扩展内跳转尚未验证）。',
    firefox: '按 Ctrl+Shift+O 打开书签库，或打开菜单 → 书签 → 管理书签。',
  };
}
