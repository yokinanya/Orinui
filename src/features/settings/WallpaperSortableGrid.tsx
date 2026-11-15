import {
  closestCenter, DndContext, KeyboardCode, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragCancelEvent, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import type { MediaAsset } from '@/domain/asset';
import { assetDisplayName, WallpaperCard } from '@/features/settings/WallpaperCard';
import { useSettingsDragGuard } from '@/features/settings/settings-drag-guard';

const DRAG_DIRECTION_CODES: ReadonlySet<string> = new Set([
  KeyboardCode.Up, KeyboardCode.Down, KeyboardCode.Left, KeyboardCode.Right,
]);

/**
 * 弹层内方向键桥接。
 *
 * 设置面板是 Base UI DialogPopup：它在祖先冒泡阶段对方向键停止传播，而 dnd-kit 的
 * KeyboardSensor 激活后把 keydown 挂在 document 上，真实方向键因此到不了传感器。
 * 拖动手柄位于该祖先之前，所以在激活态把方向键转发一份到 document，让 KeyboardSensor
 * 收到且只收到一次；只有当传感器确实消费（defaultPrevented）时才吞掉原事件。
 * 未激活、非方向键（Space/Enter/Escape/Tab 等）一律不改动。
 */
function forwardActiveArrowKey(event: KeyboardEvent<HTMLButtonElement>, dragging: boolean): void {
  if (!dragging) return;
  const native = event.nativeEvent;
  if (!native.isTrusted || native.defaultPrevented || !DRAG_DIRECTION_CODES.has(native.code)) return;
  // 只在会吞掉方向键的弹层祖先内桥接；没有该祖先时原生事件本就能到达 document。
  if (!event.currentTarget.closest('[role="dialog"]')) return;
  const ownerDocument = event.currentTarget.ownerDocument;
  const view = ownerDocument.defaultView;
  if (!view) return;
  const forwarded = new view.KeyboardEvent('keydown', {
    key: native.key, code: native.code, location: native.location, repeat: native.repeat,
    ctrlKey: native.ctrlKey, altKey: native.altKey, shiftKey: native.shiftKey, metaKey: native.metaKey,
    bubbles: true, cancelable: true,
  });
  ownerDocument.dispatchEvent(forwarded);
  // 传感器未挂载或未处理时不吞键，保留浏览器默认行为。
  if (!forwarded.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
}

interface GridProps {
  readonly assets: readonly MediaAsset[];
  readonly activeId: string | null;
  readonly selectedId: string | null;
  readonly busy: boolean;
  readonly gridRef: RefObject<HTMLDivElement | null>;
  readonly onSelect: (id: string) => void;
  readonly onReorder: (id: string, targetId: string) => Promise<void>;
}

function SortableCard({ asset, input }: { readonly asset: MediaAsset; readonly input: GridProps }) {
  const sortable = useSortable({ id: asset.id, disabled: input.busy });
  const listenerKeyDown = sortable.listeners?.onKeyDown;
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    listenerKeyDown?.(event);
    forwardActiveArrowKey(event, sortable.isDragging);
  };
  return <div ref={sortable.setNodeRef} data-asset-id={asset.id} className="relative min-w-0"
    style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <WallpaperCard asset={asset} active={asset.id === input.activeId} selected={asset.id === input.selectedId} onSelect={input.onSelect} />
    <Button ref={sortable.setActivatorNodeRef} type="button" variant="secondary" size="icon-xs"
      className="absolute top-2 right-2 touch-none cursor-grab active:cursor-grabbing" disabled={input.busy}
      aria-label={`拖动${assetDisplayName(asset)}排序`} {...sortable.attributes} {...sortable.listeners} onKeyDown={handleKeyDown}>
      <GripVerticalIcon />
    </Button>
  </div>;
}

export function WallpaperSortableGrid(input: GridProps) {
  const dragGuard = useSettingsDragGuard();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const begin = (_: DragStartEvent) => dragGuard?.setDragging(true);
  const settle = () => dragGuard?.setDragging(false);
  const drop = ({ active, over }: DragEndEvent) => {
    settle();
    if (over && active.id !== over.id) void input.onReorder(String(active.id), String(over.id)).catch(() => {
      // The library operation reports the error in the workspace and operation center.
    });
  };
  const cancel = (_: DragCancelEvent) => settle();
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragStart={begin} onDragEnd={drop} onDragCancel={cancel}>
    <SortableContext items={input.assets.map(({ id }) => id)} strategy={rectSortingStrategy}>
      <div ref={input.gridRef} aria-label="壁纸素材列表" className="grid min-w-0 grid-cols-2 gap-3">
        {input.assets.map((asset) => <SortableCard key={asset.id} asset={asset} input={input} />)}
      </div>
    </SortableContext>
  </DndContext>;
}
