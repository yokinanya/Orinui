import { ArrowLeftIcon, FolderPlusIcon, PlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { CreateFolderDialog } from '@/features/folders/CreateFolderDialog';
import { DeleteFolderDialog } from '@/features/folders/DeleteFolderDialog';
import { RenameFolderDialog } from '@/features/folders/FolderDialogs';
import { childFolders, folderHomePathLabel, folderTrail, HOME_PATH_LABEL, nearestExtantAncestor }
  from '@/features/folders/folder-path';
import { pendingFocusOutcome } from '@/features/folders/folder-focus';
import { folderBodyKind, folderReadDescription, type FolderShortcutRead } from '@/features/folders/folder-read';
import { ShortcutFormDialog } from '@/features/shortcuts/ShortcutFormDialog';
import { ShortcutGrid } from '@/features/shortcuts/ShortcutGrid';
import { cn } from '@/lib/utils';

interface FolderDialogProps {
  readonly folder: Folder;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

type FolderAction = { readonly kind: 'rename' | 'delete'; readonly folder: Folder } | null;

/**
 * 读取当前层的网站。
 *
 * 每次打开或切换层级都重新读取；修改后主动 reload，不依赖主页网站的订阅，
 * 因为嵌套层里的增删不会改变主页网格数据。
 * 显式区分加载、成功与失败：读取未完成或失败时不能显示「0 个网站」或空文件夹，
 * 否则会把「读不到」伪装成「没有内容」。
 */
function useFolderShortcuts(folderId: string | null, open: boolean) {
  const { loadFolderShortcuts, folders } = useData();
  const [state, setState] = useState<FolderShortcutRead>({ status: 'idle' });
  /** `state` 属于哪一层：切换层级后到新结果到达之前，内容区仍然展示上一层读到的结果。 */
  const [stateFolderId, setStateFolderId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open || folderId === null) { setState({ status: 'idle' }); setStateFolderId(null); return; }
    let cancelled = false;
    setState({ status: 'loading' });
    setStateFolderId(folderId);
    void loadFolderShortcuts(folderId)
      .then((items) => { if (!cancelled) setState({ status: 'ready', shortcuts: items }); })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => { cancelled = true; };
  }, [folderId, open, version, folders, loadFolderShortcuts]);
  return { state, stateFolderId, reload: () => setVersion((value) => value + 1) };
}

/**
 * 文件夹弹层。
 *
 * 自有文件夹可任意嵌套：这里始终只展示当前层的直接子文件夹与网站，
 * 顶部面包屑给出从顶层到当前位置的完整路径，可点任意祖先返回、焦点回到刚才进入的子文件夹。
 * 新建文件夹与网站都落在当前层；删除只提升直接子项，深层子树保持原样。
 * 文件夹格子是静态块，不参与拖动或重排；网站仍可编辑、排序与跨文件夹移动。
 */
export function FolderDialog({ folder, open, onOpenChange }: FolderDialogProps) {
  const { folders } = useData();
  const [currentId, setCurrentId] = useState<string>(folder.id);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [shortcutFormOpen, setShortcutFormOpen] = useState(false);
  const [target, setTarget] = useState<Shortcut | null>(null);
  const [action, setAction] = useState<FolderAction>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fallbackFocusRef = useRef<HTMLButtonElement | null>(null);
  /** 最近一次解析出的完整路径：父文件夹在别处被删后，仍能回到仍存在的祖先。 */
  const lastTrailRef = useRef<Folder[]>([]);

  // 从搜索建议或其他入口打开另一层时回到开始位置；同一文件夹重新打开也重置。
  useEffect(() => {
    if (open) setCurrentId(folder.id);
  }, [folder.id, open]);

  const current = folders.find((item) => item.id === currentId) ?? null;
  const { state, stateFolderId, reload } = useFolderShortcuts(current?.id ?? null, open && current !== null);
  const children = current ? childFolders(folders, current.id) : [];
  const trail = current ? folderTrail(folders, current.id) : [];
  const parentMissing = current !== null && current.parentId !== null
    && !folders.some((item) => item.id === current.parentId);

  // 记录可用的完整路径；只在最后一个节点确实是当前层时更新，避免把过期路径当成事实。
  useEffect(() => {
    if (trail.length > 0 && trail[trail.length - 1]?.id === currentId) lastTrailRef.current = trail;
  }, [currentId, trail]);

  // 面包屑或返回导航后，把焦点放回刚进入的那一层文件夹格子；找不到时退到返回按钮，键盘用户不会丢失位置。
  // 切换层级会重新读取当前层网站，内容区先换成加载占位；读取结束前就在这里聚焦，格子随后被占位卸载，
  // 焦点会掉回弹层且没有第二次机会。因此只在内容区确实属于当前层、且读取已结束时消费待恢复焦点。
  useEffect(() => {
    if (pendingFocus === null) return;
    const tiles = bodyRef.current === null
      ? []
      : [...bodyRef.current.querySelectorAll<HTMLElement>('[data-folder-id]')];
    const renderedTileIds: string[] = [];
    for (const element of tiles) {
      const folderId = element.dataset.folderId;
      if (folderId !== undefined) renderedTileIds.push(folderId);
    }
    const outcome = pendingFocusOutcome({
      pendingFocus,
      currentId,
      content: { folderId: stateFolderId, status: state.status },
      renderedTileIds,
    });
    if (outcome.kind === 'wait') return;
    // 目标格子不在 DOM 时（含读取失败）退到返回按钮，不静默丢弃这次焦点恢复。
    const focusTarget = outcome.kind === 'focus'
      ? tiles.find((element) => element.dataset.folderId === outcome.folderId) ?? fallbackFocusRef.current
      : fallbackFocusRef.current;
    focusTarget?.focus();
    setPendingFocus(null);
  }, [pendingFocus, currentId, state, stateFolderId]);

  // 从父层点进子文件夹时，被点的格子会卸载，焦点会掉回 body；此时把焦点交给返回按钮。
  useEffect(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && !active.hasAttribute('data-folder-id')) return;
    fallbackFocusRef.current?.focus();
  }, [currentId]);

  const navigate = (folderId: string, focusAfter?: string) => {
    setCurrentId(folderId);
    if (focusAfter) setPendingFocus(focusAfter);
  };

  /** 返回上一层：父层不在时退到仍存在的最近祖先；连祖先都不存在就关闭弹层回主页。 */
  const goBack = () => {
    if (!current || current.parentId === null) return;
    const target = nearestExtantAncestor(folders, current, lastTrailRef.current);
    if (target === null) onOpenChange(false);
    else navigate(target, current.id);
  };

  const openCreate = () => { setTarget(null); setShortcutFormOpen(true); };
  const openEdit = (shortcut: Shortcut) => { setTarget(shortcut); setShortcutFormOpen(true); };
  const closeAction = () => setAction(null);

  const afterDelete = (deleted: Folder) => {
    if (deleted.id === currentId) {
      // 当前层被删：回到父层；父层也已被删时退到仍存在的最近祖先，连祖先都没有就关闭弹层。
      // 直接跳 deleted.parentId 会停在一个不存在的层级上，把「已删除」显示成读取失败。
      const target = nearestExtantAncestor(folders, deleted, lastTrailRef.current);
      if (target === null) onOpenChange(false);
      else navigate(target);
      return;
    }
    // 删除的是当前层的子文件夹：它的网站与子文件夹被提升到当前层，需要刷新当前列表。
    reload();
  };

  if (current === null) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>文件夹已不存在</DialogTitle>
            <DialogDescription>它可能已在其他窗口被删除，关闭后主页会显示最新内容。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button type="button" onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const shortcuts = state.status === 'ready' ? state.shortcuts : null;
  const body = folderBodyKind(state, children.length);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-4 sm:max-w-3xl" data-folder-dialog data-folder-level={current.id}
          data-folder-state={state.status}>
          <DialogHeader>
            {/* 标题保持当前层名称；悬停补齐从主页起的完整路径，和面包屑一致。 */}
            <DialogTitle title={folderHomePathLabel(folders, current.id)}>{current.name}</DialogTitle>
            <DialogDescription>{folderReadDescription(state, children.length)}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="文件夹路径" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {current.parentId !== null && (
                <Button ref={fallbackFocusRef} type="button" variant="ghost" size="icon-xs" aria-label="返回上一级"
                  className="home-readable-focus mr-1" onClick={goBack}>
                  <ArrowLeftIcon />
                </Button>
              )}
              {/* 路径起点：与搜索结果和视觉规格一致，完整路径从「主页」开始；点它即离开文件夹回到主页。 */}
              <button type="button" className="max-w-40 truncate rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
                title={`${HOME_PATH_LABEL}：关闭文件夹并回到主页`} onClick={() => onOpenChange(false)}>
                {HOME_PATH_LABEL}
              </button>
              <span aria-hidden="true">/</span>
              {trail.map((item, index) => {
                const last = index === trail.length - 1;
                return (
                  <span key={item.id} className="flex min-w-0 items-center gap-1">
                    {last ? (
                      <span aria-current="page" className="max-w-40 truncate font-medium text-foreground">{item.name}</span>
                    ) : (
                      <button type="button" className="max-w-40 truncate rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
                        title={item.name} onClick={() => navigate(item.id, trail[index + 1]?.id)}>
                        {item.name}
                      </button>
                    )}
                    {!last && <span aria-hidden="true">/</span>}
                  </span>
                );
              })}
              {parentMissing && (
                <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                  上一级已不在，返回会回到仍存在的最近位置
                </span>
              )}
            </nav>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="home-readable-focus"
                onClick={() => setCreateFolderOpen(true)}>
                <FolderPlusIcon data-icon="inline-start" />
                新建文件夹
              </Button>
              <Button type="button" size="sm" className="home-readable-focus" onClick={openCreate}>
                <PlusIcon data-icon="inline-start" />
                添加网站
              </Button>
            </div>
          </div>
          {state.status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <span>网站读取失败：{state.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={reload}>重试</Button>
            </div>
          )}
          <div ref={bodyRef} className="max-h-[60dvh] overflow-y-auto">
            {body === 'content' && shortcuts !== null ? (
              <ShortcutGrid shortcuts={[...shortcuts]} folders={children} onShortcutsChanged={reload}
                editing={false} showActions
                onEdit={openEdit} onAdd={openCreate} alignment="center"
                onOpenFolder={(folderId) => navigate(folderId)}
                onEditFolder={(item) => setAction({ kind: 'rename', folder: item })}
                onDeleteFolder={(item) => setAction({ kind: 'delete', folder: item })} />
            ) : body === 'empty' ? (
              <div className={cn('flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center')}>
                <p className="text-sm font-medium">这个文件夹是空的</p>
                <p className="text-sm text-muted-foreground">用上方的「新建文件夹」或「添加网站」在这里添加内容。</p>
              </div>
            ) : (
              // 加载中或失败时不能渲染空文件夹或 0 计数，否则会把「读不到」伪装成「没有内容」。
              <p className="p-8 text-center text-sm text-muted-foreground" aria-live="polite">
                {body === 'error' ? '网站未能读取，重试前不会显示内容。' : '正在读取这个文件夹的网站…'}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <CreateFolderDialog open={createFolderOpen} parentId={current.id} parentName={current.name}
        onOpenChange={setCreateFolderOpen} />
      {shortcutFormOpen && <ShortcutFormDialog open={shortcutFormOpen}
        onOpenChange={(next) => { if (!next) { setShortcutFormOpen(false); reload(); } }}
        folderId={current.id} shortcut={target ?? undefined} />}
      {action?.kind === 'rename' && <RenameFolderDialog folder={action.folder} open
        onOpenChange={(next) => { if (!next) closeAction(); }} />}
      {action?.kind === 'delete' && <DeleteFolderDialog folder={action.folder} open
        onDeleted={afterDelete} onOpenChange={(next) => { if (!next) closeAction(); }} />}
    </>
  );
}
