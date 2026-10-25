import { useState } from 'react';
import { CheckIcon, PencilIcon, Settings } from 'lucide-react';
import { HomeAddMenu } from '@/app/HomeAddMenu';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { HomeWidget } from '@/domain/home';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { MotionPlaybackButton } from '@/features/appearance/MotionPlaybackButton';
import { OperationCenterButton } from '@/app/operations';
import { CreateFolderDialog } from '@/features/folders/CreateFolderDialog';
import { FolderDialog } from '@/features/folders/FolderDialog';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';

interface HomeActionsProps {
  readonly editing: boolean;
  readonly canEdit: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  /** 当前打开的文件夹；由主页统一持有，搜索建议也要能打开。 */
  readonly openFolderId: string | null;
  readonly onOpenFolder: (folderId: string | null) => void;
  readonly onAddWidget: (kind: HomeWidget['kind']) => void;
}

/**
 * 右下角动作区与文件夹弹层。
 *
 * 文件夹弹层放在这里而不是网格里：搜索建议打开文件夹时网格未必渲染（区域可能被隐藏），
 * 动作区则始终存在，弹层的打开状态不会被布局切换打断。新增网站与小组件也收在右下角「添加」里。
 */
export function HomeActions({ editing, canEdit, onEditingChange, openFolderId, onOpenFolder, onAddWidget }: HomeActionsProps) {
  const { folders } = useData();
  const [creating, setCreating] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  const openFolder = folders.find((folder) => folder.id === openFolderId) ?? null;
  const editButton = (
    <Button type="button" variant="ghost" size="icon"
      aria-label={editing ? '完成编辑' : '整理主页'} aria-pressed={editing}
      onClick={() => onEditingChange(!editing)} className="home-readable-control home-readable-focus rounded-full">
      {editing ? <CheckIcon /> : <PencilIcon />}
    </Button>
  );

  return (
    <>
      <div className="fixed right-4 bottom-4 z-40 flex flex-col items-center gap-2 md:right-6 md:bottom-6" data-home-actions>
        <MotionPlaybackButton compact />
        {canEdit && <HomeAddMenu onWebsite={() => setAddingWebsite(true)} onFolder={() => setCreating(true)} onWidget={onAddWidget} />}
        {canEdit && (
          <Tooltip>
            <TooltipTrigger render={editButton} />
            <TooltipContent side="left">{editing ? '完成编辑' : '整理主页'}</TooltipContent>
          </Tooltip>
        )}
        <OperationCenterButton />
        <SettingsPanel trigger={
          <Button variant="ghost" size="icon" aria-label="设置" className="home-readable-control home-readable-focus rounded-full">
            <Settings />
          </Button>
        } />
      </div>
      <CreateFolderDialog open={creating} onOpenChange={setCreating} />
      <ShortcutFormDialog open={addingWebsite} onOpenChange={setAddingWebsite} folderId={null} />
      {openFolder && <FolderDialog key={openFolder.id} folder={openFolder} open onOpenChange={(next) => { if (!next) onOpenFolder(null); }} />}
    </>
  );
}
