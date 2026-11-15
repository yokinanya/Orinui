import type { BookmarkPreferences } from '@/domain/bookmark-preferences';

/**
 * 浏览器书签偏好的单一 canonical 门控。
 *
 * 两个输入源会带来同一个设置行：
 * - `observer`：本页对既有 Dexie `settings` 行的只读观察（他页提交与 Dexie 广播）。
 * - `settings`：`DataContext` 的本地 `settings.bookmarks`（启动读取 + 本页命令写入后的读回）。
 *
 * 规则：
 * - 观察器投递过值之后，本页设置快照只有与最近一次观察值一致时才被接受（那是本页提交的
 *   回声）；其它值只能是较早的读取迟到返回，接受它会用过期值回滚较新的跨页值。
 *   等待回声不改变最终状态，只是少一次提前应用。
 * - 同值判等：视图键（含 `showInSearch`）决定界面刷新，数据源键（`enabled`/`mode`/`hiddenRules`）
 *   决定是否调用 `applyPreferences`；重复投递不产生额外写入，也不写回设置。
 * - 只有能证明是“他页提交的关闭”时才作废本页在途授权：
 *   - 观察器亲眼看到 `true → false`；或
 *   - 观察器首次投递即为 `false`，而本页挂载时已经启用（快照 `enabled: true`），说明关闭
 *     发生在挂载与首次观察之间。
 *   本页初始 `enabled: false` 时，首次投递的 `false` 只是授权前的当前值，不得打断用户
 *   刚发起的首次启用；本页设置侧的关闭回声（已持久化）同样算真实关闭。
 *
 * 不引入全局时钟、墓碑或 CAS：同一值的重复关闭在设置行上没有变化，观察器可能完全收不到
 * 事件；`enabled: false` 页面在注册观察器之前已被他页关闭时，只能体现为“当前值”，
 * 无法与“从未启用”区分。这些缺口如实保留，不伪造可观测性。
 */
export type BookmarkPreferenceOrigin = 'settings' | 'observer';

export interface BookmarkPreferenceDecision {
  /** 门控后的当前 canonical 偏好。 */
  readonly preferences: BookmarkPreferences;
  /** canonical 视图字段（含 `showInSearch`）是否变化，需要刷新界面状态。 */
  readonly update: boolean;
  /** 数据源相关字段（`enabled`/`mode`/`hiddenRules`）是否变化，需要调用 `applyPreferences`。 */
  readonly apply: boolean;
  /** 是否观察到真实的关闭提交，需要作废本页在途授权。 */
  readonly interruptEnable: boolean;
}

export interface BookmarkPreferenceGate {
  current(): BookmarkPreferences;
  accept(next: BookmarkPreferences, origin: BookmarkPreferenceOrigin): BookmarkPreferenceDecision;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/** 数据源只消费这三个字段；`showInSearch` 只影响搜索索引。 */
function sourceKey(preferences: BookmarkPreferences): string {
  return stableJson([preferences.enabled, preferences.mode, preferences.hiddenRules]);
}

function viewKey(preferences: BookmarkPreferences): string {
  return stableJson([preferences.enabled, preferences.mode, preferences.showInSearch, preferences.hiddenRules]);
}

const IGNORED = { update: false, apply: false, interruptEnable: false } as const;

export function createBookmarkPreferenceGate(initial: BookmarkPreferences): BookmarkPreferenceGate {
  let current = initial;
  let applied = sourceKey(initial);
  /** 观察器是否投递过至少一个值。 */
  let observerDelivered = false;
  /** 观察器最近一次投递的视图键；用于识别本页设置回声。 */
  let lastObservedView: string | null = null;
  /** 观察器上一次投递的启用值；`undefined` 表示尚未投递。 */
  let lastObservedEnabled: boolean | undefined;
  /** 挂载时的启用意图；用于区分“首次快照就是关闭”与“根本没有启用过”。 */
  const initiallyEnabled = initial.enabled;

  return {
    current: () => current,
    accept(next, origin) {
      const nextView = viewKey(next);
      if (origin === 'settings' && observerDelivered && nextView !== lastObservedView) {
        return { preferences: current, ...IGNORED };
      }

      const interruptEnable = !next.enabled
        && (origin === 'observer'
          ? lastObservedEnabled === true || (lastObservedEnabled === undefined && initiallyEnabled)
          : current.enabled);

      const sourceChanged = sourceKey(next) !== applied;
      const update = nextView !== viewKey(current);
      if (sourceChanged) applied = sourceKey(next);
      if (update) current = next;
      if (origin === 'observer') {
        observerDelivered = true;
        lastObservedView = nextView;
        lastObservedEnabled = next.enabled;
      }
      return { preferences: current, update, apply: sourceChanged, interruptEnable };
    },
  };
}

export interface BookmarkPreferenceReconcileInput {
  readonly gate: BookmarkPreferenceGate;
  readonly next: BookmarkPreferences;
  readonly origin: BookmarkPreferenceOrigin;
  /** 仅在数据源相关字段变化时调用；同步抛错与异步拒绝都经 `onError` 上报。 */
  readonly applySource: (preferences: BookmarkPreferences) => void | Promise<void>;
  /** 观察到真实关闭时调用，用于作废本页在途授权。 */
  readonly interruptEnable: () => void;
  readonly onError: (cause: unknown) => void;
}

/**
 * 把一次偏好输入并入 canonical，并把必要动作派发给调用方。
 *
 * 返回 canonical 的视图字段是否变化（`showInSearch` 也算），供调用方决定是否重渲染；
 * 数据源写入与授权打断都由本函数按门控结果触发，避免两处各自判等。
 */
export function reconcileBookmarkPreferences(input: BookmarkPreferenceReconcileInput): boolean {
  const decision = input.gate.accept(input.next, input.origin);
  if (decision.interruptEnable) input.interruptEnable();
  if (decision.apply) {
    try {
      const pending = input.applySource(decision.preferences);
      if (pending instanceof Promise) {
        void pending.catch((cause: unknown) => input.onError(cause));
      }
    } catch (cause) {
      input.onError(cause);
    }
  }
  return decision.update;
}
