import {
  closestCenter, DndContext, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type Modifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { useData } from '@/app/data-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { visibleSlots, type LayoutConfig, type SlotId } from '@/domain/layout';
import type { SearchPreferences } from '@/domain/settings';
import { Clock } from '@/features/clock/Clock';
import { SearchField } from '@/features/search/SearchField';
import { ShortcutsRegion } from '@/features/shortcuts/ShortcutsRegion';
import { PAGE_WIDTH_CLASSES, REGION_SPACING_CLASSES, SEARCH_WIDTH_CLASSES } from '@/features/layout/layout-classes';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

const DRAG_DISTANCE = 6;
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const SLOT_LABELS: Record<SlotId, string> = {
  clock: '时钟', search: '搜索', shortcuts: '快捷方式', bookmarks: '浏览器收藏夹',
};

interface SlotRenderOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchWidth: SearchPreferences['width'];
  openFolder: (folderId: string) => void;
  shortcutAlignment?: 'center' | 'start';
  clockAlignment?: 'center' | 'start' | 'end';
  pendingHomeItem: string | null;
  /** 书签区域由集成方注入；未注入时该区域不可用，不渲染。 */
  bookmarks?: ReactNode;
}

function renderSlot(slot: SlotId, editing: boolean, options: SlotRenderOptions): ReactNode {
  switch (slot) {
    case 'clock':
      return <Clock alignment={options.clockAlignment} />;
    case 'search':
      return (
        <div className={`w-full ${SEARCH_WIDTH_CLASSES[options.searchWidth]}`}>
          <SearchField inputRef={options.searchInputRef} openFolder={options.openFolder} />
        </div>
      );
    case 'shortcuts':
      return <ShortcutsRegion editing={editing} alignment={options.shortcutAlignment} onOpenFolder={options.openFolder}
        pendingHomeItem={options.pendingHomeItem} />;
    case 'bookmarks':
      // 书签内容严格只读，由集成方提供节点；本渲染器不读取任何书签数据。
      return options.bookmarks ?? null;
  }
}

export interface HomeLayoutRenderInput {
  readonly layout: LayoutConfig;
  readonly editing: boolean;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly searchWidth: SearchPreferences['width'];
  readonly openFolder: (folderId: string) => void;
  readonly messages: ReactNode;
  readonly restoreContent: () => void;
  readonly pendingHomeItem: string | null;
  /** 浏览器书签区域内容；缺省表示该区域当前不可用，不渲染也不计入“全隐藏”判断。 */
  readonly bookmarks?: ReactNode;
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

/**
 * 编辑模式下可拖动的单个主页区域。
 *
 * 拖动把手独立于区域内容，只占用左侧留白；区域内的输入、链接与小组件不被拦截。
 */
function RegionRow({ slot, editing, children }: {
  readonly slot: SlotId;
  readonly editing: boolean;
  readonly children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: slot, disabled: !editing });
  return (
    <div ref={setNodeRef} data-layout-region={slot}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative w-full', isDragging && 'z-10')}>
      {editing && <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon-xs"
        aria-label={`拖动${SLOT_LABELS[slot]}排序`} title={`拖动${SLOT_LABELS[slot]}排序`}
        className="absolute top-1/2 -left-6 z-10 -translate-y-1/2 cursor-grab touch-none text-muted-foreground/70 opacity-70 hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        {...attributes} {...listeners}><GripVerticalIcon /></Button>}
      {children}
    </div>
  );
}

function HomeLayoutView(input: HomeLayoutRenderInput) {
  const { updateLayout } = useData();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }));
  const options: SlotRenderOptions = {
    searchInputRef: input.searchInputRef, searchWidth: input.searchWidth, openFolder: input.openFolder,
    shortcutAlignment: 'start', clockAlignment: 'start',
    pendingHomeItem: input.pendingHomeItem, bookmarks: input.bookmarks,
  };
  // 持久化顺序驱动渲染；未注入内容的书签区域既不算可见，也不占位置。
  const visible = visibleSlots(input.layout).filter((slot) => slot !== 'bookmarks' || input.bookmarks != null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const order = input.layout.order;
    const from = order.indexOf(active.id as SlotId);
    const to = order.indexOf(over.id as SlotId);
    if (from < 0 || to < 0) return;
    void updateLayout({ order: arrayMove([...order], from, to) }).catch(notifyError);
  };
  return (
    <div data-layout-container className={`home-layout-left motion-home-enter flex w-full flex-col items-start ${REGION_SPACING_CLASSES[input.layout.regionSpacing]} ${PAGE_WIDTH_CLASSES[input.layout.pageWidth]}`}>
      {input.messages}
      <AllHiddenMessage visible={visible} restoreContent={input.restoreContent} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: '拖动区域排序。' } }}>
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          {visible.map((slot) => <RegionRow key={slot} slot={slot} editing={input.editing}>
            {renderSlot(slot, input.editing, options)}
          </RegionRow>)}
        </SortableContext>
      </DndContext>
    </div>
  );
}

export function renderHomeLayout(input: HomeLayoutRenderInput) {
  return <HomeLayoutView {...input} />;
}
