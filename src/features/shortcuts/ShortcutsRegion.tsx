import { useState } from 'react';

import { useData } from '@/app/data-context';
import type { Shortcut } from '@/domain/shortcut';
import { GroupTabs } from '@/features/groups/GroupTabs';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';
import { ShortcutGroupContent } from '@/features/shortcuts/ShortcutGroupContent';
import { useGroupContentMotion } from '@/features/shortcuts/use-group-content-motion';
import { browserContentMotion } from '@/platform/content-motion';

/**
 * 快捷方式区域：分组标签 + 网站网格，并承载主页的编辑模式。
 *
 * 网站与分组的操作都从主页进入：右键任意网站或分组标签即可调出操作菜单，
 * 主页右下角的编辑按钮切换到可拖动排序、带「＋ 添加网站」格子的编辑模式。
 */
export function ShortcutsRegion({ editing }: { readonly editing: boolean }) {
  const { shortcuts, activeGroupId, loadedShortcutsGroupId } = useData();
  const { contentRef, isWaiting } = useGroupContentMotion({
    activeGroupId,
    loadedGroupId: loadedShortcutsGroupId,
    motion: browserContentMotion,
    shortcutCount: shortcuts.length,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<Shortcut | null>(null);

  const openCreate = () => {
    setTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (shortcut: Shortcut) => {
    setTarget(shortcut);
    setDialogOpen(true);
  };

  return (
    <section aria-label="快捷方式" className="flex w-full flex-col items-center gap-6">
      <GroupTabs editing={editing} />

      <ShortcutGroupContent activeGroupId={activeGroupId} contentRef={contentRef} editing={editing}
        isWaiting={isWaiting} onAdd={openCreate} onEdit={openEdit} shortcuts={shortcuts} />

      {activeGroupId && (
        <ShortcutFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          groupId={activeGroupId}
          shortcut={target ?? undefined}
        />
      )}
    </section>
  );
}
