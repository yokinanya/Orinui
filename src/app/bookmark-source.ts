/**
 * 浏览器书签应用层数据源。
 *
 * 负责启用/授权/读取/降级缓存的完整生命周期，并把只读投影暴露给 UI 与搜索。
 * 平台 API 通过端口注入，因此本模块不直接接触扩展 API，也不会创建 Orinui 账号实体。
 *
 * 状态机（AGENTS 与设计稿）：
 * disabled / unsupported / permission-missing / loading / ready / stale / error。
 * - loading：已启用，正在检查权限或等待首次读取；不先展示缓存。
 * - stale：权限仍有效但读取失败，且存在上一次成功结果；读取时间与错误必须可见。
 * - error：读取/缓存都不可用；不显示空态伪装“没有书签”。
 * - permission-missing：本机未授权或被撤销；不渲染任何书签标题。
 * - unsupported：权限已授予但没有书签 API（含普通网页预览）。
 *
 * 代次门控：每次禁用/撤销/刷新都推进 generation。迟到的读取结果、缓存写入与
 * 其他标签页的缓存变更必须匹配当前代次与状态，避免关闭或撤销后旧树重新出现。
 *
 * 生命周期门控：除 `generation` 外，`lifecycleEpoch` 只在关闭、明确撤销与销毁时推进
 * （普通刷新与容量/窗口重读都不推进）。授权请求是用户手势内的异步操作，返回时可能
 * 已经越过一次关闭或撤销；此时授权结果只更新权限显示，不能把功能悄悄重新启用。
 * 撤销之后用户再次点击启用会捕获新的代次，因此真正快速的重新授权仍然生效。
 */
import {
  normalizeBookmarkTree,
  projectBookmarkTree,
  resolveHiddenRules,
  type BookmarkHiddenRuleInput,
  type BookmarkHiddenRulePending,
  type BookmarkProjection,
  type BookmarkProjectionMode,
  type NormalizedBookmarkTree,
  type RawBookmarkNode,
} from '@/domain/browser-bookmarks';
import type {
  BookmarkCapability,
  BookmarkOpenTarget,
  BookmarkPermission,
  BookmarkPermissionChange,
} from '@/platform/bookmarks';
import type { BookmarkCache, CachedBookmarkTree } from '@/platform/bookmark-cache';

export type BookmarkSourceStatus =
  | 'disabled'
  | 'unsupported'
  | 'permission-missing'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'error';

export interface BookmarkSourceSnapshot {
  readonly status: BookmarkSourceStatus;
  readonly capability: BookmarkCapability;
  /** 最近一次权限查询结果；尚未查询时为 unknown。 */
  readonly permission: BookmarkPermission | 'unknown';
  /** 用户跨设备启用意图；本机开关还需 permission === granted。 */
  readonly enabled: boolean;
  readonly mode: BookmarkProjectionMode;
  readonly projection: BookmarkProjection | null;
  /** 当前投影数据的读取时间；stale 时表示缓存对应的上次成功读取时间。 */
  readonly readAt: number | null;
  readonly stale: boolean;
  readonly error: string | null;
  /** 浏览器导入会话进行中（仅在浏览器提供成对导入事件时出现）。 */
  readonly importing: boolean;
  /** 本机按当前树推导的待确认规则；不是持久化字段。 */
  readonly pendingRules: readonly BookmarkHiddenRulePending[];
  /** 缓存写入/清空失败等不影响当前投影但必须可见的提示。 */
  readonly cacheWarning: string | null;
}

export interface BookmarkSourcePreferences {
  readonly enabled: boolean;
  readonly mode: BookmarkProjectionMode;
  /** 隐藏规则由偏好/同步层提供；只读、无 pending 字段。 */
  readonly hiddenRules: readonly BookmarkHiddenRuleInput[];
}

export interface BookmarkChangeSubscriptionLike {
  readonly importEvents: boolean;
  readonly dispose: () => void;
}

export interface BookmarkPlatformPort {
  capability(): BookmarkCapability;
  permission(): Promise<BookmarkPermission>;
  /** 仅从明确的用户手势动作调用；端口实现必须先同步发起浏览器请求。 */
  requestPermission(): Promise<BookmarkPermission>;
  read(): Promise<readonly RawBookmarkNode[]>;
  subscribeChanges(handlers: {
    readonly changed: () => void;
    readonly importingChanged: (importing: boolean) => void;
  }): BookmarkChangeSubscriptionLike;
  /** 启动即订阅；不得依赖 `bookmarks` 命名空间已可见。 */
  subscribePermissionChanges(listener: (change: BookmarkPermissionChange) => void): () => void;
  open(url: string, target: BookmarkOpenTarget): Promise<void>;
}

export interface BookmarkSourceInput {
  readonly platform: BookmarkPlatformPort;
  readonly cache: BookmarkCache;
  readonly initial: BookmarkSourcePreferences;
  readonly now?: () => number;
  /** 变更事件合并窗口；设计建议 150–250ms。 */
  readonly coalesceMs?: number;
  readonly setTimer?: (operation: () => void, delay: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export interface BookmarkSource {
  getSnapshot(): BookmarkSourceSnapshot;
  subscribe(listener: (snapshot: BookmarkSourceSnapshot) => void): () => void;
  /** 初始化：未启用时立即清除上次会话遗留的缓存；已启用时先 loading 再检查权限。 */
  initialize(): Promise<void>;
  /** 编排层读到新的书签偏好后调用；启用/模式/规则变化重新投影。 */
  applyPreferences(next: BookmarkSourcePreferences): Promise<void>;
  /** 用户点击启用：必须在同一次点击调用链中调用，权限请求先于任何异步等待。 */
  enableFromGesture(): Promise<BookmarkPermission>;
  /** 用户关闭：立即清空内存投影与缓存，保留启用意图由编排层写入。 */
  disable(): Promise<void>;
  /** 读取失败时的显式重试；不改动偏好。 */
  refresh(): Promise<void>;
  open(url: string, target?: BookmarkOpenTarget): Promise<void>;
  dispose(): void;
}

const DEFAULT_COALESCE_MS = 200;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 平台层的 `BookmarkUnsupportedError` 带 `code: 'unsupported'`；结构化判定避免引入运行时依赖。 */
function isUnsupported(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'unsupported';
}

function emptySnapshot(input: {
  readonly capability: BookmarkCapability;
  readonly enabled: boolean;
  readonly mode: BookmarkProjectionMode;
  readonly status: BookmarkSourceStatus;
}): BookmarkSourceSnapshot {
  return {
    status: input.status,
    capability: input.capability,
    permission: 'unknown',
    enabled: input.enabled,
    mode: input.mode,
    projection: null,
    readAt: null,
    stale: false,
    error: null,
    importing: false,
    pendingRules: [],
    cacheWarning: null,
  };
}

export function createBookmarkSource(input: BookmarkSourceInput): BookmarkSource {
  const now = input.now ?? Date.now;
  const coalesceMs = input.coalesceMs ?? DEFAULT_COALESCE_MS;
  const setTimer = input.setTimer ?? ((operation, delay) => setTimeout(operation, delay));
  const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  let preferences = input.initial;
  let snapshot = emptySnapshot({
    capability: input.platform.capability(),
    enabled: input.initial.enabled,
    mode: input.initial.mode,
    status: input.initial.enabled ? 'loading' : 'disabled',
  });
  let tree: NormalizedBookmarkTree | null = null;
  /** 每次禁用/撤销/刷新推进；迟到的异步结果必须与当前代次一致才可应用。 */
  let generation = 0;
  /** 只在关闭/撤销/销毁时推进；用于拒绝互斥窗口内的迟到授权。 */
  let lifecycleEpoch = 0;
  /** 尚未返回的授权请求数量；关闭意图到来时据此决定是否作废在途请求。 */
  let pendingEnableRequests = 0;
  let reading = false;
  let refreshQueued = false;
  let importInProgress = false;
  let disposed = false;
  let timer: unknown = null;
  let changeSubscription: BookmarkChangeSubscriptionLike | null = null;
  let stopPermissionSubscription: (() => void) | null = null;
  let stopCacheSubscription: (() => void) | null = null;
  let lastCachedReadAt: number | null = null;
  const listeners = new Set<(snapshot: BookmarkSourceSnapshot) => void>();

  function emit(patch: Partial<BookmarkSourceSnapshot>): void {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  }

  function project(current: NormalizedBookmarkTree | null, resolutionPending: readonly BookmarkHiddenRulePending[] = []): {
    projection: BookmarkProjection | null;
    pendingRules: readonly BookmarkHiddenRulePending[];
  } {
    if (!current) return { projection: null, pendingRules: [] };
    const resolution = resolveHiddenRules(current, preferences.hiddenRules);
    const projection = projectBookmarkTree(current, {
      mode: preferences.mode,
      hidden: resolution.hiddenNodeIds,
    });
    return { projection, pendingRules: [...resolutionPending, ...resolution.pending] };
  }

  function clearMemory(patch: Partial<BookmarkSourceSnapshot> = {}): void {
    tree = null;
    emit({ projection: null, readAt: null, stale: false, pendingRules: [], cacheWarning: null, ...patch });
  }

  function cancelScheduled(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /** 缓存清空可能失败：状态已清空，但错误必须可见，不能报告成功。 */
  async function clearCache(currentGeneration: number): Promise<void> {
    try {
      await input.cache.clear(currentGeneration);
      lastCachedReadAt = null;
      emit({ cacheWarning: null });
    } catch (cause) {
      emit({ cacheWarning: `书签缓存清除失败：${errorMessage(cause)}` });
    }
  }

  function scheduleRefresh(): void {
    if (disposed || !preferences.enabled) return;
    if (reading) {
      refreshQueued = true;
      return;
    }
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      void readFresh();
    }, coalesceMs);
  }

  function onChanged(): void {
    if (disposed || !preferences.enabled) return;
    if (importInProgress) return;
    scheduleRefresh();
  }

  function onImporting(next: boolean): void {
    if (disposed) return;
    // 导入会话只在浏览器提供成对事件时可用；单侧能力由平台层过滤，
    // 这里再兜底一次，避免缺失结束事件时永久停留在“导入中”并抑制刷新。
    if (!changeSubscription?.importEvents) return;
    importInProgress = next;
    emit({ importing: next && input.platform.capability() === 'available' });
    if (!next) scheduleRefresh();
  }

  /**
   * 绑定书签变更事件。
   *
   * 授权前 `browser.bookmarks` 命名空间可能不存在（Firefox 侧尤其如此），因此这里只在
   * 能力探测为 available 时绑定；授权事件到达后重新调用本函数完成“当时可用”的绑定。
   * 导入会话只在平台层确认 began/ended 成对存在时才会被订阅。
   */
  function ensureChangeEvents(): void {
    if (disposed || !preferences.enabled) return;
    if (changeSubscription) return;
    if (input.platform.capability() !== 'available') return;
    changeSubscription = input.platform.subscribeChanges({ changed: onChanged, importingChanged: onImporting });
    emit({ capability: 'available' });
    if (!changeSubscription.importEvents) {
      importInProgress = false;
      if (snapshot.importing) emit({ importing: false });
    }
  }

  function stopChangeEvents(): void {
    changeSubscription?.dispose();
    changeSubscription = null;
    importInProgress = false;
  }

  /**
   * 立即移除所有可展示结果（内存投影、导航/待确认状态与读取时间）。
   *
   * 撤销权限时必须先做这一步再异步复核，界面不得等待 `permissions.contains()`。
   * 关闭功能时状态保持 disabled；仅撤销权限时进入 permission-missing。
   *
   * `invalidatePending` 用于真实的撤销/关闭边界：推进 `lifecycleEpoch`，让撤销前发出、
   * 撤销后才返回的授权请求失效（否则旧请求可以把功能重新启用）。撤销之后用户再次点击
   * 启用会捕获新的代次，因此“真正快速重新授权”仍能恢复。普通刷新里观察到“当前没有权限”
   * 只清理内存与缓存，不作废用户手势内的请求，避免把真实授权误判成迟到结果。
   * 本函数只处理权限/关闭，普通刷新不经过它，所以刷新不会被当成关闭。
   */
  function revokeState(
    permission: BookmarkPermission,
    error: string | null = null,
    options: { readonly invalidatePending?: boolean } = {},
  ): number {
    if (options.invalidatePending) lifecycleEpoch += 1;
    const cleanupGeneration = ++generation;
    cancelScheduled();
    stopChangeEvents();
    clearMemory({
      status: preferences.enabled ? 'permission-missing' : 'disabled',
      permission,
      importing: false,
      error,
    });
    return cleanupGeneration;
  }

  /**
   * 全量重读。
   *
   * 顺序很关键：代次与启用在读前后都检查，读取完成后重新确认权限；
   * 只有仍处于当前代次、已启用且权限有效时才应用结果或写缓存。
   */
  async function readFresh(): Promise<void> {
    if (disposed || !preferences.enabled) return;
    if (reading) {
      refreshQueued = true;
      return;
    }

    reading = true;
    const startedGeneration = ++generation;
    const stillCurrent = () => !disposed && preferences.enabled
      && startedGeneration === generation && snapshot.enabled;
    // fresh-first：没有可用结果时才进入 loading；刷新期间保留现有投影，不闪回骨架。
    if (tree) emit({ status: snapshot.status === 'stale' ? 'stale' : 'ready' });
    else emit({ status: 'loading', error: null, projection: null, stale: false });

    try {
      let permission: BookmarkPermission;
      try {
        permission = await input.platform.permission();
      } catch (cause) {
        // 连权限接口都不可用：这是能力缺失，不是空列表，也不是普通读取失败。
        if (!stillCurrent()) return;
        clearMemory({ status: 'unsupported', permission: 'unknown', error: errorMessage(cause) });
        return;
      }
      if (!stillCurrent()) return;
      if (permission !== 'granted') {
        // 没有权限时不读树、不展示缓存；顺带清掉上次会话遗留的缓存。
        const cleanupGeneration = revokeState(permission);
        if (!disposed && preferences.enabled) await clearCache(cleanupGeneration);
        return;
      }
      emit({ permission });
      if (input.platform.capability() !== 'available') {
        // 权限已授予却没有书签命名空间：真实能力缺失（普通网页预览也走这里）。
        clearMemory({ status: 'unsupported', permission, error: '此浏览器不提供书签接口' });
        return;
      }
      ensureChangeEvents();

      const raw = await input.platform.read();
      if (!stillCurrent()) return;

      // 读取可能较慢；完成后再确认一次权限，避免撤销后仍发布结果。
      const permissionAfterRead = await input.platform.permission();
      if (!stillCurrent()) return;
      if (permissionAfterRead !== 'granted') {
        const cleanupGeneration = revokeState(permissionAfterRead);
        if (!disposed && preferences.enabled) await clearCache(cleanupGeneration);
        return;
      }

      const normalized = normalizeBookmarkTree(raw);
      if (!stillCurrent()) return;

      tree = normalized;
      const { projection, pendingRules } = project(normalized);
      const readAt = now();
      emit({
        status: 'ready',
        permission: permissionAfterRead,
        projection,
        pendingRules,
        readAt,
        stale: false,
        error: null,
      });

      if (!stillCurrent()) return;
      try {
        const written = await input.cache.write(normalized, startedGeneration);
        if (disposed || !preferences.enabled || startedGeneration !== generation) return;
        if (written) lastCachedReadAt = readAt;
        else emit({ cacheWarning: '书签缓存未保存：结果已被后续操作取代' });
      } catch (cause) {
        // 缓存失败不改变当前可用投影，但绝不能显示成“缓存已保存”。
        emit({ cacheWarning: `书签缓存保存失败：${errorMessage(cause)}` });
      }
    } catch (cause) {
      if (!stillCurrent()) return;
      if (isUnsupported(cause)) {
        // 书签命名空间在读取中途消失：这是能力缺失，不是可降级的历史数据。
        clearMemory({ status: 'unsupported', error: errorMessage(cause) });
        return;
      }
      const message = errorMessage(cause);
      try {
        const permissionAfterFailure = await input.platform.permission();
        if (!stillCurrent()) return;
        if (permissionAfterFailure !== 'granted') {
          const cleanupGeneration = revokeState(permissionAfterFailure);
          if (!disposed && preferences.enabled) await clearCache(cleanupGeneration);
          return;
        }
        emit({ permission: permissionAfterFailure });
        await showStaleOrError(startedGeneration, message);
      } catch (permissionFailure) {
        if (!stillCurrent()) return;
        // 无法确认权限时不得继续展示内容：先清内存，再清缓存，并报告无法复核。
        const cleanupGeneration = revokeState(
          'denied',
          `${message}（且无法确认书签权限：${errorMessage(permissionFailure)}）`,
        );
        await clearCache(cleanupGeneration);
      }
    } finally {
      reading = false;
      if (refreshQueued && !disposed && preferences.enabled) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  }

  /**
   * 读取失败后的降级：只有权限仍有效且缓存存在时才使用缓存。
   * 缓存读取/解析失败必须显式报错，不能显示空态或旧的成功状态。
   */
  async function showStaleOrError(currentGeneration: number, message: string): Promise<void> {
    let cached: CachedBookmarkTree | null;
    try {
      cached = await input.cache.read();
    } catch (cause) {
      if (currentGeneration !== generation || !preferences.enabled || disposed) return;
      clearMemory({ status: 'error', error: `${message}；无法读取本地书签缓存：${errorMessage(cause)}` });
      return;
    }
    if (currentGeneration !== generation || !preferences.enabled || disposed) return;
    if (!cached) {
      clearMemory({ status: 'error', error: message });
      return;
    }
    tree = cached.tree;
    const { projection, pendingRules } = project(cached.tree);
    lastCachedReadAt = cached.readAt;
    emit({
      status: 'stale',
      projection,
      pendingRules,
      readAt: cached.readAt,
      stale: true,
      error: message,
    });
  }

  function applyCacheChange(change: { readonly removed: boolean; readonly value: CachedBookmarkTree | null }): void {
    // 自身写入也会触发变更；按读取时间识别并忽略，避免把 ready 误降级。
    if (change.value !== null && change.value.readAt === lastCachedReadAt) return;
    if (!change.removed) return;
    // 其他标签页/上下文已清空缓存：不得继续展示由缓存派生的旧投影。
    if (snapshot.status !== 'stale') return;
    tree = null;
    lastCachedReadAt = null;
    emit({
      status: 'error',
      projection: null,
      readAt: null,
      stale: false,
      pendingRules: [],
      error: '本机书签缓存已被其他页面清除，请重试读取',
    });
  }

  function installSubscriptions(): void {
    // 权限事件必须启动即订阅：授权前 bookmarks 命名空间可能不可见，
    // 事件是之后重新绑定书签事件与刷新投影的唯一可靠信号。
    if (!stopPermissionSubscription) {
      stopPermissionSubscription = input.platform.subscribePermissionChanges(handlePermissionEvent);
    }
    if (!stopCacheSubscription) {
      stopCacheSubscription = input.cache.subscribe(applyCacheChange);
    }
    ensureChangeEvents();
  }

  /** 复核当前权限；授权成功才绑定书签事件并读取，撤销则清空。 */
  async function confirmPermission(options: { readonly fromRemoval?: boolean } = {}): Promise<void> {
    const startedEpoch = lifecycleEpoch;
    let permission: BookmarkPermission;
    try {
      permission = await input.platform.permission();
    } catch (cause) {
      if (disposed || startedEpoch !== lifecycleEpoch) return;
      // 无法确认权限时和“未授权”同样处理：清内存并清缓存，且把原因显示出来。
      const cleanupGeneration = revokeState(
        'denied',
        `无法确认书签权限：${errorMessage(cause)}`,
        { invalidatePending: options.fromRemoval === true },
      );
      await clearCache(cleanupGeneration);
      return;
    }
    if (disposed || startedEpoch !== lifecycleEpoch) return;
    if (permission !== 'granted') {
      // 撤销事件之后才确认“没有权限”：同一撤销边界内的在途授权请求必须作废。
      const cleanupGeneration = revokeState(permission, null, {
        invalidatePending: options.fromRemoval === true,
      });
      if (!disposed) await clearCache(cleanupGeneration);
      return;
    }
    emit({ permission, capability: input.platform.capability() });
    if (!preferences.enabled) return;
    ensureChangeEvents();
    await readFresh();
  }

  /**
   * 明确撤销后的异步复核。
   *
   * 事件载荷已确认 bookmarks 被移除时，界面与内存已经同步清空；这里只负责
   * 复核结果、清缓存，并在快速重新授权（或载荷误报）时恢复刷新。
   */
  async function confirmPermissionAfterRevoke(cleanupGeneration: number): Promise<void> {
    const startedEpoch = lifecycleEpoch;
    let permission: BookmarkPermission | null = null;
    try {
      permission = await input.platform.permission();
    } catch {
      permission = null;
    }
    if (disposed) return;
    // 之后发生的关闭/撤销/销毁拥有更新的清理代次；旧代次不再触碰缓存。
    if (startedEpoch !== lifecycleEpoch) return;
    await clearCache(cleanupGeneration);
    if (disposed || startedEpoch !== lifecycleEpoch) return;
    if (permission === 'granted' && preferences.enabled) {
      emit({ permission });
      ensureChangeEvents();
      await readFresh();
      return;
    }
    emit({ permission: permission ?? 'denied' });
  }

  function handlePermissionEvent(change: BookmarkPermissionChange): void {
    if (disposed) return;
    if (change.added) {
      // 载荷明确与书签无关时完全忽略；否则复核，避免误报重新启用。
      if (change.bookmarks === false) return;
      void confirmPermission();
      return;
    }
    if (change.bookmarks === false) return;
    if (change.bookmarks === true) {
      // 明确撤销：不等 contains，先同步撤销界面状态并作废在途授权，再异步复核与清缓存。
      const cleanupGeneration = revokeState('denied', null, { invalidatePending: true });
      void confirmPermissionAfterRevoke(cleanupGeneration);
      return;
    }
    // 载荷无法判定：用 contains 复核；若结果为撤销，走同一清理路径并作废在途授权。
    void confirmPermission({ fromRemoval: true });
  }

  const source: BookmarkSource = {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async initialize() {
      installSubscriptions();
      if (!preferences.enabled) {
        // 初始未启用也要清掉上次会话遗留的缓存；否则重新启用前的旧树会一直留在本机。
        const cleanupGeneration = ++generation;
        clearMemory({ status: 'disabled', permission: 'unknown', error: null });
        await clearCache(cleanupGeneration);
        return;
      }
      // 已启用但尚未确认权限：先查权限，再判断命名空间是否存在，
      // 避免“授权前 namespace 缺失”被误判为永久 unsupported。
      let permission: BookmarkPermission;
      try {
        permission = await input.platform.permission();
      } catch (cause) {
        clearMemory({ status: 'unsupported', permission: 'unknown', error: errorMessage(cause) });
        return;
      }
      if (disposed || !preferences.enabled) return;
      if (permission !== 'granted') {
        const cleanupGeneration = revokeState(permission);
        await clearCache(cleanupGeneration);
        return;
      }
      emit({ permission, capability: input.platform.capability() });
      if (input.platform.capability() !== 'available') {
        clearMemory({ status: 'unsupported', permission, error: '此浏览器不提供书签接口' });
        return;
      }
      await readFresh();
    },

    async applyPreferences(next) {
      const enabledChanged = next.enabled !== preferences.enabled;
      const projectionChanged = next.mode !== preferences.mode
        || JSON.stringify(next.hiddenRules) !== JSON.stringify(preferences.hiddenRules);
      preferences = next;
      if (!next.enabled) {
        // 关闭意图：即使快照已是 disabled，只要还有在途授权请求，也必须作废它们，
        // 否则用户关掉之后迟到的授权结果会把功能重新启用。
        if (pendingEnableRequests > 0) lifecycleEpoch += 1;
        if (enabledChanged || snapshot.status !== 'disabled') {
          const cleanupGeneration = ++generation;
          cancelScheduled();
          stopChangeEvents();
          clearMemory({ status: 'disabled', enabled: false, error: null, importing: false });
          await clearCache(cleanupGeneration);
        } else {
          emit({ enabled: false });
        }
        return;
      }
      emit({ enabled: true, mode: next.mode });
      if (!snapshot.enabled || enabledChanged) await readFresh();
      else if (projectionChanged && tree) {
        const { projection, pendingRules } = project(tree);
        emit({ projection, pendingRules });
      }
    },

    async enableFromGesture() {
      // 必须先同步发起权限请求：在此调用之前没有任何 await。
      let request: Promise<BookmarkPermission>;
      try {
        request = input.platform.requestPermission();
      } catch (cause) {
        emit({ error: `无法请求书签权限：${errorMessage(cause)}`, permission: 'denied' });
        throw cause;
      }
      const startedEpoch = lifecycleEpoch;
      pendingEnableRequests += 1;
      let permission: BookmarkPermission;
      try {
        permission = await request;
      } catch (cause) {
        emit({ error: `无法请求书签权限：${errorMessage(cause)}`, permission: 'denied' });
        throw cause;
      } finally {
        pendingEnableRequests -= 1;
      }
      if (disposed) return permission;
      if (startedEpoch !== lifecycleEpoch) {
        // 请求期间被关闭/撤销/销毁：授权结果不得让功能悄悄恢复，只显示权限状态。
        emit({ permission });
        return permission;
      }
      if (permission !== 'granted') {
        // 首次拒绝：保持关闭意图，不读树、不写缓存、不渲染内容。
        preferences = { ...preferences, enabled: false };
        lifecycleEpoch += 1;
        const cleanupGeneration = ++generation;
        clearMemory({ status: 'disabled', enabled: false, permission, error: null, importing: false });
        await clearCache(cleanupGeneration);
        return permission;
      }
      preferences = { ...preferences, enabled: true };
      emit({ enabled: true, permission, capability: input.platform.capability() });
      // 授权后 bookmarks 命名空间才可能出现；先绑定当时可用的事件再读取。
      ensureChangeEvents();
      await readFresh();
      return permission;
    },

    async disable() {
      preferences = { ...preferences, enabled: false };
      lifecycleEpoch += 1;
      const cleanupGeneration = ++generation;
      cancelScheduled();
      stopChangeEvents();
      // 先清内存（同步可见），再清缓存；缓存清空与旧写入由代次/队列排序。
      clearMemory({
        status: 'disabled',
        enabled: false,
        permission: snapshot.permission,
        error: null,
        importing: false,
      });
      await clearCache(cleanupGeneration);
    },

    async refresh() {
      if (!preferences.enabled) return;
      await readFresh();
    },

    async open(url, target = 'new-tab') {
      // 打开失败必须上抛给 UI；这里不伪造成功、也不记录书签地址。
      await input.platform.open(url, target);
    },

    dispose() {
      disposed = true;
      // 销毁后任何迟到结果都不得写回快照或恢复功能。
      lifecycleEpoch += 1;
      generation += 1;
      cancelScheduled();
      stopChangeEvents();
      stopPermissionSubscription?.();
      stopPermissionSubscription = null;
      stopCacheSubscription?.();
      stopCacheSubscription = null;
      tree = null;
      lastCachedReadAt = null;
      listeners.clear();
      // 页面卸载不是“关闭功能”：保留本机缓存，供下次权限仍有效时读取失败降级；
      // 关闭与撤销才清空缓存（设计 D-10）。
    },
  };

  // 权限/缓存订阅在构造时立即安装：授权前 `bookmarks` 命名空间可能不存在，
  // 若等 initialize() 才订阅，会漏掉“先授权、后装配”的事件窗口。
  installSubscriptions();

  return source;
}
