import type { DataContextValue } from '@/app/data-context';
import type { AppSettings } from '@/domain/settings';
import { DEFAULT_LAYOUT, joinLayout, splitLayout, type LayoutConfig, type LayoutPreferences } from '@/domain/layout';
import { applyBookmarkPreferencePatch, validateBookmarkHiddenRule,
  type BookmarkHiddenRule, type BookmarkPreferences } from '@/domain/bookmark-preferences';
import { createSearchPreferenceCommands } from '@/app/search-preference-commands';
import type { Database } from '@/storage/db';
import { updateSettings } from '@/storage/settings';
import { resetHomePositions } from '@/storage/home';

type PreferenceCommands = Pick<DataContextValue, 'updateLayout' | 'resetLayout' | 'updateClockFormat' | 'updateClockSettings'
  | 'updateShortcutPreferences' | 'updateBookmarkPreferences' | 'setBookmarkHiddenRule' | 'removeBookmarkHiddenRule'>
  & ReturnType<typeof createSearchPreferenceCommands>;

function upsertRule(rules: readonly BookmarkHiddenRule[], rule: BookmarkHiddenRule): BookmarkHiddenRule[] {
  const exists = rules.some((item) => item.ruleId === rule.ruleId);
  const next = exists ? rules.map((item) => item.ruleId === rule.ruleId ? rule : item) : [...rules, rule];
  return next.toSorted((left, right) => left.ruleId < right.ruleId ? -1 : Number(left.ruleId !== right.ruleId));
}

/** 从补丁中挑出布局偏好字段；顺序与显隐单独处理。 */
function layoutPreferences(patch: Partial<LayoutConfig>): Partial<LayoutPreferences> {
  return {
    ...(patch.style === undefined ? {} : { style: patch.style }),
    ...(patch.clockPosition === undefined ? {} : { clockPosition: patch.clockPosition }),
    ...(patch.pageWidth === undefined ? {} : { pageWidth: patch.pageWidth }),
    ...(patch.regionSpacing === undefined ? {} : { regionSpacing: patch.regionSpacing }),
    ...(patch.columns === undefined ? {} : { columns: patch.columns }),
  };
}

export function createPreferenceCommands(input: { readonly db: Database;
  readonly setSettings: (settings: AppSettings) => void }): PreferenceCommands {
  const { db, setSettings } = input;
  return {
    ...createSearchPreferenceCommands(input),
    async updateLayout(patch) {
      // 区域顺序与显隐各自独立同步；这里仍写完整布局对象，由同步层拆分寄存器。
      setSettings(await updateSettings(db, (current) => {
        const { order, hidden, preferences } = splitLayout(current.layout);
        return { ...current, layout: joinLayout({ order: patch.order ?? order, hidden: patch.hidden ?? hidden,
          preferences: { ...preferences, ...layoutPreferences(patch) } }) };
      }));
    },
    async resetLayout() {
      await resetHomePositions(db);
      setSettings(await updateSettings(db, (current) => ({ ...current,
        layout: { ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], hidden: [] },
        shortcuts: { ...current.shortcuts, showNames: true } })));
    },
    async updateClockFormat(format) {
      setSettings(await updateSettings(db, (current) => ({ ...current, clock: { ...current.clock, format } })));
    },
    async updateClockSettings(patch) {
      setSettings(await updateSettings(db, (current) => ({ ...current, clock: { ...current.clock, ...patch } })));
    },
    async updateShortcutPreferences(patch) {
      setSettings(await updateSettings(db, (current) => ({ ...current, shortcuts: { ...current.shortcuts, ...patch } })));
    },
    async updateBookmarkPreferences(patch: Partial<Pick<BookmarkPreferences, 'enabled' | 'mode' | 'showInSearch'>>) {
      setSettings(await updateSettings(db, (current) => ({ ...current,
        bookmarks: applyBookmarkPreferencePatch(current.bookmarks, patch) })));
    },
    async setBookmarkHiddenRule(rule) {
      const updatedAt = rule.updatedAt ?? Date.now();
      const validated = validateBookmarkHiddenRule({ ...rule, updatedAt });
      setSettings(await updateSettings(db, (current) => ({ ...current,
        bookmarks: { ...current.bookmarks, hiddenRules: upsertRule(current.bookmarks.hiddenRules, validated) } })));
    },
    async removeBookmarkHiddenRule(ruleId) {
      setSettings(await updateSettings(db, (current) => ({ ...current,
        bookmarks: { ...current.bookmarks,
          hiddenRules: current.bookmarks.hiddenRules.filter((rule) => rule.ruleId !== ruleId) } })));
    },
  };
}
