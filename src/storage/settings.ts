import { createDefaultSettings, validateSettings, type AppSettings } from '@/domain/settings';
import { SETTINGS_ID, type Database, type SettingsRow } from '@/storage/db';

/** 读取设置；未初始化时返回默认值，已存在但不合法时明确报错。 */
export async function readSettings(db: Database): Promise<AppSettings> {
  const row = await db.settings.get(SETTINGS_ID);
  if (!row) return createDefaultSettings();
  return validateSettings(row);
}

/**
 * 以更新函数的方式写入设置。
 *
 * 读取、校验与写入在同一个事务内完成，任一步失败都不会留下部分更新。
 */
export async function updateSettings(
  db: Database,
  updater: (current: AppSettings) => AppSettings,
): Promise<AppSettings> {
  return db.transaction('rw', db.settings, async () => {
    const next = validateSettings(updater(await readSettings(db)));
    const row: SettingsRow = { id: SETTINGS_ID, ...next };
    await db.settings.put(row);
    return next;
  });
}

/** 写入默认设置并返回，用于首次安装。 */
export async function writeDefaultSettings(db: Database): Promise<AppSettings> {
  return db.transaction('rw', db.settings, async () => {
    const defaults = createDefaultSettings();
    const row: SettingsRow = { id: SETTINGS_ID, ...defaults };
    await db.settings.put(row);
    return defaults;
  });
}
