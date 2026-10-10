/**
 * 图标引用。
 *
 * 数据契约 §5.4 的四类来源中，首版数据层先支持文字与本地资源；
 * 内置图形与直链下载在接入对应功能时补充。
 */
export type ShortcutIcon =
  | { kind: 'letter' }
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
