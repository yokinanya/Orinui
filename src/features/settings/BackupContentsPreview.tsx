import type { RestorableBackup } from '@/platform/backup-file';

export function BackupContentsPreview({ backup }: { readonly backup: RestorableBackup }) {
  const widgets = backup.document.settings.home?.widgets ?? [];
  const noteCount = widgets.filter(({ kind }) => kind === 'note').length;
  const todoCount = widgets.filter(({ kind }) => kind === 'todo').length;
  return <>{`备份包含 ${backup.folderCount} 个文件夹、${backup.shortcutCount} 个网站、${widgets.length} 个小组件（${noteCount} 个便签、${todoCount} 个待办列表）、${backup.backgroundCount} 个壁纸素材及 ${backup.assetCount} 个媒体文件，原件共 ${backup.totalAssetBytes.toLocaleString()} 字节。默认搜索引擎「${backup.engine}」。`}</>;
}
