import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { BackgroundLayer } from '@/app/BackgroundLayer';
import { BookmarkFeatureProvider } from '@/app/BookmarkFeatureProvider';
import { useBookmarks } from '@/app/bookmark-context';
import { MotionPlaybackProvider, useMotionPlayback } from '@/app/MotionPlayback';
import { HomeActions } from '@/app/HomeActions';
import { useData } from '@/app/data-context';
import { DataProvider } from '@/app/DataProvider';
import { useApplyAppearance, useSystemPrefersDark } from '@/app/theme';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DEFAULT_LAYOUT, visibleSlots } from '@/domain/layout';
import type { HomeWidget } from '@/domain/home';
import { newId } from '@/domain/id';
import { BookmarkFolderHost } from '@/features/bookmarks/BookmarkFolderHost';
import { BookmarkRegion } from '@/features/bookmarks/BookmarkRegion';
import { Clock } from '@/features/clock/Clock';
import { SearchField } from '@/features/search/SearchField';
import { ShortcutsRegion } from '@/features/shortcuts/ShortcutsRegion';
import { useLocalImage } from '@/hooks/use-local-image';
import { notifyError } from '@/lib/notify';
import { PAGE_WIDTH_CLASSES, REGION_SPACING_CLASSES, SEARCH_WIDTH_CLASSES } from '@/features/layout/layout-classes';
import type { SearchPreferences } from '@/domain/settings';
import { renderHomeLayout } from '@/features/layout/HomeLayout';
import { OperationProvider } from '@/app/operations';

function LoadingState() {
  return (
    <div className="flex w-full flex-col items-center gap-6" aria-busy="true">
      <Skeleton className="h-16 w-48 rounded-2xl" />
      <Skeleton className="h-12 w-full max-w-xl rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

function LoadingPage() {
  return <main className="flex min-h-dvh items-center justify-center px-6 py-16">
    <div className="w-full max-w-3xl"><LoadingState /></div>
  </main>;
}

function DataErrorPage({ error }: { readonly error: string | null }) {
  return <main className="flex min-h-dvh items-center justify-center px-6 py-16">
    <div className="w-full max-w-xl">
      <Alert variant="destructive">
        <AlertTitle>本地数据无法读取</AlertTitle>
        <AlertDescription>{error ?? '未知错误'}</AlertDescription>
      </Alert>
    </div>
  </main>;
}

/**
 * 主页组合。
 *
 * 数据契约 §4：按固定命名插槽的持久化顺序渲染，隐藏的区域不渲染。
 * 初始化失败时显示明确原因，而不是让页面停留在空白状态。
 */
interface HomePageProps {
  readonly editing: boolean;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly openFolder: (folderId: string) => void;
  readonly pendingHomeItem: string | null;
}

function BackgroundMessages({ photo }: { readonly photo: ReturnType<typeof useLocalImage> }) {
  const motion = useMotionPlayback();
  return <>
    {photo.error && <Alert variant="destructive"><AlertTitle>壁纸无法读取</AlertTitle><AlertDescription>{photo.error}</AlertDescription></Alert>}
    {photo.seedError && <Alert variant="destructive"><AlertTitle>动态配色取色失败</AlertTitle><AlertDescription>{photo.seedError}</AlertDescription></Alert>}
    {photo.readabilityColorError && <Alert variant="destructive"><AlertTitle>壁纸颜色分析失败</AlertTitle><AlertDescription>{photo.readabilityColorError}</AlertDescription></Alert>}
    {motion.error && <Alert variant="destructive"><AlertTitle>动态壁纸播放失败</AlertTitle><AlertDescription>{motion.error}</AlertDescription></Alert>}
    {motion.preferenceError && <Alert variant="destructive"><AlertTitle>动态壁纸偏好无法保存</AlertTitle><AlertDescription>{motion.preferenceError}</AlertDescription></Alert>}
  </>;
}

function HomePage({ editing, searchInputRef, openFolder, pendingHomeItem }: HomePageProps) {
  const { status, error, settings, updateLayout } = useData();
  const bookmarks = useBookmarks();
  const systemPrefersDark = useSystemPrefersDark();
  const background = settings.appearance.background;
  const staticPhoto = useLocalImage(background.kind === 'photo' ? background.assetId : null,
    settings.appearance.dynamicColor.enabled, background.kind === 'photo');
  const motion = useMotionPlayback();
  const photo = background.kind === 'motion' ? motion.image : staticPhoto;

  useApplyAppearance({ appearance: settings.appearance, systemPrefersDark, photoUrl: photo.url,
    photoSeed: photo.seed, photoColor: photo.readabilityColor });

  if (status === 'loading') return <LoadingPage />;
  if (status === 'error') return <DataErrorPage error={error} />;

  const mainAlignment = 'home-main-left items-start justify-start pt-16 pb-32';
  // 功能关闭时不注入任何节点：HomeLayout 不渲染空的书签区域，也不把它计入「全隐藏」判断。
  const bookmarkRegion = bookmarks && bookmarks.snapshot.status !== 'disabled'
    ? <BookmarkRegion bookmarks={bookmarks} />
    : null;
  return (
    <main data-layout-style="niagara"
      className={`flex min-h-dvh flex-col px-6 ${mainAlignment}`}>
      {renderHomeLayout({
        layout: settings.layout,
        editing,
        searchInputRef,
        searchWidth: settings.search.width,
        openFolder,
        messages: <BackgroundMessages photo={photo} />,
        restoreContent: () => void updateLayout({ order: [...DEFAULT_LAYOUT.order], hidden: [] }).catch(notifyError),
        pendingHomeItem,
        bookmarks: bookmarkRegion,
      })}
    </main>
  );
}

/** 点空白退出编辑：只看点击起点是否落在可交互对象（格子、按钮、菜单、输入）之外。 */
const EDIT_SURFACE_SELECTOR = [
  '[data-shortcut-frame]',
  '[data-home-item]',
  '[data-slot="dialog-content"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="region"][aria-label="操作状态"]',
].join(', ');

/** 点空白退出编辑：仅左键、且按下位置不在格子、标签、按钮、菜单或弹窗内时触发。 */
function useLeaveEditingOnBlankClick(editing: boolean, leaveEditing: () => void): void {
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(EDIT_SURFACE_SELECTOR) !== null) return;
      if (target.closest('button, a[href], input, textarea, select') !== null) return;
      leaveEditing();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [editing, leaveEditing]);
}

function useAddWidgetAction(onCreated: (id: string) => void): (kind: HomeWidget['kind']) => void {
  const { saveWidget } = useData();
  return (kind) => {
    const id = newId();
    void saveWidget({ id, kind, text: '', items: [] }).then(() => onCreated(`widget:${id}`)).catch(notifyError);
  };
}

function HomeContent() {
  const { status, settings } = useData();
  const bookmarks = useBookmarks();
  const [editing, setEditing] = useState(false);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initialFocusHandled = useRef(false);
  const [pendingHomeItem, setPendingHomeItem] = useState<string | null>(null);
  const addWidget = useAddWidgetAction(setPendingHomeItem);
  useEffect(() => {
    if (status !== 'ready' || initialFocusHandled.current) return;
    initialFocusHandled.current = true;
    if (settings.search.autoFocus && visibleSlots(settings.layout).includes('search')) searchInputRef.current?.focus();
  }, [settings.layout, settings.search.autoFocus, status]);
  // 书签功能关闭时不渲染书签区域，也就不能把它算作「仍有一块可整理的内容」。
  const visibleRegions = visibleSlots(settings.layout)
    .filter((slot) => slot !== 'bookmarks' || (bookmarks !== null && bookmarks.snapshot.status !== 'disabled'));
  // 区域排序/显隐是全局布局操作：只要还有实际可见区域就能整理，不再要求快捷方式可见。
  const canEdit = status === 'ready' && visibleRegions.length > 0;
  // 新增网站、文件夹与小组件仍写主页自有内容，只在快捷方式区域可见时开放。
  const canAddContent = status === 'ready' && visibleRegions.includes('shortcuts');
  const leaveEditing = useCallback(() => setEditing(false), []);

  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  // 编辑模式下点击空白处退出，与点右下角「完成编辑」等价；格子、菜单和弹窗内部点击不触发。
  useLeaveEditingOnBlankClick(editing, leaveEditing);

  return (
    <>
      <BackgroundLayer />
      <HomePage editing={editing} searchInputRef={searchInputRef} openFolder={setOpenFolderId}
        pendingHomeItem={pendingHomeItem} />
      <HomeActions editing={editing} canEdit={canEdit} canAddContent={canAddContent}
        onEditingChange={setEditing} onOpenFolder={setOpenFolderId} openFolderId={openFolderId}
        onAddWidget={addWidget} />
      {/* 书签区域被布局隐藏时仍需响应搜索结果：外部文件夹请求由这个区域外宿主持有。 */}
      <BookmarkFolderHost />
    </>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <Toaster>
        <OperationProvider><DataProvider>
          <BookmarkFeatureProvider>
            <MotionPlaybackProvider><HomeContent /></MotionPlaybackProvider>
          </BookmarkFeatureProvider>
        </DataProvider></OperationProvider>
      </Toaster>
    </TooltipProvider>
  );
}
