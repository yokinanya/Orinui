import { useEffect, useRef, useState } from 'react';
import { CheckIcon, PencilIcon, Settings } from 'lucide-react';
import { HomeAddMenu } from '@/app/HomeAddMenu';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Folder } from '@/domain/folder';
import type { HomeWidget } from '@/domain/home';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { MotionPlaybackButton } from '@/features/appearance/MotionPlaybackButton';
import { OperationCenterButton } from '@/app/operations';
import { CreateFolderDialog } from '@/features/folders/CreateFolderDialog';
import { FolderDialog } from '@/features/folders/FolderDialog';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';

interface HomeActionsProps {
  readonly editing: boolean;
  /** 全局区域整理：任何实际可见区域存在时都可用。 */
  readonly canEdit: boolean;
  /** 新增网站/文件夹/小组件写入主页自有内容，只在快捷方式区域可见时开放。 */
  readonly canAddContent: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  /** 当前打开的文件夹；由主页统一持有，搜索建议也要能打开。 */
  readonly openFolderId: string | null;
  readonly onOpenFolder: (folderId: string | null) => void;
  readonly onAddWidget: (kind: HomeWidget['kind']) => void;
}

interface OpenFolderState {
  /** 用来渲染弹层的文件夹；`live` 为 false 时表示它已从当前数据里消失。 */
  readonly folder: Folder | null;
  readonly live: boolean;
  /** 打开请求指向一个既不在数据里、也没有历史引用的 id。 */
  readonly unresolved: boolean;
}

/**
 * 解析当前要打开的文件夹。
 *
 * 文件夹可能在其他窗口被删除，此时弹层不能凭空卸载——用户会以为点击没生效。
 * 因此保留最后一次真实解析到的引用（不是虚构节点）：`FolderDialog` 用它在数据里查不到时
 * 展示既有的「文件夹已不存在」界面。只有从未成功解析过的 id 才归为 `unresolved`。
 */
export function resolveOpenFolder(
  folders: readonly Folder[],
  openFolderId: string | null,
  lastKnown: Folder | null,
): OpenFolderState {
  if (openFolderId === null) return { folder: null, live: false, unresolved: false };
  const live = folders.find((folder) => folder.id === openFolderId);
  if (live) return { folder: live, live: true, unresolved: false };
  if (lastKnown !== null && lastKnown.id === openFolderId) return { folder: lastKnown, live: false, unresolved: false };
  return { folder: null, live: false, unresolved: true };
}

/** 目标文件夹在数据里已消失时的显式提示；不含任何书签内容，也不伪造文件夹节点。 */
function MissingFolderDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>文件夹已不存在</DialogTitle>
          <DialogDescription>它可能已在其他窗口被删除，关闭后主页会显示最新内容。</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 右下角动作区与文件夹弹层。
 *
 * 文件夹弹层放在这里而不是网格里：搜索建议打开文件夹时网格未必渲染（区域可能被隐藏），
 * 动作区则始终存在，弹层的打开状态不会被布局切换打断。新增网站与小组件也收在右下角「添加」里，
 * 但「整理主页」与「添加」的可用条件不同：隐藏快捷方式后仍应能整理其他区域的顺序与显隐。
 */
export function HomeActions({ editing, canEdit, canAddContent, onEditingChange, openFolderId, onOpenFolder, onAddWidget }: HomeActionsProps) {
  const { folders, status } = useData();
  const [creating, setCreating] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  /** 最后一次真实解析到的文件夹；外部删除后仍用它触发「已不存在」界面。 */
  const lastKnownFolderRef = useRef<Folder | null>(null);
  const requested = resolveOpenFolder(folders, openFolderId, lastKnownFolderRef.current);
  useEffect(() => {
    if (openFolderId === null) {
      lastKnownFolderRef.current = null;
      return;
    }
    const live = folders.find((folder) => folder.id === openFolderId);
    if (live) lastKnownFolderRef.current = live;
  }, [folders, openFolderId]);
  const closeFolder = () => {
    lastKnownFolderRef.current = null;
    onOpenFolder(null);
  };
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
        {canAddContent && <HomeAddMenu onWebsite={() => setAddingWebsite(true)} onFolder={() => setCreating(true)} onWidget={onAddWidget} />}
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
      {/* 快捷方式区域重新可见前不提交新增表单，避免创建不可见的自有内容。 */}
      <CreateFolderDialog open={creating && canAddContent} onOpenChange={(next) => { if (!next || !canAddContent) setCreating(false); }} />
      <ShortcutFormDialog open={addingWebsite && canAddContent} onOpenChange={(next) => { if (!next || !canAddContent) setAddingWebsite(false); }} folderId={null} />
      {requested.folder && (
        <FolderDialog key={requested.folder.id} folder={requested.folder} open
          onOpenChange={(next) => { if (!next) closeFolder(); }} />
      )}
      {/* 既不在数据里也没有历史引用：同样给出明确提示，而不是静默无反应。 */}
      <MissingFolderDialog open={requested.unresolved && status === 'ready'} onClose={closeFolder} />
    </>
  );
}
