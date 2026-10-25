import { useState, type KeyboardEvent } from 'react';
import { HOME_COLUMNS, type HomePlacement } from '@/domain/home';
import { notifyError } from '@/lib/notify';

const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
};

export function useHomeKeyboard(move: (placement: HomePlacement) => Promise<void>) {
  const [target, setTarget] = useState<HomePlacement | null>(null);
  const [message, setMessage] = useState('');
  const handle = (event: KeyboardEvent<HTMLDivElement>, placement: HomePlacement) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Escape' && target) {
      event.preventDefault(); setTarget(null); setMessage('已取消移动'); return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!target) { setTarget(placement); setMessage('已拾起条目，用方向键选择格位，空格放下，Esc 取消'); return; }
      const destination = target;
      setTarget(null);
      void move(destination).then(() => setMessage('位置已保存')).catch(notifyError);
      return;
    }
    const delta = DIRECTIONS[event.key];
    if (!delta || target?.id !== placement.id) return;
    event.preventDefault();
    const next = { ...target, row: Math.max(0, target.row + delta[0]),
      column: Math.min(HOME_COLUMNS - 1, Math.max(0, target.column + delta[1])) };
    setTarget(next); setMessage(`第 ${next.row + 1} 行，第 ${next.column + 1} 列，按空格放下`);
  };
  return { target, message, handle };
}
