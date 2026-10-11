/**
 * 图标引用。
 *
 * 支持文字首字母、随包图形和本地图片；图片可由上传或用户主动直链下载保存。
 */
export const BUILT_IN_ICON_IDS = ['compass', 'book', 'briefcase', 'code', 'heart', 'sparkles'] as const;
export type BuiltInIconId = (typeof BUILT_IN_ICON_IDS)[number];

export type ShortcutIcon =
  | { kind: 'letter' }
  | { kind: 'built-in'; iconId: BuiltInIconId }
  | { kind: 'asset'; assetId: string };

export interface Shortcut {
  id: string;
  groupId: string;
  title: string;
  url: string;
  icon: ShortcutIcon;
  /** 外链下载的来源地址；不保存许可信息（数据契约 §5.5） */
  iconSourceUrl: string | null;
  order: number;
}
