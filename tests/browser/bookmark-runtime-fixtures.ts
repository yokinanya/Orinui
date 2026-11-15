import type { Page } from '@playwright/test';

/**
 * 普通网页（vite preview，http 协议）里的受控假平台。
 *
 * 边界（必须如实理解，不能当作真实扩展验收）：
 * - 本文件只在 http 页面通过 `page.addInitScript` 注入 `globalThis.browser`，不改写原生
 *   `globalThis.chrome`，也不请求任何真实扩展权限；`runtime.id` 只是让 `wxt/browser`
 *   选择这个假对象。
 * - 假平台始终暴露 `bookmarks` 命名空间。Chrome 在未授权时通常隐藏该命名空间，
 *   这里没有模拟“授权前命名空间缺失”的能力缝隙。
 * - `browser.storage` 故意不提供可用实现，因此 `bookmark-cache.ts` 在 http 协议下
 *   仍会抛出 unsupported；本 fixture **不覆盖** stale 降级、缓存写入成功或清缓存成功。
 * - `permissions.request/contains` 与 `bookmarks.getTree` 都是内存桩，计数只在当前
 *   文档内有效；重新加载页面后计数归零，权限只经 localStorage 中的测试标记恢复。
 * - tabs.create/query/update 不真正导航，只记录地址；`openFailure` 是模拟浏览器拒绝。
 * 书签树、标题与地址都来自本文件的测试常量，不读取用户 profile 或真实书签。
 */

export const BOOKMARK_ROOT_DIRECT_URL = 'https://root-direct.example/';
export const BOOKMARK_SECRET_URL = 'https://secret-token-abc123.example/private/path?token=leaked-secret';
export const BOOKMARK_CACHE_WARNING = '书签缓存保存失败';

export interface FixtureBookmarkNode {
  readonly id: string;
  readonly parentId?: string;
  readonly index?: number;
  readonly title?: string;
  readonly url?: string;
  readonly type?: 'folder' | 'separator';
  readonly children?: readonly FixtureBookmarkNode[];
}

/** Chrome 形状：单一内部虚拟根 `'0'`，其下是公开根。 */
export const BOOKMARK_TREE: readonly FixtureBookmarkNode[] = [{
  id: '0',
  title: '',
  children: [
    {
      id: '1',
      parentId: '0',
      index: 0,
      title: '书签栏',
      type: 'folder',
      children: [
        { id: 'b-root-direct', parentId: '1', index: 0, title: '根直链', url: BOOKMARK_ROOT_DIRECT_URL },
        {
          id: 'f-work',
          parentId: '1',
          index: 1,
          title: '工作',
          type: 'folder',
          children: [
            { id: 'b-deep', parentId: 'f-work', index: 0, title: '深层链接', url: 'https://deep.example/a' },
            {
              id: 'f-inner',
              parentId: 'f-work',
              index: 1,
              title: '子层',
              type: 'folder',
              children: [
                { id: 'b-inner', parentId: 'f-inner', index: 0, title: '更深链接', url: 'https://inner.example/b' },
              ],
            },
          ],
        },
        { id: 'sep-1', parentId: '1', index: 2, title: '', type: 'separator' },
        { id: 'b-dupe-a', parentId: '1', index: 3, title: '重复链接', url: 'https://dupe.example/' },
        { id: 'b-dupe-b', parentId: '1', index: 4, title: '重复链接（副本）', url: 'https://dupe.example/' },
        { id: 'f-empty', parentId: '1', index: 5, title: '空文件夹', type: 'folder', children: [] },
        { id: 'b-bad', parentId: '1', index: 6, title: '坏地址', url: '缺少协议的书签地址' },
        { id: 'b-no-url', parentId: '1', index: 7, title: '无地址书签' },
        { id: 'b-secret', parentId: '1', index: 8, title: '秘密书签', url: BOOKMARK_SECRET_URL },
      ],
    },
    {
      id: '2',
      parentId: '0',
      index: 1,
      title: '其他收藏夹',
      type: 'folder',
      children: [
        { id: 'b-other', parentId: '2', index: 0, title: '其他站点', url: 'https://other.example/' },
      ],
    },
  ],
}];

export interface BookmarkPlatformCounts {
  readonly request: number;
  readonly contains: number;
  readonly getTree: number;
  readonly tabsCreate: number;
  readonly tabsQuery: number;
  readonly tabsUpdate: number;
}

export interface BookmarkPlatformControl {
  counts(): BookmarkPlatformCounts;
  requestPhases(): string[];
  openedUrls(): string[];
  setGranted(granted: boolean): void;
  setNextRequestGrant(granted: boolean): void;
  setOpenFailure(message: string | null): void;
  emitPermission(kind: 'added' | 'removed', permissions?: string[] | null): void;
  emitBookmarkChange(): void;
}

export interface SeedBookmarkRule {
  readonly ruleId: string;
  readonly targetId: string;
  readonly path: readonly string[];
  readonly kind: 'root' | 'folder';
  readonly hidden: boolean;
  readonly updatedAt: number;
}

export interface SeedBookmarkPreferencesInput {
  readonly enabled: boolean;
  readonly hiddenRules: readonly SeedBookmarkRule[];
}

declare global {
  interface Window {
    __orinuiBookmarkPlatform?: BookmarkPlatformControl;
  }
}

const PERMISSION_KEY = 'orinui.test.bookmark-permission';

export interface InstallBookmarkPlatformOptions {
  readonly tree?: readonly FixtureBookmarkNode[];
  readonly granted?: boolean;
  readonly grantOnRequest?: boolean;
  readonly openFailure?: string | null;
}

/**
 * 在页面任何 bundle 脚本之前注入同一份 `globalThis.browser`。
 *
 * 注入对象在整个文档生命周期内原地可变：测试通过 `window.__orinuiBookmarkPlatform`
 * 修改授权、拒绝打开或触发权限/书签事件，而不是替换 browser 对象。
 */
export async function installBookmarkPlatform(
  page: Page,
  options: InstallBookmarkPlatformOptions = {},
): Promise<void> {
  await page.addInitScript((input) => {
    const PERMISSION_STORAGE_KEY = input.permissionKey;
    const readPersisted = (): boolean | null => {
      try {
        const value = window.localStorage.getItem(PERMISSION_STORAGE_KEY);
        return value === null ? null : value === 'granted';
      } catch {
        return null;
      }
    };
    const persist = (granted: boolean) => {
      try {
        window.localStorage.setItem(PERMISSION_STORAGE_KEY, granted ? 'granted' : 'denied');
      } catch {
        // 存储被禁用时不静默改写产品行为：本页仍使用内存状态，只是刷新后无法恢复。
      }
    };

    interface ListenerEvent {
      addListener(listener: (payload?: unknown) => void): void;
      removeListener(listener: (payload?: unknown) => void): void;
      hasListener(listener: (payload?: unknown) => void): boolean;
      emit(payload?: unknown): void;
    }
    const createEvent = (): ListenerEvent => {
      const listeners = new Set<(payload?: unknown) => void>();
      return {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
        hasListener(listener) { return listeners.has(listener); },
        emit(payload) { for (const listener of [...listeners]) listener(payload); },
      };
    };

    const counts = { request: 0, contains: 0, getTree: 0, tabsCreate: 0, tabsQuery: 0, tabsUpdate: 0 };
    const phases: string[] = [];
    const opened: string[] = [];
    const persisted = readPersisted();
    const state = {
      granted: persisted ?? input.granted,
      nextRequestGrant: input.grantOnRequest,
      openFailure: input.openFailure as string | null,
      tree: input.tree,
    };

    /**
     * 手势探针：点击捕获阶段记录 `capture`，并在微任务里翻转。
     * 若权限请求与点击处理在同一任务内同步发起，记录的仍是 `capture`；
     * 一旦 request 被 await/定时器推迟，微任务先运行，记录就会变成 `after-microtask`。
     */
    let clickPhase = 'none';
    document.addEventListener('click', () => {
      clickPhase = 'capture';
      queueMicrotask(() => {
        if (clickPhase === 'capture') clickPhase = 'after-microtask';
      });
    }, true);

    const added = createEvent();
    const removed = createEvent();
    const onCreated = createEvent();
    const onRemoved = createEvent();
    const onChanged = createEvent();
    const onMoved = createEvent();
    const onChildrenReordered = createEvent();
    const onImportBegan = createEvent();
    const onImportEnded = createEvent();

    const setGranted = (granted: boolean) => {
      state.granted = granted;
      persist(granted);
    };

    const fakeBrowser = {
      runtime: {
        id: 'orinui-controlled-fake-extension',
        getURL: (path = '') => `http://127.0.0.1:5173/${String(path).replace(/^\/+/u, '')}`,
        getManifest: () => ({ name: 'Orinui 受控假平台', version: '0.0.0', version_name: '0.0.0-test' }),
      },
      permissions: {
        request: (permissions: { readonly permissions?: readonly string[] }) => {
          counts.request += 1;
          phases.push(clickPhase);
          clickPhase = 'none';
          if (state.nextRequestGrant) {
            setGranted(true);
            // 真实浏览器在授权完成后发出 onAdded；载荷只包含本次申请的可选权限。
            added.emit({ permissions: permissions.permissions ?? ['bookmarks'] });
          }
          return Promise.resolve(state.nextRequestGrant);
        },
        contains: (_permissions: { readonly permissions?: readonly string[] }) => {
          counts.contains += 1;
          return Promise.resolve(state.granted);
        },
        onAdded: added,
        onRemoved: removed,
      },
      bookmarks: {
        getTree: () => {
          counts.getTree += 1;
          return Promise.resolve(JSON.parse(JSON.stringify(state.tree)) as unknown[]);
        },
        onCreated,
        onRemoved,
        onChanged,
        onMoved,
        onChildrenReordered,
        onImportBegan,
        onImportEnded,
      },
      tabs: {
        create: (properties: { readonly url: string }) => {
          counts.tabsCreate += 1;
          opened.push(properties.url);
          return state.openFailure === null
            ? Promise.resolve({ id: 1 })
            : Promise.reject(new Error(state.openFailure));
        },
        query: () => {
          counts.tabsQuery += 1;
          return Promise.resolve([{ id: 1, url: 'http://127.0.0.1:5173/newtab.html', active: true }]);
        },
        update: (tabId: number | undefined, properties: { readonly url: string }) => {
          counts.tabsUpdate += 1;
          opened.push(properties.url);
          return state.openFailure === null
            ? Promise.resolve({ id: tabId ?? 1 })
            : Promise.reject(new Error(state.openFailure));
        },
      },
    };

    (globalThis as unknown as { browser?: unknown }).browser = fakeBrowser;

    window.__orinuiBookmarkPlatform = {
      counts: () => ({ ...counts }),
      requestPhases: () => [...phases],
      openedUrls: () => [...opened],
      setGranted,
      setNextRequestGrant: (granted) => { state.nextRequestGrant = granted; },
      setOpenFailure: (message) => { state.openFailure = message; },
      emitPermission: (kind, permissions = ['bookmarks']) => {
        setGranted(kind === 'added');
        const payload = permissions === null ? undefined : { permissions };
        if (kind === 'added') added.emit(payload); else removed.emit(payload);
      },
      emitBookmarkChange: () => { onChanged.emit(); },
    };
  }, {
    tree: options.tree ?? BOOKMARK_TREE,
    granted: options.granted ?? false,
    grantOnRequest: options.grantOnRequest ?? true,
    openFailure: options.openFailure ?? null,
    permissionKey: PERMISSION_KEY,
  });
}

export async function platformCounts(page: Page): Promise<BookmarkPlatformCounts> {
  return page.evaluate(() => window.__orinuiBookmarkPlatform!.counts());
}

export async function requestPhases(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__orinuiBookmarkPlatform!.requestPhases());
}

export async function openedBookmarkUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__orinuiBookmarkPlatform!.openedUrls());
}

/** 让下一次文档加载仍处于已授权状态（只写测试 localStorage 标记，不碰产品设置）。 */
export async function persistBookmarkPermission(page: Page, granted: boolean): Promise<void> {
  await page.evaluate((value) => window.__orinuiBookmarkPlatform!.setGranted(value), granted);
}

/** 触发权限增减事件；`permissions: null` 表示载荷无法判定（走 contains 复核分支）。 */
export async function emitBookmarkPermission(
  page: Page,
  kind: 'added' | 'removed',
  permissions: string[] | null = ['bookmarks'],
): Promise<void> {
  await page.evaluate(({ eventKind, payload }) => {
    window.__orinuiBookmarkPlatform!.emitPermission(eventKind, payload);
  }, { eventKind: kind, payload: permissions });
}

export async function setBookmarkOpenFailure(page: Page, message: string | null): Promise<void> {
  await page.evaluate((value) => window.__orinuiBookmarkPlatform!.setOpenFailure(value), message);
}

type SettingsRowProbe =
  | { readonly state: 'ready' }
  | { readonly state: 'pending'; readonly reason: string };

/**
 * 只读探测真实 Dexie 库里的 `settings` / `app` 行是否已经落库。
 *
 * 首次打开时 `openHome` 只能等到 `<main>` 可见，而加载骨架屏同样是 `<main>`，
 * 此时 `ensureInitialized` → `writeDefaultSettings` 可能还没提交。这里不猜时间：
 * - 先看 `indexedDB.databases()` 里有没有 `orinui`，没有就**不 open**，避免抢先建出
 *   空库、让产品侧的 Dexie 升级失败；
 * - 只有 `settings` 表与 `app` 行（含 `bookmarks` 偏好）都就绪才返回 ready。
 */
export async function probeSettingsRow(page: Page): Promise<SettingsRowProbe> {
  return page.evaluate(() => new Promise<SettingsRowProbe>((resolve) => {
    const finish = (value: SettingsRowProbe) => resolve(value);

    const readStore = () => {
      let opening: IDBOpenDBRequest;
      try {
        opening = indexedDB.open('orinui');
      } catch (error) {
        finish({ state: 'pending', reason: `无法打开测试数据库：${String(error)}` });
        return;
      }
      let createdHere = false;
      opening.onupgradeneeded = () => { createdHere = true; };
      opening.onblocked = () => finish({ state: 'pending', reason: '测试数据库被其它连接阻塞' });
      opening.onerror = () => finish({
        state: 'pending', reason: `打开测试数据库失败：${String(opening.error ?? '未知错误')}`,
      });
      opening.onsuccess = () => {
        const database = opening.result;
        // 探测连接必须立刻让路，避免阻塞产品侧 Dexie 的版本升级。
        database.onversionchange = () => { database.close(); };
        // 抢在 Dexie 之前建出的空库必须丢弃，否则产品侧会因版本不匹配无法升级。
        if (createdHere || !database.objectStoreNames.contains('settings')) {
          database.close();
          if (createdHere) indexedDB.deleteDatabase('orinui');
          finish({ state: 'pending', reason: 'settings 表尚未建立' });
          return;
        }
        const read = database.transaction('settings', 'readonly').objectStore('settings').get('app');
        read.onerror = () => {
          database.close();
          finish({ state: 'pending', reason: `读取测试设置失败：${String(read.error ?? '未知错误')}` });
        };
        read.onsuccess = () => {
          const row = read.result as { bookmarks?: unknown } | undefined;
          database.close();
          if (!row) {
            finish({ state: 'pending', reason: '设置行尚未初始化' });
            return;
          }
          if (!row.bookmarks) {
            finish({ state: 'pending', reason: '设置行缺少浏览器书签偏好' });
            return;
          }
          finish({ state: 'ready' });
        };
      };
    };

    const factory = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
    if (typeof factory.databases !== 'function') {
      readStore();
      return;
    }
    factory.databases().then((list) => {
      if (list.some((entry) => entry.name === 'orinui')) readStore();
      else finish({ state: 'pending', reason: '测试数据库尚未创建' });
    }, () => readStore());
  }));
}

/**
 * 轮询到 `settings` / `app` 行真正落库为止；只用条件轮询，不用固定延时兜底。
 *
 * 上限与 Playwright 默认断言超时一致（5s），不额外放宽；实测未降速时约 170ms，
 * CDP 12 倍 CPU 降速下实测 0.40–0.54s。
 */
export async function waitForSettingsRow(page: Page, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastReason = '未开始探测';
  for (;;) {
    const probe = await probeSettingsRow(page);
    if (probe.state === 'ready') return;
    lastReason = probe.reason;
    if (Date.now() > deadline) {
      throw new Error(`等待测试设置行超时（${timeoutMs}ms）：${lastReason}`);
    }
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

/**
 * 直接写真实 Dexie 库里的设置行（不依赖任何产品 test hook）。
 *
 * 只用于把“同一浏览器文件夹命中多条隐藏规则”的用户数据预置进去；不写入书签内容、
 * 不修改缓存、不绕过设置校验以外的路径。写入前先确定性等待默认设置行落库，
 * 因为 `openHome` 的 `<main>` 可见也可能只是加载骨架屏。
 */
export async function seedBookmarkPreferences(
  page: Page,
  input: SeedBookmarkPreferencesInput,
): Promise<void> {
  await waitForSettingsRow(page);
  await page.evaluate((payload) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('settings', 'readwrite');
      const store = transaction.objectStore('settings');
      const request = store.get('app');
      request.onerror = () => reject(request.error ?? new Error('无法读取测试设置'));
      request.onsuccess = () => {
        const row = request.result as Record<string, unknown> | undefined;
        if (!row) {
          transaction.abort();
          reject(new Error('测试设置行尚未初始化'));
          return;
        }
        const bookmarks = row.bookmarks as Record<string, unknown> | undefined;
        if (!bookmarks) {
          transaction.abort();
          reject(new Error('测试设置缺少浏览器书签偏好'));
          return;
        }
        store.put({
          ...row,
          bookmarks: { ...bookmarks, enabled: payload.enabled, hiddenRules: payload.hiddenRules },
        });
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('写入测试设置失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('测试设置事务已中止'));
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }), { enabled: input.enabled, hiddenRules: input.hiddenRules });
}

export interface ReadBookmarkPreferences {
  readonly enabled: boolean;
  readonly mode: 'region' | 'folder';
  readonly showInSearch: boolean;
}

/** 读真实 Dexie 设置行里的书签偏好，验证另一个页面的写入确实提交（而不只是本地界面）。 */
export async function readBookmarkPreferences(page: Page): Promise<ReadBookmarkPreferences> {
  return page.evaluate(() => new Promise<ReadBookmarkPreferences>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('settings', 'readonly');
      const request = transaction.objectStore('settings').get('app');
      request.onerror = () => reject(request.error ?? new Error('无法读取测试设置'));
      request.onsuccess = () => {
        const row = request.result as
          | { bookmarks?: { enabled?: boolean; mode?: 'region' | 'folder'; showInSearch?: boolean } }
          | undefined;
        if (!row?.bookmarks) {
          reject(new Error('测试设置缺少浏览器书签偏好'));
          return;
        }
        resolve({
          enabled: row.bookmarks.enabled === true,
          mode: row.bookmarks.mode === 'folder' ? 'folder' : 'region',
          showInSearch: row.bookmarks.showInSearch !== false,
        });
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('读取测试设置失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('测试设置读取事务已中止'));
      transaction.oncomplete = () => { database.close(); };
    };
  }));
}

export async function readBookmarkRules(page: Page): Promise<Array<{ ruleId: string; hidden: boolean }>> {
  return page.evaluate(() => new Promise<Array<{ ruleId: string; hidden: boolean }>>((resolve, reject) => {
    const opening = indexedDB.open('orinui');
    opening.onerror = () => reject(opening.error ?? new Error('无法打开测试数据库'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('settings', 'readonly');
      const request = transaction.objectStore('settings').get('app');
      request.onerror = () => reject(request.error ?? new Error('无法读取测试设置'));
      request.onsuccess = () => {
        const row = request.result as { bookmarks?: { hiddenRules?: Array<{ ruleId: string; hidden: boolean }> } } | undefined;
        resolve((row?.bookmarks?.hiddenRules ?? []).map((rule) => ({ ruleId: rule.ruleId, hidden: rule.hidden })));
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('读取测试设置失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('测试设置读取事务已中止'));
      transaction.oncomplete = () => { database.close(); };
    };
  }));
}
