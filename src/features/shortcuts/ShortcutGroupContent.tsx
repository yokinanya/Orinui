import { PlusIcon } from 'lucide-react';
import type { Ref } from 'react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import type { Shortcut } from '@/domain/shortcut';
import { ShortcutGrid } from '@/features/shortcuts/ShortcutGrid';

interface ShortcutGroupContentProps {
  readonly activeGroupId: string | null;
  readonly contentRef: Ref<HTMLDivElement>;
  readonly editing: boolean;
  readonly isWaiting: boolean;
  readonly onAdd: () => void;
  readonly onEdit: (shortcut: Shortcut) => void;
  readonly shortcuts: Shortcut[];
}

export function ShortcutGroupContent({
  activeGroupId, contentRef, editing, isWaiting, onAdd, onEdit, shortcuts,
}: ShortcutGroupContentProps) {
  return (
    <>
      <div ref={contentRef} data-testid="shortcut-group-content" aria-busy={isWaiting}
        hidden={isWaiting} className="w-full">
        {shortcuts.length === 0 && !editing
          ? <EmptyGroup activeGroupId={activeGroupId} onAdd={onAdd} />
          : <ShortcutGrid shortcuts={shortcuts} editing={editing} onEdit={onEdit} onAdd={onAdd} />}
      </div>
      {isWaiting && <p role="status" className="home-readable-chip home-readable-muted text-sm text-glass-foreground-muted">正在读取分组网站…</p>}
    </>
  );
}

function EmptyGroup({ activeGroupId, onAdd }: { readonly activeGroupId: string | null; readonly onAdd: () => void }) {
  return (
    <Empty className="home-readable-surface border-glass-border bg-glass/40 backdrop-blur-sm">
      <EmptyHeader>
        <EmptyTitle className="home-readable-ink text-glass-foreground">还没有网站</EmptyTitle>
        <EmptyDescription className="home-readable-muted text-glass-foreground-muted">
          添加常用网站后会按分组显示在这里。
        </EmptyDescription>
      </EmptyHeader>
      <Button type="button" disabled={!activeGroupId} onClick={onAdd}
        className="home-readable-control home-readable-focus bg-glass text-glass-foreground hover:bg-glass-strong">
        <PlusIcon data-icon="inline-start" />
        添加第一个网站
      </Button>
    </Empty>
  );
}
