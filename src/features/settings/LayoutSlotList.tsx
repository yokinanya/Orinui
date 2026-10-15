import {
  closestCorners, DndContext, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type Modifier,
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
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_LAYOUT, type SlotId } from '@/domain/layout';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

const SLOT_LABELS: Record<SlotId, string> = { clock: '时钟', search: '搜索', shortcuts: '快捷方式' };
const DRAG_DISTANCE = 8;
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

interface SlotRowProps {
  readonly slot: SlotId;
  readonly index: number;
  readonly total: number;
  readonly visible: boolean;
  readonly onMove: (index: number, direction: 'up' | 'down') => void;
  readonly onVisibleChange: (slot: SlotId, visible: boolean) => void;
}

function SortableSlotRow({ slot, index, total, visible, onMove, onVisibleChange }: SlotRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: slot });
  const label = SLOT_LABELS[slot];
  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onMove(index, event.key === 'ArrowUp' ? 'up' : 'down');
  };
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative flex min-h-11 items-center gap-0.5 bg-background/50 px-1.5 sm:gap-1 sm:px-2', isDragging && 'z-10 shadow-sm')}>
      <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon-xs"
        aria-label={`拖动${label}排序，方向键调整位置`} title={`拖动${label}排序`} className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        {...attributes} {...listeners} onKeyDown={onHandleKeyDown}><GripVerticalIcon /></Button>
      <span aria-hidden="true" className="hidden w-4 shrink-0 text-xs tabular-nums text-muted-foreground sm:block">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`上移${label}`}
          disabled={index === 0} onClick={() => onMove(index, 'up')}><ArrowUpIcon /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`下移${label}`}
          disabled={index === total - 1} onClick={() => onMove(index, 'down')}><ArrowDownIcon /></Button>
        <Switch size="sm" aria-label={`显示${label}`} checked={visible}
          onCheckedChange={(checked) => onVisibleChange(slot, checked === true)} />
      </div>
    </li>
  );
}

export function LayoutSlotList() {
  const { settings, updateLayout } = useData();
  const { order, hidden } = settings.layout;
  const update = (patch: Partial<typeof settings.layout>) => void updateLayout(patch).catch(notifyError);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
  );
  const move = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= order.length) return;
    update({ order: arrayMove(order, index, target) });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as SlotId);
    const to = order.indexOf(over.id as SlotId);
    if (from >= 0 && to >= 0) update({ order: arrayMove(order, from, to) });
  };
  const onVisibleChange = (slot: SlotId, visible: boolean) => update({
    hidden: visible ? hidden.filter((item) => item !== slot) : [...hidden, slot],
  });
  return (
    <FieldSet className="min-w-0 gap-3 pt-1">
      <FieldLegend variant="label" className="mb-0">主页区域</FieldLegend>
      <DndContext sensors={sensors} collisionDetection={closestCorners}
        modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: '使用上下方向键调整顺序，或用鼠标、触屏拖动。' } }}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="settings-slot-list min-w-0 rounded-xl border border-border/50 bg-muted/25 [&>li+li]:border-t [&>li+li]:border-border/40">
            {order.map((slot, index) => <SortableSlotRow key={slot} slot={slot} index={index}
              total={order.length} visible={!hidden.includes(slot)} onMove={move} onVisibleChange={onVisibleChange} />)}
          </ol>
        </SortableContext>
      </DndContext>
      <Button type="button" variant="outline" size="sm" className="self-start"
        onClick={() => update({ order: [...DEFAULT_LAYOUT.order], hidden: [] })}>恢复主页内容</Button>
    </FieldSet>
  );
}
