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
      return <ShortcutsRegion key={slot} editing={editing} alignment={options.shortcutAlignment} onOpenFolder={options.openFolder} />;
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

function renderCenteredLayout(input: HomeLayoutRenderInput) {
  const options = { searchInputRef: input.searchInputRef, searchWidth: input.searchWidth, openFolder: input.openFolder };
  const visible = visibleSlots(input.layout);
  return (
    <div data-layout-container
      className={`home-layout-centered motion-home-enter flex w-full flex-col items-center ${REGION_SPACING_CLASSES[input.layout.regionSpacing]} ${PAGE_WIDTH_CLASSES[input.layout.pageWidth]}`}>
      {input.messages}
      <AllHiddenMessage visible={visible} restoreContent={input.restoreContent} />
      {visible.map((slot) => renderSlot(slot, input.editing, options))}
    </div>
  );
}

function renderTopSearchHeader(input: HomeLayoutRenderInput, options: SlotRenderOptions) {
  const clock = isVisible(input.layout, 'clock') && (
    <div data-layout-clock-position={input.layout.clockPosition}
      className={`flex w-full ${input.layout.clockPosition === 'left' ? 'justify-start' : 'justify-end'}`}>
      {renderSlot('clock', input.editing, options)}
    </div>
  );
  const search = isVisible(input.layout, 'search') && (
    <div data-layout-search className="flex w-full justify-center">
      {renderSlot('search', input.editing, options)}
    </div>
  );
  return <div data-layout-header="top-search"
    className={`home-layout-header grid w-full min-w-0 grid-cols-1 items-center ${REGION_SPACING_CLASSES[input.layout.regionSpacing]}`}>
    {clock}{search}
    {input.messages}
    {<AllHiddenMessage visible={visibleSlots(input.layout)} restoreContent={input.restoreContent} />}
  </div>;
}

function renderTopSearchLayout(input: HomeLayoutRenderInput) {
  const options: SlotRenderOptions = {
    searchInputRef: input.searchInputRef,
    searchWidth: input.searchWidth,
    openFolder: input.openFolder,
    shortcutAlignment: 'center',
    clockAlignment: input.layout.clockPosition === 'left' ? 'start' : 'end',
  };
  const shortcuts = isVisible(input.layout, 'shortcuts') ? renderSlot('shortcuts', input.editing, options) : null;
  // 宽屏时外层容器占满主区域：时钟贴齐页面两侧边缘，搜索框仍相对页面居中并受内容宽度约束。
  // 主区域在居中布局使用 items-center，flex 子项的最大宽度只压住居中容器自身，
  // 因此这里显式放宽本容器，避免静态样式的最大宽度把贴边布局限制在内容宽度内。
  const header = renderTopSearchHeader(input, options);
  return (
    <div data-layout-container style={{ maxWidth: 'none' }}
      className="home-layout-workbench relative motion-home-enter flex w-full flex-col items-center">
      {header}
      {shortcuts && <div className={`home-layout-workbench-sites w-full ${PAGE_WIDTH_CLASSES[input.layout.pageWidth]}`}>{shortcuts}</div>}
    </div>
  );
}

function renderLeftStackLayout(input: HomeLayoutRenderInput) {
  const options: SlotRenderOptions = {
    searchInputRef: input.searchInputRef, searchWidth: input.searchWidth, openFolder: input.openFolder,
    shortcutAlignment: 'start', clockAlignment: 'start',
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

function renderSplitLayout(input: HomeLayoutRenderInput) {
  const options: SlotRenderOptions = {
    searchInputRef: input.searchInputRef, searchWidth: input.searchWidth, openFolder: input.openFolder,
    shortcutAlignment: 'start', clockAlignment: 'start',
  };
  const visible = visibleSlots(input.layout);
  return <div data-layout-container data-clock-visible={isVisible(input.layout, 'clock')}
    className={`home-layout-split motion-home-enter grid w-full min-w-0 ${PAGE_WIDTH_CLASSES[input.layout.pageWidth]} ${REGION_SPACING_CLASSES[input.layout.regionSpacing]}`}>
    <div className="home-layout-messages">{input.messages}<AllHiddenMessage visible={visible} restoreContent={input.restoreContent} /></div>
    {(['clock', 'search', 'shortcuts'] as const).filter((slot) => isVisible(input.layout, slot)).map((slot) => (
      <div key={slot} data-layout-region={slot} className="min-w-0 w-full">{renderSlot(slot, input.editing, options)}</div>
    ))}
  </div>;
}

export function renderHomeLayout(input: HomeLayoutRenderInput) {
  if (input.layout.style === 'top-search') return renderTopSearchLayout(input);
  if (input.layout.style === 'left-stack') return renderLeftStackLayout(input);
  if (input.layout.style === 'split') return renderSplitLayout(input);
  return renderCenteredLayout(input);
}
