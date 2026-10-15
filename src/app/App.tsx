import { useEffect, useRef, useState, type RefObject } from 'react';

import { BackgroundLayer } from '@/app/BackgroundLayer';
import { HomeActions } from '@/app/HomeActions';
import { useData } from '@/app/data-context';
import { DataProvider } from '@/app/DataProvider';
import { useApplyAppearance, useSystemPrefersDark } from '@/app/theme';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DEFAULT_LAYOUT, visibleSlots, type SlotId } from '@/domain/layout';
import { Clock } from '@/features/clock/Clock';
import { SearchField } from '@/features/search/SearchField';
import { ShortcutsRegion } from '@/features/shortcuts/ShortcutsRegion';
import { useLocalImage } from '@/hooks/use-local-image';
import { notifyError } from '@/lib/notify';
import { PAGE_WIDTH_CLASSES, REGION_SPACING_CLASSES, SEARCH_WIDTH_CLASSES } from '@/features/layout/layout-classes';
import type { SearchPreferences } from '@/domain/settings';

interface SlotRenderOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchWidth: SearchPreferences['width'];
}

function renderSlot(slot: SlotId, editing: boolean, options: SlotRenderOptions) {
  switch (slot) {
    case 'clock':
      return <Clock key={slot} />;
    case 'search':
      return (
        <div key={slot} className={`w-full ${SEARCH_WIDTH_CLASSES[options.searchWidth]}`}>
          <SearchField inputRef={options.searchInputRef} />
        </div>
      );
    case 'shortcuts':
      return <ShortcutsRegion key={slot} editing={editing} />;
  }
}

function LoadingState() {
  return (
    <div className="flex w-full flex-col items-center gap-6" aria-busy="true">
      <Skeleton className="h-16 w-48 rounded-2xl" />
      <Skeleton className="h-12 w-full max-w-xl rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

/**
 * 主页组合。
 *
 * 数据契约 §4：按固定命名插槽的持久化顺序渲染，隐藏的区域不渲染。
 * 初始化失败时显示明确原因，而不是让页面停留在空白状态。
 */
function HomePage({ editing, searchInputRef }: { readonly editing: boolean; readonly searchInputRef: RefObject<HTMLInputElement | null> }) {
  const { status, error, settings, updateLayout } = useData();
  const systemPrefersDark = useSystemPrefersDark();
  const background = settings.appearance.background;
  const photo = useLocalImage(background.kind === 'photo' ? background.assetId : null,
    settings.appearance.dynamicColor.enabled);

  useApplyAppearance({ appearance: settings.appearance, systemPrefersDark, photoUrl: photo.url, photoSeed: photo.seed });

  if (status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl">
          <LoadingState />
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <Alert variant="destructive">
            <AlertTitle>本地数据无法读取</AlertTitle>
            <AlertDescription>{error ?? '未知错误'}</AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className={`motion-home-enter flex w-full flex-col items-center ${REGION_SPACING_CLASSES[settings.layout.regionSpacing]} ${PAGE_WIDTH_CLASSES[settings.layout.pageWidth]}`}>
        {photo.error && <Alert variant="destructive"><AlertTitle>照片无法读取</AlertTitle><AlertDescription>{photo.error}</AlertDescription></Alert>}
        {photo.seedError && <Alert variant="destructive"><AlertTitle>照片取色失败</AlertTitle><AlertDescription>{photo.seedError}</AlertDescription></Alert>}
        {visibleSlots(settings.layout).length === 0 && <Alert>
          <AlertTitle>主页内容已隐藏</AlertTitle>
          <AlertDescription>恢复默认布局以显示时钟、搜索和网站分组。</AlertDescription>
          <Button type="button" className="mt-3" onClick={() => void updateLayout({
            order: [...DEFAULT_LAYOUT.order], hidden: [],
          }).catch(notifyError)}>
            恢复主页内容
          </Button>
        </Alert>}
        {visibleSlots(settings.layout).map((slot) => renderSlot(slot, editing, {
          searchInputRef, searchWidth: settings.search.width,
        }))}
      </div>
    </main>
  );
}

function HomeContent() {
  const { status, activeGroupId, settings } = useData();
  const [editing, setEditing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initialFocusHandled = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || initialFocusHandled.current) return;
    initialFocusHandled.current = true;
    if (settings.search.autoFocus && visibleSlots(settings.layout).includes('search')) searchInputRef.current?.focus();
  }, [settings.layout, settings.search.autoFocus, status]);
  const canEdit = status === 'ready' && activeGroupId !== null && visibleSlots(settings.layout).includes('shortcuts');

  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  return (
    <>
      <BackgroundLayer />
      <HomePage editing={editing} searchInputRef={searchInputRef} />
      <HomeActions editing={editing} canEdit={canEdit} onEditingChange={setEditing} />
    </>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <Toaster>
        <DataProvider>
          <HomeContent />
        </DataProvider>
      </Toaster>
    </TooltipProvider>
  );
}
