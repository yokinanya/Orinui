import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_LAYOUT, type SlotId } from '@/domain/layout';
import { notifyError } from '@/lib/notify';
import { ClockSettingsPanel } from '@/features/settings/ClockSettingsPanel';

const SLOT_LABELS: Record<SlotId, string> = {
  clock: '时钟',
  search: '搜索',
  shortcuts: '快捷方式',
};

interface LayoutRowProps {
  readonly slot: SlotId;
  readonly index: number;
  readonly count: number;
  readonly visible: boolean;
  readonly onMove: (index: number, direction: 'up' | 'down') => void;
  readonly onVisibilityChange: (slot: SlotId, visible: boolean) => void;
}

function LayoutRow({ slot, index, count, visible, onMove, onVisibilityChange }: LayoutRowProps) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-muted/60">
      <span className="truncate text-sm">{SLOT_LABELS[slot]}</span>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`上移${SLOT_LABELS[slot]}`}
          disabled={index === 0} onClick={() => onMove(index, 'up')}><ArrowUpIcon /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`下移${SLOT_LABELS[slot]}`}
          disabled={index === count - 1} onClick={() => onMove(index, 'down')}><ArrowDownIcon /></Button>
        <Switch aria-label={`显示${SLOT_LABELS[slot]}`} checked={visible}
          onCheckedChange={(checked) => onVisibilityChange(slot, checked === true)} />
      </div>
    </li>
  );
}

/**
 * 布局设置。
 *
 * 数据契约 §4：只提供三个固定区域的显示开关与上/下移，不提供拖拽、
 * 任意位置或尺寸调整。设置入口不属于可隐藏区域，始终保留。
 */
export function LayoutPanel() {
  const { settings, updateLayout } = useData();
  const { order, hidden } = settings.layout;

  const move = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= order.length) return;

    const next = [...order];
    const current = next[index];
    const neighbour = next[target];
    if (!current || !neighbour) return;

    next[index] = neighbour;
    next[target] = current;
    void updateLayout({ order: next, hidden }).catch(notifyError);
  };

  const toggleVisible = (slot: SlotId, visible: boolean) => {
    const nextHidden = visible ? hidden.filter((item) => item !== slot) : [...hidden, slot];
    void updateLayout({ order, hidden: nextHidden }).catch(notifyError);
  };

  return (
    <div className="flex flex-col gap-3">
      <ClockSettingsPanel />
      <ul className="flex flex-col gap-1">
        {order.map((slot, index) => (
          <LayoutRow key={slot} slot={slot} index={index} count={order.length}
            visible={!hidden.includes(slot)} onMove={move} onVisibilityChange={toggleVisible} />
        ))}
      </ul>
      <Button type="button" variant="outline" onClick={() => void updateLayout(DEFAULT_LAYOUT).catch(notifyError)}>
        恢复默认布局
      </Button>
    </div>
  );
}
