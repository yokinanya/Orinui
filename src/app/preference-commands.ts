import type { DataContextValue } from '@/app/data-context';
import type { AppSettings } from '@/domain/settings';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { createSearchPreferenceCommands } from '@/app/search-preference-commands';
import type { Database } from '@/storage/db';
import { updateSettings } from '@/storage/settings';

type PreferenceCommands = Pick<DataContextValue, 'updateLayout' | 'resetLayout' | 'updateClockFormat' | 'updateClockSettings'
  | 'updateShortcutPreferences'> & ReturnType<typeof createSearchPreferenceCommands>;

export function createPreferenceCommands(input: { readonly db: Database;
  readonly setSettings: (settings: AppSettings) => void }): PreferenceCommands {
  const { db, setSettings } = input;
  return {
    ...createSearchPreferenceCommands(input),
    async updateLayout(patch) {
      setSettings(await updateSettings(db, (current) => ({ ...current, layout: { ...current.layout, ...patch } })));
    },
    async resetLayout() {
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
  };
}
