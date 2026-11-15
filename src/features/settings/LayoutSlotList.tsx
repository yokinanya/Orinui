import {
  closestCorners, DndContext, PointerSensor, useSensor, useSensors,
  type DragCancelEvent, type DragEndEvent, type DragStartEvent, type Modifier,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DEFAULT_LAYOUT, type ClockCornerPosition, type SlotId } from '@/domain/layout';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { useSettingsDragGuard } from '@/features/settings/settings-drag-guard';

/**
 * 区域名称。
 *
 * 显隐开关沿用既有可访问名称；快捷方式区域在主页承载网站/文件夹网格，仍称“主页内容”。
 */
const SLOT_LABELS: Record<SlotId, string> = {
  clock: '时钟', search: '搜索', shortcuts: '快捷方式', bookmarks: '浏览器收藏夹',
};
const SLOT_VISIBILITY_LABELS: Record<SlotId, string> = {
  clock: '显示时钟', search: '显示搜索', shortcuts: '显示主页内容', bookmarks: '显示浏览器收藏夹',
};
const CLOCK_CORNER_OPTIONS: readonly ClockCornerPosition[] = ['left', 'right'];
const CLOCK_CORNER_LABELS: Record<ClockCornerPosition, string> = { left: '左对齐', right: '右对齐' };

/** 返回拖拽后的顺序；两端都在列表中时才产生新顺序。 */
function moveOrder(order: readonly SlotId[], activeId: string, overId: string): SlotId[] | null {
  const from = order.indexOf(activeId as SlotId);
  const to = order.indexOf(overId as SlotId);
  return from >= 0 && to >= 0 ? arrayMove([...order], from, to) : null;
}

function slotVisibilityId(slot: SlotId): string {
  return `layout-slot-visible-${slot}`;
}

function slotVisibilityLabelId(slot: SlotId): string {
  return `layout-slot-visible-${slot}-label`;
}
const DRAG_DISTANCE = 8;
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface SlotRowProps {
  readonly slot: SlotId;
  readonly index: number;
  readonly total: number;
  readonly visible: boolean;
  readonly hidden: readonly SlotId[];
  readonly onMove: (index: number, direction: 'up' | 'down') => void;
  readonly onVisibleChange: (slot: SlotId, visible: boolean) => void;
  /** 仅顶部搜索布局给出时钟当前角落，其他布局为 null。 */
  readonly clockPosition: ClockCornerPosition | null;
  readonly onClockPositionChange: (position: ClockCornerPosition) => void;
}

/** 顶部搜索布局中时钟的角落对齐，直接放在时钟行内，靠近它所描述的对象。 */
function ClockCornerControls({ clockPosition, disabled, onChange }: {
  readonly clockPosition: ClockCornerPosition;
  readonly disabled: boolean;
  readonly onChange: (position: ClockCornerPosition) => void;
}) {
  return <ToggleGroup value={[clockPosition]} disabled={disabled} aria-label="时钟对齐"
    className="settings-segmented shrink-0 gap-0.5 p-0.5" onValueChange={(values) => {
      const next = values[0];
      if (next === 'left' || next === 'right') onChange(next);
    }}>
    {CLOCK_CORNER_OPTIONS.map((position) => <ToggleGroupItem key={position} value={position}
      className="h-7 min-w-0 px-1.5 text-xs sm:px-2">{CLOCK_CORNER_LABELS[position]}</ToggleGroupItem>)}
  </ToggleGroup>;
}

function SortableSlotRow(props: SlotRowProps) {
  const { slot, index, total, visible, onMove, onVisibleChange, clockPosition } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: slot });
  const label = SLOT_LABELS[slot];
  const visibilityLabel = SLOT_VISIBILITY_LABELS[slot];
  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onMove(index, event.key === 'ArrowUp' ? 'up' : 'down');
  };
  return (
    <li ref={setNodeRef} data-layout-slot={slot}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative flex min-h-11 items-center gap-0.5 bg-background/50 px-1.5 sm:gap-1 sm:px-2', isDragging && 'z-10 shadow-sm')}>
      <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon-xs"
        aria-label={`拖动${label}排序，方向键调整位置`} title={`拖动${label}排序`} className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        {...attributes} {...listeners} onKeyDown={onHandleKeyDown}><GripVerticalIcon /></Button>
      <span aria-hidden="true" className="hidden w-4 shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{index + 1}</span>
      <span id={slotVisibilityLabelId(slot)} className="sr-only">{visibilityLabel}</span>
      <Label htmlFor={slotVisibilityId(slot)} className="min-w-0 flex-1 cursor-pointer truncate py-2 text-sm">{label}</Label>
      {slot === 'clock' && clockPosition !== null && <ClockCornerControls clockPosition={clockPosition}
        disabled={!visible || props.hidden.includes('search')} onChange={props.onClockPositionChange} />}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`上移${label}`}
          disabled={index === 0} onClick={() => onMove(index, 'up')}><ArrowUpIcon /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`下移${label}`}
          disabled={index === total - 1} onClick={() => onMove(index, 'down')}><ArrowDownIcon /></Button>
        {/* 由独立的文字标签命名，名称固定为“显示时钟”等；标签本身也可点击切换。 */}
        <Switch id={slotVisibilityId(slot)} size="sm" aria-labelledby={slotVisibilityLabelId(slot)} checked={visible}
          onCheckedChange={(checked) => onVisibleChange(slot, checked === true)} />
      </div>
    </li>
  );
}

/**
 * 主页区域排序与显隐。
 *
 * 顺序在所有布局样式下都可调整；显隐只改 hidden，不重排 order。
 */
export function LayoutSlotList() {
  const { settings, updateLayout } = useData();
  const dragGuard = useSettingsDragGuard();
  const { order, hidden, style, clockPosition } = settings.layout;
  const topSearch = style === 'top-search';
  const update = (patch: Partial<typeof settings.layout>) => void updateLayout(patch).catch(notifyError);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
  );
  const move = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= order.length) return;
    update({ order: arrayMove(order, index, target) });
  };
  const onDragStart = (_: DragStartEvent) => dragGuard?.setDragging(true);
  const onDragCancel = (_: DragCancelEvent) => dragGuard?.setDragging(false);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragGuard?.setDragging(false);
    if (!over || active.id === over.id) return;
    const moved = moveOrder(order, String(active.id), String(over.id));
    if (moved) update({ order: moved });
  };
  const onVisibleChange = (slot: SlotId, visible: boolean) => update({
    hidden: visible ? hidden.filter((item) => item !== slot) : [...hidden, slot],
  });
  return (
    <FieldSet className="min-w-0 gap-3 pt-1">
      <FieldLegend variant="label" className="mb-0">主页区域</FieldLegend>
      {topSearch && <FieldDescription>时钟可选左上角或右上角。</FieldDescription>}
      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}
        modifiers={[restrictToVerticalAxis]}
        accessibility={{ screenReaderInstructions: { draggable: '使用上下方向键调整顺序，或用鼠标、触屏拖动。' } }}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol aria-label="主页区域顺序"
            className="settings-slot-list min-w-0 rounded-xl border border-border/50 bg-muted/25 [&>li+li]:border-t [&>li+li]:border-border/40">
            {order.map((slot, index) => <SortableSlotRow key={slot} slot={slot} index={index}
              total={order.length} visible={!hidden.includes(slot)} hidden={hidden}
              onMove={move} onVisibleChange={onVisibleChange}
              clockPosition={topSearch ? clockPosition : null}
              onClockPositionChange={(next) => update({ clockPosition: next })} />)}
          </ol>
        </SortableContext>
      </DndContext>
      <Button type="button" variant="outline" size="sm" className="self-start"
        onClick={() => update({ order: [...DEFAULT_LAYOUT.order], hidden: [] })}>恢复主页内容</Button>
    </FieldSet>
  );
}
