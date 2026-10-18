/**
 * 图标引用。
 *
 * 支持文字首字母、随包图形和本地图片；图片可由上传或用户主动直链下载保存。
 */
export const BUILT_IN_ICON_IDS = ['compass', 'book', 'briefcase', 'code', 'heart', 'sparkles'] as const;
export type BuiltInIconId = (typeof BUILT_IN_ICON_IDS)[number];

export interface ShortcutIconOccupancy {
  readonly occupancy?: number;
}

export type ShortcutIcon =
  | ({ kind: 'letter' } & ShortcutIconOccupancy)
  | ({ kind: 'built-in'; iconId: BuiltInIconId } & ShortcutIconOccupancy)
  | ({ kind: 'asset'; assetId: string; color?: string } & ShortcutIconOccupancy);

/**
 * 网站用户可编辑的名称。
 *
 * 名称可为空：空名称表示沿用网站地址里的域名。派生结果只在显示与无障碍名称中使用，
 * 不写回数据，避免同步时产生无意义的名称寄存器冲突。
 */
export function shortcutDisplayName(shortcut: Pick<Shortcut, 'title' | 'url'>): string {
  if (shortcut.title.length > 0) return shortcut.title;
  try {
    return new URL(shortcut.url).hostname || shortcut.url;
  } catch {
    return shortcut.url;
  }
}

export interface Shortcut {
  id: string;
  /** 所属文件夹；null 表示直接放在主页网格上 */
  folderId: string | null;
  /** 用户输入的名称；空字符串表示使用地址域名 */
  title: string;
  url: string;
  icon: ShortcutIcon;
  /** 外链下载的来源地址；不保存许可信息（数据契约 §5.5） */
  iconSourceUrl: string | null;
  /** 在主页网格或所属文件夹内的顺序 */
  order: number;
}
