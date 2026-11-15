import type { BookmarkSource } from '@/app/bookmark-source';
import {
  createBookmarkPreferenceGate,
  reconcileBookmarkPreferences,
  type BookmarkPreferenceGate,
} from '@/app/bookmark-preference-gate';
import type { BookmarkPreferences } from '@/domain/bookmark-preferences';

export type BookmarkPreferencesSubscription = (
  next: (preferences: BookmarkPreferences) => void,
  onError: (cause: unknown) => void,
) => () => void;

export interface BookmarkPreferenceBridgeInput {
  /** 由 `DataContext` 注入的只读观察（生产实现见 `storage/bookmark-preferences-observer`）。 */
  readonly subscribe: BookmarkPreferencesSubscription;
  readonly source: BookmarkSource;
  readonly initial: BookmarkPreferences;
  /** canonical 视图字段变化（含 `showInSearch`）时通知界面重渲染。 */
  readonly onChange: (preferences: BookmarkPreferences) => void;
  /** 观察到真实关闭时作废本页在途授权。 */
  readonly interruptEnable: () => void;
  readonly onError: (cause: unknown) => void;
}

export interface BookmarkPreferenceBridge {
  /** 本页 `DataContext` 读回的设置；观察器给出权威值后不会回滚。 */
  acceptFromSettings(preferences: BookmarkPreferences): void;
  current(): BookmarkPreferences;
  /** 解除观察器订阅；页面卸载时调用。 */
  dispose(): void;
}

/**
 * 把「本页设置快照」与「既有 Dexie 设置行的只读观察」合成一份 canonical 偏好。
 *
 * 这是 BookmarkFeatureProvider 唯一的数据源偏好输入：本页提交、跨页提交与同步到达
 * 的设置都经过同一门控，值未变化时不重复调用 `applyPreferences`，也不写回设置。
 * 观察器只读 `settings.bookmarks`，不写任何行。
 */
export function connectBookmarkPreferences(input: BookmarkPreferenceBridgeInput): BookmarkPreferenceBridge {
  const gate: BookmarkPreferenceGate = createBookmarkPreferenceGate(input.initial);
  const apply = (origin: 'settings' | 'observer') => (next: BookmarkPreferences): void => {
    const changed = reconcileBookmarkPreferences({
      gate,
      next,
      origin,
      // `createBookmarkSource.applyPreferences` 已串行且内部判等；这里按门控只调用一次。
      applySource: (preferences) => input.source.applyPreferences({
        enabled: preferences.enabled,
        mode: preferences.mode,
        hiddenRules: preferences.hiddenRules.map((rule) => ({
          ruleId: rule.ruleId,
          targetId: rule.targetId,
          path: [...rule.path],
          kind: rule.kind,
          hidden: rule.hidden,
          updatedAt: rule.updatedAt,
        })),
      }),
      interruptEnable: input.interruptEnable,
      onError: input.onError,
    });
    if (changed) input.onChange(gate.current());
  };

  const acceptFromObserver = apply('observer');
  let disposed = false;
  const unobserve = input.subscribe(
    (preferences) => {
      if (!disposed) acceptFromObserver(preferences);
    },
    (cause) => {
      if (!disposed) input.onError(cause);
    },
  );

  return {
    acceptFromSettings: (preferences) => {
      if (!disposed) apply('settings')(preferences);
    },
    current: () => gate.current(),
    dispose() {
      if (disposed) return;
      disposed = true;
      unobserve();
    },
  };
}
