import type { ReactNode, RefObject } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { visibleSlots, type LayoutConfig, type SlotId } from '@/domain/layout';
import type { SearchPreferences } from '@/domain/settings';
import { Clock } from '@/features/clock/Clock';
import { SearchField } from '@/features/search/SearchField';
import { ShortcutsRegion } from '@/features/shortcuts/ShortcutsRegion';
import { PAGE_WIDTH_CLASSES, REGION_SPACING_CLASSES, SEARCH_WIDTH_CLASSES } from '@/features/layout/layout-classes';

interface SlotRenderOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchWidth: SearchPreferences['width'];
  openFolder: (folderId: string) => void;
  shortcutAlignment?: 'center' | 'start';
  clockAlignment?: 'center' | 'start' | 'end';
  pendingHomeItem: string | null;
}

function renderSlot(slot: SlotId, editing: boolean, options: SlotRenderOptions) {
  switch (slot) {
    case 'clock':
      return <Clock key={slot} alignment={options.clockAlignment} />;
    case 'search':
      return (
        <div key={slot} className={`w-full ${SEARCH_WIDTH_CLASSES[options.searchWidth]}`}>
          <SearchField inputRef={options.searchInputRef} openFolder={options.openFolder} />
        </div>
      );
    case 'shortcuts':
      return <ShortcutsRegion key={slot} editing={editing} alignment={options.shortcutAlignment} onOpenFolder={options.openFolder}
        pendingHomeItem={options.pendingHomeItem} />;
  }
}

interface HomeLayoutRenderInput {
  readonly layout: LayoutConfig;
  readonly editing: boolean;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchWidth: SearchPreferences['width'];
  readonly openFolder: (folderId: string) => void;
  readonly messages: ReactNode;
  readonly restoreContent: () => void;
  readonly pendingHomeItem: string | null;
}

function isVisible(layout: LayoutConfig, slot: SlotId): boolean {
  return !layout.hidden.includes(slot);
}

/** 全隐藏提示。返回元素而非片段：React 不会在部分浏览器的渲染路径中展开片段。 */
function AllHiddenMessage({ visible, restoreContent }: {
  readonly visible: readonly SlotId[];
  readonly restoreContent: () => void;
}) {
  if (visible.length > 0) return null;
  return <Alert>
    <AlertTitle>主页内容已隐藏</AlertTitle>
    <AlertDescription>恢复默认布局以显示时钟、搜索和网站。</AlertDescription>
    <Button type="button" className="mt-3" onClick={restoreContent}>恢复主页内容</Button>
  </Alert>;
}

function renderLeftStackLayout(input: HomeLayoutRenderInput) {
  const options: SlotRenderOptions = {
    searchInputRef: input.searchInputRef, searchWidth: input.searchWidth, openFolder: input.openFolder,
    shortcutAlignment: 'start', clockAlignment: 'start',
    pendingHomeItem: input.pendingHomeItem,
  };
  const visible = visibleSlots(input.layout);
  const slots: readonly SlotId[] = ['clock', 'search', 'shortcuts'];
  return (
    <div data-layout-container className={`home-layout-left motion-home-enter flex w-full flex-col items-start ${REGION_SPACING_CLASSES[input.layout.regionSpacing]} ${PAGE_WIDTH_CLASSES[input.layout.pageWidth]}`}>
      {input.messages}
      {<AllHiddenMessage visible={visible} restoreContent={input.restoreContent} />}
      {slots.filter((slot) => isVisible(input.layout, slot)).map((slot) => (
        <div key={slot} data-layout-region={slot} className="w-full">
          {renderSlot(slot, input.editing, options)}
        </div>
      ))}
    </div>
  );
}

export function renderHomeLayout(input: HomeLayoutRenderInput) {
  return renderLeftStackLayout(input);
}
