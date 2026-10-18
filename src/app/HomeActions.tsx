import { CheckIcon, FolderPlusIcon, PencilIcon, Settings } from 'lucide-react';
import { useState } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { MotionPlaybackButton } from '@/features/appearance/MotionPlaybackButton';
import { OperationCenterButton } from '@/app/operations';
import { CreateFolderDialog } from '@/features/folders/CreateFolderDialog';
import { FolderDialog } from '@/features/folders/FolderDialog';

interface HomeActionsProps {
  readonly editing: boolean;
  readonly canEdit: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  /** 当前打开的文件夹；由主页统一持有，搜索建议也要能打开。 */
  readonly openFolderId: string | null;
  readonly onOpenFolder: (folderId: string | null) => void;
}

/**
 * 右下角动作区与文件夹弹层。
 *
 * 文件夹弹层放在这里而不是网格里：搜索建议打开文件夹时网格未必渲染（区域可能被隐藏），
 * 动作区则始终存在，弹层的打开状态不会被布局切换打断。
 */
export function HomeActions({ editing, canEdit, onEditingChange, openFolderId, onOpenFolder }: HomeActionsProps) {
  const { folders } = useData();
  const [creating, setCreating] = useState(false);
  // 渲染函数里不能就地声明组件：这里先取出启用条件，避免每次渲染重建按钮组件。
  const folderEntry = canEdit ? (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" aria-label="新建文件夹"
        onClick={() => setCreating(true)} className="home-readable-control home-readable-focus rounded-full" />}>
        <FolderPlusIcon />
      </TooltipTrigger>
      <TooltipContent>新建文件夹</TooltipContent>
    </Tooltip>
  ) : null;
  const openFolder = folders.find((folder) => folder.id === openFolderId) ?? null;
  const editButton = (
    <Button type="button" variant="ghost" size="icon"
      aria-label={editing ? '完成编辑' : '编辑网站'} aria-pressed={editing}
      onClick={() => onEditingChange(!editing)} className="home-readable-control home-readable-focus rounded-full">
      {editing ? <CheckIcon /> : <PencilIcon />}
    </Button>
  );

  return (
    <>
      <div className="fixed right-4 bottom-4 z-40 flex flex-col items-center gap-2 md:right-6 md:bottom-6">
        <MotionPlaybackButton compact />
        {folderEntry}
        {canEdit && (
          <Tooltip>
            <TooltipTrigger render={editButton} />
            <TooltipContent>{editing ? '完成编辑' : '编辑网站'}</TooltipContent>
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
      {openFolder && <FolderDialog key={openFolder.id} folder={openFolder} open onOpenChange={(next) => { if (!next) onOpenFolder(null); }} />}
    </>
  );
}
