import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { ShortcutGrid } from '@/features/shortcuts/ShortcutGrid';

interface ShortcutGridContentProps {
  readonly editing: boolean;
  readonly alignment: 'center' | 'start';
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly onAdd: () => void;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly onOpenFolder: (folderId: string) => void;
  readonly onEditFolder: (folder: Folder) => void;
  readonly onDeleteFolder: (folder: Folder) => void;
  readonly onShortcutsChanged: () => void;
}

/**
 * 主页网格内容：文件夹与网站并列。
 *
 * 空的首次使用状态只给出唯一的下一步（添加网站），不预置示例数据。
 */
export function ShortcutGridContent({
  editing, alignment, folders, shortcuts, onAdd, onEdit, onOpenFolder, onEditFolder, onDeleteFolder, onShortcutsChanged,
}: ShortcutGridContentProps) {
  if (folders.length === 0 && shortcuts.length === 0 && !editing) {
    return <EmptyGrid alignment={alignment} onAdd={onAdd} />;
  }
  return <ShortcutGrid shortcuts={[...shortcuts]} folders={folders} onShortcutsChanged={onShortcutsChanged}
    editing={editing} onEdit={onEdit} onAdd={onAdd}
    onOpenFolder={onOpenFolder} onEditFolder={onEditFolder} onDeleteFolder={onDeleteFolder} alignment={alignment} />;
}

function EmptyGrid({ alignment, onAdd }: { readonly alignment: 'center' | 'start'; readonly onAdd: () => void }) {
  const aligned = alignment === 'start';
  return (
    <Empty className={`border-glass-border ${aligned ? 'items-start text-left' : ''}`}>
      <EmptyHeader className={aligned ? 'w-full items-start text-left' : undefined}>
        <EmptyTitle className="home-readable-ink text-glass-foreground">还没有网站</EmptyTitle>
        <EmptyDescription className="home-readable-muted text-glass-foreground-muted">
          添加常用网站，或用文件夹整理。
        </EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={onAdd}
          className="home-readable-control home-readable-focus bg-glass text-glass-foreground hover:bg-glass-strong">
          <PlusIcon data-icon="inline-start" />
          添加第一个网站
        </Button>
      </div>
    </Empty>
  );
}
