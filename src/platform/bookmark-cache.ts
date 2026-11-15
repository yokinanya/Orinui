/**
 * 浏览器书签的本地降级缓存。
 *
 * 只使用专用 `browser.storage.local` 键，不建 Dexie 表、不进入设置/同步/ZIP。
 * 缓存只有一个用途：功能已启用、权限仍有效、但本次读取失败时展示上一次成功结果。
 * 它不是首屏优化，也不能在未启用/未授权时读取。
 *
 * 写入与清空按代次与内部队列排序：关闭/撤销后的迟到写入会被拒绝，
 * 已进入实际写入的 set 一定先于后续清空落地，不会在清空之后把旧树写回来。
 * 存储不可用（例如普通网页预览）时抛出明确的“不支持”，而不是伪装成空缓存。
 */
import { browser } from 'wxt/browser';
import { parseNormalizedBookmarkTree, type NormalizedBookmarkTree } from '@/domain/browser-bookmarks';
import { restrictStorageToTrustedContexts } from '@/platform/extension-runtime';
import { BookmarkUnsupportedError } from '@/platform/bookmarks';

export const BOOKMARK_CACHE_KEY = 'orinui.browser-bookmarks.v1';

export interface CachedBookmarkTree {
  readonly version: 1;
  /** 最近一次成功读取并规范化的完整树。 */
  readonly tree: NormalizedBookmarkTree;
  /** 该次读取完成时间（毫秒时间戳）。 */
  readonly readAt: number;
}

export interface BookmarkCacheArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  /** Chrome 提供、Firefox 缺少的能力；由共享运行助手按存在与否调用。 */
  setAccessLevel?: (options: { readonly accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void> | void;
}

export interface BookmarkStorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface BookmarkCacheChange {
  /** 键被其他上下文移除或清空。 */
  readonly removed: boolean;
  readonly value: CachedBookmarkTree | null;
}

type StorageChangeListener = (changes: Record<string, BookmarkStorageChange>, areaName: string) => void;

export interface BookmarkCacheChangeSource {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
}

export interface BookmarkCachePorts {
  /** 测试/宿主注入的存储区；省略时使用扩展的 `browser.storage.local`。 */
  readonly area?: BookmarkCacheArea;
  readonly onChanged?: BookmarkCacheChangeSource;
  readonly now?: () => number;
  readonly isExtension?: () => boolean;
}

export interface BookmarkCache {
  read(): Promise<CachedBookmarkTree | null>;
  /**
   * 写入最新成功结果。
   *
   * @param generation 调用方当前的代次；小于本模块已知最小代次时拒绝写入并返回 false。
   * @returns 是否真正写入；被取代时返回 false（不报错，也不伪造成功）。
   */
  write(tree: NormalizedBookmarkTree, generation: number): Promise<boolean>;
  /** 清空缓存并把所有旧代次的迟到写入标记为失效。 */
  clear(generation: number): Promise<void>;
  /** 订阅其他标签页/上下文对本键的修改；自身写入也会触发，由调用方按值判断。 */
  subscribe(listener: (change: BookmarkCacheChange) => void): () => void;
  /** 当前最小可写代次，供诊断与测试。 */
  minimumGeneration(): number;
}

function runtimeChanges(): BookmarkCacheChangeSource | undefined {
  return (browser as unknown as { storage?: { onChanged?: BookmarkCacheChangeSource } }).storage?.onChanged;
}

function runtimeArea(): BookmarkCacheArea | undefined {
  const local = (browser as unknown as {
    storage?: { local?: { get?: unknown; set?: unknown; remove?: unknown } };
  }).storage?.local;
  if (!local || typeof local.get !== 'function' || typeof local.set !== 'function' || typeof local.remove !== 'function') {
    return undefined;
  }
  return local as unknown as BookmarkCacheArea;
}

function extensionPage(): boolean {
  return globalThis.location?.protocol === 'chrome-extension:' || globalThis.location?.protocol === 'moz-extension:';
}

function parseCached(value: unknown): CachedBookmarkTree {
  if (typeof value !== 'object' || value === null) throw new Error('书签缓存损坏：缓存项不是对象');
  const candidate = value as { readonly version?: unknown; readonly tree?: unknown; readonly readAt?: unknown };
  if (candidate.version !== 1) throw new Error('书签缓存损坏：缓存版本未知');
  if (typeof candidate.readAt !== 'number' || !Number.isFinite(candidate.readAt)) {
    throw new Error('书签缓存损坏：读取时间非法');
  }
  return { version: 1, tree: parseNormalizedBookmarkTree(candidate.tree), readAt: candidate.readAt };
}

/**
 * 创建缓存端口。
 *
 * 普通网页预览没有扩展存储：读写都抛出 unsupported，界面据此显示明确说明，
 * 不能把“读不到存储”当成“没有书签”或普通错误。
 */
export function createBookmarkCache(ports: BookmarkCachePorts = {}): BookmarkCache {
  const isExtension = ports.isExtension ?? extensionPage;
  let area: BookmarkCacheArea | undefined = ports.area;
  let minimum = 0;
  /** 串行化写入与清空，确保 clear 不会与已开始的 set 交错。 */
  let queue: Promise<unknown> = Promise.resolve();

  const resolveArea = (): BookmarkCacheArea => {
    if (!isExtension()) {
      throw new BookmarkUnsupportedError('书签缓存只在已加载的 Chrome 或 Firefox 扩展中可用，普通网页预览不支持');
    }
    if (!area) {
      area = runtimeArea();
      if (!area) throw new BookmarkUnsupportedError('浏览器存储接口不可用，无法保存书签缓存');
    }
    return area;
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    async read() {
      const target = resolveArea();
      await restrictStorageToTrustedContexts(target);
      const stored = await target.get(BOOKMARK_CACHE_KEY);
      const value = stored[BOOKMARK_CACHE_KEY];
      if (value === undefined) return null;
      return parseCached(value);
    },

    write(tree, generation) {
      return enqueue(async () => {
        if (generation <= minimum) return false;
        const target = resolveArea();
        await restrictStorageToTrustedContexts(target);
        // 串行队列保证只有正在执行的这一次写入；若已开始后发生清空，清空会排在其后。
        if (generation <= minimum) return false;
        const entry: CachedBookmarkTree = { version: 1, tree, readAt: (ports.now ?? Date.now)() };
        await target.set({ [BOOKMARK_CACHE_KEY]: entry });
        return true;
      });
    },

    clear(generation) {
      minimum = Math.max(minimum, generation);
      return enqueue(async () => {
        const target = resolveArea();
        await restrictStorageToTrustedContexts(target);
        await target.remove(BOOKMARK_CACHE_KEY);
      });
    },

    subscribe(listener) {
      const source = ports.onChanged ?? runtimeChanges();
      if (!source) return () => {};
      const handler: StorageChangeListener = (changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[BOOKMARK_CACHE_KEY];
        if (change === undefined) return;
        if (change.newValue === undefined) {
          listener({ removed: true, value: null });
          return;
        }
        let value: CachedBookmarkTree | null = null;
        try {
          value = parseCached(change.newValue);
        } catch {
          // 其他上下文写入损坏数据时不上抛；调用方只需知道缓存不再可信。
          value = null;
        }
        listener({ removed: false, value });
      };
      source.addListener(handler);
      return () => source.removeListener(handler);
    },

    minimumGeneration: () => minimum,
  };
}
