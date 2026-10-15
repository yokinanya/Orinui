import { useCallback, useEffect, useRef, useState } from 'react';
import { Field, FieldLabel } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import { useThrottledEmit } from '@/hooks/use-throttled-emit';
import { notifyError } from '@/lib/notify';

const PERCENT = 100;
const MIN_PERCENT = 0;
const PERCENT_STEP = 1;
const LARGE_STEP = 10;

interface MaskProps {
  readonly strength: number;
  readonly dynamic?: boolean;
  readonly onUpdate: (strength: number) => Promise<void>;
}

export function BackgroundMaskField({ strength, dynamic = false, onUpdate }: MaskProps) {
  const saved = Math.round(strength * PERCENT);
  const [percent, setPercent] = useState(saved);
  const pendingPercent = useRef<number | null>(null);
  const emit = useCallback((value: string) => { void onUpdate(Number(value) / PERCENT).catch(notifyError); }, [onUpdate]);
  const { emit: queueUpdate, flush } = useThrottledEmit(emit);
  useEffect(() => {
    if (pendingPercent.current !== null && pendingPercent.current !== saved) return;
    pendingPercent.current = null;
    setPercent(saved);
  }, [saved]);
  const preview = (value: number | readonly number[]) => {
    const next = typeof value === 'number' ? value : value[0] ?? MIN_PERCENT;
    pendingPercent.current = next;
    setPercent(next);
    queueUpdate(String(next));
  };
  const label = dynamic ? '动态壁纸遮罩强度' : '照片遮罩强度';
  const labelId = dynamic ? 'motion-mask-label' : 'photo-mask-label';
  return <Field>
    <div className="flex items-center justify-between gap-2">
      <FieldLabel id={labelId}>{label}（%）</FieldLabel>
      <output aria-label={`当前${label}`} className="text-sm text-muted-foreground tabular-nums">{percent}%</output>
    </div>
    <Slider aria-labelledby={labelId} value={[percent]} min={MIN_PERCENT} max={PERCENT} step={PERCENT_STEP}
      largeStep={LARGE_STEP} onValueChange={preview} onValueCommitted={(value) => { preview(value); flush(); }} />
  </Field>;
}
