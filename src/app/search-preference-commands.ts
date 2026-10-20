import type { DataContextValue } from '@/app/data-context';
import type { AppSettings } from '@/domain/settings';
import { resolveEngine } from '@/domain/search-engines';
import type { Database } from '@/storage/db';
import { updateSettings } from '@/storage/settings';

type SearchCommands = Pick<DataContextValue, 'updateSearchPreferences' | 'updateSearchCustomization'
  | 'setSearchEngineKeyword' | 'setSearchToolEnabled'>;

export function createSearchPreferenceCommands(input: { readonly db: Database;
  readonly setSettings: (settings: AppSettings) => void }): SearchCommands {
  const { db, setSettings } = input;
  return {
    async updateSearchPreferences(patch) {
      setSettings(await updateSettings(db, (current) => ({ ...current, search: { ...current.search, ...patch } })));
    },
    async updateSearchCustomization(patch) {
      setSettings(await updateSettings(db, (current) => ({ ...current,
        search: { ...current.search, customization: { ...current.search.customization, ...patch } } })));
    },
    async setSearchToolEnabled(group, enabled) {
      setSettings(await updateSettings(db, (current) => {
        const customization = current.search.customization;
        const others = customization.enabledTools.filter((value) => value !== group);
        const enabledTools = enabled ? [...others, group] : others;
        return { ...current, search: { ...current.search, customization: { ...customization, enabledTools } } };
      }));
    },
    async setSearchEngineKeyword(engineId, keyword) {
      setSettings(await updateSettings(db, (current) => {
        if (!resolveEngine(engineId, current.search.customEngines, current.search.customization.engineOverrides)) {
          throw new Error('搜索引擎不存在');
        }
        const entries = Object.entries(current.search.customization.engineKeywords).filter(([id]) => id !== engineId);
        const engineKeywords = Object.fromEntries(keyword.trim() ? [...entries, [engineId, keyword.trim()]] : entries);
        return { ...current, search: { ...current.search, customization: { ...current.search.customization, engineKeywords } } };
      }));
    },
  };
}
