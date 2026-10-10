import { PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import type { Shortcut } from '@/domain/shortcut';
import { GroupTabs } from '@/features/groups/GroupTabs';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';
import { ShortcutGrid } from '@/features/shortcuts/ShortcutGrid';

/**
 * 快捷方式区域：分组标签 + 网站网格，并承载主页的编辑模式。
 *
 * 网站与分组的操作都从主页进入：右键任意网站或分组标签即可调出操作菜单，
 * 分组标签行末尾的「编辑」按钮切换到可拖动排序、带「＋ 添加网站」格子的编辑模式。
 */
export function ShortcutsRegion() {
  const { shortcuts, activeGroupId } = useData();
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<Shortcut | null>(null);

  // 分组被删空后编辑模式没有可操作的对象，主动退出避免留下无意义的空状态
  useEffect(() => {
    if (!activeGroupId) setEditing(false);
  }, [activeGroupId]);

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
      <GroupTabs editing={editing} onEditingChange={setEditing} />

      {shortcuts.length === 0 && !editing ? (
        <Empty className="border-glass-border bg-glass/40 backdrop-blur-sm">
          <EmptyHeader>
            <EmptyTitle className="text-glass-foreground">还没有网站</EmptyTitle>
            <EmptyDescription className="text-glass-foreground-muted">
              添加常用网站后会按分组显示在这里。
            </EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            disabled={!activeGroupId}
            onClick={openCreate}
            className="bg-glass text-glass-foreground hover:bg-glass-strong"
          >
            <PlusIcon data-icon="inline-start" />
            添加第一个网站
          </Button>
        </Empty>
      ) : (
        <ShortcutGrid shortcuts={shortcuts} editing={editing} onEdit={openEdit} onAdd={openCreate} />
      )}

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
