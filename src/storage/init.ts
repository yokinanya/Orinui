import type { AppSettings } from '@/domain/settings';
import { SETTINGS_ID, type Database } from '@/storage/db';
import { readSettings, writeDefaultSettings } from '@/storage/settings';

export interface InitialState {
  settings: AppSettings;
}

/**
 * 首次运行时建立默认设置；已初始化时原样返回，不做多余写入。
 *
 * 数据契约 §10：安装后主页为空，不预置网站，也不预置文件夹。
 */
export async function ensureInitialized(db: Database): Promise<InitialState> {
  const stored = await db.settings.get(SETTINGS_ID);
  const settings = stored ? await readSettings(db) : await writeDefaultSettings(db);

  return { settings };
}