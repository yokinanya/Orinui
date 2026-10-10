import type { Group } from '@/domain/group';
import type { AppSettings } from '@/domain/settings';
import type { Database } from '@/storage/db';
import { ensureDefaultGroup } from '@/storage/groups';
import { readSettings, writeDefaultSettings } from '@/storage/settings';
import { SETTINGS_ID } from '@/storage/db';

export interface InitialState {
  defaultGroup: Group;
  settings: AppSettings;
}

/**
 * 首次运行时建立默认分组与默认设置；已初始化时原样返回，不做多余写入。
 *
 * 数据契约 §10：安装后只有一个空的默认分组，不预置网站。
 */
export async function ensureInitialized(db: Database): Promise<InitialState> {
  const defaultGroup = await ensureDefaultGroup(db);

  const stored = await db.settings.get(SETTINGS_ID);
  const settings = stored ? await readSettings(db) : await writeDefaultSettings(db);

  return { defaultGroup, settings };
}
